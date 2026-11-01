//! Ovule application runtime loaded by the native Tuffite host.
pub mod agent_host;
#[cfg(test)]
mod architecture_tests;
mod bootstrap;
#[path = "../configuration.rs"]
mod configuration;
mod diagnostics;
mod isolated_ui;
mod providers;
mod runtime;
mod shell;

mod shell_api {
    #![allow(clippy::struct_field_names, clippy::type_complexity)]
    include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
}

use runtime::App;

#[tuffite::main]
fn main() -> tuffite::Embedding<App> {
    tuffite::Embedding::new().browser::<runtime::Profile>()
}

pub(crate) fn configure_application(
    builder: tuffite::app::Builder<App>,
) -> tuffite::app::Builder<App> {
    builder
        .configuration(configuration::configuration(cfg!(debug_assertions)))
        .interfaces(|registry| {
            registry
                .register::<shell_api::interfaces::Agent>()
                .register::<shell_api::interfaces::Remoting>()
                .register::<shell_api::interfaces::Workspace>()
                .register::<shell_api::interfaces::Extensions>()
                .register::<shell_api::interfaces::Setup>()
                .register::<shell_api::interfaces::Workflow>()
                .register::<shell_api::interfaces::Message>()
                .register::<shell_api::interfaces::Content>()
                .register::<shell_api::interfaces::Terminal>()
                .register::<shell_api::interfaces::Settings>()
        })
}
