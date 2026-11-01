//! Onboarding, extension setup, managed toolchain and model setup contracts.
use ovule_platform::resources;

use ovule_secrets as secret_store;
use ovule_settings::catalog as settings;

use ovule_workspace as workspace;
use ovule_workspace::state;

#[cfg(feature = "framework")]
mod framework;

mod extension_onboarding;
mod extensions;
mod model;
mod models;
mod onboarding;
mod ports;
mod service;
mod support;
mod toolchains;
pub use model::{
    ExtensionOnboardingActionView, ExtensionOnboardingView, ExtensionSetupActionInput,
    ExtensionSetupValue, IntegrationStatus, OllamaModelCatalog, OnboardingAgentInput,
    OnboardingInput, OnboardingModelOption, OnboardingStatus,
};
pub use ports::{SetupAgentCommands, SetupModels, SetupToolchains};
use service::NativeSetupService;
pub use service::{Setup, SetupError, SetupService};

use std::sync::Arc;
use tuffite_ioc::Service;

pub mod providers {
    use super::{Arc, Service, SetupService};
    /// Bind managed toolchain and model jobs to the browser context.
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }

    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<SetupService, _, _>(|deps| {
            Ok(Arc::new(super::service::NativeSetupService::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                deps.depends_on::<Service<dyn crate::SetupAgentCommands>>()?,
                deps.depends_on::<Service<dyn crate::SetupModels>>()?,
                deps.depends_on::<Service<dyn crate::SetupToolchains>>()?,
                deps.depends_on::<Service<dyn crate::secret_store::SecretStore>>()?,
                deps.depends_on::<Service<ovule_toolchains::ToolchainRoot>>()?
                    .0
                    .clone(),
            )))
        }))?;

        Ok(())
    }
}

pub use model::OllamaModelJobView;
pub use ovule_toolchains::ToolchainView;

/// Lifecycle port for the lazily owned local model runtime.
pub trait OllamaRuntime: Send {
    fn shutdown(&mut self, timeout: std::time::Duration);
}

pub type OllamaRuntimeService = Service<std::sync::Mutex<Box<dyn OllamaRuntime>>>;
