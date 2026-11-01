//! Message submission, command dispatch, and attachment contracts.

use std::sync::Arc;

use crate::ConversationIngress;
use crate::state::AppSnapshot;
use crate::state::{AttemptSpec, LocalImageAttachment};
use crate::workspace::{MutationError, WorkspaceEventSink, WorkspaceSession};
use ovule_extension_api as extension_protocol;

/// Result of either forking or restarting history; a restart retains its Thread ID.
pub struct MessageActionResult {
    pub thread_id: String,
    pub snapshot: AppSnapshot,
}

pub struct ImageAttachment {
    pub name: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}
pub trait AttachmentRepository: Send + Sync {
    fn persist(
        &self,
        attachments: &[ImageAttachment],
    ) -> Result<Vec<LocalImageAttachment>, MessageError>;
    fn read(&self, id: &str) -> Result<Vec<u8>, MessageError>;
}
pub use ovule_settings::catalog::CommandPlan;

#[derive(Debug)]
pub enum MessageError {
    InvalidArgument(String),
    Persistence(String),
}

/// Read model required by message commands; channel providers implement this port.
pub trait ChannelStatusProvider: Send + Sync {
    fn status_json(&self, target: &str, connection_id: &str) -> Result<String, String>;
}

/// Structured message planning belongs to workflow, supplied through a consumer-owned port.
pub trait PlanningObserverFactory: Send + Sync {
    fn for_thread(&self, thread_id: String) -> crate::WorkerEventCallback;
}

struct NativeMessageService {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
    conversations: Arc<dyn ConversationIngress>,
    channels: Arc<dyn ChannelStatusProvider>,
    attachments: Arc<dyn AttachmentRepository>,
    planning: Arc<dyn PlanningObserverFactory>,
}

