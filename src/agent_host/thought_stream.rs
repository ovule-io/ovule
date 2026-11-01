//! Bound persistence and workspace invalidations independently of provider token rate.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ovule_conversation::{WorkerEvent, WorkerEventCallback};

#[derive(Default)]
pub(super) struct ThoughtStream {
    text: String,
    dirty: bool,
    scheduled: bool,
    closed: bool,
}

impl ThoughtStream {
    pub(super) fn queue(
        state: &Arc<Mutex<Self>>,
        attempt_id: &str,
        notify: &WorkerEventCallback,
        delta: &str,
    ) {
        let mut stream = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if stream.closed || delta.is_empty() {
            return;
        }
        if stream.text.len().saturating_add(delta.len()) > 60_000 {
            return;
        }
        let first = stream.text.is_empty();
        stream.text.push_str(delta);
        stream.dirty = true;
        if first {
            stream.flush(attempt_id, notify);
        } else if !stream.scheduled {
            stream.scheduled = true;
            let state = Arc::clone(state);
            let attempt_id = attempt_id.to_owned();
            let notify = Arc::clone(notify);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let mut stream = state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                stream.scheduled = false;
                if !stream.closed {
                    stream.flush(&attempt_id, &notify);
                }
            });
        }
    }

    pub(super) fn close(&mut self, attempt_id: &str, notify: &WorkerEventCallback) {
        self.flush(attempt_id, notify);
        self.closed = true;
    }

    fn flush(&mut self, attempt_id: &str, notify: &WorkerEventCallback) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        notify(WorkerEvent::MessageBlock {
            attempt_id: attempt_id.to_owned(),
            block_id: "thinking".to_owned(),
            kind: "thinking".to_owned(),
            data_json: serde_json::json!({"text": self.text}).to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bursts_preserve_text_and_close_prevents_late_updates() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&events);
        let notify: WorkerEventCallback =
            Arc::new(move |event| captured.lock().unwrap().push(event));
        let stream = Arc::new(Mutex::new(ThoughtStream::default()));
        for _ in 0..1000 {
            ThoughtStream::queue(&stream, "attempt", &notify, "x");
        }
        assert_eq!(events.lock().unwrap().len(), 1);
        stream.lock().unwrap().close("attempt", &notify);
        tokio::time::sleep(Duration::from_millis(150)).await;
        ThoughtStream::queue(&stream, "attempt", &notify, "late");
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        let WorkerEvent::MessageBlock { data_json, .. } = &events[1] else {
            panic!("expected thinking block");
        };
        let value: serde_json::Value = serde_json::from_str(data_json).unwrap();
        assert_eq!(value["text"], "x".repeat(1000));
    }
}
