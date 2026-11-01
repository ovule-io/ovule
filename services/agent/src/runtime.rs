//! Model loop and streaming projection; all capabilities are injected.
mod model;
mod model_metadata;
mod tool_projection;
use crate::output::project_message_blocks;
use crate::support::{bounded_message, serialized_size_up_to};
pub use model::run_turn;
use ovule_agent_api::{CancellationToken, WorkerEvent, WorkerOutcome};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const ATTEMPT_TIMEOUT: Duration = Duration::from_hours(2);
const MAX_NATIVE_PROVIDER_BYTES: usize = 512 * 1024;
const MAX_NATIVE_TOOL_ROUNDS: usize = 32;
pub(super) enum ModelError {
    Cancelled,
    Failed(String),
}

#[derive(Clone)]
pub struct ModelTurn {
    pub execution: Arc<crate::execution::ToolExecutor>,
    pub provider: String,
    pub api_key: String,
    pub api_base: String,
    pub model: String,
    pub prompt: String,
    pub structured_goal: bool,
    pub capability_providers: Vec<Arc<dyn ovule_agent_api::CapabilityProvider>>,
}

struct OutputAccumulator {
    sequence: u64,
    pending: String,
    last_emit: Instant,
    flush_scheduled: bool,
}

#[derive(Default)]
struct MessageBlockStream {
    pending: String,
    control_started: bool,
}

fn emit_pending_output(
    attempt_id: &str,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    output: &mut OutputAccumulator,
) {
    if output.pending.is_empty() {
        return;
    }
    let delta = std::mem::take(&mut output.pending);
    notify(WorkerEvent::Output {
        attempt_id: attempt_id.to_owned(),
        sequence: output.sequence,
        delta,
    });
    output.sequence += 1;
    output.last_emit = Instant::now();
}

fn queue_output_delta(
    attempt_id: &str,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    accumulator: &Arc<Mutex<OutputAccumulator>>,
    delta: &str,
) {
    if delta.is_empty() {
        return;
    }
    let mut output = accumulator
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    output.pending.push_str(delta);
    if output.pending.len() >= 1_024 || output.last_emit.elapsed() >= Duration::from_millis(50) {
        emit_pending_output(attempt_id, notify, &mut output);
    } else if !output.flush_scheduled {
        output.flush_scheduled = true;
        let delayed_attempt_id = attempt_id.to_owned();
        let delayed_notify = Arc::clone(notify);
        let delayed_accumulator = Arc::clone(accumulator);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let mut output = delayed_accumulator
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            output.flush_scheduled = false;
            emit_pending_output(&delayed_attempt_id, &delayed_notify, &mut output);
        });
    }
}

fn filter_and_queue_output(
    attempt_id: &str,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    accumulator: &Arc<Mutex<OutputAccumulator>>,
    state: &Arc<Mutex<MessageBlockStream>>,
    delta: &str,
) {
    const OPEN: &str = "```ovule-block";
    const PREFIX: usize = OPEN.len() - 1;
    let mut stream = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if stream.control_started {
        return;
    }
    stream.pending.push_str(delta);
    if let Some(index) = stream.pending.find(OPEN) {
        let visible = stream.pending[..index].to_owned();
        stream.pending.clear();
        stream.control_started = true;
        drop(stream);
        queue_output_delta(attempt_id, notify, accumulator, &visible);
        return;
    }
    let mut split = stream.pending.len().saturating_sub(PREFIX);
    while !stream.pending.is_char_boundary(split) {
        split = split.saturating_sub(1);
        if split == 0 {
            return;
        }
    }
    let visible = stream.pending[..split].to_owned();
    stream.pending.drain(..split);
    drop(stream);
    queue_output_delta(attempt_id, notify, accumulator, &visible);
}

fn flush_filtered_output(
    attempt_id: &str,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    accumulator: &Arc<Mutex<OutputAccumulator>>,
    state: &Arc<Mutex<MessageBlockStream>>,
) {
    let mut stream = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if stream.control_started || stream.pending.is_empty() {
        return;
    }
    let visible = std::mem::take(&mut stream.pending);
    drop(stream);
    queue_output_delta(attempt_id, notify, accumulator, &visible);
}

fn cancelled_outcome(attempt_id: &str) -> WorkerOutcome {
    WorkerOutcome {
        attempt_id: attempt_id.into(),
        status: "cancelled".into(),
        summary: "Generation stopped".into(),
    }
}
fn failed_outcome(attempt_id: &str, summary: &str) -> WorkerOutcome {
    WorkerOutcome {
        attempt_id: attempt_id.into(),
        status: "failed".into(),
        summary: summary.into(),
    }
}

#[cfg(test)]
mod tests;