impl NativeMessageService {
    #[must_use]
    pub fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
        conversations: Arc<dyn ConversationIngress>,
        channels: Arc<dyn ChannelStatusProvider>,
        attachments: Arc<dyn AttachmentRepository>,
        planning: Arc<dyn PlanningObserverFactory>,
    ) -> Self {
        Self {
            state,
            events,
            conversations,
            channels,
            attachments,
            planning,
        }
    }

    pub fn select_agent(&self, thread_id: &str, agent: &str) -> Result<AppSnapshot, MessageError> {
        self.change(
            "thread/agent-selected",
            Some(thread_id),
            &serde_json::json!({"agent": agent}),
            |workspace| workspace.select_agent(thread_id, agent),
        )
    }

    pub fn select_host(&self, thread_id: &str, host_id: &str) -> Result<AppSnapshot, MessageError> {
        self.change(
            "thread/host-selected",
            Some(thread_id),
            &serde_json::json!({"host_id": host_id}),
            |workspace| workspace.select_host(thread_id, host_id),
        )
    }

    pub fn send(
        &self,
        thread_id: &str,
        content: &str,
        attachments: &[ImageAttachment],
    ) -> Result<AppSnapshot, MessageError> {
        let local_images = if attachments.is_empty() {
            Vec::new()
        } else {
            self.attachments.persist(attachments)?
        };
        self.send_with_local_images(thread_id, content, local_images)
    }

    pub fn fork_message(
        &self,
        thread_id: &str,
        message_id: &str,
    ) -> Result<MessageActionResult, MessageError> {
        let branch = self
            .state
            .transact(
                "thread/forked",
                Some(thread_id),
                &serde_json::json!({"messageId":message_id}),
                |workspace| workspace.fork_message(thread_id, message_id),
            )
            .map_err(map_mutation_error)?;
        self.publish_current_revision();
        Ok(MessageActionResult {
            thread_id: branch,
            snapshot: self.snapshot(),
        })
    }
    pub fn restart_message(
        &self,
        thread_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<MessageActionResult, MessageError> {
        let source = self
            .state
            .read(|workspace| {
                workspace
                    .snapshot()
                    .messages
                    .into_iter()
                    .find(|message| message.thread_id == thread_id && message.id == message_id)
            })
            .ok_or_else(|| {
                MessageError::InvalidArgument("Unknown message in this Thread".into())
            })?;
        if source.role != "user" || content.trim().is_empty() || content.chars().count() > 65_536 {
            return Err(MessageError::InvalidArgument(
                "An editable user prompt of 1 to 65536 characters is required".into(),
            ));
        }
        let images = source
            .parts
            .iter()
            .filter(|part| part.kind == "image")
            .map(|part| {
                let id = part
                    .url
                    .as_deref()
                    .and_then(|url| url.strip_prefix("ovule-attachment:///"))
                    .ok_or_else(|| {
                        MessageError::InvalidArgument("Invalid image attachment".into())
                    })?;
                Ok(ImageAttachment {
                    name: part.name.clone().unwrap_or_default(),
                    media_type: part.media_type.clone().unwrap_or_default(),
                    bytes: self.attachments.read(id)?,
                })
            })
            .collect::<Result<Vec<_>, MessageError>>()?;
        let images = if images.is_empty() {
            Vec::new()
        } else {
            self.attachments.persist(&images)?
        };
        // Read the authoritative state immediately before replacing history. Native
        // callers and other windows must revoke Workers even without this renderer.
        let active = self.state.read(|workspace| {
            workspace
                .snapshot()
                .attempts
                .into_iter()
                .filter(|attempt| {
                    attempt.thread_id == thread_id
                        && matches!(attempt.status.as_str(), "queued" | "dispatched" | "running")
                })
                .map(|attempt| attempt.id)
                .collect::<Vec<_>>()
        });
        for attempt in active {
            self.conversations
                .cancel_attempt(&attempt)
                .map_err(MessageError::Persistence)?;
        }
        let spec = self
            .state
            .transact(
                "thread/prompt-restarted",
                Some(thread_id),
                &serde_json::json!({"messageId":message_id}),
                |workspace| workspace.restart_message(thread_id, message_id, content, images),
            )
            .map_err(map_mutation_error)?;
        self.publish_current_revision();
        self.dispatch(&spec)?;
        Ok(MessageActionResult {
            thread_id: spec.thread_id,
            snapshot: self.snapshot(),
        })
    }

    pub fn read_attachment(&self, attachment_id: &str) -> Result<Vec<u8>, MessageError> {
        self.attachments.read(attachment_id)
    }

    #[allow(clippy::too_many_lines)]
    fn send_with_local_images(
        &self,
        thread_id: &str,
        content: &str,
        local_images: Vec<LocalImageAttachment>,
    ) -> Result<AppSnapshot, MessageError> {
        if local_images.is_empty()
            && let Some(approved) = parse_gate_decision(content)
            && let Some(node_id) = self
                .state
                .read(|workspace| workspace.first_waiting_gate(thread_id))
        {
            return self.change(
                if approved {
                    "gate/approved"
                } else {
                    "gate/rejected"
                },
                Some(&node_id),
                &serde_json::json!({"approved": approved, "source": "thread-message"}),
                |workspace| {
                    workspace.resolve_gate_from_message(thread_id, &node_id, content, approved)
                },
            );
        }

        let goal_command = local_images
            .is_empty()
            .then(|| parse_goal_command(content))
            .transpose()
            .map_err(MessageError::InvalidArgument)?
            .flatten();
        let onboarding_request = (goal_command.is_none() && local_images.is_empty())
            .then(|| parse_onboarding_command(content))
            .flatten();
        let parsed_slash_command = onboarding_request
            .is_none()
            .then(|| parse_skill_command(content))
            .flatten();
        let extension_command = parsed_slash_command
            .map(|(command_id, request)| {
                self.state
                    .read(|workspace| workspace.resolve_command(command_id))
                    .map(|resolved| resolved.map(|resolved| (resolved, request)))
            })
            .transpose()
            .map_err(|error| MessageError::Persistence(error.clone()))?
            .flatten();
        if let Some((resolved, _)) = &extension_command
            && resolved.contribution.handler
                == extension_protocol::SlashCommandHandler::ConnectivitySetup
        {
            return self.change(
                "extension/setup-opened",
                Some(thread_id),
                &serde_json::json!({"extensionId": resolved.extension_id}),
                |workspace| {
                    workspace.show_extension_setup(
                        thread_id,
                        content,
                        &resolved.contribution.status_block,
                    )
                },
            );
        }
        let skill_command = extension_command
            .is_none()
            .then_some(parsed_slash_command)
            .flatten();
        let onboarding_skill = onboarding_request
            .map(|_| {
                self.state
                    .read(|workspace| workspace.bundled_skill_path("onboarding"))
            })
            .transpose()
            .map_err(MessageError::Persistence)?;
        let extension_workflow = extension_command
            .as_ref()
            .map(|(resolved, _)| {
                let skill_paths = resolved.skill_paths.clone();
                let workflow = resolved.workflow.clone();
                let fallback = resolved.fallback.clone();
                let status_json = match resolved.contribution.handler {
                    extension_protocol::SlashCommandHandler::ChannelSetup => self
                        .channels
                        .status_json(&resolved.contribution.target, "default")?,
                    extension_protocol::SlashCommandHandler::ConnectivitySetup => {
                        unreachable!("setup commands do not invoke agents")
                    }
                };
                Ok::<_, String>((skill_paths, workflow, fallback, status_json))
            })
            .transpose()
            .map_err(MessageError::Persistence)?;

        let spec = self
            .state
            .transact(
                if goal_command.is_some() {
                    "goal/workflow-requested"
                } else if onboarding_request.is_some() {
                    "onboarding/workflow-requested"
                } else if extension_command.is_some() {
                    "extension/slash-command-requested"
                } else if skill_command.is_some() {
                    "thread/skill-message-created"
                } else {
                    "thread/message-created"
                },
                Some(thread_id),
                &serde_json::json!({"content": content, "attachmentCount": local_images.len()}),
                |workspace| {
                    if let Some(command) = goal_command {
                        match command {
                            GoalCommand::Create { request } => {
                                workspace.prepare_goal_workflow(thread_id, None, request)
                            }
                            GoalCommand::Adjust { goal_id, request } => {
                                workspace.prepare_goal_workflow(thread_id, Some(goal_id), request)
                            }
                        }
                    } else if let Some(request) = onboarding_request {
                        workspace.import_skill(
                            &onboarding_skill
                                .as_ref()
                                .expect("onboarding command has a bundled Skill")
                                .to_string_lossy(),
                            true,
                        )?;
                        workspace.prepare_onboarding_workflow(thread_id, request)
                    } else if let Some((resolved, request)) = extension_command {
                        let (skill_paths, workflow, fallback, status_json) = extension_workflow
                            .as_ref()
                            .expect("resolved extension command has workflow resources");
                        for (_, path) in skill_paths {
                            workspace.import_extension_skill(
                                &path.to_string_lossy(),
                                true,
                                &resolved.extension_id,
                            )?;
                        }
                        workspace.prepare_extension_workflow(
                            thread_id,
                            &resolved.contribution.id,
                            request,
                            &resolved.contribution.skills,
                            workflow,
                            fallback.clone(),
                            &resolved.contribution.status_block,
                            status_json.clone(),
                        )
                    } else if let Some((skill_id, _)) = skill_command {
                        workspace.prepare_skill_attempt(thread_id, content, &[skill_id.to_owned()])
                    } else {
                        workspace.prepare_message_attempt_with_attachments(
                            thread_id,
                            content,
                            local_images,
                        )
                    }
                },
            )
            .map_err(map_mutation_error)?;
        self.publish_current_revision();
        self.dispatch(&spec)?;
        Ok(self.snapshot())
    }

    fn dispatch(&self, spec: &AttemptSpec) -> Result<(), MessageError> {
        let observer = spec
            .structured_goal
            .then(|| self.planning.for_thread(spec.thread_id.clone()));
        if let Err(error) = self.conversations.spawn_attempt(spec, observer) {
            if self.state.read(|workspace| {
                workspace
                    .snapshot()
                    .attempts
                    .iter()
                    .any(|attempt| attempt.id == spec.id && attempt.status == "cancelled")
            }) {
                return Ok(());
            }
            self.change(
                "attempt/failed",
                Some(&spec.id),
                &serde_json::json!({"error": error}),
                |workspace| workspace.finish_attempt(&spec.id, "failed", error),
            )?;
        }
        Ok(())
    }

    fn change(
        &self,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
        operation: impl FnOnce(&mut crate::state::Workspace) -> Result<AppSnapshot, String>,
    ) -> Result<AppSnapshot, MessageError> {
        let snapshot = self
            .state
            .transact(kind, subject_id, payload, operation)
            .map_err(map_mutation_error)?;
        self.events.revision_changed(snapshot.revision);
        Ok(snapshot)
    }

    fn snapshot(&self) -> AppSnapshot {
        self.state.read(crate::state::Workspace::snapshot)
    }

    fn publish_current_revision(&self) {
        self.events
            .revision_changed(self.state.read(crate::state::Workspace::revision));
    }
}

