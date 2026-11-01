use crate::state::TerminalSpec;

pub type TerminalRegistered = Box<dyn FnOnce() -> Result<(), String> + Send>;
pub type TerminalStreaming = Box<dyn Fn(TerminalOutput) + Send + Sync>;
pub type TerminalFinished = Box<dyn FnOnce(TerminalOutcome) + Send>;

pub trait TerminalEventSink: Send + Sync {
    fn output(&self, output: &TerminalOutput) -> Result<(), String>;
}

pub trait TerminalExecutor: Send + Sync {
    fn spawn(
        &self,
        spec: TerminalSpec,
        registered: TerminalRegistered,
        streaming: TerminalStreaming,
        finished: TerminalFinished,
    ) -> Result<(), String>;

    fn cancel(&self, id: &str, registered: TerminalRegistered) -> Result<(), String>;
}

pub struct TerminalOutput {
    pub id: String,
    pub owner_id: Option<String>,
    pub sequence: u64,
    pub stream: &'static str,
    pub delta: String,
}

pub struct TerminalOutcome {
    pub id: String,
    pub status: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}
