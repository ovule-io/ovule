//! Scoped Memory tool owned by the Memory service.
use crate::{Access, Memory, MemoryService, Provenance};
use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
fn definition(value: &Value) -> CapabilityDefinition {
    CapabilityDefinition {
        name: value["name"].as_str().unwrap_or_default().into(),
        description: value["description"].as_str().unwrap_or_default().into(),
        input_schema: value["inputSchema"].clone(),
    }
}
fn bounded(value: Value) -> Result<Value, String> {
    if value.to_string().chars().count() > 15_000 {
        Err("Context result exceeds its disclosure budget; retry with a smaller limit/page. No partial JSON was returned.".into())
    } else {
        Ok(value)
    }
}

#[derive(Clone)]
struct MemoryProvider {
    memory: Arc<MemoryService>,
    access: Access,
}
#[must_use]
pub fn provider(memory: Arc<MemoryService>, access: Access) -> Arc<dyn CapabilityProvider> {
    Arc::new(MemoryProvider { memory, access })
}
#[must_use]
pub fn tool_definition() -> CapabilityDefinition {
    definition(
        &json!({"name":"ovule_memory","description":"Search/read sourced knowledge; persist or delete Thread memory with revision checks. No secrets or instructions.","inputSchema":{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["search","get","put","delete"]},"scope":{"type":"string"},"key":{"type":"string"},"query":{"type":"string","maxLength":4096},"title":{"type":"string","maxLength":512},"body":{"type":"string","maxLength":32768},"source":{"type":"string","maxLength":512},"expectedRevision":{"type":"integer","minimum":0},"ttlSeconds":{"type":"integer","minimum":1,"maximum":31_536_000},"limit":{"type":"integer","minimum":1,"maximum":12000},"offset":{"type":"integer","minimum":0}}}}),
    )
}
pub fn call(memory: &MemoryService, access: &Access, args: &Value) -> Result<Value, String> {
    if access.readable.is_empty() {
        return Err("context tools are not granted on this Attempt".into());
    }
    validate_arguments(args)?;
    MemoryTool { memory, access }
        .invoke_memory(args, text(args, "action")?)
        .and_then(bounded)
}
struct MemoryTool<'a> {
    memory: &'a MemoryService,
    access: &'a Access,
}
impl MemoryTool<'_> {
    fn invoke_memory(&self, args: &Value, action: &str) -> Result<Value, String> {
        let scope = args
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or(&self.access.readable[0]);
        let now = now_ms();
        match action {
            "search" => {
                let hits = self.memory.search(
                    self.access,
                    scope,
                    args.get("query").and_then(Value::as_str).unwrap_or(""),
                    now,
                    number(args, "limit", 5)?,
                )?;
                // Search discloses metadata/snippets. Full bodies require get.
                Ok(
                    json!({"scope":scope,"hits":hits.iter().map(|m|json!({"key":m.key,"revision":m.revision,"title":m.title,"snippet":m.body.chars().take(240).collect::<String>(),"provenance":m.provenance})).collect::<Vec<_>>(),"untrustedData":true}),
                )
            }
            "get" => {
                let mut memory = self
                    .memory
                    .get(self.access, scope, text(args, "key")?, now)?;
                let offset = number(args, "offset", 0)?;
                let limit = number(args, "limit", 8000)?;
                let mut next_offset = None;
                let mut total_chars = 0;
                if let Some(memory) = &mut memory {
                    total_chars = memory.body.chars().count();
                    if offset > total_chars {
                        return Err("memory offset exceeds content length".into());
                    }
                    memory.body = memory.body.chars().skip(offset).take(limit).collect();
                    let end = offset + memory.body.chars().count();
                    next_offset = (end < total_chars).then_some(end);
                }
                Ok(
                    json!({"memory":memory,"currentRevision":self.memory.revision(self.access,scope,text(args,"key")?)?,"offset":offset,"nextOffset":next_offset,"totalChars":total_chars,"untrustedData":true}),
                )
            }
            "put" => {
                let expected = revision(args)?;
                let expiry = args
                    .get("ttlSeconds")
                    .map(|value| {
                        value
                            .as_i64()
                            .filter(|v| (1..=31_536_000).contains(v))
                            .ok_or("invalid memory TTL")
                    })
                    .transpose()?
                    .map(|ttl| now.saturating_add(ttl * 1000));
                let memory = Memory {
                    scope: scope.into(),
                    key: text(args, "key")?.into(),
                    revision: expected,
                    title: text(args, "title")?.into(),
                    body: text(args, "body")?.into(),
                    provenance: Provenance {
                        attempt_id: self.access.attempt_id.clone(),
                        source: text(args, "source")?.into(),
                        observed_at_ms: now,
                    },
                    expires_at_ms: expiry,
                };
                let saved = self.memory.put(self.access, &memory, expected, now)?;
                Ok(json!({"scope":saved.scope,"key":saved.key,"revision":saved.revision}))
            }
            "delete" => {
                self.memory
                    .delete(self.access, scope, text(args, "key")?, revision(args)?)?;
                Ok(json!({"deleted":true,"revision":revision(args)? + 1}))
            }
            _ => Err("unsupported memory action".into()),
        }
    }
}
#[async_trait]
impl CapabilityProvider for MemoryProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "memory".into(),
            description: "Scoped persistent Memory".into(),
        }
    }
    fn effect(&self, _name: &str, _args: &Value) -> ToolEffect {
        ToolEffect::Workspace
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        vec![tool_definition()]
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        Ok(Box::new(self.clone()))
    }
}
#[async_trait]
impl CapabilityLease for MemoryProvider {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        CapabilityProvider::definitions(self)
    }
    async fn invoke(
        &mut self,
        _name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        call(&self.memory, &self.access, args).map_err(ProviderError::Tool)
    }
    async fn close(&mut self) -> Result<(), String> {
        Ok(())
    }
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} must be a string"))
}
fn number(value: &Value, key: &str, default: usize) -> Result<usize, String> {
    value.get(key).map_or(Ok(default), |v| {
        v.as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| format!("{key} must be a nonnegative integer"))
    })
}
fn revision(value: &Value) -> Result<i64, String> {
    value
        .get("expectedRevision")
        .and_then(Value::as_i64)
        .filter(|v| *v >= 0)
        .ok_or_else(|| "expectedRevision is required".into())
}
#[must_use]
pub fn now_ms() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

fn validate_arguments(args: &Value) -> Result<(), String> {
    let object = args.as_object().ok_or("tool arguments must be an object")?;
    let fields: &[&str] = &[
        "action",
        "scope",
        "key",
        "query",
        "title",
        "body",
        "source",
        "expectedRevision",
        "ttlSeconds",
        "offset",
        "limit",
    ];
    if args.to_string().len() > 65536 {
        return Err("tool arguments exceed 64 KiB".into());
    }
    for (key, value) in object {
        if !fields.contains(&key.as_str()) {
            return Err(format!("unknown argument: {key}"));
        }
        if ["offset", "limit", "expectedRevision", "ttlSeconds"].contains(&key.as_str()) {
            if value.as_u64().is_none() {
                return Err(format!("{key} must be a nonnegative integer"));
            }
        } else if !value.is_string() {
            return Err(format!("{key} must be a string"));
        }
    }
    let action = text(args, "action")?;
    let maximum = if action == "search" { 20 } else { 12000 };
    if let Some(limit) = object.get("limit").and_then(Value::as_u64)
        && (limit == 0 || limit > maximum)
    {
        return Err(format!("limit must be between 1 and {maximum}"));
    }
    Ok(())
}