fn parse_onboarding_command(content: &str) -> Option<&str> {
    let content = content.trim();
    content
        .strip_prefix("/onboarding")
        .filter(|request| request.is_empty() || request.starts_with(char::is_whitespace))
        .map(str::trim)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GoalCommand<'a> {
    Create { request: &'a str },
    Adjust { goal_id: &'a str, request: &'a str },
}

fn parse_goal_command(content: &str) -> Result<Option<GoalCommand<'_>>, String> {
    let content = content.trim();
    let Some(rest) = content
        .strip_prefix("/goal")
        .filter(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
    else {
        return Ok(None);
    };
    let rest = rest.trim();
    if rest.is_empty() {
        return Err("usage: /goal <prompt> or /goal #<goal_id> <prompt>".to_owned());
    }
    let Some(target) = rest.strip_prefix('#') else {
        return Ok(Some(GoalCommand::Create { request: rest }));
    };
    let split = target.find(char::is_whitespace).unwrap_or(target.len());
    let (goal_id, request) = target.split_at(split);
    let request = request.trim();
    if goal_id.is_empty() || request.is_empty() {
        return Err("usage: /goal #<goal_id> <prompt>".to_owned());
    }
    Ok(Some(GoalCommand::Adjust { goal_id, request }))
}

fn parse_skill_command(content: &str) -> Option<(&str, &str)> {
    let content = content.trim();
    let command = content.strip_prefix('/')?;
    let split = command.find(char::is_whitespace).unwrap_or(command.len());
    let (skill_id, request) = command.split_at(split);
    let valid = !skill_id.is_empty()
        && skill_id.len() <= 64
        && skill_id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        });
    valid.then(|| (skill_id, request.trim()))
}

