//! Workflow consumer contracts and domain implementation.
use ovule_conversation as conversation;
use ovule_workspace as workspace;
pub use ovule_workspace::state;
#[cfg(test)]
use ovule_workspace::state::test_support;

mod service;
pub use service::*;

use std::sync::Arc;
use tuffite_ioc::Service;

pub mod providers {
    use super::{Arc, Service, WorkflowService};
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            Service<dyn ovule_conversation::messages::PlanningObserverFactory>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(super::service::PlanningObservers::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                deps.depends_on::<Service<dyn crate::conversation::ConversationIngress>>()?,
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<WorkflowService, _, _>(|deps| {
            Ok(Arc::new(super::service::NativeWorkflowService::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                deps.depends_on::<Service<dyn crate::conversation::ConversationIngress>>()?,
            )))
        }))?;

        Ok(())
    }
}

#[cfg(test)]
mod adapter_tests;
