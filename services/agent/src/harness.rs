//! Attempt-local capability discovery and resource lifetime enforcement.
mod capabilities;
mod provider;
pub use capabilities::{CapabilityCatalog, DISCOVERY_TOOL};
pub use ovule_agent_api::{
    CapabilityDefinition, CapabilityLease, CapabilityProvider, ProviderDescriptor, ProviderError,
};
pub use provider::{CapabilityRegistry, ProviderLimits};
pub const VERSION: &str = "ovule-harness/2";