fn parse_gate_decision(content: &str) -> Option<bool> {
    match content
        .trim()
        .trim_end_matches(['。', '.', '！', '!'])
        .trim()
    {
        "批准" | "批准执行" | "同意" | "approve" | "approved" | "/approve" => Some(true),
        "拒绝" | "拒绝执行" | "reject" | "rejected" | "/reject" => Some(false),
        _ => None,
    }
}

fn map_mutation_error(error: MutationError) -> MessageError {
    match error {
        MutationError::Domain(message) => MessageError::InvalidArgument(message),
        MutationError::Repository(message) => MessageError::Persistence(message),
    }
}

pub mod providers {
    use super::{Arc, AttachmentRepository, MessageService, NativeMessageService, attachments};
    use tuffite_ioc::Service;
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<
            Service<dyn AttachmentRepository>,
            _,
            _,
        >(|deps| {
            let root = deps.depends_on::<Service<ovule_workspace::WorkspaceDataRoot>>()?;
            Ok(attachments(&root.0))
        }))?;
        registrar.register(tuffite_ioc::factory::<MessageService, _, _>(|deps| {
            Ok(Arc::new(NativeMessageService::new(
                deps.depends_on::<Service<crate::workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn crate::workspace::WorkspaceEventSink>>()?,
                deps.depends_on::<Service<dyn crate::ConversationIngress>>()?,
                deps.depends_on::<Service<dyn super::ChannelStatusProvider>>()?,
                deps.depends_on::<Service<dyn AttachmentRepository>>()?,
                deps.depends_on::<Service<dyn super::PlanningObserverFactory>>()?,
            )))
        }))?;

        Ok(())
    }
    #[must_use]
    pub fn attachments(root: &std::path::Path) -> std::sync::Arc<dyn AttachmentRepository> {
        std::sync::Arc::new(attachments::MessageAttachmentStore::new(root))
    }
}

