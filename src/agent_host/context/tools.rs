//! Shared progressive Skill and scoped Memory operations for all drivers.
use super::{ToolTrace, TraceSink};
use ovule_memory::{Access, MemoryService};
use ovule_skills::SkillCatalog;
use serde_json::Value;
use std::{sync::Arc, time::Instant};

#[derive(Clone)]
pub struct ContextTools {
    pub(crate) skills: SkillCatalog,
    pub(crate) memory: Arc<MemoryService>,
    pub(crate) access: Access,
    pub(crate) trace: Option<TraceSink>,
    pub(crate) next_call: Arc<std::sync::atomic::AtomicU64>,
}
impl ContextTools {
    pub fn call(&self, tool: &str, arguments: &Value) -> Result<Value, String> {
        let start = Instant::now();
        let action = arguments
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("");
        let result = self.invoke(tool, arguments).and_then(|value| {
            if value.to_string().chars().count() > 15_000 {
                Err("Context result exceeds its disclosure budget; retry with a smaller limit/page. No partial JSON was returned.".into())
            } else { Ok(value) }
        });
        if let Some(trace) = &self.trace {
            trace(&ToolTrace {
                schema_version: 1,
                attempt_id: self.access.attempt_id.clone(),
                call_id: self
                    .next_call
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                tool: tool.into(),
                operation: if ["list", "read", "resource", "search", "get", "put", "delete"]
                    .contains(&action)
                {
                    action
                } else {
                    "invalid"
                }
                .into(),
                status: if result.is_ok() {
                    "succeeded"
                } else {
                    "failed"
                }
                .into(),
                duration_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
                input_bytes: arguments.to_string().len(),
                output_bytes: result.as_ref().map_or(0, |value| value.to_string().len()),
            });
        }
        result
    }
    fn invoke(&self, tool: &str, args: &Value) -> Result<Value, String> {
        if self.access.readable.is_empty() {
            return Err("context tools are not granted on this Attempt".into());
        }
        match tool {
            "ovule_skills" => ovule_skills::capability::call(&self.skills, args),
            "ovule_memory" => ovule_memory::capability::call(&self.memory, &self.access, args),
            _ => Err("unknown context tool".into()),
        }
    }
    #[must_use]
    pub fn providers(&self) -> Vec<Arc<dyn ovule_agent_api::CapabilityProvider>> {
        vec![
            ovule_skills::capability::provider(self.skills.clone()),
            ovule_memory::capability::provider(self.memory.clone(), self.access.clone()),
        ]
    }
}
#[must_use]
pub fn now_ms() -> i64 {
    ovule_memory::capability::now_ms()
}
