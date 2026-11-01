//! Agent execution kernel. Domain providers and product/ACP assembly live outside this crate.
pub mod execution;
pub mod harness;
pub mod output;
mod prompts;
mod runtime;
pub mod support;
pub use runtime::{ModelTurn, run_turn};
#[derive(Default)]
pub struct AgentKernel;
impl AgentKernel {
    pub async fn run(
        &self,
        attempt_id: &str,
        turn: ModelTurn,
        cancellation: ovule_agent_api::CancellationToken,
        notify: ovule_agent_api::WorkerEventCallback,
        stream: bool,
        kinds: &std::collections::BTreeSet<String>,
    ) -> ovule_agent_api::WorkerOutcome {
        run_turn(attempt_id, turn, cancellation, notify, stream, kinds).await
    }
}
pub mod providers {
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            tuffite_ioc::Service<crate::AgentKernel>,
            _,
            _,
        >(|_| Ok(std::sync::Arc::new(crate::AgentKernel))))?;
        Ok(())
    }
}
