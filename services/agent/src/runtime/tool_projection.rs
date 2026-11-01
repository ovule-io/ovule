//! Rig projection of the SDK-independent injected capability registry.
use crate::harness::{CapabilityRegistry, ProviderLimits};
use crate::runtime::{ModelError, ModelTurn};
use ::rig::completion::ToolDefinition;
use ::rig::message::{ToolCall, ToolResultContent};
use ovule_agent_api::{WorkerEvent, WorkerEventCallback};
use serde_json::Value;
use std::{collections::BTreeSet, time::Instant};

/// SDK adapter over one Attempt-owned registry, including shutdown of its leases.
pub(super) struct AttemptTools {
    registry: CapabilityRegistry,
    notify: WorkerEventCallback,
    attempt_id: String,
}
impl AttemptTools {
    pub fn new(turn: &ModelTurn, notify: WorkerEventCallback) -> Result<Self, ModelError> {
        let providers = if turn.structured_goal {
            Vec::new()
        } else {
            turn.capability_providers.clone()
        };
        Ok(Self {
            registry: CapabilityRegistry::new(
                providers,
                turn.execution.clone(),
                notify.clone(),
                ProviderLimits::default(),
            )
            .map_err(ModelError::Failed)?,
            notify,
            attempt_id: turn.execution.attempt_id.clone(),
        })
    }
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.registry
            .exposed()
            .into_iter()
            .map(|tool| ToolDefinition {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            })
            .collect()
    }
    pub async fn invoke(
        &mut self,
        call: &ToolCall,
        exposed: &BTreeSet<String>,
    ) -> DynamicToolResult {
        let started = Instant::now();
        let result = self
            .registry
            .invoke(&call.function.name, &call.function.arguments, exposed)
            .await
            .map_or_else(
                |e| dynamic_tool_error(&e),
                |value| native_tool_result(&value),
            );
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.attempt_id.clone(),
            kind: "harness/tool_projection".into(),
            detail_json: serde_json::json!({
                "schema_version": 1, "tool": call.function.name, "call_id": call.id,
                "status": if result.is_error { "failed" } else { "succeeded" },
                "duration_ms": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            })
            .to_string(),
        });
        result
    }
    pub async fn shutdown(&mut self) -> Result<(), String> {
        self.registry.shutdown().await
    }
}
pub(in crate::runtime) struct DynamicToolResult {
    pub(in crate::runtime) text: String,
    pub(in crate::runtime) is_error: bool,
    pub(in crate::runtime) media: Vec<ToolResultContent>,
}

/// Convert only a typed native media envelope, never an arbitrary text string.
pub(super) fn native_tool_result(value: &Value) -> DynamicToolResult {
    const MAX_MEDIA_BASE64_BYTES: usize = 16 * 1024 * 1024;
    let mut media = Vec::new();
    let mut media_bytes = 0;
    let mut summary = value.clone();
    if let Some(content) = summary.get_mut("content").and_then(Value::as_array_mut) {
        for item in content {
            if item.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let mime = match item.get("mimeType").and_then(Value::as_str) {
                Some("image/png") => ::rig::message::ImageMediaType::PNG,
                Some("image/jpeg") => ::rig::message::ImageMediaType::JPEG,
                Some("image/webp") => ::rig::message::ImageMediaType::WEBP,
                _ => return dynamic_tool_error("Unsupported native image media type"),
            };
            if let Some(data) = item.get("data").and_then(Value::as_str) {
                if data.len() > MAX_MEDIA_BASE64_BYTES - media_bytes {
                    return dynamic_tool_error(
                        "Native image result exceeds the 16 MiB base64 media budget; no image was attached",
                    );
                }
                media_bytes += data.len();
                media.push(ToolResultContent::image_base64(
                    data.to_owned(),
                    Some(mime),
                    None,
                ));
                let bytes = data.len();
                item["data"] = serde_json::json!({"omitted":true,"base64_bytes":bytes});
            } else {
                return dynamic_tool_error("Native image result is missing base64 data");
            }
        }
    }
    DynamicToolResult {
        text: summary.to_string(),
        is_error: value.get("isError").and_then(Value::as_bool) == Some(true),
        media,
    }
}

pub(in crate::runtime) fn dynamic_tool_error(error: &str) -> DynamicToolResult {
    DynamicToolResult {
        media: Vec::new(),
        text: serde_json::json!({"error": error}).to_string(),
        is_error: true,
    }
}

#[cfg(test)]
mod media_tests {
    use super::*;
    #[test]
    fn domain_error_fields_are_data_and_mcp_error_envelopes_are_failures() {
        assert!(
            !native_tool_result(&serde_json::json!({"error":"legitimate document field"})).is_error
        );
        assert!(native_tool_result(&serde_json::json!({"isError":true,"content":[]})).is_error);
        assert!(dynamic_tool_error("failed").is_error);
    }

    #[test]
    fn desktop_image_above_old_limit_reaches_model_without_base64_in_text() {
        let data = "AAAA".repeat(1_048_577);
        let result = native_tool_result(&serde_json::json!({"content":[
            {"type":"image","mimeType":"image/png","data":data}
        ]}));
        assert_eq!(result.media.len(), 1);
        assert!(result.text.len() < 200);
        assert!(result.text.contains("base64_bytes"));
    }

    #[test]
    fn oversized_image_is_an_explicit_error_instead_of_silent_omission() {
        let result = native_tool_result(&serde_json::json!({"content":[
            {"type":"image","mimeType":"image/png","data":"A".repeat(16*1024*1024+1)}
        ]}));
        assert_eq!(result.media.len(), 0);
        assert!(result.text.contains("\"error\""));
        assert!(result.text.contains("no image was attached"));
    }
}
