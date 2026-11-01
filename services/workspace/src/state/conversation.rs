use super::Thread;
use serde::{Deserialize, Serialize};

/// Persisted state owned by the conversation capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct ConversationState {
    pub(super) threads: Vec<Thread>,
    #[serde(default)]
    pub(super) messages: Vec<ThreadMessage>,
    pub(super) attempts: Vec<Attempt>,
}

use super::{
    AppSnapshot, Attempt, AttemptEvent, AttemptSpec, Goal, LocalImageAttachment,
    MAX_STREAMED_OUTPUT_BYTES, MessagePart, NodeKind, ThreadMessage, Workspace,
    append_bounded_stream, generated_thread_title, markdown_part, now_millis,
    parse_goal_derivation, required_text,
};

mod history;

impl Workspace {
    #[allow(clippy::too_many_lines)]
    /// Setup cards are native actions, independent of Agent/model configuration.
    pub fn show_extension_setup(
        &mut self,
        thread_id: &str,
        command: &str,
        kind: &str,
    ) -> Result<AppSnapshot, String> {
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err("unknown Thread".into());
        }
        for role in ["user", "assistant"] {
            let id = self.allocate_id("message");
            let parts = if role == "user" {
                vec![markdown_part(&id, command.to_owned())]
            } else {
                vec![MessagePart {
                    id: format!("{id}-setup"),
                    kind: kind.into(),
                    text: None,
                    url: None,
                    name: None,
                    media_type: Some("application/json".into()),
                    size_bytes: None,
                    data_json: Some("{}".into()),
                }]
            };
            self.conversation.messages.push(ThreadMessage {
                id,
                thread_id: thread_id.into(),
                role: role.into(),
                content: if role == "user" {
                    command.into()
                } else {
                    String::new()
                },
                parts,
                status: "complete".into(),
                stream_sequence: 0,
                created_at_ms: now_millis(),
                attempt_id: None,
            });
        }
        self.changed();
        Ok(self.snapshot())
    }

    pub fn prepare_message_attempt(
        &mut self,
        thread_id: &str,
        content: &str,
    ) -> Result<AttemptSpec, String> {
        self.prepare_message_attempt_with_attachments(thread_id, content, Vec::new())
    }

    #[allow(clippy::too_many_lines)]
    pub fn prepare_message_attempt_with_attachments(
        &mut self,
        thread_id: &str,
        content: &str,
        local_images: Vec<LocalImageAttachment>,
    ) -> Result<AttemptSpec, String> {
        let content = content.trim();
        if content.chars().count() > 65_536 {
            return Err("message must be at most 65536 characters".to_owned());
        }
        if content.is_empty() && local_images.is_empty() {
            return Err("message is required".to_owned());
        }
        let content = content.to_owned();
        let thread = self
            .conversation
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .cloned()
            .ok_or_else(|| format!("unknown Thread: {thread_id}"))?;
        let resolved_agent = self.resolve_agent_for_thread(thread_id, &thread.agent)?;
        let resolved_model = thread
            .model_id
            .as_deref()
            .map(|id| self.settings.catalog.enabled_model(id))
            .transpose()?
            .or(resolved_agent.model);
        let message_id = self.allocate_id("message");
        let attempt_id = self.allocate_id("attempt");
        let created_at_ms = now_millis();
        let mut user_parts =
            Vec::with_capacity(local_images.len() + usize::from(!content.is_empty()));
        if !content.is_empty() {
            user_parts.push(markdown_part(&message_id, content.clone()));
        }
        user_parts.extend(
            local_images
                .iter()
                .enumerate()
                .map(|(index, image)| MessagePart {
                    id: format!("{message_id}-image-{index}"),
                    kind: "image".to_owned(),
                    text: None,
                    url: Some(format!("ovule-attachment:///{}", image.id)),
                    name: Some(image.name.clone()),
                    media_type: Some(image.media_type.clone()),
                    size_bytes: Some(image.size_bytes),
                    data_json: None,
                }),
        );
        self.conversation.messages.push(ThreadMessage {
            id: message_id.clone(),
            thread_id: thread_id.to_owned(),
            role: "user".to_owned(),
            content: content.clone(),
            parts: user_parts,
            status: "complete".to_owned(),
            stream_sequence: 0,
            created_at_ms,
            attempt_id: Some(attempt_id.clone()),
        });
        let history = self
            .conversation
            .messages
            .iter()
            .filter(|message| message.thread_id == thread_id)
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|message| {
                let images = message
                    .parts
                    .iter()
                    .filter(|part| part.kind == "image")
                    .filter_map(|part| part.name.as_deref())
                    .map(|name| format!("[attached image: {name}]"))
                    .collect::<Vec<_>>()
                    .join(" ");
                format!(
                    "{}: {}{}{}",
                    message.role,
                    message.content.chars().take(4000).collect::<String>(),
                    if message.content.is_empty() || images.is_empty() {
                        ""
                    } else {
                        " "
                    },
                    images
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let prompt = format!(
            "You are responding in a persistent Ovule Thread.\n\nThread: {}\n\nConversation:\n{}\n\nAvailable Ovule execution targets (Host IDs, Agent profile IDs, and Workspace IDs):\n{}\n\nRespond directly to the latest user message in Markdown. When proposing or creating Workflow work, use only IDs from this inventory. Work only in the provided workspace, verify material actions, and finish with a concise response for the user.{}",
            thread.title,
            history,
            self.workflow_host_context(),
            if thread.title == "New thread" {
                " Begin the response with a concise level-one Markdown heading inferred from the request; do not use New thread."
            } else {
                ""
            }
        );
        let response_message_id = self.allocate_id("message");
        self.conversation.messages.push(ThreadMessage {
            id: response_message_id.clone(),
            thread_id: thread_id.to_owned(),
            role: "assistant".to_owned(),
            content: String::new(),
            parts: vec![markdown_part(&response_message_id, String::new())],
            status: "streaming".to_owned(),
            stream_sequence: 0,
            created_at_ms,
            attempt_id: Some(attempt_id.clone()),
        });
        self.conversation.attempts.push(Attempt {
            id: attempt_id.clone(),
            thread_id: thread_id.to_owned(),
            task_id: None,
            source_message_id: Some(message_id.clone()),
            response_message_id: Some(response_message_id),
            output_sequence: 0,
            output: String::new(),
            structured_fallback: None,
            purpose: "conversation".to_owned(),
            agent: thread.agent.clone(),
            host_id: thread.host_id.clone(),
            driver: Some(resolved_agent.driver.clone()),
            model_provider: resolved_model.as_ref().map(|model| model.provider.clone()),
            model_remote_id: resolved_model.as_ref().map(|model| model.remote_id.clone()),
            status: "queued".to_owned(),
            summary: "Waiting for AgentDriver".to_owned(),
            created_at_ms,
            started_at_ms: None,
            finished_at_ms: None,
            events: vec![AttemptEvent {
                kind: "attempt/created".to_owned(),
                occurred_at_ms: created_at_ms,
                detail: "Thread message delegated to an Agent".to_owned(),
            }],
        });
        self.changed();
        Ok(AttemptSpec {
            project_id: thread.project_id.clone(),
            id: attempt_id,
            thread_id: thread_id.to_owned(),
            task_id: None,
            source_message_id: Some(message_id),
            agent: thread.agent,
            host_id: thread.host_id.clone(),
            prompt,
            workspace_path: thread.workspace_path,
            workspace_binding_id: thread
                .workspace_binding_ids
                .iter()
                .find(|id| {
                    self.workspace_binding(id)
                        .is_some_and(|binding| binding.host_id == thread.host_id)
                })
                .cloned(),
            workspaces: thread
                .workspace_binding_ids
                .iter()
                .filter_map(|id| self.workspace_binding(id))
                .filter(|binding| binding.host_id == thread.host_id)
                .collect(),
            driver: resolved_agent.driver,
            model_provider: resolved_model.as_ref().map(|model| model.provider.clone()),
            model_remote_id: resolved_model.map(|model| model.remote_id),
            skill_paths: resolved_agent
                .skills
                .into_iter()
                .map(|skill| skill.path)
                .collect(),
            tools: resolved_agent.tools,
            instructions: resolved_agent.instructions,
            structured_goal: false,
            local_images,
        })
    }

    pub fn prepare_onboarding_workflow(
        &mut self,
        thread_id: &str,
        request: &str,
    ) -> Result<AttemptSpec, String> {
        let request = required_text(request, "onboarding request", 65_536)?;
        let skill_path = self.settings.catalog.enabled_skill_path("onboarding")?;
        let command = format!("/onboarding {request}");
        let mut spec = self.prepare_message_attempt(thread_id, &command)?;
        if !spec.skill_paths.contains(&skill_path) {
            spec.skill_paths.push(skill_path);
        }
        spec.structured_goal = true;
        spec.prompt = format!(
            "Use the bundled onboarding Skill to turn the user's setup request into an observable Goal and Workflow. Return only a JSON object with this shape: {{\"title\": string, \"intent\": string, \"response\": string, \"nodes\": [{{\"id\": string, \"kind\": \"task\" | \"gate\", \"title\": string, \"dependsOn\": string[], \"agent\": string | null, \"host\": string | null, \"workspaces\": string[]}}]}}. Node IDs are unique within this response. `dependsOn` references earlier Node IDs; use an empty array for independent roots so safe work can run in parallel. Task nodes may be assigned to any listed Host using its exact Host ID, one Agent profile ID available on that Host, and its Workspace IDs. Omitted assignments inherit the parent Thread. Include explicit checks, approval gates for installations or authentication, and a human-assisted Browser Use step for browser login when needed. Do not fabricate IDs, URLs, selectors, authentication state, or completed actions. Keep the title concise, make intent an outcome with acceptance criteria, respond in the user's language, and prefer 1-6 initial nodes (up to 64 when necessary). Do not use Markdown fences.\n\nAvailable execution targets:\n{}\n\nOnboarding request:\n{request}",
            self.workflow_host_context(),
        );
        if let Some(attempt) = self
            .conversation
            .attempts
            .iter_mut()
            .find(|attempt| attempt.id == spec.id)
        {
            "onboarding_workflow".clone_into(&mut attempt.purpose);
            "Planning onboarding Goal and Workflow".clone_into(&mut attempt.summary);
        }
        Ok(spec)
    }

    pub fn prepare_goal_workflow(
        &mut self,
        thread_id: &str,
        goal_id: Option<&str>,
        request: &str,
    ) -> Result<AttemptSpec, String> {
        let request = required_text(request, "Goal prompt", 65_536)?;
        let target = goal_id
            .map(|goal_id| {
                let goal = self.goal(goal_id)?;
                if goal.thread_id != thread_id {
                    return Err(format!(
                        "Goal {goal_id} does not belong to Thread {thread_id}"
                    ));
                }
                Ok(goal.clone())
            })
            .transpose()?;
        if let Some(goal) = &target
            && self.conversation.attempts.iter().any(|attempt| {
                (attempt.purpose == format!("goal_adjustment:{}", goal.id)
                    || attempt
                        .purpose
                        .starts_with(&format!("workflow_replan:{}:", goal.id)))
                    && matches!(
                        attempt.status.as_str(),
                        "queued" | "dispatched" | "running" | "cancelling"
                    )
            })
        {
            return Err(format!("Goal {} is already being replanned", goal.id));
        }
        let command = target.as_ref().map_or_else(
            || format!("/goal {request}"),
            |goal| format!("/goal #{} {request}", goal.id),
        );
        let mut spec = self.prepare_message_attempt(thread_id, &command)?;
        spec.structured_goal = true;
        if let Some(goal) = &target {
            spec.prompt = format!(
                "Adjust the existing Ovule Goal and its remaining Workflow according to the user's request. Return only a JSON object with this shape: {{\"title\": string, \"intent\": string, \"response\": string, \"nodes\": [{{\"id\": string, \"kind\": \"task\" | \"gate\", \"title\": string, \"dependsOn\": string[], \"agent\": string | null, \"host\": string | null, \"workspaces\": string[]}}]}}. Node IDs are unique within this response. `dependsOn` references earlier Node IDs; use an empty array for independent roots so safe work can run in parallel. The nodes array is the complete replacement plan for remaining work and may be empty when no work remains. Completed or currently running Nodes are immutable history and must not be repeated. Use only exact Host, Agent profile, and Workspace IDs from the inventory. Do not fabricate completed work. Do not use Markdown fences.\n\nAvailable execution targets:\n{}\n\nCurrent Goal and Workflow:\n{}\n\nAdjustment request:\n{request}",
                self.workflow_host_context(),
                self.workflow_goal_context(&goal.id)?,
            );
            if let Some(current) = self
                .workflow
                .goals
                .iter_mut()
                .find(|item| item.id == goal.id)
            {
                "replanning".clone_into(&mut current.status);
            }
            if let Some(attempt) = self
                .conversation
                .attempts
                .iter_mut()
                .find(|item| item.id == spec.id)
            {
                attempt.purpose = format!("goal_adjustment:{}", goal.id);
                "Adjusting Goal and Workflow".clone_into(&mut attempt.summary);
            }
        } else {
            spec.prompt = format!(
                "Create an observable Ovule Goal and Workflow from the user's request. Return only a JSON object with this shape: {{\"title\": string, \"intent\": string, \"response\": string, \"nodes\": [{{\"kind\": \"task\" | \"gate\", \"title\": string, \"agent\": string | null, \"host\": string | null, \"workspaces\": string[]}}]}}. Prefer 1-6 initial Nodes (up to 64 when necessary). Use short action titles (about 40 characters or less) and a concise intent; keep diagnostics out of titles. Task Nodes may target any listed Host using exact Host, Agent profile, and Workspace IDs. Omitted assignments inherit the Conversation Thread. Include verification and approval Gates when appropriate. Do not fabricate IDs or completed work. Do not use Markdown fences.\n\nAvailable execution targets:\n{}\n\nGoal request:\n{request}",
                self.workflow_host_context(),
            );
            if let Some(attempt) = self
                .conversation
                .attempts
                .iter_mut()
                .find(|item| item.id == spec.id)
            {
                "goal_creation".clone_into(&mut attempt.purpose);
                "Planning Goal and Workflow".clone_into(&mut attempt.summary);
            }
        }
        Ok(spec)
    }

    pub fn prepare_workflow_replan(
        &mut self,
        task_id: &str,
        outcome_status: &str,
        outcome_summary: &str,
    ) -> Result<AttemptSpec, String> {
        let node = self
            .workflow
            .nodes
            .iter()
            .find(|node| node.id == task_id)
            .cloned()
            .ok_or_else(|| format!("unknown Node: {task_id}"))?;
        let goal = self.goal(&node.goal_id)?.clone();
        let replan_prefix = format!("workflow_replan:{}:", goal.id);
        if self
            .conversation
            .attempts
            .iter()
            .rev()
            .take_while(|attempt| attempt.purpose != format!("goal_adjustment:{}", goal.id))
            .filter(|attempt| attempt.purpose.starts_with(&replan_prefix))
            .count()
            >= 2
        {
            return Err("Automatic Workflow recovery exhausted; inspect the failed Node and adjust the Goal before retrying".to_owned());
        }
        let purpose = format!("workflow_replan:{}:{}", goal.id, node.id);
        if self
            .conversation
            .attempts
            .iter()
            .any(|attempt| attempt.purpose == purpose)
        {
            return Err(format!(
                "Workflow was already replanned after Node {task_id}"
            ));
        }
        let active_adjustment = format!("goal_adjustment:{}", goal.id);
        if self.conversation.attempts.iter().any(|attempt| {
            attempt.purpose == active_adjustment
                && matches!(
                    attempt.status.as_str(),
                    "queued" | "dispatched" | "running" | "cancelling"
                )
        }) {
            return Err(format!("Goal {} is already being adjusted", goal.id));
        }
        let command = format!(
            "/goal #{} Replan after Node {} finished with status {}.",
            goal.id, node.id, outcome_status
        );
        let mut spec = self.prepare_message_attempt(&goal.thread_id, &command)?;
        if let Some(source_message_id) = spec.source_message_id.take() {
            self.conversation
                .messages
                .retain(|message| message.id != source_message_id);
        }
        spec.structured_goal = true;
        spec.prompt = format!(
            "Dynamically replan the remaining work for an executing Ovule Goal after one Node finished. Return only a JSON object with this shape: {{\"title\": string, \"intent\": string, \"response\": string, \"nodes\": [{{\"id\": string, \"kind\": \"task\" | \"gate\", \"title\": string, \"dependsOn\": string[], \"agent\": string | null, \"host\": string | null, \"workspaces\": string[]}}]}}. Node IDs are unique within this response. `dependsOn` references earlier Node IDs; use an empty array for independent roots so safe work can run in parallel. Preserve the Goal identity and completed/running history. Use short action titles and a concise intent; do not repeat diagnostics or historical explanations. The nodes array is the complete replacement plan for remaining work and may be empty when the Goal is complete. Use only exact IDs from the inventory. Do not repeat completed Nodes or fabricate results. Do not use Markdown fences.\n\nAvailable execution targets:\n{}\n\nCurrent Goal and Workflow:\n{}\n\nCompleted Node outcome:\nNode: {}\nStatus: {outcome_status}\nSummary: {outcome_summary}",
            self.workflow_host_context(),
            self.workflow_goal_context(&goal.id)?,
            node.title,
        );
        if let Some(attempt) = self
            .conversation
            .attempts
            .iter_mut()
            .find(|item| item.id == spec.id)
        {
            attempt.source_message_id = None;
            attempt.purpose = purpose;
            "Dynamically replanning Workflow".clone_into(&mut attempt.summary);
        }
        if let Some(current) = self
            .workflow
            .goals
            .iter_mut()
            .find(|item| item.id == goal.id)
        {
            "replanning".clone_into(&mut current.status);
        }
        Ok(spec)
    }

    fn workflow_goal_context(&self, goal_id: &str) -> Result<String, String> {
        let goal = self.goal(goal_id)?;
        let nodes = self
            .workflow
            .nodes
            .iter()
            .filter(|node| node.goal_id == goal_id)
            .map(|node| {
                let latest_attempt = self
                    .conversation
                    .attempts
                    .iter()
                    .rev()
                    .find(|attempt| attempt.task_id.as_deref() == Some(node.id.as_str()));
                serde_json::json!({
                    "id": node.id,
                    "title": node.title,
                    "kind": if matches!(node.kind, NodeKind::Gate) { "gate" } else { "task" },
                    "status": node.status,
                    "threadId": node.thread_id,
                    "attemptSummary": latest_attempt.map(|attempt| attempt.summary.as_str()),
                })
            })
            .collect::<Vec<_>>();
        serde_json::to_string_pretty(&serde_json::json!({
            "id": goal.id,
            "title": goal.title,
            "intent": goal.intent,
            "status": goal.status,
            "nodes": nodes,
        }))
        .map_err(|error| error.to_string())
    }

    pub fn prepare_skill_attempt(
        &mut self,
        thread_id: &str,
        content: &str,
        skill_ids: &[String],
    ) -> Result<AttemptSpec, String> {
        let skill_paths = skill_ids
            .iter()
            .map(|skill_id| self.settings.catalog.enabled_skill_path(skill_id))
            .collect::<Result<Vec<_>, _>>()?;
        let mut spec = self.prepare_message_attempt(thread_id, content)?;
        for skill_path in skill_paths {
            if !spec.skill_paths.contains(&skill_path) {
                spec.skill_paths.push(skill_path);
            }
        }
        Ok(spec)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare_extension_workflow(
        &mut self,
        thread_id: &str,
        command_id: &str,
        request: &str,
        skill_ids: &[String],
        workflow_instructions: &str,
        fallback_json: String,
        status_block_kind: &str,
        status_json: String,
    ) -> Result<AttemptSpec, String> {
        let skill_paths = skill_ids
            .iter()
            .map(|skill_id| self.settings.catalog.enabled_skill_path(skill_id))
            .collect::<Result<Vec<_>, _>>()?;
        let request = request.trim();
        let requested_action = if request.is_empty() {
            "Configure and verify this extension."
        } else {
            request
        };
        let command = if request.is_empty() {
            format!("/{command_id}")
        } else {
            format!("/{command_id} {request}")
        };
        let mut spec = self.prepare_message_attempt(thread_id, &command)?;
        for skill_path in skill_paths {
            if !spec.skill_paths.contains(&skill_path) {
                spec.skill_paths.push(skill_path);
            }
        }
        spec.structured_goal = true;
        spec.prompt = format!(
            "Create an observable Goal and Workflow for the extension that owns /{command_id}. Return only a JSON object with this shape: {{\"title\": string, \"intent\": string, \"response\": string, \"nodes\": [{{\"id\": string, \"kind\": \"task\" | \"gate\", \"title\": string, \"dependsOn\": string[], \"agent\": string | null, \"host\": string | null, \"workspaces\": string[]}}]}}. Node IDs are unique within this response. `dependsOn` references earlier Node IDs; use an empty array for independent roots so safe work can run in parallel. Task nodes may be assigned to any listed Host using its exact Host ID, one Agent profile ID available on that Host, and its Workspace IDs. Omitted assignments inherit the parent Thread. Keep the title concise, make the intent an outcome with acceptance criteria, prefer 1-6 initial nodes (up to 64 when necessary), and do not use Markdown fences. Follow the extension-owned workflow instructions below.\n\nAvailable execution targets:\n{}\n\nExtension workflow instructions:\n{workflow_instructions}\n\nRequest:\n{requested_action}",
            self.workflow_host_context(),
        );
        self.upsert_attempt_message_block(
            &spec.id,
            "setup-status",
            status_block_kind,
            status_json,
        )?;
        if let Some(attempt) = self
            .conversation
            .attempts
            .iter_mut()
            .find(|attempt| attempt.id == spec.id)
        {
            "extension_workflow".clone_into(&mut attempt.purpose);
            attempt.structured_fallback = Some(fallback_json);
            format!("Planning /{command_id} extension workflow").clone_into(&mut attempt.summary);
        }
        Ok(spec)
    }

    #[cfg(test)]
    #[must_use]
    pub fn first_pending_task(&self, thread_id: &str) -> Option<String> {
        let succeeded = self
            .workflow
            .nodes
            .iter()
            .filter(|node| matches!(node.status.as_str(), "succeeded" | "approved"))
            .map(|node| node.id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        self.workflow
            .goals
            .iter()
            .filter(|goal| goal.thread_id == thread_id && goal.status == "active")
            .flat_map(|goal| {
                self.workflow
                    .nodes
                    .iter()
                    .filter(move |node| node.goal_id == goal.id)
            })
            .find(|node| {
                node.status == "pending"
                    && matches!(node.kind, NodeKind::Task { .. })
                    && node
                        .dependency_ids
                        .iter()
                        .all(|dependency| succeeded.contains(dependency.as_str()))
            })
            .map(|node| node.id.clone())
    }

    #[must_use]
    pub fn first_waiting_gate(&self, thread_id: &str) -> Option<String> {
        if let Some(node) = self.workflow.nodes.iter().find(|node| {
            node.thread_id == thread_id && node.status == "waiting" && node.kind == NodeKind::Gate
        }) {
            return Some(node.id.clone());
        }
        self.workflow
            .goals
            .iter()
            .filter(|goal| goal.thread_id == thread_id && goal.status == "active")
            .find_map(|goal| {
                let first_incomplete = self.workflow.nodes.iter().find(|node| {
                    node.goal_id == goal.id
                        && !matches!(
                            node.status.as_str(),
                            "succeeded" | "approved" | "superseded"
                        )
                })?;
                (first_incomplete.status == "waiting" && first_incomplete.kind == NodeKind::Gate)
                    .then(|| first_incomplete.id.clone())
            })
    }

    pub fn resolve_gate_from_message(
        &mut self,
        thread_id: &str,
        node_id: &str,
        content: &str,
        approved: bool,
    ) -> Result<AppSnapshot, String> {
        if !self
            .conversation
            .threads
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(format!("unknown Thread: {thread_id}"));
        }
        let content = required_text(content, "message", 65_536)?;
        let message_id = self.allocate_id("message");
        self.conversation.messages.push(ThreadMessage {
            id: message_id.clone(),
            thread_id: thread_id.to_owned(),
            role: "user".to_owned(),
            content: content.clone(),
            parts: vec![markdown_part(&message_id, content)],
            status: "complete".to_owned(),
            stream_sequence: 0,
            created_at_ms: now_millis(),
            attempt_id: None,
        });
        self.resolve_gate(node_id, approved)
    }

    pub fn dispatch_attempt(&mut self, attempt_id: &str) -> Result<AppSnapshot, String> {
        let attempt = self.attempt_mut(attempt_id)?;
        if attempt.status != "queued" {
            return Err("only queued Attempts can be dispatched".to_owned());
        }
        "dispatched".clone_into(&mut attempt.status);
        "AgentDriver accepted the Attempt".clone_into(&mut attempt.summary);
        attempt.events.push(AttemptEvent {
            kind: "attempt/dispatched".to_owned(),
            occurred_at_ms: now_millis(),
            detail: format!("{} AgentDriver accepted the Attempt", attempt.agent),
        });
        self.changed();
        Ok(self.snapshot())
    }

    /// Diagnostics share the checkpoint transaction and bounded Attempt timeline.
    pub fn record_attempt_diagnostic(
        &mut self,
        attempt_id: &str,
        kind: &str,
        detail: &str,
    ) -> Result<AppSnapshot, String> {
        if !matches!(
            kind,
            "harness/assembled"
                | "harness/tool"
                | "harness/failed"
                | "harness/execution"
                | "harness/approval"
        ) || detail.len() > 65_536
        {
            return Err("invalid harness diagnostic".into());
        }
        serde_json::from_str::<serde_json::Value>(detail).map_err(|_| "invalid diagnostic JSON")?;
        let attempt = self.attempt_mut(attempt_id)?;
        if !matches!(attempt.status.as_str(), "queued" | "dispatched" | "running") {
            return Ok(self.snapshot());
        }
        if attempt
            .events
            .iter()
            .filter(|event| event.kind.starts_with("harness/"))
            .count()
            >= 256
        {
            if let Some(index) = attempt.events.iter().position(|event| {
                matches!(
                    event.kind.as_str(),
                    "harness/tool" | "harness/execution" | "harness/approval"
                )
            }) {
                attempt.events.remove(index);
            } else {
                return Ok(self.snapshot());
            }
        }
        attempt.events.push(AttemptEvent {
            kind: kind.into(),
            occurred_at_ms: now_millis(),
            detail: detail.into(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    pub fn start_attempt(&mut self, attempt_id: &str) -> Result<AppSnapshot, String> {
        let attempt = self.attempt_mut(attempt_id)?;
        if attempt.status != "dispatched" {
            return Err("only dispatched Attempts can start".to_owned());
        }
        "running".clone_into(&mut attempt.status);
        "Agent Worker is running".clone_into(&mut attempt.summary);
        let started_at_ms = now_millis();
        attempt.started_at_ms = Some(started_at_ms);
        attempt.events.push(AttemptEvent {
            kind: "attempt/started".to_owned(),
            occurred_at_ms: started_at_ms,
            detail: "Worker process started".to_owned(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    pub fn append_attempt_output(
        &mut self,
        attempt_id: &str,
        sequence: u64,
        delta: &str,
    ) -> Result<AppSnapshot, String> {
        let delta = delta.chars().take(65_536).collect::<String>();
        let attempt_index = self
            .conversation
            .attempts
            .iter()
            .position(|attempt| attempt.id == attempt_id)
            .ok_or_else(|| format!("unknown Attempt: {attempt_id}"))?;
        if !matches!(
            self.conversation.attempts[attempt_index].status.as_str(),
            "queued" | "dispatched" | "running" | "cancelling"
        ) {
            return Ok(self.snapshot());
        }
        if sequence < self.conversation.attempts[attempt_index].output_sequence {
            return Ok(self.snapshot());
        }
        if sequence != self.conversation.attempts[attempt_index].output_sequence {
            return Err(format!(
                "out-of-order Agent output for {attempt_id}: expected {}, got {sequence}",
                self.conversation.attempts[attempt_index].output_sequence
            ));
        }
        append_bounded_stream(
            &mut self.conversation.attempts[attempt_index].output,
            &delta,
            MAX_STREAMED_OUTPUT_BYTES,
        );
        self.conversation.attempts[attempt_index].output_sequence += 1;
        if let Some(response_message_id) = self.conversation.attempts[attempt_index]
            .response_message_id
            .clone()
        {
            let message = self
                .conversation
                .messages
                .iter_mut()
                .find(|message| message.id == response_message_id)
                .ok_or_else(|| {
                    format!("Attempt response Message is missing: {response_message_id}")
                })?;
            append_bounded_stream(&mut message.content, &delta, MAX_STREAMED_OUTPUT_BYTES);
            if let Some(part) = message.parts.first_mut() {
                part.text = Some(message.content.clone());
            }
            message.stream_sequence = self.conversation.attempts[attempt_index].output_sequence;
        }
        "Agent is responding".clone_into(&mut self.conversation.attempts[attempt_index].summary);
        self.changed();
        Ok(self.snapshot())
    }

    pub fn upsert_attempt_message_block(
        &mut self,
        attempt_id: &str,
        block_id: &str,
        kind: &str,
        data_json: String,
    ) -> Result<AppSnapshot, String> {
        if block_id.is_empty() || block_id.len() > 128 || kind.is_empty() || kind.len() > 128 {
            return Err("invalid extension Message Block identity".to_owned());
        }
        if data_json.len() > 256 * 1024
            || serde_json::from_str::<serde_json::Value>(&data_json).is_err()
        {
            return Err("invalid extension Message Block payload".to_owned());
        }
        let attempt = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)
            .ok_or_else(|| format!("Unknown Attempt: {attempt_id}"))?;
        if !matches!(
            attempt.status.as_str(),
            "queued" | "dispatched" | "running" | "cancelling"
        ) {
            return Ok(self.snapshot());
        }
        let response_message_id = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)
            .and_then(|attempt| attempt.response_message_id.clone())
            .ok_or_else(|| format!("Attempt has no response Message: {attempt_id}"))?;
        let message = self
            .conversation
            .messages
            .iter_mut()
            .find(|message| message.id == response_message_id)
            .ok_or_else(|| format!("Attempt response Message is missing: {response_message_id}"))?;
        let part_id = format!("{response_message_id}-extension-{block_id}");
        let image = (kind == "image")
            .then(|| serde_json::from_str::<serde_json::Value>(&data_json).unwrap_or_default());
        let mut part = MessagePart {
            id: part_id.clone(),
            kind: kind.to_owned(),
            text: None,
            url: None,
            name: None,
            media_type: Some("application/json".to_owned()),
            size_bytes: i64::try_from(data_json.len()).ok(),
            data_json: Some(data_json),
        };
        if let Some(image) = image {
            part.url = image
                .get("url")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            part.name = image
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            part.media_type = image
                .get("mediaType")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            part.size_bytes = image.get("sizeBytes").and_then(serde_json::Value::as_i64);
        }
        if let Some(existing) = message.parts.iter_mut().find(|part| part.id == part_id) {
            *existing = part;
        } else {
            message.parts.push(part);
        }
        self.changed();
        Ok(self.snapshot())
    }

    pub fn replace_attempt_output(
        &mut self,
        attempt_id: &str,
        content: String,
    ) -> Result<AppSnapshot, String> {
        if content.len() > MAX_STREAMED_OUTPUT_BYTES {
            return Err("replacement Agent output is too large".to_owned());
        }
        let attempt_index = self
            .conversation
            .attempts
            .iter()
            .position(|attempt| attempt.id == attempt_id)
            .ok_or_else(|| format!("unknown Attempt: {attempt_id}"))?;
        if !matches!(
            self.conversation.attempts[attempt_index].status.as_str(),
            "dispatched" | "running" | "cancelling"
        ) {
            return Err("only active Attempts can replace output".to_owned());
        }
        self.conversation.attempts[attempt_index]
            .output
            .clone_from(&content);
        if let Some(response_message_id) = self.conversation.attempts[attempt_index]
            .response_message_id
            .clone()
        {
            let message = self
                .conversation
                .messages
                .iter_mut()
                .find(|message| message.id == response_message_id)
                .ok_or_else(|| {
                    format!("Attempt response Message is missing: {response_message_id}")
                })?;
            message.content.clone_from(&content);
            if let Some(markdown) = message
                .parts
                .iter_mut()
                .find(|part| part.kind == "markdown")
            {
                markdown.text = Some(content);
            }
        }
        self.changed();
        Ok(self.snapshot())
    }

    #[allow(clippy::too_many_lines)]
    pub fn finish_attempt(
        &mut self,
        attempt_id: &str,
        status: &str,
        summary: String,
    ) -> Result<AppSnapshot, String> {
        if !matches!(status, "succeeded" | "failed" | "cancelled") {
            return Err(format!("invalid terminal Attempt status: {status}"));
        }
        let purpose = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)
            .map(|attempt| attempt.purpose.clone())
            .ok_or_else(|| format!("unknown Attempt: {attempt_id}"))?;
        let structured_fallback = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)
            .and_then(|attempt| attempt.structured_fallback.clone());
        let derived_target = purpose
            .strip_prefix("goal_adjustment:")
            .or_else(|| {
                purpose
                    .strip_prefix("workflow_replan:")
                    .and_then(|value| value.split(':').next())
            })
            .map(str::to_owned);
        let creates_goal = matches!(
            purpose.as_str(),
            "goal_derivation" | "goal_creation" | "onboarding_workflow" | "extension_workflow"
        );
        let derived = if status == "succeeded" && (creates_goal || derived_target.is_some()) {
            let primary = parse_goal_derivation(&summary, creates_goal);
            Some(match (primary, structured_fallback.as_deref()) {
                (Ok(goal), _) => Ok(goal),
                (Err(primary_error), Some(fallback)) if purpose == "extension_workflow" => {
                    parse_goal_derivation(fallback, true).map_err(|fallback_error| {
                        format!("{primary_error}; Extension fallback is invalid: {fallback_error}")
                    })
                }
                (Err(error), _) => Err(error),
            })
        } else {
            None
        };
        let (final_status, final_summary) = match &derived {
            Some(Ok(goal)) => ("succeeded", goal.response.clone()),
            Some(Err(error)) => (
                "failed",
                format!(
                    "Goal derivation failed: {error}. Your message was saved; retry from this Thread."
                ),
            ),
            None => (status, summary),
        };
        let existing_stream = self
            .conversation
            .attempts
            .iter()
            .find(|attempt| attempt.id == attempt_id)
            .and_then(|attempt| attempt.response_message_id.as_deref())
            .and_then(|id| {
                self.conversation
                    .messages
                    .iter()
                    .find(|message| message.id == id)
            })
            .map(|message| message.content.clone())
            .unwrap_or_default();
        let title_source = if existing_stream.trim().is_empty() {
            final_summary.as_str()
        } else {
            existing_stream.as_str()
        };
        let generated_title = (purpose == "conversation" && status == "succeeded")
            .then(|| generated_thread_title(title_source));
        let (task_id, thread_id, response_message_id, response) = {
            let attempt = self.attempt_mut(attempt_id)?;
            if !matches!(
                attempt.status.as_str(),
                "queued" | "dispatched" | "running" | "cancelling"
            ) {
                return Err("only incomplete Attempts can finish".to_owned());
            }
            final_status.clone_into(&mut attempt.status);
            attempt.summary = final_summary;
            if attempt.output.trim().is_empty() {
                attempt.output.clone_from(&attempt.summary);
            }
            let finished_at_ms = now_millis();
            attempt.finished_at_ms = Some(finished_at_ms);
            attempt.events.push(AttemptEvent {
                kind: format!("attempt/{final_status}"),
                occurred_at_ms: finished_at_ms,
                detail: attempt.summary.clone(),
            });
            (
                attempt.task_id.clone(),
                attempt.thread_id.clone(),
                attempt.response_message_id.clone(),
                (attempt.summary.clone(), finished_at_ms),
            )
        };
        if let Some(task_id) = task_id {
            self.finalize_attempt_message(
                attempt_id,
                &thread_id,
                response_message_id.as_deref(),
                final_status,
                response.0,
                response.1,
            );
            let node = self
                .workflow
                .nodes
                .iter_mut()
                .find(|node| node.id == task_id)
                .ok_or_else(|| format!("Attempt {attempt_id} has no Task"))?;
            if final_status == "succeeded" {
                "succeeded"
            } else {
                final_status
            }
            .clone_into(&mut node.status);
            let goal_id = node.goal_id.clone();
            self.update_goal_progress(&goal_id);
        } else {
            let (content, created_at_ms) = response;
            if let Some(title) = generated_title
                && let Some(thread) = self
                    .conversation
                    .threads
                    .iter_mut()
                    .find(|thread| thread.id == thread_id)
                && thread.title == "New thread"
            {
                thread.title = title;
            }
            self.finalize_attempt_message(
                attempt_id,
                &thread_id,
                response_message_id.as_deref(),
                final_status,
                content,
                created_at_ms,
            );
            match derived {
                Some(Ok(derived)) => {
                    if let Some(goal_id) = derived_target.as_deref() {
                        self.apply_derived_workflow_update(goal_id, derived)?;
                    } else {
                        let goal_id = self.allocate_id("goal");
                        self.workflow.goals.push(Goal {
                            id: goal_id.clone(),
                            thread_id: thread_id.clone(),
                            title: derived.title,
                            intent: derived.intent,
                            status: "active".to_owned(),
                            progress: "No nodes yet".to_owned(),
                            created_at_ms: now_millis(),
                        });
                        self.append_derived_nodes(&goal_id, &thread_id, derived.nodes)?;
                        self.update_goal_progress(&goal_id);
                        if let Some(message) = response_message_id.as_deref().and_then(|id| {
                            self.conversation
                                .messages
                                .iter_mut()
                                .find(|message| message.id == id)
                        }) {
                            let mut setup_parts = Vec::new();
                            message.parts.retain(|part| {
                                if part.id.ends_with("setup-status") {
                                    setup_parts.push(part.clone());
                                    false
                                } else {
                                    true
                                }
                            });
                            let setup_node_id = (!setup_parts.is_empty())
                                .then(|| {
                                    self.workflow
                                        .nodes
                                        .iter()
                                        .find(|node| {
                                            node.goal_id == goal_id
                                                && matches!(node.kind, NodeKind::Task { .. })
                                        })
                                        .map(|node| node.id.clone())
                                })
                                .flatten();
                            let mut workflow_part =
                                markdown_part(&format!("{}:workflow", message.id), String::new());
                            "workflow".clone_into(&mut workflow_part.kind);
                            workflow_part.text = None;
                            workflow_part.data_json =
                                Some(serde_json::json!({"goalId": goal_id, "setupNodeId": setup_node_id}).to_string());
                            message.parts.push(workflow_part);
                            if let Some(node) = self.workflow.nodes.iter_mut().find(|node| {
                                node.goal_id == goal_id
                                    && matches!(node.kind, NodeKind::Task { .. })
                            }) {
                                node.initial_parts.extend(setup_parts);
                            }
                        }
                    }
                }
                Some(Err(_)) | None => {
                    if let Some(goal_id) = derived_target.as_deref() {
                        self.update_goal_progress(goal_id);
                    }
                }
            }
        }
        self.changed();
        Ok(self.snapshot())
    }

    fn apply_derived_workflow_update(
        &mut self,
        goal_id: &str,
        derived: super::DerivedGoal,
    ) -> Result<(), String> {
        let completes_without_replacement = derived.nodes.is_empty();
        let thread_id = {
            let goal = self.goal(goal_id)?;
            goal.thread_id.clone()
        };
        for node in self
            .workflow
            .nodes
            .iter_mut()
            .filter(|node| node.goal_id == goal_id)
        {
            if !matches!(
                node.status.as_str(),
                "running" | "cancelling" | "succeeded" | "approved"
            ) {
                "superseded".clone_into(&mut node.status);
            }
        }
        if let Some(goal) = self
            .workflow
            .goals
            .iter_mut()
            .find(|goal| goal.id == goal_id)
        {
            goal.title = derived.title;
            goal.intent = derived.intent;
        }
        self.append_derived_nodes(goal_id, &thread_id, derived.nodes)?;
        self.update_goal_progress(goal_id);
        if completes_without_replacement
            && !self.workflow.nodes.iter().any(|node| {
                node.goal_id == goal_id
                    && matches!(
                        node.status.as_str(),
                        "running" | "cancelling" | "pending" | "waiting"
                    )
            })
            && let Some(goal) = self
                .workflow
                .goals
                .iter_mut()
                .find(|goal| goal.id == goal_id)
        {
            "succeeded".clone_into(&mut goal.status);
            "No remaining nodes".clone_into(&mut goal.progress);
        }
        Ok(())
    }

    fn append_derived_nodes(
        &mut self,
        goal_id: &str,
        thread_id: &str,
        nodes: Vec<super::DerivedNode>,
    ) -> Result<(), String> {
        let mut node_ids = std::collections::BTreeMap::<String, String>::new();
        for node in nodes.into_iter().take(6) {
            let logical_id = node
                .id
                .clone()
                .ok_or_else(|| "derived Node has no normalized id".to_owned())?;
            let dependency_ids = node
                .depends_on
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|dependency| {
                    node_ids.get(dependency).cloned().ok_or_else(|| {
                        format!("derived Node dependency is unavailable: {dependency}")
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            let agent = node.agent.or_else(|| {
                self.conversation
                    .threads
                    .iter()
                    .find(|thread| thread.id == thread_id)
                    .map(|thread| thread.agent.clone())
            });
            let kind = if node.kind == "gate" {
                NodeKind::Gate
            } else {
                NodeKind::Task {
                    agent: agent.unwrap_or_else(|| "ovule".to_owned()),
                }
            };
            let node_id = self.append_workflow_node(
                goal_id,
                node.title,
                kind,
                super::workflow::WorkflowNodeOptions {
                    requested_host_id: node.host.as_deref(),
                    requested_workspace_ids: &node.workspaces,
                    dependency_ids: &dependency_ids,
                    created_at_ms: now_millis(),
                },
            )?;
            node_ids.insert(logical_id, node_id);
        }
        Ok(())
    }

    fn finalize_attempt_message(
        &mut self,
        attempt_id: &str,
        thread_id: &str,
        response_message_id: Option<&str>,
        final_status: &str,
        content: String,
        created_at_ms: i64,
    ) {
        if let Some(message) = response_message_id.and_then(|id| {
            self.conversation
                .messages
                .iter_mut()
                .find(|message| message.id == id)
        }) {
            "assistant".clone_into(&mut message.role);
            let notice = (final_status != "succeeded")
                .then(|| attempt_notice(&message.id, final_status, &content));
            let rendered = if message.content.trim().is_empty() {
                if final_status == "cancelled" {
                    "Generation stopped".into()
                } else {
                    content
                }
            } else {
                message.content.clone()
            };
            message.content.clone_from(&rendered);
            if let Some(markdown) = message
                .parts
                .iter_mut()
                .find(|part| part.kind == "markdown")
            {
                markdown.text = Some(rendered);
            } else {
                message
                    .parts
                    .insert(0, markdown_part(&message.id, rendered));
            }
            message.parts.retain(|part| part.kind != "notice");
            if let Some(notice) = notice {
                message.parts.push(notice);
            }
            message.status = message_terminal_status(final_status).into();
            message.stream_sequence = self
                .conversation
                .attempts
                .iter()
                .find(|attempt| attempt.id == attempt_id)
                .map_or(message.stream_sequence, |attempt| attempt.output_sequence);
            message.created_at_ms = created_at_ms;
            return;
        }
        let id = self.allocate_id("message");
        let content = if final_status == "cancelled" {
            "Generation stopped".into()
        } else {
            content
        };
        let mut parts = vec![markdown_part(&id, content.clone())];
        if final_status != "succeeded" {
            parts.push(attempt_notice(&id, final_status, &content));
        }
        self.conversation.messages.push(ThreadMessage {
            id: id.clone(),
            thread_id: thread_id.to_owned(),
            role: "assistant".into(),
            content,
            parts,
            status: message_terminal_status(final_status).into(),
            stream_sequence: 0,
            created_at_ms,
            attempt_id: Some(attempt_id.to_owned()),
        });
    }

    pub fn request_cancel(&mut self, attempt_id: &str) -> Result<AppSnapshot, String> {
        let attempt = self.attempt_mut(attempt_id)?;
        if !matches!(attempt.status.as_str(), "queued" | "dispatched" | "running") {
            return Err("only incomplete Attempts can be cancelled".to_owned());
        }
        "cancelling".clone_into(&mut attempt.status);
        attempt.events.push(AttemptEvent {
            kind: "attempt/cancel-requested".to_owned(),
            occurred_at_ms: now_millis(),
            detail: "Cancellation requested by the user".to_owned(),
        });
        self.changed();
        Ok(self.snapshot())
    }

    pub fn abandon_incomplete_attempts(&mut self) -> bool {
        let ids: Vec<String> = self
            .conversation
            .attempts
            .iter()
            .filter(|attempt| {
                matches!(
                    attempt.status.as_str(),
                    "queued" | "dispatched" | "running" | "cancelling"
                )
            })
            .map(|attempt| attempt.id.clone())
            .collect();
        for id in &ids {
            let Some(attempt) = self
                .conversation
                .attempts
                .iter_mut()
                .find(|attempt| attempt.id == *id)
            else {
                continue;
            };
            "abandoned".clone_into(&mut attempt.status);
            "Ovule restarted before the Worker completed".clone_into(&mut attempt.summary);
            let finished_at_ms = now_millis();
            attempt.finished_at_ms = Some(finished_at_ms);
            attempt.events.push(AttemptEvent {
                kind: "attempt/abandoned".to_owned(),
                occurred_at_ms: finished_at_ms,
                detail: attempt.summary.clone(),
            });
            let task_id = attempt.task_id.clone();
            let response_message_id = attempt.response_message_id.clone();
            let summary = attempt.summary.clone();
            let _ = attempt;
            if let Some(message) = response_message_id.as_deref().and_then(|id| {
                self.conversation
                    .messages
                    .iter_mut()
                    .find(|message| message.id == id)
            }) {
                "error".clone_into(&mut message.status);
                if message.content.trim().is_empty() {
                    message.content = summary;
                    message.parts = vec![markdown_part(&message.id, message.content.clone())];
                }
            }
            if let Some(node) = task_id.as_deref().and_then(|task_id| {
                self.workflow
                    .nodes
                    .iter_mut()
                    .find(|node| node.id == task_id)
            }) {
                "blocked".clone_into(&mut node.status);
                if let Some(goal) = self
                    .workflow
                    .goals
                    .iter_mut()
                    .find(|goal| goal.id == node.goal_id)
                {
                    "blocked".clone_into(&mut goal.status);
                }
            }
        }
        let mut terminal_changed = false;
        for run in &mut self.terminal.terminal_runs {
            if matches!(run.status.as_str(), "queued" | "running" | "cancelling") {
                "cancelled".clone_into(&mut run.status);
                "Ovule restarted before the command completed".clone_into(&mut run.stderr);
                terminal_changed = true;
            }
        }
        if ids.is_empty() && !terminal_changed {
            false
        } else {
            self.changed();
            true
        }
    }
}

fn message_terminal_status(status: &str) -> &str {
    match status {
        "succeeded" => "complete",
        "cancelled" => "cancelled",
        _ => "error",
    }
}
fn attempt_notice(id: &str, status: &str, content: &str) -> MessagePart {
    MessagePart {
        id: format!("{id}-notice"),
        kind: "notice".into(),
        text: Some(if status == "cancelled" {
            "Generation stopped".into()
        } else {
            content.into()
        }),
        url: None,
        name: None,
        media_type: None,
        size_bytes: None,
        data_json: Some(serde_json::json!({"status":status}).to_string()),
    }
}
