//! Workspace state, atomic mutation contracts, and durable repository providers.
pub mod channel_repository;
mod commands;
#[cfg(feature = "framework")]
mod framework;
mod management;
mod native_paths;
pub use commands::{WorkspaceManagement, WorkspaceService};
pub use management::{SshHostDiscovery, TunnelEndpointTest, WorkspaceServiceError};
mod host_directory;
pub mod repository;
mod restore;
mod session;
mod settings;
pub mod state;
mod storage;
mod transport_bindings;
pub use session::{MutationError, WorkspaceSession, WorkspaceState};

pub struct WorkspaceDatabasePath(pub std::path::PathBuf);

pub struct WorkspaceDataRoot(pub std::path::PathBuf);

pub trait WorkspaceEventSink: Send + Sync {
    fn revision_changed(&self, revision: i64);
}

pub mod providers {
    /// Bind framework event delivery to the browser context.
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }

    /// Select SDK-independent host defaults while leaving each port overridable.
    pub fn register_host<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        use std::sync::Arc;
        use tuffite_ioc::Service;
        registrar.register(tuffite_ioc::factory::<
            Service<crate::WorkspaceDatabasePath>,
            _,
            _,
        >(|_| {
            Ok(Arc::new(crate::WorkspaceDatabasePath(
                ovule_settings::providers::database_path()?,
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<crate::WorkspaceDataRoot>,
            _,
            _,
        >(|deps| {
            let database = deps.depends_on::<Service<crate::WorkspaceDatabasePath>>()?;
            let root = database.0.parent().ok_or("resolve Ovule data directory")?;
            Ok(Arc::new(crate::WorkspaceDataRoot(root.to_path_buf())))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            tuffite_ioc::Service<ovule_hosts::HostPowerSettingsPath>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceDataRoot>>()?;
            Ok(std::sync::Arc::new(ovule_hosts::HostPowerSettingsPath(
                root.0.join("host-power.json"),
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            tuffite_ioc::Service<ovule_memory::MemoryRoot>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceDataRoot>>()?;
            Ok(std::sync::Arc::new(ovule_memory::MemoryRoot(
                root.0.join("memory.sqlite"),
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<ovule_toolchains::ToolchainRoot>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<Service<crate::WorkspaceDataRoot>>()?;
            Ok(Arc::new(ovule_toolchains::ToolchainRoot(
                root.0.join("toolchains"),
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<ovule_secrets::SecretStoreRoot>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<Service<crate::WorkspaceDataRoot>>()?;
            Ok(Arc::new(ovule_secrets::SecretStoreRoot(root.0.clone())))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::state::paths::WorkspacePaths>,
            _,
            _,
        >(|_| Ok(native_paths())))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn ovule_hosts::BindingResolver>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(crate::transport_bindings::WorkspaceBindings(
                deps.depends_on::<Service<crate::WorkspaceSession>>()?,
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn ovule_remoting::backend::HostDirectory>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(crate::host_directory::DesktopHostDirectory::new(
                deps.depends_on::<Service<crate::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn ovule_secrets::SecretStore>>()?,
            )))
        }))?;

        Ok(())
    }
    /// Restore durable state before any worker starts, using independently bound host ports.
    pub fn register_session<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register_eager(tuffite_ioc::factory::<tuffite_ioc::Service<crate::WorkspaceSession>, _, _>(|deps| {
            let database = deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceDatabasePath>>()?;
            crate::restore::restore(
                &database.0,
                deps.depends_on::<tuffite_ioc::Service<dyn crate::state::paths::WorkspacePaths>>()?,
                deps.depends_on::<tuffite_ioc::Service<dyn ovule_settings::catalog::SettingsSource>>(
                )?,
            )
        }))?;

        Ok(())
    }

    /// Register workspace commands with explicit host capabilities.
    pub fn register_management<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register_eager(tuffite_ioc::factory::<crate::WorkspaceService, _, _>(
            |deps| {
                Ok(std::sync::Arc::new(
                    crate::management::WorkspaceCommands::new(
                        deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceSession>>()?,
                        deps.depends_on::<tuffite_ioc::Service<dyn crate::WorkspaceEventSink>>()?,
                        deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceDataRoot>>()?
                            .0
                            .clone(),
                        deps.depends_on::<tuffite_ioc::Service<dyn ovule_secrets::SecretStore>>()?,
                        deps.depends_on::<tuffite_ioc::Service<ovule_hosts::TunnelHostHandle>>()?,
                    ),
                ))
            },
        ))?;

        Ok(())
    }

    /// Provide filesystem paths for a native host.
    #[must_use]
    pub fn native_paths() -> std::sync::Arc<dyn crate::state::paths::WorkspacePaths> {
        std::sync::Arc::new(crate::native_paths::NativeWorkspacePaths)
    }

    /// Register workspace-backed settings mutations and revision notifications.
    pub fn register_settings<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            ovule_settings::SettingsService<crate::state::AppSnapshot>,
            _,
            _,
        >(|deps| {
            Ok(std::sync::Arc::new(
                crate::settings::NativeSettingsService::new(
                    deps.depends_on::<tuffite_ioc::Service<crate::WorkspaceSession>>()?,
                    deps.depends_on::<tuffite_ioc::Service<dyn crate::WorkspaceEventSink>>()?,
                ),
            ))
        }))?;

        Ok(())
    }

    /// Open the durable workspace repository.
    pub fn open(
        path: &std::path::Path,
    ) -> Result<impl crate::repository::WorkspaceRepository + use<>, String> {
        crate::storage::providers::open(path)
    }
}
