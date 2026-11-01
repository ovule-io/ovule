//! Explicit forks and in-place prompt restarts with isolated Attempt lifetimes.
use super::super::{AttemptSpec, Workspace};

impl Workspace {
    pub fn fork_message(&mut self, thread_id: &str, message_id: &str) -> Result<String, String> {
        self.fork_history_through(thread_id, message_id)
    }

    pub fn restart_message(
        &mut self,
        thread_id: &str,
        message_id: &str,
        content: &str,
        images: Vec<super::super::LocalImageAttachment>,
    ) -> Result<AttemptSpec, String> {
        // Validate and build the replacement on a candidate, including direct callers.
        let mut candidate = self.clone();
        let spec = candidate.restart_message_in_place(thread_id, message_id, content, images)?;
        *self = candidate;
        Ok(spec)
    }

    fn restart_message_in_place(
        &mut self,
        thread_id: &str,
        message_id: &str,
        content: &str,
        images: Vec<super::super::LocalImageAttachment>,
    ) -> Result<AttemptSpec, String> {
        let message = self
            .conversation
            .messages
            .iter()
            .find(|message| message.thread_id == thread_id && message.id == message_id)
            .ok_or("Unknown message in this Thread")?;
        if message.role != "user" {
            return Err("Only user prompts can be edited".into());
        }
        if content.trim().is_empty() || content.chars().count() > 65_536 {
            return Err("Edited prompt must contain 1 to 65536 characters".into());
        }
        // Resolve the Agent before replacing history.
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .ok_or("Unknown Thread")?;
        self.resolve_agent_for_thread(thread_id, &thread.agent)?;
        let created_at_ms = message.created_at_ms;
        let position = self
            .conversation
            .messages
            .iter()
            .position(|message| message.id == message_id && message.thread_id == thread_id)
            .ok_or("Unknown prompt")?;
        let prefix = self.conversation.messages[..position]
            .iter()
            .filter(|message| message.thread_id == thread_id)
            .map(|message| message.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let removed = self.conversation.messages[position..]
            .iter()
            .filter(|message| message.thread_id == thread_id)
            .map(|message| message.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let active = self
            .conversation
            .attempts
            .iter()
            .filter(|attempt| {
                attempt.thread_id == thread_id
                    && matches!(
                        attempt.status.as_str(),
                        "queued" | "dispatched" | "running" | "cancelling"
                    )
            })
            .map(|attempt| attempt.id.clone())
            .collect::<Vec<_>>();
        for attempt in active {
            self.finish_attempt(
                &attempt,
                "cancelled",
                "Superseded by an edited prompt".into(),
            )?;
        }
        for attempt in &mut self.conversation.attempts {
            if attempt
                .source_message_id
                .as_ref()
                .is_some_and(|id| removed.contains(id))
            {
                attempt.source_message_id = None;
            }
            if attempt
                .response_message_id
                .as_ref()
                .is_some_and(|id| removed.contains(id))
            {
                attempt.response_message_id = None;
            }
        }
        self.conversation
            .messages
            .retain(|message| message.thread_id != thread_id || prefix.contains(&message.id));
        let mut spec = self.prepare_message_attempt_with_attachments(thread_id, content, images)?;
        let generated_id = spec
            .source_message_id
            .clone()
            .ok_or("Replacement prompt has no message ID")?;
        let replacement = self
            .conversation
            .messages
            .iter_mut()
            .find(|message| message.id == generated_id)
            .ok_or("Replacement prompt is missing")?;
        replacement.id = message_id.into();
        replacement.created_at_ms = created_at_ms;
        for (index, part) in replacement.parts.iter_mut().enumerate() {
            part.id = format!("{message_id}-part-{index}");
        }
        self.attempt_mut(&spec.id)?.source_message_id = Some(message_id.into());
        spec.source_message_id = Some(message_id.into());
        Ok(spec)
    }

    fn fork_history_through(
        &mut self,
        thread_id: &str,
        message_id: &str,
    ) -> Result<String, String> {
        let mut thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .cloned()
            .ok_or("Unknown Thread")?;
        let history = self
            .conversation
            .messages
            .iter()
            .filter(|message| message.thread_id == thread_id)
            .cloned()
            .collect::<Vec<_>>();
        let index = history
            .iter()
            .position(|message| message.id == message_id)
            .ok_or("Unknown message in this Thread")?;
        let id = self.allocate_id("thread");
        thread.id.clone_from(&id);
        thread.title = format!(
            "{} (fork)",
            thread.title.chars().take(200).collect::<String>()
        );
        self.conversation.threads.push(thread);
        for mut message in history.into_iter().take(index + 1) {
            message.id = self.allocate_id("message");
            message.thread_id.clone_from(&id);
            message.attempt_id = None;
            if message.status == "streaming" {
                message.status = "complete".into();
            }
            message.stream_sequence = 0;
            // Keep immutable text, image and completed trace context; never clone executable setup/workflow cards.
            message.parts.retain(|part| {
                matches!(
                    part.kind.as_str(),
                    "markdown" | "image" | "thinking" | "notice"
                ) || (part.kind == "tool"
                    && part
                        .data_json
                        .as_deref()
                        .and_then(|data| serde_json::from_str::<serde_json::Value>(data).ok())
                        .and_then(|data| {
                            data.get("state")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_owned)
                        })
                        .is_some_and(|state| matches!(state.as_str(), "completed" | "failed")))
            });
            for (index, part) in message.parts.iter_mut().enumerate() {
                part.id = format!("{}-part-{index}", message.id);
            }
            self.conversation.messages.push(message);
        }
        self.changed();
        Ok(id)
    }
}
