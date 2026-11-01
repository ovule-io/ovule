//! Neutral agent/provider contracts. No domain, runtime driver, storage or `IoC` dependencies.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
pub use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolEffect {
    Workspace,
    External,
    /// Approval is bound to this invocation; task-wide grants cannot satisfy it.
    ExternalOnce,
}

#[derive(Clone, Debug, Serialize)]
pub struct CapabilityDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub description: String,
}
#[derive(Debug)]
pub enum ProviderError {
    /// The provider is no longer usable. It will be closed, never automatically reconnected.
    Unavailable(String),
    /// One tool failed; the provider remains usable. Side effects are never retried.
    Tool(String),
}
#[async_trait]
pub trait CapabilityProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    /// Host-selected effect policy; MCP and unknown providers default to approval.
    fn effect(&self, _name: &str, _arguments: &Value) -> ToolEffect {
        ToolEffect::External
    }
    /// Validate a call before asking for authorization. Bounded local metadata checks
    /// only: never execute a tool, connect or read protected file contents here.
    fn preflight(&self, _name: &str, _arguments: &Value) -> Result<(), String> {
        Ok(())
    }
    /// Static metadata only: never start a process, connect, or read credentials here.
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        Vec::new()
    }
    /// Must release partially acquired resources when this future is dropped.
    async fn acquire(
        &self,
        cancellation: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String>;
}
#[async_trait]
pub trait CapabilityLease: Send + Sync {
    /// Definitions are pinned for this lease. A refresh requires a new Attempt.
    fn definitions(&self) -> Vec<CapabilityDefinition>;
    async fn invoke(
        &mut self,
        name: &str,
        arguments: &Value,
        cancellation: CancellationToken,
    ) -> Result<Value, ProviderError>;
    /// Idempotent cleanup that reports incomplete closure. Drop must also cancel
    /// owned resources without awaiting.
    async fn close(&mut self) -> Result<(), String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkerEvent {
    /// Structured, bounded diagnostics emitted by trusted harness adapters.
    Diagnostic {
        attempt_id: String,
        kind: String,
        detail_json: String,
    },
    Started {
        attempt_id: String,
    },
    Output {
        attempt_id: String,
        sequence: u64,
        delta: String,
    },
    MessageBlock {
        attempt_id: String,
        block_id: String,
        kind: String,
        data_json: String,
    },
    ReplaceOutput {
        attempt_id: String,
        content: String,
    },
    Finished(WorkerOutcome),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkerOutcome {
    pub attempt_id: String,
    pub status: String,
    pub summary: String,
}

pub type WorkerEventCallback = Arc<dyn Fn(WorkerEvent) + Send + Sync>;
/// Body-free observations shared by direct tools and MCP projections.

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolTrace {
    pub schema_version: u32,
    pub attempt_id: String,
    pub call_id: u64,
    pub tool: String,
    pub operation: String,
    pub status: String,
    pub duration_ms: u64,
    pub input_bytes: usize,
    pub output_bytes: usize,
}
pub type TraceSink = Arc<dyn Fn(&ToolTrace) + Send + Sync>;

/// Count JSON bytes without retaining a serialized output buffer.
pub fn serialized_size_up_to(
    value: &impl serde::Serialize,
    budget: usize,
) -> Result<usize, serde_json::Error> {
    struct Counter {
        remaining: usize,
        exceeded: bool,
    }
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.remaining {
                self.exceeded = true;
                return Err(std::io::Error::other("JSON budget exceeded"));
            }
            self.remaining -= bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter {
        remaining: budget,
        exceeded: false,
    };
    match serde_json::to_writer(&mut counter, value) {
        Ok(()) => Ok(budget - counter.remaining),
        Err(_) if counter.exceeded => Ok(budget.saturating_add(1)),
        Err(error) => Err(error),
    }
}
