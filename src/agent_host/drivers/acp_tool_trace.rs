//! Status-only ACP projection. Partial updates retain titles; raw content stays
//! in the ACP/tool channels rather than being copied into a second journal.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
};
#[derive(Default)]
pub(super) struct AcpToolTrace(HashMap<String, Value>);
impl AcpToolTrace {
    pub(super) fn update(&mut self, value: &Value) -> Option<(String, String)> {
        if !matches!(
            value.get("sessionUpdate")?.as_str()?,
            "tool_call" | "tool_call_update"
        ) {
            return None;
        }
        let id = value.get("toolCallId")?.as_str()?;
        if id.len() > 1024 || (!self.0.contains_key(id) && self.0.len() >= 512) {
            return None;
        }
        let existed = self.0.contains_key(id);
        let item = self
            .0
            .entry(id.to_owned())
            .or_insert_with(|| json!({"name":"ACP tool","state":"pending"}));
        let before = item.clone();
        if let Some(title) = value.get("title").and_then(Value::as_str) {
            item["name"] = Value::String(title.chars().take(512).collect());
        }
        if let Some(status) = value.get("status").and_then(Value::as_str) {
            item["state"] = json!(match status {
                "in_progress" => "running",
                "completed" => "completed",
                "failed" => "failed",
                _ => "pending",
            });
        }
        if existed && *item == before {
            return None;
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        id.hash(&mut hash);
        Some((format!("acp-tool-{:016x}", hash.finish()), item.to_string()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_updates_preserve_title_and_do_not_project_raw_payloads() {
        let mut trace = AcpToolTrace::default();
        let (id, _) = trace.update(&json!({"sessionUpdate":"tool_call","toolCallId":"abc","title":"Read workspace","rawInput":{"secret":"do not copy"}})).unwrap();
        let (next, data) = trace.update(&json!({"sessionUpdate":"tool_call_update","toolCallId":"abc","status":"completed","rawOutput":"do not copy"})).unwrap();
        assert_eq!(id, next);
        let data: Value = serde_json::from_str(&data).unwrap();
        assert_eq!(data, json!({"name":"Read workspace","state":"completed"}));
        assert!(trace.update(&json!({"sessionUpdate":"tool_call_update","toolCallId":"abc","status":"completed","content":["new stdout"]})).is_none());
        assert!(
            trace
                .update(&json!({"sessionUpdate":"agent_message_chunk"}))
                .is_none()
        );
    }
}