mod attachments;

pub trait Messages: Send + Sync {
    fn fork_message(
        &self,
        thread_id: &str,
        message_id: &str,
    ) -> Result<MessageActionResult, MessageError>;
    fn restart_message(
        &self,
        thread_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<MessageActionResult, MessageError>;
    fn select_agent(&self, thread_id: &str, agent: &str) -> Result<AppSnapshot, MessageError>;
    fn select_host(&self, thread_id: &str, host_id: &str) -> Result<AppSnapshot, MessageError>;
    fn send(
        &self,
        thread_id: &str,
        content: &str,
        attachments: &[ImageAttachment],
    ) -> Result<AppSnapshot, MessageError>;
    fn read_attachment(&self, attachment_id: &str) -> Result<Vec<u8>, MessageError>;
}
pub type MessageService = tuffite_ioc::Service<dyn Messages>;
impl Messages for NativeMessageService {
    fn fork_message(
        &self,
        thread_id: &str,
        message_id: &str,
    ) -> Result<MessageActionResult, MessageError> {
        NativeMessageService::fork_message(self, thread_id, message_id)
    }
    fn restart_message(
        &self,
        thread_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<MessageActionResult, MessageError> {
        NativeMessageService::restart_message(self, thread_id, message_id, content)
    }

    fn select_agent(&self, thread_id: &str, agent: &str) -> Result<AppSnapshot, MessageError> {
        NativeMessageService::select_agent(self, thread_id, agent)
    }
    fn select_host(&self, thread_id: &str, host_id: &str) -> Result<AppSnapshot, MessageError> {
        NativeMessageService::select_host(self, thread_id, host_id)
    }
    fn send(
        &self,
        thread_id: &str,
        content: &str,
        attachments: &[ImageAttachment],
    ) -> Result<AppSnapshot, MessageError> {
        NativeMessageService::send(self, thread_id, content, attachments)
    }
    fn read_attachment(&self, attachment_id: &str) -> Result<Vec<u8>, MessageError> {
        NativeMessageService::read_attachment(self, attachment_id)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GoalCommand, parse_gate_decision, parse_goal_command, parse_onboarding_command,
        parse_skill_command,
    };

    #[test]
    fn parses_message_commands_exactly() {
        assert_eq!(
            parse_onboarding_command(" /onboarding configure Channel "),
            Some("configure Channel")
        );
        assert_eq!(
            parse_skill_command(" /release-check inspect the package "),
            Some(("release-check", "inspect the package"))
        );
        assert!(parse_skill_command("/Release-check inspect").is_none());
        assert!(parse_skill_command("ordinary message").is_none());
        assert_eq!(parse_gate_decision("批准执行。"), Some(true));
        assert_eq!(parse_gate_decision("/reject"), Some(false));
        assert_eq!(parse_gate_decision("我觉得可以批准"), None);
        assert_eq!(
            parse_goal_command(" /goal ship the release ").unwrap(),
            Some(GoalCommand::Create {
                request: "ship the release"
            })
        );
        assert_eq!(
            parse_goal_command("/goal #goal-42 add a verification step").unwrap(),
            Some(GoalCommand::Adjust {
                goal_id: "goal-42",
                request: "add a verification step"
            })
        );
        assert!(parse_goal_command("/goal").is_err());
        assert!(parse_goal_command("/goal #goal-42").is_err());
    }
}

#[cfg(test)]
mod port_tests {
    use super::*;
    use std::sync::Mutex;

