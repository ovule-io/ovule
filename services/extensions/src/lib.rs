//! Validated extension packages and contribution discovery contracts.

#[cfg(feature = "framework")]
mod framework;

mod model;

mod service;

pub use model::{
    AgentContributionView, ComputerUseContributionView, ExtensionCapabilityView,
    ExtensionCatalogView, ExtensionPackageView, FileEditorContributionView,
    MessageBlockContributionView, ModelContributionView, SlashCommandContributionView,
};

pub use service::{
    ExtensionActionOutcome, ExtensionChannelActions, ExtensionChannelResult,
    ExtensionConnectivityActions, ExtensionService, Extensions,
};

use std::sync::Arc;
use tuffite_ioc::Service;

pub mod providers {
    use super::{Arc, ExtensionCatalogView, ExtensionService, Service, service};
    /// Bind extension execution to the browser context.
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
        registrar.register(tuffite_ioc::factory::<ExtensionService, _, _>(|deps| {
            Ok(Arc::new(super::service::NativeExtensionService::new(
                deps.depends_on::<Service<dyn crate::ExtensionChannelActions>>()?,
                deps.depends_on::<Service<dyn crate::ExtensionConnectivityActions>>()?,
            )))
        }))?;

        Ok(())
    }
    pub fn catalog() -> Result<ExtensionCatalogView, String> {
        service::NativeExtensionService::catalog()
    }

    pub use super::packages::{
        cleanup_removed_extension_packages, extension_agent_contributions, extension_asset_root,
        extension_model_contributions, extension_packages, extension_toolchain_contributions,
        install_extension_package, installed_extension_root, known_extension_agent_contributions,
        load_bundled_extensions, load_extension_package, load_extensions,
        remove_third_party_extension, resolve_extension_action, resolve_extension_agent,
        resolve_extension_agent_for_executable, resolve_extension_channel,
        resolve_extension_model_provider, resolve_extension_onboarding,
        resolve_extension_slash_command, resolved_extension_agents,
        resolved_extension_computer_use, resolved_extension_models, resolved_extension_skills,
        set_third_party_extension_enabled,
    };
}

mod packages;
/// Extension wire types and validated contribution DTOs.
pub mod protocol {
    pub use super::packages::{
        ExtensionPackageInfo, ExtensionPackageSource, JavaScriptModule, ResolvedAgentContribution,
        ResolvedComputerUseContribution, ResolvedExtensionAction, ResolvedModelContribution,
        ResolvedOnboarding, ResolvedSkillContribution, ResolvedSlashCommand,
        ValidatedExtensionPackage,
    };
    pub use ovule_extension_api::*;
}

pub mod runtime;
