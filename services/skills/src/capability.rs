//! Progressive Skills tool owned by the Skills service.
use crate::SkillCatalog;
use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use serde_json::{Value, json};
use std::sync::Arc;
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
struct SkillsProvider(SkillCatalog);
#[must_use]
pub fn provider(catalog: SkillCatalog) -> Arc<dyn CapabilityProvider> {
    Arc::new(SkillsProvider(catalog))
}
#[must_use]
pub fn tool_definition() -> CapabilityDefinition {
    definition(
        &json!({"name":"ovule_skills","description":"Discover selected Skills, activate their instructions, and read referenced resources progressively.","inputSchema":{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["list","read","resource"]},"id":{"type":"string"},"path":{"type":"string"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":12000}}}}),
    )
}
pub fn call(catalog: &SkillCatalog, args: &Value) -> Result<Value, String> {
    validate_arguments(args)?;
    invoke(catalog, args).and_then(bounded)
}
fn invoke(catalog: &SkillCatalog, args: &Value) -> Result<Value, String> {
    let action = text(args, "action")?;
    match action {
        "list" => {
            let skills = catalog.list();
            let offset = number(args, "offset", 0)?;
            if offset > skills.len() {
                return Err("Skill offset exceeds catalog length".into());
            }
            let end = (offset + number(args, "limit", 20)?).min(skills.len());
            Ok(
                json!({"skills":&skills[offset..end],"offset":offset,"next_offset":(end<skills.len()).then_some(end),"total":skills.len()}),
            )
        }
        "read" | "resource" => Ok(serde_json::to_value(catalog.read(
            text(args, "id")?,
            if action == "resource" {
                Some(text(args, "path")?)
            } else {
                None
            },
            number(args, "offset", 0)?,
            number(args, "limit", 12_000)?,
        )?)
        .map_err(|e| e.to_string())?),
        _ => Err("unsupported Skill action".into()),
    }
}
#[async_trait]
impl CapabilityProvider for SkillsProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "skills".into(),
            description: "Selected progressive Skills".into(),
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
impl CapabilityLease for SkillsProvider {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        CapabilityProvider::definitions(self)
    }
    async fn invoke(
        &mut self,
        _name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        call(&self.0, args).map_err(ProviderError::Tool)
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
fn validate_arguments(args: &Value) -> Result<(), String> {
    let object = args.as_object().ok_or("tool arguments must be an object")?;
    let fields: &[&str] = &["action", "id", "path", "offset", "limit"];
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
    let maximum = if action == "list" { 20 } else { 12000 };
    if let Some(limit) = object.get("limit").and_then(Value::as_u64)
        && (limit == 0 || limit > maximum)
    {
        return Err(format!("limit must be between 1 and {maximum}"));
    }
    Ok(())
}
