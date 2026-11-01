use crate::state::AttemptSpec;
use ovule_agent_api::WorkerEventCallback;

pub type AttemptRegistered = Box<dyn FnOnce() -> Result<(), String> + Send>;

/// Product-facing session lifecycle port.
///
/// Implementations may host the built-in Rig agent in-process or connect to an
/// external agent over ACP. Conversation state intentionally depends on this
/// protocol-shaped port rather than process or provider details.
pub trait AgentSessionService: Send + Sync {
    fn spawn(
        &self,
        spec: &AttemptSpec,
        registered: AttemptRegistered,
        notify: WorkerEventCallback,
    ) -> Result<(), String>;

    fn cancel(&self, attempt_id: &str, registered: AttemptRegistered) -> Result<(), String>;
}

pub trait AttemptPrerequisites: Send + Sync {
    fn prepare(&self, spec: &AttemptSpec) -> Result<(), String>;
}
