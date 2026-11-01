//! Host filesystem primitives used by native adapters.

pub mod files;
pub mod power;

/// Bundled resource locations and application filesystem defaults.
pub mod resources;

/// Persistent state and credentials are isolated by the Cargo build profile.
pub mod identity;

/// System desktop capture and input grants for the running application.
pub mod permissions;
