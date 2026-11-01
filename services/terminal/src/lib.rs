//! Terminal consumer contracts and domain implementation.
#[cfg(feature = "framework")]
mod framework;
use ovule_workspace as workspace;
pub use ovule_workspace::state;

mod executor;
pub mod profiles;
pub mod pty;
mod runtime;
mod service;
pub use executor::*;
pub use service::*;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tuffite_ioc::Service;

/// Owns terminal execution resources and their shutdown lifecycle.
pub trait TerminalRuntime: Send + Sync {
    fn executor(&self) -> Arc<dyn TerminalExecutor>;
    fn stop(&mut self, timeout: Duration);
}

pub type TerminalRuntimeService = Service<Mutex<Box<dyn TerminalRuntime>>>;

pub mod providers {
    /// Bind framework event delivery to the browser context.
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }

    use super::{Arc, Mutex, Service, TerminalRuntimeService, TerminalService};

    pub fn register_runtime<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            Service<crate::profiles::ShellProfiles>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<Service<ovule_workspace::WorkspaceDataRoot>>()?;
            Ok(Arc::new(crate::profiles::ShellProfiles::new(
                root.0.clone(),
            )))
        }))?;
        registrar.register(
            tuffite_ioc::factory::<Service<crate::pty::PtySessions>, _, _>(|_| {
                Ok(Arc::new(crate::pty::PtySessions::default()))
            }),
        )?;
        registrar.register_eager(tuffite_ioc::factory::<TerminalRuntimeService, _, _>(
            |deps| {
                let root = deps.depends_on::<Service<ovule_toolchains::ToolchainRoot>>()?;
                let transports =
                    deps.depends_on::<Service<dyn ovule_hosts::WorkspaceTransportResolver>>()?;
                Ok(Arc::new(Mutex::new(Box::new(
                    super::runtime::NativeTerminalRuntime::new(root.0.clone(), transports)?,
                ))))
            },
        ))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::TerminalExecutor>,
            _,
            _,
        >(|deps| {
            let owner = deps.depends_on::<TerminalRuntimeService>()?;
            let owner = owner
                .lock()
                .map_err(|_| "Terminal lifecycle lock poisoned")?;
            Ok(owner.executor())
        }))?;

        Ok(())
    }
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<TerminalService, _, _>(|deps| {
            Ok(Arc::new(super::service::NativeTerminalService::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                deps.depends_on::<Service<dyn crate::TerminalEventSink>>()?,
                deps.depends_on::<Service<dyn crate::TerminalExecutor>>()?,
            )))
        }))?;

        Ok(())
    }
}
