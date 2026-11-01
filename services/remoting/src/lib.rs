//! Session leases, signaling, and host control contracts.

pub mod backend;
mod client;
mod executor;
#[cfg(feature = "framework")]
mod framework;
pub use executor::{RemotingExecutor, RemotingExecutorService};
#[cfg(test)]
mod client_tests;
pub mod host;
mod ice;
pub mod model;
pub use client::{Remoting, RemotingService};

use std::sync::Arc;
use tuffite_ioc::Service;

pub mod providers {
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }
    #[must_use]
    pub fn unavailable_computer_use() -> std::sync::Arc<dyn super::backend::ComputerUseHost> {
        std::sync::Arc::new(super::backend::UnavailableDesktop)
    }
    #[must_use]
    pub fn unavailable_desktop() -> std::sync::Arc<dyn super::backend::DesktopBackend> {
        std::sync::Arc::new(super::backend::UnavailableDesktop)
    }
    use super::{Arc, RemotingService, Service, backend, host};
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<RemotingService, _, _>(|deps| {
            Ok(Arc::new(super::client::NativeRemotingService::new(
                deps.depends_on::<Service<dyn crate::backend::HostDirectory>>()?,
                deps.depends_on::<Service<dyn crate::backend::SessionEvents>>()?,
                (*deps.depends_on::<Service<tokio::runtime::Handle>>()?).clone(),
            )))
        }))?;

        Ok(())
    }
    pub fn register_runtime<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register_eager(
            tuffite_ioc::factory::<super::RemotingExecutorService, _, _>(|_| {
                Ok(Arc::new(super::RemotingExecutor::new()?))
            }),
        )?;
        registrar.register(
            tuffite_ioc::factory::<Service<tokio::runtime::Handle>, _, _>(|deps| {
                let owner = deps.depends_on::<super::RemotingExecutorService>()?;
                Ok(Arc::new(owner.handle()?))
            }),
        )?;

        Ok(())
    }
    /// Register host-side control separately from client session construction.
    pub fn register_host<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(
            tuffite_ioc::factory::<Service<dyn host::HostSessions>, _, _>(|deps| {
                Ok(host_sessions(
                    deps.depends_on::<Service<dyn backend::DesktopBackend>>()?,
                    deps.depends_on::<Service<dyn backend::IceConfigProvider>>()?,
                ))
            }),
        )?;

        Ok(())
    }
    /// Read host ICE policy, retaining configuration errors for session startup.
    #[must_use]
    pub fn host_ice_configuration() -> Arc<dyn backend::IceConfigProvider> {
        Arc::new(
            super::ice::HostIceConfigProvider::from_environment()
                .unwrap_or_else(super::ice::HostIceConfigProvider::unavailable),
        )
    }

    #[must_use]
    pub fn host_sessions(
        backend: Arc<dyn backend::DesktopBackend>,
        ice: Arc<dyn backend::IceConfigProvider>,
    ) -> Arc<dyn host::HostSessions> {
        Arc::new(host::NativeHostSessions::new(backend, ice))
    }
}
