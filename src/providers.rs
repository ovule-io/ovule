//! Application composition supplies SDK adapters; domains construct their own services.

pub fn register(
    registry: &mut impl tuffite_ioc::Registrar<crate::runtime::ApplicationContext>,
) -> tuffite_ioc::Result<()> {
    ovule_settings::providers::register_host(registry)?;
    ovule_workspace::providers::register_host(registry)?;
    ovule_secrets::providers::register(registry)?;
    ovule_terminal::providers::register_runtime(registry)?;
    ovule_files::providers::register_host(registry)?;
    ovule_files::providers::register_runtime(registry)?;
    ovule_remoting::providers::register_runtime(registry)?;
    ovule_workspace::providers::register_session(registry)?;
    ovule_workspace::providers::register_settings(registry)?;
    ovule_workspace::providers::register_management(registry)?;
    ovule_conversation::providers::register(registry)?;
    ovule_conversation::messages::providers::register(registry)?;
    ovule_memory::providers::register(registry)?;
    ovule_browser::providers::register(registry)?;
    crate::agent_host::providers::register(registry)?;
    ovule_channels::providers::register_runtime(registry)?;
    ovule_channels::providers::register(registry)?;
    ovule_workflow::providers::register(registry)?;
    ovule_terminal::providers::register(registry)?;
    ovule_files::providers::register(registry)?;
    ovule_remoting::providers::register(registry)?;
    ovule_cloudflare_connectivity::providers::register(registry)?;
    ovule_remoting::providers::register_host(registry)?;
    ovule_hosts::providers::register(registry)?;
    ovule_extensions::providers::register(registry)?;
    ovule_setup::providers::register(registry)?;
    #[cfg(feature = "native-framework")]
    {
        ovule_browser::providers::register_framework(registry)?;
        crate::agent_host::providers::register_framework(registry)?;
        ovule_workspace::providers::register_framework(registry)?;
        ovule_channels::providers::register_framework(registry)?;
        ovule_conversation::providers::register_framework(registry)?;
        ovule_terminal::providers::register_framework(registry)?;
        ovule_remoting::providers::register_framework(registry)?;
        ovule_extensions::providers::register_framework(registry)?;
        ovule_setup::providers::register_framework(registry)?;
    }
    Ok(())
}