    struct NoChannels;
    impl ChannelStatusProvider for NoChannels {
        fn status_json(&self, _: &str, _: &str) -> Result<String, String> {
            Ok("{}".into())
        }
    }
    struct NoEvents;
    impl WorkspaceEventSink for NoEvents {
        fn revision_changed(&self, _: i64) {}
    }
    #[derive(Default)]
    struct RecordingPlanning(Mutex<Vec<String>>);
    impl PlanningObserverFactory for RecordingPlanning {
        fn for_thread(&self, thread_id: String) -> crate::WorkerEventCallback {
            self.0.lock().unwrap().push(thread_id);
            Arc::new(|_| {})
        }
    }
    #[derive(Default)]
    struct RecordingIngress(
        Mutex<Vec<bool>>,
        Mutex<Vec<(String, String)>>,
        Mutex<Vec<String>>,
    );
    impl ConversationIngress for RecordingIngress {
        fn cancel_attempt(&self, attempt_id: &str) -> Result<(), String> {
            self.2.lock().unwrap().push(attempt_id.into());
            Ok(())
        }
        fn spawn_attempt(
            &self,
            spec: &AttemptSpec,
            observer: Option<crate::WorkerEventCallback>,
        ) -> Result<(), String> {
            self.0.lock().unwrap().push(observer.is_some());
            self.1
                .lock()
                .unwrap()
                .push((spec.thread_id.clone(), spec.prompt.clone()));
            Ok(())
        }
        fn worker_event(&self, _: crate::WorkerEvent) {}
    }

    #[test]
    fn message_commands_request_planning_observers_only_for_structured_goals() {
        let directory = tempfile::tempdir().unwrap();
        let mut workspace = crate::test_support::native_workspace();
        workspace
            .upsert_agent(
                "test",
                "Test",
                "test",
                None,
                Vec::new(),
                Vec::new(),
                "",
                true,
            )
            .unwrap();
        workspace.configure_defaults("test", None, None).unwrap();
        let snapshot = workspace
            .create_thread("Conversation", directory.path().to_str().unwrap())
            .unwrap();
        let thread_id = snapshot.threads[0].id.clone();
        let state = Arc::new(WorkspaceSession::new(
            workspace,
            ovule_workspace::providers::open(&directory.path().join("workspace.sqlite3")).unwrap(),
        ));
        let planning = Arc::new(RecordingPlanning::default());
        let ingress = Arc::new(RecordingIngress::default());
        let service = NativeMessageService::new(
            state,
            Arc::new(NoEvents),
            ingress.clone(),
            Arc::new(NoChannels),
            providers::attachments(directory.path()),
            planning.clone(),
        );
        let messages: &dyn Messages = &service;
        let original = messages.send(&thread_id, "normal message", &[]).unwrap();
        let prompt = original
            .messages
            .iter()
            .find(|message| message.thread_id == thread_id && message.role == "user")
            .unwrap();
        let restarted = messages
            .restart_message(&thread_id, &prompt.id, "edited message")
            .unwrap();
        assert_eq!(restarted.thread_id, thread_id);
        assert_eq!(
            ingress.2.lock().unwrap().len(),
            1,
            "native restart revokes the original Worker without renderer orchestration"
        );
        assert_eq!(restarted.snapshot.threads.len(), original.threads.len());
        assert!(
            restarted
                .snapshot
                .messages
                .iter()
                .any(|message| message.id == prompt.id && message.content == "edited message")
        );
        assert_eq!(ingress.1.lock().unwrap()[1].0, thread_id);
        assert!(ingress.1.lock().unwrap()[1].1.contains("edited message"));
        assert!(!ingress.1.lock().unwrap()[1].1.contains("normal message"));
        assert!(planning.0.lock().unwrap().is_empty());
        messages.send(&thread_id, "/goal build it", &[]).unwrap();
        assert_eq!(*planning.0.lock().unwrap(), [thread_id]);
        assert_eq!(*ingress.0.lock().unwrap(), [false, false, true]);
    }
}
