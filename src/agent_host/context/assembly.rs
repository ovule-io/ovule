//! Build the bounded Attempt prompt, scope grants and diagnostic manifest.
use super::{ContextTools, TraceSink, VERSION};
use ovule_memory::{Access, MemoryService};
use ovule_skills::{SkillCatalog, SkillMetadata};
use serde::{Deserialize, Serialize};
use std::{fmt::Write as _, sync::Arc};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriverRoute {
    Rig,
    LocalAcp,
    RemoteAcp,
}
impl DriverRoute {
    #[must_use]
    pub fn resolve(driver: &str, provider: Option<&str>, local: bool) -> Self {
        if driver == "ovule" && provider != Some("openai") {
            Self::Rig
        } else if local {
            Self::LocalAcp
        } else {
            Self::RemoteAcp
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CapabilityBinding {
    pub id: String,
    pub projection: String,
    pub available: bool,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AssemblyManifest {
    pub schema_version: u32,
    pub harness_version: String,
    pub attempt_id: String,
    pub thread_id: String,
    pub route: DriverRoute,
    pub planning: bool,
    pub context_budget_chars: usize,
    pub context_used_chars: usize,
    pub skills: Vec<SkillMetadata>,
    pub memory_scopes: Vec<String>,
    pub bindings: Vec<CapabilityBinding>,
    pub warnings: Vec<String>,
}
pub struct AssemblyInput<'a> {
    pub attempt_id: &'a str,
    pub thread_id: &'a str,
    pub project_id: Option<&'a str>,
    pub host_id: &'a str,
    pub driver: &'a str,
    pub provider: Option<&'a str>,
    pub local_transport: bool,
    pub planning: bool,
    pub skill_paths: &'a [String],
    pub base_prompt: String,
    pub context_budget_chars: usize,
}
pub struct AssembledAttempt {
    pub manifest: AssemblyManifest,
    pub prompt: String,
    pub context: Arc<ContextTools>,
}
impl AssembledAttempt {
    pub fn assemble(
        input: AssemblyInput<'_>,
        memory: Arc<MemoryService>,
        trace: Option<TraceSink>,
    ) -> Result<Self, String> {
        let route = DriverRoute::resolve(input.driver, input.provider, input.local_transport);
        let available = !input.planning && route != DriverRoute::RemoteAcp;
        let skills = if input.planning {
            SkillCatalog::default()
        } else {
            SkillCatalog::discover(input.skill_paths)?
        };
        let mut access = Access::thread(input.thread_id, input.attempt_id);
        // Project knowledge is read-only in automatic Agent grants. Host/user tools
        // may deliberately publish it; a tool argument cannot widen this grant.
        if let Some(project) = input.project_id {
            access
                .readable
                .push(format!("project:{}:{project}", input.host_id));
        }
        if !available {
            access.readable.clear();
            access.writable.clear();
        }
        let context = Arc::new(ContextTools {
            skills,
            memory,
            access,
            trace,
            next_call: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        });
        let catalog = context.skills.list();
        let mut prompt = input.base_prompt;
        let mut warnings = Vec::new();
        if available {
            if route == DriverRoute::Rig {
                prompt.push_str(super::super::prompts::CONTEXT_DISCOVERY);
            }
            write!(
                prompt,
                include_str!("../prompts/selected-context.md"),
                version = VERSION,
                skills = serde_json::to_string(&catalog).map_err(|e| e.to_string())?,
                memory_scopes =
                    serde_json::to_string(&context.access.readable).map_err(|e| e.to_string())?
            )
            .map_err(|e| e.to_string())?;
        } else if route == DriverRoute::RemoteAcp && !input.planning {
            warnings.push("Host context MCP is not reachable by a remote ACP process; memory and progressive Skill tools are unavailable on this route.".into());
            prompt.push_str(super::super::prompts::REMOTE_CONTEXT);
            if !catalog.is_empty() {
                return Err("selected Skills require a supported context projection; use local ACP or Rig for this Attempt".into());
            }
        }
        let used = prompt.chars().count();
        if used > input.context_budget_chars {
            return Err(format!(
                "Attempt context exceeds its {} character budget ({used}); narrow the request or selected Skill catalog",
                input.context_budget_chars
            ));
        }
        let projection = match route {
            DriverRoute::Rig => "rig_direct",
            DriverRoute::LocalAcp => "attempt_http_mcp",
            DriverRoute::RemoteAcp => "unavailable",
        };
        let bindings = ["skills", "memory"]
            .into_iter()
            .map(|id| CapabilityBinding {
                id: id.into(),
                projection: projection.into(),
                available,
                reason: if input.planning {
                    "Planning has no mutable context tools"
                } else if available {
                    "Attempt-scoped context grant"
                } else {
                    "No Host-local MCP route"
                }
                .into(),
            })
            .collect();
        Ok(Self {
            manifest: AssemblyManifest {
                schema_version: 1,
                harness_version: VERSION.into(),
                attempt_id: input.attempt_id.into(),
                thread_id: input.thread_id.into(),
                route,
                planning: input.planning,
                context_budget_chars: input.context_budget_chars,
                context_used_chars: used,
                skills: catalog,
                memory_scopes: context.access.readable.clone(),
                bindings,
                warnings,
            },
            prompt,
            context,
        })
    }
}
