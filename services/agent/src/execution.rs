//! Shared admission, permissions, deadlines and cancellation for tool projections.
pub mod approval;
mod details;
use approval::ApprovalBroker;
use ovule_agent_api::CancellationToken;
use ovule_agent_api::{WorkerEvent, WorkerEventCallback};
use serde_json::{Value, json};
use std::{
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};

pub use ovule_agent_api::ToolEffect as Effect;
pub trait ExecutionJournal: Send + Sync {
    fn begin(&self, call_id: &str, attempt_id: &str, tool: &str) -> Result<(), String>;
    fn finish(&self, call_id: &str, state: &str) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureKind {
    Cancelled,
    Denied,
    Timeout,
    Backend,
    PermissionDenied,
    Process,
    Unavailable,
}
#[derive(Debug)]
pub struct ToolFailure {
    pub kind: FailureKind,
    pub message: String,
}
impl ToolFailure {
    fn backend(message: String) -> Self {
        let detail = serde_json::from_str::<Value>(&message).ok();
        let kind = detail
            .as_ref()
            .filter(|value| value.get("isError").and_then(Value::as_bool) == Some(true))
            .and_then(|value| value.get("failureKind"))
            .and_then(Value::as_str)
            .map_or(FailureKind::Backend, |kind| match kind {
                "permission_denied" => FailureKind::PermissionDenied,
                "process_failed" | "process_terminated" => FailureKind::Process,
                "execution_unavailable" => FailureKind::Unavailable,
                _ => FailureKind::Backend,
            });
        Self { kind, message }
    }
}
impl std::fmt::Display for ToolFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}
impl std::error::Error for ToolFailure {}
pub struct ToolExecutor {
    pub attempt_id: String,
    pub cancellation: CancellationToken,
    pub approvals: Arc<ApprovalBroker>,
    notify: WorkerEventCallback,
    journal: Option<Arc<dyn ExecutionJournal>>,
}
impl Drop for ToolExecutor {
    fn drop(&mut self) {
        self.approvals.revoke_attempt(&self.attempt_id);
    }
}
impl ToolExecutor {
    #[must_use]
    pub fn new(
        attempt_id: String,
        cancellation: CancellationToken,
        approvals: Arc<ApprovalBroker>,
        notify: WorkerEventCallback,
    ) -> Self {
        Self {
            attempt_id,
            cancellation,
            approvals,
            notify,
            journal: None,
        }
    }
    #[must_use]
    pub fn with_journal(mut self, journal: Arc<dyn ExecutionJournal>) -> Self {
        self.journal = Some(journal);
        self
    }
    pub async fn authorize(&self, tool: &str, args: &Value) -> Result<(), ToolFailure> {
        self.authorize_scoped(tool, args, false).await
    }
    async fn authorize_scoped(
        &self,
        tool: &str,
        args: &Value,
        once: bool,
    ) -> Result<(), ToolFailure> {
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.attempt_id.clone(),
            kind: "harness/approval".into(),
            detail_json: json!({"schema_version":1,"tool":tool,"status":"pending","mode":if self.approvals.review_enabled().unwrap_or(false){"review"}else{"ask"}}).to_string(),
        });
        let decision = self
            .approvals
            .request_decision(&self.attempt_id, tool, args, &self.cancellation, once)
            .await;
        let approved_status = match &decision {
            Ok(approval::ApprovalDecision::Review) => "approved_by_policy",
            Ok(approval::ApprovalDecision::Task) => "approved_for_task",
            _ => "approved_once",
        };
        let presented = match &decision {
            Err(approval::ApprovalFailure::TimedOut { presented }) => Some(*presented),
            _ => None,
        };
        let result = decision.map_err(|failure| ToolFailure {
            kind: match &failure {
                approval::ApprovalFailure::Cancelled => FailureKind::Cancelled,
                approval::ApprovalFailure::TimedOut { .. } => FailureKind::Timeout,
                approval::ApprovalFailure::Denied => FailureKind::Denied,
                approval::ApprovalFailure::Unavailable(_) => FailureKind::Unavailable,
            },
            message: failure.to_string(),
        });
        let status = result.as_ref().map_or_else(
            |error| match error.kind {
                FailureKind::Timeout => "timed_out",
                FailureKind::Cancelled => "cancelled",
                FailureKind::Unavailable => "unavailable",
                _ => "denied",
            },
            |_| approved_status,
        );
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.attempt_id.clone(),
            kind: "harness/approval".into(),
            detail_json: json!({
                "schema_version": 1, "tool": tool, "presented": presented,
                "mode": if self.approvals.review_enabled().unwrap_or(false) { "review" } else { "ask" },
                "status": status,
            }).to_string(),
        });
        result.map(|_| ())
    }

    fn tool_message(
        &self,
        call_id: &str,
        tool: &str,
        state: &str,
        elapsed: Duration,
        details: Option<&Value>,
    ) {
        let mut data = json!({"name":tool,"state":state,"durationMs":u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)});
        if let Some(Value::Object(fields)) = details {
            data.as_object_mut()
                .expect("tool card object")
                .extend(fields.clone());
        }
        (self.notify)(WorkerEvent::MessageBlock {
            attempt_id: self.attempt_id.clone(),
            block_id: format!("tool-{call_id}"),
            kind: "tool".into(),
            // Only explicitly observed calls add bounded display previews.
            // Execution diagnostics and journal entries remain body-free.
            data_json: data.to_string(),
        });
    }

    pub async fn run<T, F, Fut>(
        &self,
        tool: &str,
        args: &Value,
        effect: Effect,
        deadline: Duration,
        call: F,
    ) -> Result<T, ToolFailure>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        self.run_inner(tool, args, effect, deadline, call, None)
            .await
    }

    /// Project bounded input/output previews into the user-visible tool card.
    pub async fn run_value<F, Fut>(
        &self,
        tool: &str,
        args: &Value,
        effect: Effect,
        deadline: Duration,
        call: F,
    ) -> Result<Value, ToolFailure>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        self.run_inner(
            tool,
            args,
            effect,
            deadline,
            |cancel| async move {
                let value = call(cancel).await?;
                if value.get("isError").and_then(Value::as_bool) == Some(true) {
                    return Err(value.to_string());
                }
                Ok(value)
            },
            Some(|value| value),
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_inner<T, F, Fut>(
        &self,
        tool: &str,
        args: &Value,
        effect: Effect,
        deadline: Duration,
        call: F,
        project: Option<fn(&T) -> &Value>,
    ) -> Result<T, ToolFailure>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let preview = project.map(|_| details::Details::new(args));
        let mut card = preview
            .as_ref()
            .map(|details| json!({"input":details.input}));
        let started = Instant::now();
        let call_id = format!("{:032x}", rand::random::<u128>());
        self.tool_message(&call_id, tool, "pending", Duration::ZERO, card.as_ref());
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.attempt_id.clone(),
            kind: "harness/execution".into(),
            detail_json: json!({
                "schema_version": 1, "call_id": call_id, "tool": tool,
                "status": "requested", "phase": "admission", "effect": format!("{effect:?}"),
            })
            .to_string(),
        });
        let result = async {
            if self.cancellation.is_cancelled() {
                return Err(ToolFailure { kind: FailureKind::Cancelled, message: "Attempt cancelled before dispatch".into() });
            }
            let admission_started = Instant::now();
            if matches!(effect, Effect::External | Effect::ExternalOnce) {
                tokio::time::timeout(deadline, self.authorize_scoped(tool, args, effect == Effect::ExternalOnce))
                    .await.map_err(|_| ToolFailure { kind: FailureKind::Timeout, message: "Approval deadline exceeded before dispatch".into() })??;
            }
            let remaining = deadline.saturating_sub(admission_started.elapsed());
            if remaining.is_zero() {
                return Err(ToolFailure { kind: FailureKind::Timeout, message: "Tool deadline exceeded before dispatch".into() });
            }
            let dispatch_started = Instant::now();
            if let Some(journal) = &self.journal {
                journal.begin(&call_id, &self.attempt_id, tool).map_err(|message| ToolFailure { kind: FailureKind::Backend, message })?;
            }
            let remaining = remaining.saturating_sub(dispatch_started.elapsed());
            if self.cancellation.is_cancelled() || remaining.is_zero() {
                if let Some(journal) = &self.journal {
                    journal.finish(&call_id, "cancelled").map_err(|message| ToolFailure { kind: FailureKind::Backend, message })?;
                }
                return Err(ToolFailure {
                    kind: if self.cancellation.is_cancelled() { FailureKind::Cancelled } else { FailureKind::Timeout },
                    message: "Execution revoked before backend dispatch".into(),
                });
            }
            self.tool_message(&call_id, tool, "running", started.elapsed(), card.as_ref());
            let child = self.cancellation.child_token();
            let future = call(child.clone());
            tokio::pin!(future);
            let result = tokio::select! {
                biased;
                () = self.cancellation.cancelled() => {
                    child.cancel();
                    let message = match tokio::time::timeout(Duration::from_secs(3), &mut future).await {
                        Ok(Ok(_)) => "Tool settled after cancellation; effects may have occurred".into(),
                        Ok(Err(message)) => message,
                        Err(_) => "Tool cancellation grace exceeded; backend completion is uncertain".into(),
                    };
                    // Cancellation takes precedence over a simultaneously ready result:
                    // child tokens may wake a cooperative backend before this select runs.
                    Err(ToolFailure { kind: FailureKind::Cancelled, message })
                },
                result = &mut future => {
                    if self.cancellation.is_cancelled() {
                        Err(ToolFailure { kind: FailureKind::Cancelled, message: "Tool settled while cancellation was being applied; effects may have occurred".into() })
                    } else {
                        result.map_err(ToolFailure::backend)
                    }
                },
                () = tokio::time::sleep(remaining) => {
                    child.cancel();
                    let _ = tokio::time::timeout(Duration::from_secs(3), &mut future).await;
                    Err(ToolFailure { kind: FailureKind::Timeout, message: "Tool deadline exceeded; inspect side effects before retrying".into() })
                }
            };
            if let Some(journal) = &self.journal {
                let state = match &result {
                    Ok(_) => "completed",
                    Err(error) => match error.kind {
                        FailureKind::Cancelled | FailureKind::Timeout => "uncertain",
                        _ => "failed",
                    },
                };
                journal.finish(&call_id, state).map_err(|message| ToolFailure {
                    kind: FailureKind::Backend,
                    message: format!("Execution settlement not persisted; inspect side effects: {message}"),
                })?;
            }
            result
        }.await;
        if let (Some(preview), Some(project), Some(card)) = (&preview, project, &mut card) {
            preview.record_result(card, project, &result);
        }
        if let (Some(project), Ok(value)) = (project, &result) {
            self.project_images(&call_id, project(value));
        }
        self.observe_settlement(&call_id, tool, started.elapsed(), card.as_ref(), &result);
        result
    }
    fn project_images(&self, call_id: &str, output: &Value) {
        let Some(content) = output.get("content").and_then(Value::as_array) else {
            return;
        };
        let mut remaining = 16 * 1024 * 1024;
        for (index, image) in content
            .iter()
            .enumerate()
            .filter(|(_, item)| item["type"] == "image")
            .take(4)
        {
            let Some(data) = image.get("data").and_then(Value::as_str) else {
                continue;
            };
            let Some(mime) = image.get("mimeType").and_then(Value::as_str) else {
                continue;
            };
            if !matches!(
                mime,
                "image/png" | "image/jpeg" | "image/webp" | "image/gif"
            ) || data.len() > remaining
            {
                continue;
            }
            remaining -= data.len();
            (self.notify)(WorkerEvent::MessageBlock {
                attempt_id: self.attempt_id.clone(),
                block_id: format!("tool-{call_id}-image-{index}"),
                kind: "image".into(),
                data_json: json!({"data":data,"mediaType":mime,"name":"Screenshot"}).to_string(),
            });
        }
    }
    fn observe_settlement<T>(
        &self,
        call_id: &str,
        tool: &str,
        elapsed: Duration,
        card: Option<&Value>,
        result: &Result<T, ToolFailure>,
    ) {
        let status = match result {
            Ok(_) => "completed",
            Err(error) if error.kind == FailureKind::Cancelled => "cancelled",
            Err(_) => "failed",
        };
        self.tool_message(call_id, tool, status, elapsed, card);
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.attempt_id.clone(),
            kind: "harness/execution".into(),
            detail_json: json!({
                "schema_version": 1, "call_id": call_id, "tool": tool,
                "status": status,
                "failure_kind": result.as_ref().err().map(|error| format!("{:?}", error.kind)),
                "duration_ms": elapsed.as_millis(),
            })
            .to_string(),
        });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct PendingEvents(std::sync::Mutex<Vec<Value>>);
    impl approval::ApprovalEvents for PendingEvents {
        fn emit(&self, value: &Value) -> Result<(), String> {
            self.0.lock().unwrap().push(value.clone());
            Ok(())
        }
    }
    #[tokio::test]
    async fn tool_images_are_projected_outside_bounded_tool_previews() {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let capture = events.clone();
        let executor = ToolExecutor::new(
            "attempt".into(),
            CancellationToken::new(),
            ApprovalBroker::unavailable(),
            Arc::new(move |event| capture.lock().unwrap().push(event)),
        );
        executor.run_value("screenshot", &json!({}), Effect::Workspace, Duration::from_secs(1), |_| async {
            Ok(json!({"content":[{"type":"image","mimeType":"image/png","data":"image-base64"}]}))
        }).await.unwrap();
        let events = events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(
                    |event| matches!(event, WorkerEvent::MessageBlock {kind, ..} if kind == "image")
                )
                .count(),
            1
        );
        for event in events.iter() {
            match event {
                WorkerEvent::MessageBlock {
                    kind, data_json, ..
                } if kind == "image" => assert!(data_json.contains("image-base64")),
                WorkerEvent::MessageBlock { data_json, .. }
                | WorkerEvent::Diagnostic {
                    detail_json: data_json,
                    ..
                } => assert!(!data_json.contains("image-base64")),
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn tool_status_stream_updates_one_card_without_copying_arguments() {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let capture = events.clone();
        let execution = ToolExecutor::new(
            "attempt".into(),
            CancellationToken::new(),
            ApprovalBroker::unavailable(),
            Arc::new(move |event| capture.lock().unwrap().push(event)),
        );
        execution
            .run(
                "read",
                &json!({"secret":"must not be projected"}),
                Effect::Workspace,
                Duration::from_secs(1),
                |_| async { Ok::<_, String>(()) },
            )
            .await
            .unwrap();
        let events = events.lock().unwrap();
        let parts = events
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::MessageBlock {
                    block_id,
                    data_json,
                    ..
                } => Some((block_id, serde_json::from_str::<Value>(data_json).unwrap())),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].0, parts[2].0);
        assert_eq!(parts[0].1["state"], "pending");
        assert_eq!(parts[1].1["state"], "running");
        assert_eq!(parts[2].1["state"], "completed");
        assert!(parts.iter().all(|(_, value)| value.get("input").is_none()
            && !value.to_string().contains("must not be projected")));
    }
    #[tokio::test]
    async fn observed_calls_keep_previews_on_one_card_and_diagnostics_body_free() {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let capture = events.clone();
        let execution = ToolExecutor::new(
            "attempt".into(),
            CancellationToken::new(),
            ApprovalBroker::unavailable(),
            Arc::new(move |event| capture.lock().unwrap().push(event)),
        );
        for fails in [false, true] {
            let _ = execution
                .run_value(
                    "fixture",
                    &json!({"action":"exec","token":"fixture-secret"}),
                    Effect::Workspace,
                    Duration::from_secs(1),
                    |_| async move {
                        if fails {
                            Err("failed fixture-secret: no Workspace selected".into())
                        } else {
                            Ok(json!({"stdout":"fixture output","stderr":"", "exit_code":0}))
                        }
                    },
                )
                .await;
        }
        let events = events.lock().unwrap();
        let parts = events
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::MessageBlock {
                    block_id,
                    data_json,
                    ..
                } => Some((block_id, serde_json::from_str::<Value>(data_json).unwrap())),
                WorkerEvent::Diagnostic { detail_json, .. } => {
                    assert!(!detail_json.contains("fixture output"));
                    assert!(!detail_json.contains("fixture-secret"));
                    None
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), 6);
        assert_eq!(parts[0].0, parts[2].0);
        assert_eq!(parts[3].0, parts[5].0);
        assert_ne!(parts[0].0, parts[3].0);
        assert_eq!(parts[2].1["output"]["stdout"], "fixture output");
        assert_eq!(parts[5].1["failureKind"], "Backend");
        assert!(
            parts[5].1["error"]
                .as_str()
                .unwrap()
                .contains("no Workspace selected")
        );
        assert!(
            parts
                .iter()
                .all(|(_, part)| !part.to_string().contains("fixture-secret"))
        );
    }
    #[tokio::test]
    async fn approval_timeout_revokes_pending_request_before_dispatch() {
        let events = Arc::new(PendingEvents(std::sync::Mutex::new(vec![])));
        let broker = Arc::new(ApprovalBroker::new(events.clone()));
        let execution = ToolExecutor::new(
            "attempt".into(),
            CancellationToken::new(),
            broker.clone(),
            Arc::new(|_| {}),
        );
        let result = execution
            .run(
                "external",
                &json!({}),
                Effect::External,
                Duration::from_millis(1),
                |_| async {
                    panic!("expired approval must not dispatch");
                    #[allow(unreachable_code)]
                    Ok::<(), String>(())
                },
            )
            .await;
        assert_eq!(result.unwrap_err().kind, FailureKind::Timeout);
        let events = events.0.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["kind"], "closed");
        assert!(
            !broker
                .resolve(events[0]["requestId"].as_str().unwrap(), true)
                .unwrap()
        );
    }

    #[tokio::test]
    async fn cooperative_success_after_cancellation_is_not_reported_as_completion() {
        let cancellation = CancellationToken::new();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = events.clone();
        let executor = ToolExecutor::new(
            "cancel-race".into(),
            cancellation.clone(),
            ApprovalBroker::unavailable(),
            Arc::new(move |event| captured.lock().unwrap().push(event)),
        );
        let task = tokio::spawn(async move {
            executor
                .run_value(
                    "fixture",
                    &json!({}),
                    Effect::Workspace,
                    Duration::from_secs(10),
                    |child| async move {
                        child.cancelled().await;
                        Ok(json!({"cleaned_up":true}))
                    },
                )
                .await
        });
        tokio::task::yield_now().await;
        cancellation.cancel();
        assert_eq!(
            task.await.unwrap().unwrap_err().kind,
            FailureKind::Cancelled
        );
        let states = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::MessageBlock { data_json, .. } => {
                    serde_json::from_str::<Value>(data_json).ok()
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(states.last().unwrap()["state"], "cancelled");
        assert!(!states.iter().any(|state| state["state"] == "completed"));
        assert!(events.lock().unwrap().iter().any(|event| matches!(event,
            WorkerEvent::Diagnostic { kind, detail_json, .. } if kind == "harness/execution"
                && serde_json::from_str::<Value>(detail_json).unwrap()["status"] == "cancelled")));
    }
    #[tokio::test]
    async fn cancellation_during_the_result_poll_does_not_report_success() {
        let cancellation = CancellationToken::new();
        let executor = ToolExecutor::new(
            "poll-race".into(),
            cancellation.clone(),
            ApprovalBroker::unavailable(),
            Arc::new(|_| {}),
        );
        let error = executor
            .run(
                "fixture",
                &json!({}),
                Effect::Workspace,
                Duration::from_secs(10),
                |_| async move {
                    cancellation.cancel();
                    Ok::<_, String>(())
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, FailureKind::Cancelled);
    }
    #[tokio::test]
    async fn cancellation_reaches_backend_and_waits_for_settlement() {
        let cancel = CancellationToken::new();
        let e = Arc::new(ToolExecutor::new(
            "a".into(),
            cancel.clone(),
            ApprovalBroker::unavailable(),
            Arc::new(|_| {}),
        ));
        let settled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = tokio::spawn({
            let settled = settled.clone();
            async move {
                e.run(
                    "read",
                    &json!({}),
                    Effect::Workspace,
                    Duration::from_secs(10),
                    |token| async move {
                        token.cancelled().await;
                        settled.store(true, std::sync::atomic::Ordering::SeqCst);
                        Err::<(), _>("cancelled".into())
                    },
                )
                .await
            }
        });
        tokio::task::yield_now().await;
        cancel.cancel();
        assert!(task.await.unwrap().is_err());
        assert!(settled.load(std::sync::atomic::Ordering::SeqCst));
    }
    #[tokio::test]
    async fn unavailable_approval_never_dispatches_side_effect() {
        let e = ToolExecutor::new(
            "a".into(),
            CancellationToken::new(),
            ApprovalBroker::unavailable(),
            Arc::new(|_| {}),
        );
        assert!(
            e.run(
                "external",
                &json!({}),
                Effect::External,
                Duration::from_secs(1),
                |_| async {
                    panic!("must not execute");
                    #[allow(unreachable_code)]
                    Ok::<(), String>(())
                }
            )
            .await
            .is_err()
        );
    }
}

#[cfg(test)]
mod journal_contract_tests {
    use super::*;
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    struct Journal {
        fail_begin: bool,
        fail_finish: bool,
        events: Mutex<Vec<&'static str>>,
    }
    impl ExecutionJournal for Journal {
        fn begin(&self, _call: &str, _attempt: &str, _tool: &str) -> Result<(), String> {
            self.events.lock().unwrap().push("intent");
            if self.fail_begin {
                Err("fixture intent rejected".into())
            } else {
                Ok(())
            }
        }
        fn finish(&self, _call: &str, _state: &str) -> Result<(), String> {
            self.events.lock().unwrap().push("settlement");
            if self.fail_finish {
                Err("fixture settlement rejected".into())
            } else {
                Ok(())
            }
        }
    }
    #[tokio::test]
    async fn injected_journal_commits_before_dispatch_and_reports_uncertain_settlement() {
        for (fail_begin, fail_finish) in [(true, false), (false, true), (false, false)] {
            let journal = Arc::new(Journal {
                fail_begin,
                fail_finish,
                events: Mutex::new(vec![]),
            });
            let calls = AtomicUsize::new(0);
            let executor = ToolExecutor::new(
                "fixture".into(),
                CancellationToken::new(),
                ApprovalBroker::unavailable(),
                Arc::new(|_| {}),
            )
            .with_journal(journal.clone());
            let result = executor
                .run(
                    "fixture",
                    &json!({}),
                    Effect::Workspace,
                    Duration::from_secs(1),
                    |_| async {
                        assert_eq!(journal.events.lock().unwrap().as_slice(), ["intent"]);
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    },
                )
                .await;
            assert_eq!(calls.load(Ordering::SeqCst), usize::from(!fail_begin));
            assert_eq!(result.is_err(), fail_begin || fail_finish);
            if fail_finish {
                assert!(result.unwrap_err().message.contains("inspect side effects"));
            }
        }
    }
}
