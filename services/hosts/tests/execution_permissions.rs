#![cfg(target_os = "macos")]
use ovule_agent::{
    execution::{
        ToolExecutor,
        approval::{ApprovalBroker, ApprovalEvents},
    },
    harness::{CapabilityRegistry, DISCOVERY_TOOL, ProviderLimits},
};
use ovule_agent_api::{CancellationToken, WorkerEvent};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
};

struct Events(Mutex<Vec<Value>>);
impl ApprovalEvents for Events {
    fn emit(&self, value: &Value) -> Result<(), String> {
        self.0.lock().unwrap().push(value.clone());
        Ok(())
    }
}
#[tokio::test]
async fn approval_is_required_for_each_scoped_grant_and_denial_never_dispatches() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let secret = std::fs::canonicalize(outside.path())
        .unwrap()
        .join("fixture");
    std::fs::write(&secret, "fixture-value").unwrap();
    let provider =
        ovule_hosts::capability::provider(vec![ovule_hosts::capability::WorkspaceCapability {
            id: "thread-default".into(),
            transport: ovule_hosts::providers::local(workspace.path().into()).unwrap(),
        }]);
    let events = Arc::new(Events(Mutex::new(Vec::new())));
    let broker = Arc::new(ApprovalBroker::new(events.clone()));
    let messages = Arc::new(Mutex::new(Vec::new()));
    let sink = messages.clone();
    let notify: ovule_agent_api::WorkerEventCallback =
        Arc::new(move |event| sink.lock().unwrap().push(event));
    let execution = Arc::new(ToolExecutor::new(
        "attempt".into(),
        CancellationToken::new(),
        broker.clone(),
        notify.clone(),
    ));
    let mut registry =
        CapabilityRegistry::new(vec![provider], execution, notify, ProviderLimits::default())
            .unwrap();
    registry
        .invoke(
            DISCOVERY_TOOL,
            &json!({"action":"load","names":["ovule_workspace_exec","ovule_workspace_policy"]}),
            &BTreeSet::from([DISCOVERY_TOOL.into()]),
        )
        .await
        .unwrap();
    let exposed = BTreeSet::from([
        "ovule_workspace_exec".into(),
        "ovule_workspace_policy".into(),
    ]);
    let policy = registry
        .invoke(
            "ovule_workspace_policy",
            &json!({"bindingId":"thread-default"}),
            &exposed,
        )
        .await
        .unwrap();
    assert_eq!(policy["executionLocation"], "local_host");
    assert_eq!(policy["supportsPermissionRequests"], true);
    assert_eq!(policy["network"], false);
    assert_eq!(policy["processInfo"], "self only");
    assert_invalid_path_not_presented(&mut registry, &exposed, &events).await;
    let request = json!({"bindingId":"thread-default","argv":["/bin/cat",secret],"reason":"Read the fixture for this diagnostic only","permissions":{"readPaths":[secret]}});
    for allow in [false, true, false] {
        events.0.lock().unwrap().clear();
        let approve = async {
            let event = loop {
                if let Some(value) = events
                    .0
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|value| value["kind"] == "request")
                    .cloned()
                {
                    break value;
                }
                tokio::task::yield_now().await;
            };
            assert_eq!(event["automaticAllowed"], false);
            assert_eq!(event["arguments"], request);
            broker
                .resolve_scoped(event["requestId"].as_str().unwrap(), allow, true)
                .unwrap();
        };
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(
                registry.invoke("ovule_workspace_exec", &request, &exposed),
                approve
            )
        })
        .await
        .unwrap();
        assert_eq!(result.is_ok(), allow);
        if let Ok(value) = result {
            assert_eq!(value["stdout"], "fixture-value");
        }
    }
    let plain = json!({"bindingId":"thread-default","argv":["/bin/cat",secret]});
    assert!(
        registry
            .invoke("ovule_workspace_exec", &plain, &exposed)
            .await
            .is_err()
    );
    assert!(messages.lock().unwrap().iter().any(|event|matches!(event,WorkerEvent::Diagnostic{detail_json,..} if detail_json.contains("PermissionDenied"))));
    registry.shutdown().await.unwrap();
}

async fn assert_invalid_path_not_presented(
    registry: &mut CapabilityRegistry,
    exposed: &BTreeSet<String>,
    events: &Events,
) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("missing");
    let missing = json!({"bindingId":"thread-default","argv":["/bin/ls",path],"reason":"Inspect fixture","permissions":{"readPaths":[path]}});
    let invalid = registry
        .invoke("ovule_workspace_exec", &missing, exposed)
        .await
        .unwrap_err();
    assert!(invalid.contains("invalid workspace path"));
    assert!(
        !events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["kind"] == "request"),
        "invalid paths never present an approval card"
    );
}
