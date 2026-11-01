//! Settings catalog rules, consumer commands, and native discovery providers.
pub mod catalog;
mod host;

mod service;
pub use service::{Settings, SettingsError, SettingsService};

use std::sync::Arc;

pub mod providers {
    pub fn register_host<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            tuffite_ioc::Service<dyn crate::catalog::SettingsSource>,
            _,
            _,
        >(|_| Ok(source())))?;

        Ok(())
    }
    use super::Arc;
    #[must_use]
    pub fn source() -> Arc<dyn crate::catalog::SettingsSource> {
        Arc::new(super::host::native_source::NativeSettingsSource)
    }
    #[must_use]
    pub fn managed_toolchains_path() -> std::path::PathBuf {
        super::host::environment::managed_toolchains_path()
    }
    #[must_use]
    pub fn provider_credential_available(name: &str) -> bool {
        super::host::environment::provider_credential_available(name)
    }
    pub fn database_path() -> Result<std::path::PathBuf, String> {
        super::host::environment::database_path()
    }
}
