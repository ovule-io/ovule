//! Host-UI approvals with explicit task/tool grants. Model arguments cannot mint a grant.
use ovule_agent_api::CancellationToken;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;
pub trait ApprovalEvents: Send + Sync {
    fn emit(&self, request: &Value) -> Result<(), String>;
}
/// Trusted application policy; tool arguments alone cannot select an approval mode.
/// Returning false leaves the request for explicit user consent.
pub trait ApprovalReviewer: Send + Sync {
    fn approve(&self, tool: &str, arguments: &Value) -> bool;
}
pub struct ApprovalBroker {
    events: Arc<dyn ApprovalEvents>,
    reviewer: Option<Arc<dyn ApprovalReviewer>>,
    review_enabled: Mutex<bool>,
    pending: Mutex<HashMap<String, ApprovalRequest>>,
    automatic: Mutex<HashSet<(String, String)>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalDecision {
    Once,
    Task,
    Review,
    Denied,
}
struct ApprovalRequest {
    sender: oneshot::Sender<ApprovalDecision>,
    attempt: String,
    tool: String,
    automatic_allowed: bool,
    arguments: Value,
    expires_at_ms: i64,
    presented: bool,
}
#[derive(Clone, Debug)]
pub struct PendingApproval {
    pub request_id: String,
    pub attempt_id: String,
    pub tool: String,
    pub arguments: Value,
    pub automatic_allowed: bool,
    pub expires_at_ms: i64,
}
#[derive(Debug)]
pub enum ApprovalFailure {
    Denied,
    TimedOut { presented: bool },
    Cancelled,
    Unavailable(String),
}
impl std::fmt::Display for ApprovalFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Denied => f.write_str("Permission request was denied"),
            Self::TimedOut { presented } => write!(
                f,
                "Approval timed out after 120 seconds without a decision (card mounted: {presented}). This is not a user denial; do not claim the command ran or automatically repeat the request."
            ),
            Self::Cancelled => f.write_str("Approval cancelled before a decision"),
            Self::Unavailable(message) => write!(f, "Approval unavailable: {message}"),
        }
    }
}
impl std::error::Error for ApprovalFailure {}
fn now_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}
fn tool_scope(tool: &str, arguments: &Value) -> Option<String> {
    if tool != "acp.permission" {
        return Some(tool.to_owned());
    }
    // ACP multiplexes different operation kinds through one facade. A read
    // approval must not silently approve execution or edits in the same task.
    arguments
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| !kind.is_empty() && kind.len() <= 32)
        .map(|kind| format!("{tool}:{kind}"))
}
pub type ApprovalRuntime = tuffite_ioc::Service<ApprovalBroker>;
impl ApprovalBroker {
    #[must_use]
    pub fn new(events: Arc<dyn ApprovalEvents>) -> Self {
        Self {
            events,
            reviewer: None,
            review_enabled: Mutex::new(false),
            pending: Mutex::new(HashMap::new()),
            automatic: Mutex::new(HashSet::new()),
        }
    }
    #[must_use]
    pub fn with_reviewer(mut self, reviewer: Arc<dyn ApprovalReviewer>) -> Self {
        self.reviewer = Some(reviewer);
        self
    }
    pub fn review_enabled(&self) -> Result<bool, String> {
        self.review_enabled
            .lock()
            .map(|mode| *mode)
            .map_err(|_| "Approval mode lock poisoned".into())
    }
    /// App-session preference set only through the trusted UI bridge. Restart resets to asking.
    pub fn set_review_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled && self.reviewer.is_none() {
            return Err("Automatic approval reviewer is unavailable".into());
        }
        let mut mode = self
            .review_enabled
            .lock()
            .map_err(|_| "Approval mode lock poisoned")?;
        *mode = enabled;
        if enabled {
            let reviewed = self
                .pending
                .lock()
                .map_err(|_| "Approval lock poisoned")?
                .iter()
                .filter(|(_, request)| {
                    self.reviewer
                        .as_ref()
                        .is_some_and(|reviewer| reviewer.approve(&request.tool, &request.arguments))
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in reviewed {
                if self.resolve_decision(&id, true, false, true)? {
                    tracing::info!(
                        request_id = id,
                        "Pending invocation approved by trusted review policy"
                    );
                }
            }
        }
        Ok(())
    }
    fn can_review(&self, tool: &str, arguments: &Value) -> bool {
        self.review_enabled().unwrap_or(false)
            && self
                .reviewer
                .as_ref()
                .is_some_and(|reviewer| reviewer.approve(tool, arguments))
    }
    pub fn pending_for(&self, attempt: &str) -> Result<Vec<PendingApproval>, String> {
        let pending = self.pending.lock().map_err(|_| "Approval lock poisoned")?;
        let mut result = pending
            .iter()
            .filter(|(_, request)| request.attempt == attempt && !request.sender.is_closed())
            .map(|(id, request)| PendingApproval {
                request_id: id.clone(),
                attempt_id: request.attempt.clone(),
                tool: request.tool.clone(),
                arguments: request.arguments.clone(),
                automatic_allowed: request.automatic_allowed,
                expires_at_ms: request.expires_at_ms,
            })
            .collect::<Vec<_>>();
        result.sort_by(|a, b| {
            a.expires_at_ms
                .cmp(&b.expires_at_ms)
                .then(a.request_id.cmp(&b.request_id))
        });
        Ok(result)
    }
    /// Presentation acknowledgements never authorize a call.
    pub fn mark_presented(&self, id: &str) -> Result<bool, String> {
        let mut pending = self.pending.lock().map_err(|_| "Approval lock poisoned")?;
        if let Some(request) = pending.get_mut(id) {
            request.presented = true;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub fn resolve(&self, id: &str, allow: bool) -> Result<bool, String> {
        self.resolve_scoped(id, allow, false)
    }
    /// Only a live host-UI request can establish an automatic grant. The grant
    /// applies to this tool in this Attempt, never another task or tool.
    pub fn resolve_scoped(&self, id: &str, allow: bool, automatic: bool) -> Result<bool, String> {
        self.resolve_decision(id, allow, automatic, false)
    }
    fn resolve_decision(
        &self,
        id: &str,
        allow: bool,
        automatic: bool,
        reviewed: bool,
    ) -> Result<bool, String> {
        let request = self
            .pending
            .lock()
            .map_err(|_| "Approval lock poisoned")?
            .remove(id);
        let Some(request) = request else {
            return Ok(false);
        };
        let automatic = automatic && request.automatic_allowed;
        let key = (request.attempt, request.tool);
        if allow && automatic {
            let mut grants = self
                .automatic
                .lock()
                .map_err(|_| "Approval lock poisoned")?;
            if grants.len() >= 1024 {
                return Err("Too many automatic approval scopes".into());
            }
            grants.insert(key.clone());
        }
        let decision = if !allow {
            ApprovalDecision::Denied
        } else if reviewed {
            ApprovalDecision::Review
        } else if automatic {
            ApprovalDecision::Task
        } else {
            ApprovalDecision::Once
        };
        let sent = request.sender.send(decision).is_ok();
        if sent && allow && automatic {
            let mut pending = self.pending.lock().map_err(|_| "Approval lock poisoned")?;
            let matching = pending
                .iter()
                .filter(|(_, request)| {
                    request.automatic_allowed && request.attempt == key.0 && request.tool == key.1
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in matching {
                if let Some(request) = pending.remove(&id) {
                    let _ = request.sender.send(ApprovalDecision::Task);
                }
            }
        }
        if !sent && automatic {
            self.automatic
                .lock()
                .map_err(|_| "Approval lock poisoned")?
                .remove(&key);
        }
        Ok(sent)
    }
    pub fn is_automatic(&self, attempt: &str, tool: &str) -> bool {
        self.automatic
            .lock()
            .is_ok_and(|grants| grants.contains(&(attempt.to_owned(), tool.to_owned())))
    }
    pub fn is_automatic_for(&self, attempt: &str, tool: &str, arguments: &Value) -> bool {
        tool_scope(tool, arguments).is_some_and(|scope| self.is_automatic(attempt, &scope))
    }
    pub fn revoke_attempt(&self, attempt: &str) {
        if let Ok(mut grants) = self.automatic.lock() {
            grants.retain(|(id, _)| id != attempt);
        }
    }
    pub async fn request(
        self: &Arc<Self>,
        attempt: &str,
        tool: &str,
        arguments: &Value,
        cancellation: &CancellationToken,
    ) -> Result<(), ApprovalFailure> {
        self.request_decision(attempt, tool, arguments, cancellation, false)
            .await
            .map(|_| ())
    }
    pub async fn request_once(
        self: &Arc<Self>,
        attempt: &str,
        tool: &str,
        arguments: &Value,
        cancellation: &CancellationToken,
    ) -> Result<(), ApprovalFailure> {
        self.request_decision(attempt, tool, arguments, cancellation, true)
            .await
            .map(|_| ())
    }
    pub async fn request_decision(
        self: &Arc<Self>,
        attempt: &str,
        tool: &str,
        arguments: &Value,
        cancellation: &CancellationToken,
        once: bool,
    ) -> Result<ApprovalDecision, ApprovalFailure> {
        let allow_task_grant = !once;
        if arguments.to_string().len() > 16_384 {
            return Err(ApprovalFailure::Unavailable(
                "Approval preview exceeds limit; narrow the request".into(),
            ));
        }
        if cancellation.is_cancelled() {
            return Err(ApprovalFailure::Cancelled);
        }
        let scope = allow_task_grant
            .then(|| tool_scope(tool, arguments))
            .flatten();
        if allow_task_grant && self.is_automatic_for(attempt, tool, arguments) {
            return Ok(ApprovalDecision::Task);
        }
        if self.can_review(tool, arguments) {
            tracing::info!(
                attempt,
                tool,
                "Invocation approved by trusted review policy"
            );
            return Ok(ApprovalDecision::Review);
        }
        let id = format!("{:032x}", rand::random::<u128>());
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| ApprovalFailure::Unavailable("Approval lock poisoned".into()))?;
            if pending.len() >= 32 {
                return Err(ApprovalFailure::Unavailable(
                    "Too many pending approvals".into(),
                ));
            }
            pending.insert(
                id.clone(),
                ApprovalRequest {
                    sender: tx,
                    attempt: attempt.into(),
                    tool: scope.clone().unwrap_or_else(|| tool.to_owned()),
                    automatic_allowed: scope.is_some(),
                    arguments: arguments.clone(),
                    expires_at_ms: now_ms().saturating_add(120_000),
                    presented: false,
                },
            );
        }
        let _pending = Pending {
            broker: self.clone(),
            id: id.clone(),
        };
        // Recheck after insertion: a mode switch may have reviewed the pending map
        // between the first policy check and registration of this request.
        if self.can_review(tool, arguments)
            && self
                .resolve_decision(&id, true, false, true)
                .map_err(ApprovalFailure::Unavailable)?
        {
            return Ok(ApprovalDecision::Review);
        }
        self.events.emit(&json!({"kind":"request","requestId":id,"attemptId":attempt,"tool":scope.as_deref().unwrap_or(tool),"arguments":arguments,"automaticAllowed":scope.is_some(),"reviewFallback":self.review_enabled().unwrap_or(false)})).map_err(ApprovalFailure::Unavailable)?;
        tokio::select! { biased;
            ()=cancellation.cancelled()=>Err(ApprovalFailure::Cancelled),
            result=tokio::time::timeout(Duration::from_secs(120),rx)=>match result {
                Ok(Ok(ApprovalDecision::Denied))=>Err(ApprovalFailure::Denied),
                Ok(Ok(decision))=>Ok(decision),
                Ok(Err(_))=>Err(ApprovalFailure::Unavailable("Approval response channel closed".into())),
                Err(_)=>Err(ApprovalFailure::TimedOut {presented:self.pending.lock().is_ok_and(|pending|pending.get(&id).is_some_and(|request|request.presented))}),
            }
        }
    }
    #[must_use]
    pub fn unavailable() -> Arc<Self> {
        Arc::new(Self::new(Arc::new(Unavailable)))
    }
}
struct Unavailable;
impl ApprovalEvents for Unavailable {
    fn emit(&self, _: &Value) -> Result<(), String> {
        Err("Approval UI unavailable; operation denied".into())
    }
}
struct Pending {
    broker: Arc<ApprovalBroker>,
    id: String,
}
impl Drop for Pending {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.broker.pending.lock() {
            pending.remove(&self.id);
        }
        let _ = self
            .broker
            .events
            .emit(&json!({"kind":"closed","requestId":self.id}));
    }
}

pub fn register<C: Send + Sync + 'static>(
    r: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    use tuffite_ioc::{Service, factory};
    r.register(factory::<ApprovalRuntime, _, _>(|deps| {
        Ok(Arc::new(ApprovalBroker::new(
            deps.depends_on::<Service<dyn ApprovalEvents>>()?,
        )))
    }))?;
    Ok(())
}
pub fn register_unavailable_events<C: Send + Sync + 'static>(
    r: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    r.register(tuffite_ioc::factory::<
        tuffite_ioc::Service<dyn ApprovalEvents>,
        _,
        _,
    >(|_| Ok(Arc::new(Unavailable))))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Events(Mutex<Vec<Value>>);
    impl ApprovalEvents for Events {
        fn emit(&self, v: &Value) -> Result<(), String> {
            self.0.lock().unwrap().push(v.clone());
            Ok(())
        }
    }
    struct Reviewer;
    impl ApprovalReviewer for Reviewer {
        fn approve(&self, tool: &str, args: &Value) -> bool {
            tool == "read" && args.get("safe") == Some(&Value::Bool(true))
        }
    }
    #[tokio::test]
    async fn review_mode_checks_every_invocation_and_falls_back_to_manual() {
        let events = Arc::new(Events(Mutex::new(Vec::new())));
        let broker =
            Arc::new(ApprovalBroker::new(events.clone()).with_reviewer(Arc::new(Reviewer)));
        assert!(!broker.review_enabled().unwrap());
        let token = CancellationToken::new();
        let pending = tokio::spawn({
            let broker = broker.clone();
            let token = token.clone();
            async move {
                broker
                    .request_once("attempt", "read", &json!({"safe":true}), &token)
                    .await
            }
        });
        tokio::task::yield_now().await;
        assert_eq!(broker.pending_for("attempt").unwrap().len(), 1);
        broker.set_review_enabled(true).unwrap();
        pending.await.unwrap().unwrap();
        broker
            .request_once("attempt", "read", &json!({"safe":true}), &token)
            .await
            .unwrap();
        assert!(
            !broker.is_automatic("attempt", "read"),
            "review does not mint a task grant"
        );
        let pending = tokio::spawn({
            let broker = broker.clone();
            async move {
                broker
                    .request_once(
                        "attempt",
                        "read",
                        &json!({"safe":false,"mode":"review"}),
                        &CancellationToken::new(),
                    )
                    .await
            }
        });
        tokio::task::yield_now().await;
        let requests = broker.pending_for("attempt").unwrap();
        assert_eq!(
            requests.len(),
            1,
            "unknown invocations still require consent"
        );
        broker.resolve(&requests[0].request_id, false).unwrap();
        assert!(matches!(
            pending.await.unwrap(),
            Err(ApprovalFailure::Denied)
        ));
        broker.set_review_enabled(false).unwrap();
        assert!(!broker.can_review("read", &json!({"safe":true})));
        let no_reviewer = ApprovalBroker::new(events);
        assert!(no_reviewer.set_review_enabled(true).is_err());
    }
    #[tokio::test]
    async fn switching_review_mode_resolves_a_live_invocation_and_records_policy_source() {
        let broker = Arc::new(
            ApprovalBroker::new(Arc::new(Events(Mutex::new(vec![]))))
                .with_reviewer(Arc::new(Reviewer)),
        );
        let pending = tokio::spawn({
            let broker = broker.clone();
            async move {
                broker
                    .request_decision(
                        "live",
                        "read",
                        &json!({"safe":true}),
                        &CancellationToken::new(),
                        true,
                    )
                    .await
            }
        });
        tokio::task::yield_now().await;
        assert_eq!(broker.pending_for("live").unwrap().len(), 1);
        broker.set_review_enabled(true).unwrap();
        assert_eq!(pending.await.unwrap().unwrap(), ApprovalDecision::Review);
        assert!(broker.pending_for("live").unwrap().is_empty());
        assert!(!broker.is_automatic("live", "read"));
    }
    #[tokio::test(start_paused = true)]
    async fn pending_replay_and_presentation_never_grant_permission_and_timeout_is_not_denial() {
        for presented in [false, true] {
            let events = Arc::new(Events(Mutex::new(Vec::new())));
            let broker = Arc::new(ApprovalBroker::new(events));
            let task = tokio::spawn({
                let broker = broker.clone();
                async move {
                    broker
                        .request_once(
                            "attempt",
                            "read",
                            &json!({"path":"fixture"}),
                            &CancellationToken::new(),
                        )
                        .await
                }
            });
            tokio::task::yield_now().await;
            let pending = broker.pending_for("attempt").unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].arguments, json!({"path":"fixture"}));
            assert!(!pending[0].automatic_allowed);
            assert!(broker.pending_for("other").unwrap().is_empty());
            if presented {
                assert!(broker.mark_presented(&pending[0].request_id).unwrap());
            }
            assert!(!task.is_finished(), "presentation is never approval");
            tokio::time::advance(Duration::from_secs(120)).await;
            let failure = task.await.unwrap().unwrap_err();
            assert!(
                matches!(failure,ApprovalFailure::TimedOut{presented:actual} if actual==presented)
            );
            assert!(broker.pending_for("attempt").unwrap().is_empty());
            assert!(!broker.mark_presented(&pending[0].request_id).unwrap());
            assert!(!broker.resolve(&pending[0].request_id, true).unwrap());
        }
    }
    #[test]
    fn resolving_a_task_grant_does_not_approve_pending_invocation_only_requests() {
        let broker = ApprovalBroker::new(Arc::new(Events(Mutex::new(Vec::new()))));
        let (normal_tx, mut normal_rx) = oneshot::channel();
        let (once_tx, mut once_rx) = oneshot::channel();
        for (id, sender, automatic_allowed) in
            [("normal", normal_tx, true), ("once", once_tx, false)]
        {
            broker.pending.lock().unwrap().insert(
                id.into(),
                ApprovalRequest {
                    sender,
                    attempt: "a".into(),
                    tool: "t".into(),
                    automatic_allowed,
                    arguments: json!({}),
                    expires_at_ms: now_ms().saturating_add(120_000),
                    presented: false,
                },
            );
        }
        assert!(broker.resolve_scoped("normal", true, true).unwrap());
        assert_eq!(normal_rx.try_recv().unwrap(), ApprovalDecision::Task);
        assert!(matches!(
            once_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        assert!(broker.resolve("once", false).unwrap());
        assert_eq!(once_rx.try_recv().unwrap(), ApprovalDecision::Denied);
    }
    #[tokio::test]
    async fn invocation_approval_cannot_use_or_create_task_grants() {
        let events = Arc::new(Events(Mutex::new(Vec::new())));
        let broker = Arc::new(ApprovalBroker::new(events.clone()));
        broker
            .automatic
            .lock()
            .unwrap()
            .insert(("attempt".into(), "tool".into()));
        for allowed in [true, false] {
            let task = tokio::spawn({
                let broker = broker.clone();
                async move {
                    broker
                        .request_once(
                            "attempt",
                            "tool",
                            &json!({"permission":"fixture"}),
                            &CancellationToken::new(),
                        )
                        .await
                }
            });
            tokio::task::yield_now().await;
            let event = events
                .0
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|event| event["kind"] == "request")
                .unwrap()
                .clone();
            assert_eq!(event["automaticAllowed"], false);
            broker
                .resolve_scoped(event["requestId"].as_str().unwrap(), allowed, true)
                .unwrap();
            assert_eq!(task.await.unwrap().is_ok(), allowed);
        }
    }
    #[test]
    fn acp_auto_approval_never_crosses_operation_kinds() {
        let broker = ApprovalBroker::new(Arc::new(Events(Mutex::new(Vec::new()))));
        broker
            .automatic
            .lock()
            .unwrap()
            .insert(("task".into(), "acp.permission:read".into()));
        assert!(broker.is_automatic_for("task", "acp.permission", &json!({"kind":"read"})));
        assert!(!broker.is_automatic_for("task", "acp.permission", &json!({"kind":"execute"})));
        assert!(!broker.is_automatic_for("task", "acp.permission", &json!({"kind":"edit"})));
        assert!(!broker.is_automatic_for("task", "acp.permission", &json!({})));
        assert!(tool_scope("acp.permission", &json!({})).is_none());
    }
    #[tokio::test]
    async fn automatic_approval_is_bound_to_the_task_and_tool_and_is_revocable() {
        let events = Arc::new(Events(Mutex::new(Vec::new())));
        let broker = Arc::new(ApprovalBroker::new(events.clone()));
        let cancellation = CancellationToken::new();
        let task = tokio::spawn({
            let broker = broker.clone();
            let cancellation = cancellation.clone();
            async move {
                broker
                    .request(
                        "task-a",
                        "computer",
                        &json!({"action":"key"}),
                        &cancellation,
                    )
                    .await
            }
        });
        tokio::task::yield_now().await;
        let id = events
            .0
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|event| event["kind"] == "request")
            .unwrap()["requestId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(!broker.resolve_scoped("forged", true, true).unwrap());
        assert!(broker.resolve_scoped(&id, true, true).unwrap());
        task.await.unwrap().unwrap();
        broker
            .request(
                "task-a",
                "computer",
                &json!({"action":"type"}),
                &cancellation,
            )
            .await
            .unwrap();
        for (attempt, tool) in [("task-a", "shell"), ("task-b", "computer")] {
            let task = tokio::spawn({
                let broker = broker.clone();
                let cancellation = cancellation.clone();
                async move {
                    broker
                        .request(attempt, tool, &json!({}), &cancellation)
                        .await
                }
            });
            tokio::task::yield_now().await;
            let id = events
                .0
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|event| event["kind"] == "request")
                .unwrap()["requestId"]
                .as_str()
                .unwrap()
                .to_owned();
            broker.resolve(&id, false).unwrap();
            assert!(task.await.unwrap().is_err());
        }
        assert!(broker.is_automatic("task-a", "computer"));
        cancellation.cancel();
        assert!(
            broker
                .request("task-a", "computer", &json!({}), &cancellation)
                .await
                .is_err()
        );
        broker.revoke_attempt("task-a");
        assert!(!broker.is_automatic("task-a", "computer"));
    }
    #[tokio::test]
    async fn grant_is_exactly_once_and_cancel_removes_pending() {
        let events = Arc::new(Events(Mutex::new(Vec::new())));
        let b = Arc::new(ApprovalBroker::new(events.clone()));
        let c = CancellationToken::new();
        let task = tokio::spawn({
            let b = b.clone();
            let c = c.clone();
            async move {
                b.request("attempt", "exec", &json!({"argv":["test"]}), &c)
                    .await
            }
        });
        tokio::task::yield_now().await;
        let id = events.0.lock().unwrap()[0]["requestId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(!b.resolve("forged", true).unwrap());
        assert!(b.resolve(&id, true).unwrap());
        assert!(!b.resolve(&id, true).unwrap());
        task.await.unwrap().unwrap();
        let task = tokio::spawn({
            let b = b.clone();
            let c = c.clone();
            async move { b.request("attempt", "exec", &json!({}), &c).await }
        });
        tokio::task::yield_now().await;
        c.cancel();
        assert!(task.await.unwrap().is_err());
        assert_eq!(b.pending.lock().unwrap().len(), 0);
    }
}
