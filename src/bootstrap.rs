use std::sync::Arc;
use tuffite::{ApplicationContext, Error, Result};
use tuffite_ioc::Registry;

pub(crate) fn build(context: ApplicationContext) -> Result<Registry<ApplicationContext>> {
    crate::diagnostics::install_panic_reporter();
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .try_init();
    let _ = rustls::crypto::ring::default_provider().install_default();

    ovule_extensions::providers::cleanup_removed_extension_packages()
        .map_err(|error| Error::new(error.to_string()))?;
    let mut registry = Registry::new(Arc::new(context));
    crate::providers::register(&mut registry).map_err(Error::new)?;

    registry.freeze();
    registry.initialize().map_err(Error::new)?;
    Ok(registry)
}
