//! Workspace identity and encrypted host credential storage.
pub use secret_store::*;
mod secret_store;

/// Consumer-side service identity for encrypted host credentials.
pub type Secrets = tuffite_ioc::Service<dyn SecretStore>;
pub struct SecretStoreRoot(pub std::path::PathBuf);
pub mod providers {
    pub fn open(path: &std::path::Path) -> Result<impl super::SecretStore + use<>, String> {
        super::secret_store::NativeSecretStore::new(path)
    }
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<super::Secrets, _, _>(|deps| {
            let root = deps.depends_on::<tuffite_ioc::Service<super::SecretStoreRoot>>()?;
            Ok(std::sync::Arc::new(
                super::secret_store::NativeSecretStore::new(&root.0)?,
            ))
        }))?;

        Ok(())
    }
}
