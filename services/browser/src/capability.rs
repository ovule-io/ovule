use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use serde_json::Value;
use std::sync::Arc;
#[must_use]
pub fn provider(
    broker: Arc<crate::BrowserBroker>,
    attempt_id: String,
    thread_id: String,
) -> Arc<dyn CapabilityProvider> {
    Arc::new(BrowserProvider {
        broker,
        attempt_id,
        thread_id,
    })
}
struct BrowserProvider {
    broker: Arc<crate::BrowserBroker>,
    attempt_id: String,
    thread_id: String,
}
struct BrowserLease(Option<Arc<crate::BrowserLease>>);
fn browser_definition() -> CapabilityDefinition {
    CapabilityDefinition {name:"ovule_browser".into(),description:"Use this Attempt's isolated HTTP(S) browser. Snapshot before click/type by ref. Input is DOM based; user takeover pauses actions.".into(),input_schema:serde_json::json!({"type":"object","required":["action"],"additionalProperties":false,"properties":{
"action":{"type":"string","enum":["open","navigate","snapshot","screenshot","click","type","scroll","close"]},"url":{"type":"string"},"ref":{"type":"string"},"text":{"type":"string","maxLength":16000},"deltaY":{"type":"number"}}})}
}
#[async_trait]
impl CapabilityProvider for BrowserProvider {
    fn effect(&self, _name: &str, _args: &Value) -> ToolEffect {
        ToolEffect::Workspace
    }
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "browser".into(),
            description: "Attempt-owned isolated web browser".into(),
        }
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        vec![browser_definition()]
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        Ok(Box::new(BrowserLease(Some(
            self.broker.lease(&self.attempt_id, &self.thread_id)?,
        ))))
    }
}
#[async_trait]
impl CapabilityLease for BrowserLease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        vec![browser_definition()]
    }
    async fn invoke(
        &mut self,
        _name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        self.0
            .as_ref()
            .ok_or_else(|| ProviderError::Unavailable("Browser lease closed".into()))?
            .call(args)
            .await
            .map_err(ProviderError::Tool)
    }
    async fn close(&mut self) -> Result<(), String> {
        self.0.take();
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Events;
    impl crate::BrowserEvents for Events {
        fn emit(&self, _request: &Value) -> Result<(), String> {
            Ok(())
        }
    }
    #[tokio::test]
    async fn browser_provider_does_not_reserve_capacity_until_acquired_and_close_releases_it() {
        let broker = Arc::new(crate::BrowserBroker::new(Arc::new(Events)));
        let provider = BrowserProvider {
            broker: broker.clone(),
            attempt_id: "browser-fixture".into(),
            thread_id: "thread".into(),
        };
        assert_eq!(provider.definitions().len(), 1);
        let probe = broker.lease("browser-fixture", "thread").unwrap();
        drop(probe);
        let mut lease = provider.acquire(CancellationToken::new()).await.unwrap();
        assert!(broker.lease("browser-fixture", "thread").is_err());
        lease.close().await.unwrap();
        let probe = broker.lease("browser-fixture", "thread").unwrap();
        drop(probe);
        let lease = provider.acquire(CancellationToken::new()).await.unwrap();
        drop(lease);
        assert!(broker.lease("browser-fixture", "thread").is_ok());
    }
}
