//! Protocol-independent, Attempt-local disclosure. Loading never grants execution.
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const DISCOVERY_TOOL: &str = "ovule_capabilities";
const MAX_ACTIVE: usize = 32;
const MAX_SCHEMA_BYTES: usize = 48_000;

pub use ovule_agent_api::CapabilityDefinition;
/// Pinned provider definitions with monotonic disclosure for one Attempt. There is no
/// global registration, credentials, backend startup or execution authority here.
pub struct CapabilityCatalog {
    definitions: BTreeMap<String, CapabilityDefinition>,
    active: BTreeSet<String>,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Search {
        #[serde(default)]
        query: String,
        #[serde(default)]
        offset: usize,
    },
    Load {
        names: Vec<String>,
    },
}
impl CapabilityCatalog {
    pub fn new(definitions: Vec<CapabilityDefinition>) -> Result<Self, String> {
        if definitions.len() > 2048 {
            return Err("Attempt capability catalog exceeds 2048 tools".into());
        }
        let mut indexed = BTreeMap::new();
        for definition in definitions {
            if definition.name == DISCOVERY_TOOL
                || definition.name.is_empty()
                || definition.name.len() > 64
                || !definition
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                || !definition.input_schema.is_object()
            {
                return Err("Invalid or reserved capability definition".into());
            }
            if indexed
                .insert(definition.name.clone(), definition)
                .is_some()
            {
                return Err("Duplicate capability name in Attempt catalog".into());
            }
        }
        Ok(Self {
            definitions: indexed,
            active: BTreeSet::new(),
        })
    }
    /// Atomically register a newly acquired provider's pinned definitions.
    pub fn register(&mut self, definitions: Vec<CapabilityDefinition>) -> Result<(), String> {
        let incoming = Self::new(definitions)?;
        if self.definitions.len() + incoming.definitions.len() > 2048
            || incoming
                .definitions
                .keys()
                .any(|name| self.definitions.contains_key(name))
        {
            return Err("Provider definitions collide or exceed the Attempt catalog limit".into());
        }
        self.definitions.extend(incoming.definitions);
        Ok(())
    }
    /// Stable ordering keeps identical request prefixes stable across rounds.
    #[must_use]
    pub fn exposed(&self) -> Vec<CapabilityDefinition> {
        let mut result = vec![Self::discovery_definition()];
        result.extend(
            self.active
                .iter()
                .filter_map(|name| self.definitions.get(name))
                .cloned(),
        );
        result
    }
    #[must_use]
    pub fn discovery_definition() -> CapabilityDefinition {
        CapabilityDefinition {
            name: DISCOVERY_TOOL.into(),
            description: crate::prompts::CAPABILITY_DISCOVERY.trim().into(),
            input_schema: json!({"type":"object","additionalProperties":false,"required":["action"],"properties":{
                "action":{"type":"string","enum":["search","load","providers","acquire"]},
                "provider":{"type":"string","maxLength":128},"query":{"type":"string","maxLength":256},"offset":{"type":"integer","minimum":0},
                "names":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","maxLength":64}}
            }}),
        }
    }
    pub fn call(&mut self, arguments: &Value) -> Result<Value, String> {
        let request: Request =
            serde_json::from_value(arguments.clone()).map_err(|e| e.to_string())?;
        match request {
            Request::Search { query, offset } => {
                if query.chars().count() > 256 {
                    return Err("Capability query exceeds 256 characters".into());
                }
                let query = query.to_lowercase();
                let matches = self
                    .definitions
                    .values()
                    .filter(|tool| {
                        tool.name.to_lowercase().contains(&query)
                            || tool.description.to_lowercase().contains(&query)
                    })
                    .collect::<Vec<_>>();
                if offset > matches.len() {
                    return Err("Capability offset exceeds matching catalog length".into());
                }
                let tools = matches.iter().skip(offset).take(8).map(|tool| json!({
                    "name":tool.name,"description":tool.description.chars().take(240).collect::<String>(),
                    "loaded":self.active.contains(&tool.name),
                })).collect::<Vec<_>>();
                let end = offset + tools.len();
                Ok(
                    json!({"tools":tools,"nextOffset":(end < matches.len()).then_some(end),"total":matches.len()}),
                )
            }
            Request::Load { names } => {
                if names.is_empty() || names.len() > 8 {
                    return Err("Load requires 1 to 8 exact tool names".into());
                }
                let mut active = self.active.clone();
                for name in names {
                    if !self.definitions.contains_key(&name) {
                        return Err("Tool is unavailable in this Attempt catalog".into());
                    }
                    active.insert(name);
                }
                if active.len() > MAX_ACTIVE {
                    return Err("Attempt exceeds 32 loaded tools; start a narrower Attempt".into());
                }
                let definitions = active
                    .iter()
                    .filter_map(|name| self.definitions.get(name))
                    .collect::<Vec<_>>();
                if serde_json::to_vec(&definitions)
                    .map_err(|e| e.to_string())?
                    .len()
                    > MAX_SCHEMA_BYTES
                {
                    return Err(
                        "Loaded capability schemas exceed the 48,000-byte request budget".into(),
                    );
                }
                self.active = active;
                Ok(
                    json!({"loaded":self.active,"effective":"next_model_request","grantsChanged":false}),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn definition(name: &str) -> CapabilityDefinition {
        CapabilityDefinition {
            name: name.into(),
            description: "Search workspace files 搜索".into(),
            input_schema: json!({"type":"object"}),
        }
    }
    #[test]
    fn discovery_is_bounded_and_does_not_load_schemas() {
        let mut catalog = CapabilityCatalog::new(
            (0..12)
                .map(|i| definition(&format!("tool_{i:02}")))
                .collect(),
        )
        .unwrap();
        assert_eq!(catalog.exposed().len(), 1);
        let first = catalog
            .call(&json!({"action":"search","query":"搜索"}))
            .unwrap();
        assert_eq!(first["tools"].as_array().unwrap().len(), 8);
        assert_eq!(first["nextOffset"], 8);
        assert!(!first.to_string().contains("inputSchema"));
        let second = catalog
            .call(&json!({"action":"search","offset":8}))
            .unwrap();
        assert_eq!(second["tools"].as_array().unwrap().len(), 4);
        assert_eq!(second["nextOffset"], Value::Null);
        assert_eq!(catalog.exposed().len(), 1);
    }
    #[test]
    fn load_is_atomic_attempt_local_and_keeps_stable_order() {
        let mut catalog = CapabilityCatalog::new(vec![definition("b"), definition("a")]).unwrap();
        assert!(
            catalog
                .call(&json!({"action":"load","names":["a","missing"]}))
                .is_err()
        );
        assert_eq!(catalog.exposed().len(), 1);
        catalog
            .call(&json!({"action":"load","names":["b","a","a"]}))
            .unwrap();
        let snapshot = catalog.exposed();
        assert_eq!(
            snapshot.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(),
            [DISCOVERY_TOOL, "a", "b"]
        );
        catalog
            .call(&json!({"action":"load","names":["a"]}))
            .unwrap();
        assert_eq!(catalog.exposed().len(), 3);
        assert_eq!(
            CapabilityCatalog::new(vec![definition("a")])
                .unwrap()
                .exposed()
                .len(),
            1
        );
    }
    #[test]
    fn active_tool_limit_rejects_without_partial_activation() {
        let mut catalog = CapabilityCatalog::new(
            (0..40)
                .map(|i| definition(&format!("tool_{i:02}")))
                .collect(),
        )
        .unwrap();
        for start in [0, 8, 16, 24] {
            let names = (start..start + 8)
                .map(|i| format!("tool_{i:02}"))
                .collect::<Vec<_>>();
            catalog
                .call(&json!({"action":"load","names":names}))
                .unwrap();
        }
        assert_eq!(catalog.exposed().len(), 33);
        assert!(
            catalog
                .call(&json!({"action":"load","names":["tool_32"]}))
                .is_err()
        );
        assert_eq!(catalog.exposed().len(), 33);
        assert!(!catalog.exposed().iter().any(|tool| tool.name == "tool_32"));
    }
    #[test]
    fn malformed_and_oversized_loads_never_change_disclosure() {
        let mut huge = definition("huge");
        huge.input_schema = json!({"description":"x".repeat(MAX_SCHEMA_BYTES)});
        let mut catalog = CapabilityCatalog::new(vec![definition("small"), huge]).unwrap();
        for request in [
            json!({"action":"search","unknown":true}),
            json!({"action":"load","names":[]}),
            json!({"action":"load","names":["small","huge"]}),
            json!({"action":"search","offset":99}),
            json!({"action":"load","names":["small"],"query":"x"}),
        ] {
            assert!(catalog.call(&request).is_err());
            assert_eq!(catalog.exposed().len(), 1);
        }
        assert!(CapabilityCatalog::new(vec![definition("same"), definition("same")]).is_err());
        assert!(CapabilityCatalog::new(vec![definition(DISCOVERY_TOOL)]).is_err());
    }
}
