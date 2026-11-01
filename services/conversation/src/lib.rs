//! Conversation consumer contracts and domain implementation.
#[cfg(feature = "framework")]
mod framework;
use ovule_workspace as workspace;
pub use ovule_workspace::state;
#[cfg(test)]
use ovule_workspace::state::test_support;

mod agent_session;
pub mod messages;
mod service;

pub use agent_session::*;
pub use ovule_agent_api::{WorkerEvent, WorkerEventCallback, WorkerOutcome};
pub use service::*;

pub mod providers {
    /// Bind framework event delivery to the browser context.
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }

    use super::{
        AgentSessionService, AttemptPrerequisites, Conversation, ConversationEventSink,
        ConversationService, service,
    };
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<ConversationService, _, _>(|deps| {
            use tuffite_ioc::Service;
            Ok(std::sync::Arc::new(
                super::service::NativeConversationService::new(
                    deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                    deps.depends_on::<Service<dyn AttemptPrerequisites>>()?,
                    deps.depends_on::<Service<dyn AgentSessionService>>()?,
                    deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                    deps.depends_on::<Service<dyn ConversationEventSink>>()?,
                )
                .with_attachments(
                    deps.depends_on::<Service<dyn crate::messages::AttachmentRepository>>()?,
                ),
            ))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            tuffite_ioc::Service<dyn super::ConversationIngress>,
            _,
            _,
        >(|deps| {
            Ok(deps.depends_on::<ConversationService>()?)
        }))?;

        Ok(())
    }
    #[must_use]
    pub fn create(
        state: std::sync::Arc<ovule_workspace::WorkspaceSession>,
        prerequisites: std::sync::Arc<dyn AttemptPrerequisites>,
        sessions: std::sync::Arc<dyn AgentSessionService>,
        workspace_events: std::sync::Arc<dyn ovule_workspace::WorkspaceEventSink>,
        events: std::sync::Arc<dyn ConversationEventSink>,
    ) -> std::sync::Arc<dyn Conversation> {
        std::sync::Arc::new(service::NativeConversationService::new(
            state,
            prerequisites,
            sessions,
            workspace_events,
            events,
        ))
    }
}

#[cfg(test)]
mod adapter_tests;
