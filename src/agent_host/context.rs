//! Application-owned context assembly and ACP projections.
mod assembly;
mod tools;
pub use assembly::{
    AssembledAttempt, AssemblyInput, AssemblyManifest, CapabilityBinding, DriverRoute,
};
pub use ovule_agent_api::{ToolTrace, TraceSink};
pub use tools::{ContextTools, now_ms};
pub const VERSION: &str = ovule_agent::harness::VERSION;

pub use ovule_agent_api::{
    CapabilityDefinition, CapabilityLease, CapabilityProvider, ProviderDescriptor, ProviderError,
};
