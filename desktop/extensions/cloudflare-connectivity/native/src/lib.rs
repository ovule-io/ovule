//! Native capabilities of the bundled Cloudflare connectivity plugin.
//! Provider endpoints, credential schema and official CLI operations live here,
//! outside the platform's provider-neutral remoting service.
mod provider;
mod setup;
pub use provider::{CONFIG_REFERENCE, CloudflareTurnConfig};

pub mod providers {
    use std::sync::Arc;
    use tuffite_ioc::Service;
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            Service<dyn ovule_remoting::backend::IceConfigProvider>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(crate::provider::ConfiguredIceProvider::new(
                deps.depends_on::<ovule_secrets::Secrets>()?,
                ovule_remoting::providers::host_ice_configuration(),
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn ovule_extensions::ExtensionConnectivityActions>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(crate::setup::CloudflareSetup::new(
                deps.depends_on::<ovule_secrets::Secrets>()?,
                deps.depends_on::<Service<ovule_toolchains::ToolchainRoot>>()?
                    .0
                    .clone(),
            )))
        }))?;
        Ok(())
    }
}
