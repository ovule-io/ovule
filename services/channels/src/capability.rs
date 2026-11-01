use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use serde_json::Value;
use std::sync::Arc;
#[must_use]
pub fn provider(
    host: Arc<dyn crate::ChannelToolHost>,
    attempt_id: String,
) -> Arc<dyn CapabilityProvider> {
    Arc::new(ChannelLease { host, attempt_id })
}
#[derive(Clone)]
struct ChannelLease {
    host: Arc<dyn crate::ChannelToolHost>,
    attempt_id: String,
}
#[async_trait]
impl CapabilityLease for ChannelLease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        channel_definitions()
    }
    async fn invoke(
        &mut self,
        name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        let tool = name
            .strip_prefix("ovule_channel_")
            .ok_or_else(|| ProviderError::Tool("Unsupported channel tool".into()))?;
        self.host
            .invoke(&self.attempt_id, &snake_to_camel(tool), args)
            .map_err(ProviderError::Tool)
    }
    async fn close(&mut self) -> Result<(), String> {
        Ok(())
    }
}
#[async_trait]
impl CapabilityProvider for ChannelLease {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "channels".into(),
            description: "Channel status and durable subscriptions".into(),
        }
    }
    fn effect(&self, _name: &str, _args: &Value) -> ToolEffect {
        ToolEffect::External
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        channel_definitions()
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        Ok(Box::new(self.clone()))
    }
}
#[must_use]
pub fn channel_dynamic_tools() -> Vec<Value> {
    vec![
        serde_json::json!({
            "namespace": "ovule_channel", "name": "status",
            "description": "Read live Channel bot setup and verification state: provisioning, WebSocket health, owner pairing, inbound message, Agent attempt and durable reply. Omit connectionId to discover connections; then use the exact connectionId. CLI login is separate from bot setup.",
            "inputSchema": {"type": "object", "additionalProperties": false, "properties": {"connectionId": {"type": "string"}}}
        }),
        serde_json::json!({
            "namespace": "ovule_channel",
            "name": "subscribeCurrent",
            "description": "Subscribe the current channel conversation as a durable raw-message feed for this Ovule Thread.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "properties": {"label": {"type": "string", "maxLength": 128}}
            }
        }),
        serde_json::json!({
            "namespace": "ovule_channel",
            "name": "listSubscriptions",
            "description": "List durable channel feeds owned by the current Ovule Thread.",
            "inputSchema": {"type": "object", "additionalProperties": false}
        }),
        serde_json::json!({
            "namespace": "ovule_channel",
            "name": "readFeed",
            "description": "Read ordered raw messages from one channel subscription.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["subscriptionId"],
                "properties": {
                    "subscriptionId": {"type": "string"},
                    "afterSequence": {"type": "integer", "minimum": 0},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100}
                }
            }
        }),
        serde_json::json!({
            "namespace": "ovule_channel",
            "name": "unsubscribe",
            "description": "Stop capturing new messages for a channel subscription owned by the current Ovule Thread.",
            "inputSchema": {
                "type": "object", "additionalProperties": false,
                "required": ["subscriptionId"],
                "properties": {"subscriptionId": {"type": "string"}}
            }
        }),
    ]
}

#[must_use]
pub fn channel_definitions() -> Vec<CapabilityDefinition> {
    channel_dynamic_tools()
        .into_iter()
        .filter_map(|tool| {
            Some(CapabilityDefinition {
                name: format!(
                    "ovule_channel_{}",
                    camel_to_snake(tool.get("name")?.as_str()?)
                ),
                description: tool.get("description")?.as_str()?.to_owned(),
                input_schema: tool.get("inputSchema")?.clone(),
            })
        })
        .collect()
}

fn camel_to_snake(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_ascii_uppercase() {
            output.push('_');
            output.push(character.to_ascii_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

#[must_use]
pub fn snake_to_camel(value: &str) -> String {
    let mut output = String::new();
    let mut uppercase = false;
    for character in value.chars() {
        if character == '_' {
            uppercase = true;
        } else if uppercase {
            output.push(character.to_ascii_uppercase());
            uppercase = false;
        } else {
            output.push(character);
        }
    }
    output
}
