use ovule_browser::{BrowserBroker, BrowserEvents};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
#[derive(Default)]
struct Events(Mutex<Vec<Value>>);
impl BrowserEvents for Events {
    fn emit(&self, request: &Value) -> Result<(), String> {
        self.0.lock().unwrap().push(request.clone());
        Ok(())
    }
}
#[tokio::test]
async fn requests_are_correlated_and_lease_cleanup_is_owned() {
    let events = Arc::new(Events::default());
    let broker = Arc::new(BrowserBroker::new(events.clone()));
    let lease = broker.lease("a", "thread-a").unwrap();
    assert!(broker.lease("a", "thread-a").is_err());
    let pending = tokio::spawn({
        let lease = lease.clone();
        async move {
            lease
                .call(&json!({"action":"open","url":"https://example.test"}))
                .await
        }
    });
    tokio::task::yield_now().await;
    let request = events.0.lock().unwrap()[0].clone();
    assert_eq!(request["attemptId"], "a");
    assert_eq!(request["threadId"], "thread-a");
    assert!(!broker.respond("unknown", "{}").unwrap());
    assert!(
        broker
            .respond(
                request["requestId"].as_str().unwrap(),
                "{\"url\":\"https://example.test\"}"
            )
            .unwrap()
    );
    assert!(pending.await.unwrap().is_ok());
    assert!(
        lease
            .call(&json!({"action":"open","url":"file:///etc/passwd"}))
            .await
            .is_err()
    );
    drop(lease);
    assert_eq!(
        events.0.lock().unwrap().last().unwrap()["arguments"]["action"],
        "close"
    );
    assert!(broker.lease("a", "thread-a").is_ok());
}
