//! ACP client boundary for external agents.
//!
//! Owns the outbound ACP connection: process launch configuration, the ACP v1
//! session handshake, and projection of session updates onto `WorkerEvent`.
//! Ovule session identity, permission policy, and durable state live in the
//! surrounding services; the official SDK owns wire framing and schema.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ClientCapabilities, ContentBlock, ContentChunk,
    FileSystemCapabilities, Implementation, InitializeRequest, InitializeResponse, McpServer,
    NewSessionRequest, NewSessionResponse, PermissionOptionKind, PromptRequest, PromptResponse,
    ReadTextFileRequest, ReadTextFileResponse, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, SessionUpdate,
    StopReason, TextContent, ToolCallContent, WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::{
    Agent, Channel, Client, ConnectTo, ConnectionTo, on_receive_notification, on_receive_request,
};
use processkit::CancellationToken;
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

use crate::agent_host::{
    OutputSequence, WorkerEvent, WorkerOutcome, cancelled_outcome, failed_outcome,
    project_message_blocks, thought_stream,
};

const ACP_TURN_TIMEOUT: Duration = Duration::from_hours(2);
const MAX_ACP_STDERR_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::agent_host) struct AcpLaunchSpec {
    pub command: PathBuf,
    pub arguments: Vec<String>,
    pub environment: BTreeMap<String, String>,
}

impl AcpLaunchSpec {
    fn validate(&self) -> Result<(), String> {
        if self.command.as_os_str().is_empty() {
            return Err("ACP Agent command must not be empty".to_owned());
        }
        if self
            .environment
            .keys()
            .any(|name| name.is_empty() || name.contains('='))
        {
            return Err("ACP Agent environment contains an invalid variable name".to_owned());
        }
        Ok(())
    }
}

pub(in crate::agent_host) enum AcpServer {
    External {
        launch: AcpLaunchSpec,
        transport: Arc<dyn ovule_hosts::WorkspaceTransport>,
    },
    Remote {
        agent_id: String,
        model_provider: Option<String>,
        model_remote_id: Option<String>,
        transport: Arc<dyn ovule_hosts::WorkspaceTransport>,
    },
    Rig {
        kernel: Arc<ovule_agent::AgentKernel>,
        turn: ovule_agent::ModelTurn,
    },
}

#[derive(Clone)]
pub(in crate::agent_host) struct AcpWorkspaceRoot {
    pub id: String,
    pub root: PathBuf,
    pub transport: Arc<dyn ovule_hosts::WorkspaceTransport>,
}

pub(in crate::agent_host) struct AcpTurn {
    pub execution: Arc<ovule_agent::execution::ToolExecutor>,
    pub server: AcpServer,
    pub workspace: PathBuf,
    pub additional_workspaces: Vec<PathBuf>,
    pub workspace_roots: Vec<AcpWorkspaceRoot>,
    pub mcp_servers: Vec<McpServer>,
    pub prompt: String,
    pub emit_deltas: bool,
    pub message_block_kinds: BTreeSet<String>,
}

pub(in crate::agent_host) async fn run_acp_agent(
    attempt_id: &str,
    turn: AcpTurn,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome {
    let AcpTurn {
        execution,
        server,
        workspace,
        additional_workspaces,
        workspace_roots,
        mcp_servers,
        prompt,
        emit_deltas,
        message_block_kinds,
    } = turn;
    match server {
        AcpServer::External { launch, transport } => {
            run_external_acp_agent(
                attempt_id,
                execution,
                launch,
                transport,
                workspace,
                additional_workspaces,
                workspace_roots,
                mcp_servers,
                prompt,
                emit_deltas,
                message_block_kinds,
                cancellation,
                notify,
            )
            .await
        }
        AcpServer::Remote {
            agent_id,
            model_provider,
            model_remote_id,
            transport,
        } => {
            let process = match transport
                .spawn_agent(
                    &agent_id,
                    model_provider.as_deref(),
                    model_remote_id.as_deref(),
                )
                .await
            {
                Ok(process) => process,
                Err(error) => return failed_outcome(attempt_id, &error.to_string()),
            };
            run_spawned_acp_agent(
                attempt_id,
                execution,
                process,
                workspace,
                additional_workspaces,
                workspace_roots,
                mcp_servers,
                prompt,
                emit_deltas,
                message_block_kinds,
                cancellation,
                notify,
            )
            .await
        }
        AcpServer::Rig { kernel, turn } => {
            run_embedded_rig_agent(
                attempt_id,
                execution,
                kernel,
                turn,
                workspace,
                additional_workspaces,
                workspace_roots,
                mcp_servers,
                prompt,
                emit_deltas,
                message_block_kinds,
                cancellation,
                notify,
            )
            .await
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_external_acp_agent(
    attempt_id: &str,
    execution: Arc<ovule_agent::execution::ToolExecutor>,
    launch: AcpLaunchSpec,
    workspace_transport: Arc<dyn ovule_hosts::WorkspaceTransport>,
    workspace: PathBuf,
    additional_workspaces: Vec<PathBuf>,
    workspace_roots: Vec<AcpWorkspaceRoot>,
    mcp_servers: Vec<McpServer>,
    prompt: String,
    emit_deltas: bool,
    message_block_kinds: BTreeSet<String>,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome {
    if let Err(error) = launch.validate() {
        return failed_outcome(attempt_id, &error);
    }
    let mut argv = vec![launch.command.to_string_lossy().into_owned()];
    argv.extend(launch.arguments);
    let process = match workspace_transport.spawn(&argv, &launch.environment).await {
        Ok(process) => process,
        Err(error) => return failed_outcome(attempt_id, &error.to_string()),
    };
    run_spawned_acp_agent(
        attempt_id,
        execution,
        process,
        workspace,
        additional_workspaces,
        workspace_roots,
        mcp_servers,
        prompt,
        emit_deltas,
        message_block_kinds,
        cancellation,
        notify,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn run_spawned_acp_agent(
    attempt_id: &str,
    execution: Arc<ovule_agent::execution::ToolExecutor>,
    mut process: ovule_hosts::WorkspaceProcess,
    workspace: PathBuf,
    additional_workspaces: Vec<PathBuf>,
    workspace_roots: Vec<AcpWorkspaceRoot>,
    mcp_servers: Vec<McpServer>,
    prompt: String,
    emit_deltas: bool,
    message_block_kinds: BTreeSet<String>,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome {
    let stdin = std::mem::replace(&mut process.stdin, Box::pin(tokio::io::sink()));
    let stdout = std::mem::replace(&mut process.stdout, Box::pin(tokio::io::empty()));
    let stderr = std::mem::replace(&mut process.stderr, Box::pin(tokio::io::empty()));
    let drain = tokio::spawn(async move {
        use tokio::io::AsyncReadExt as _;
        let mut stderr = stderr.take(u64::try_from(MAX_ACP_STDERR_BYTES).unwrap_or(u64::MAX));
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes).await;
        bytes
    });
    let mut result = drive_acp_client_scoped(
        attempt_id,
        execution,
        agent_client_protocol::ByteStreams::new(stdin.compat_write(), stdout.compat()),
        workspace,
        additional_workspaces,
        workspace_roots,
        mcp_servers,
        prompt,
        emit_deltas,
        message_block_kinds,
        cancellation,
        notify,
    )
    .await;
    drop(process);
    let diagnostics = tokio::time::timeout(Duration::from_secs(1), drain)
        .await
        .ok()
        .and_then(Result::ok)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    if result.status == "failed"
        && let Some(detail) = diagnostics
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
    {
        result.summary.push_str(". Agent server: ");
        result.summary.extend(detail.trim().chars().take(2_000));
    }
    result
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn run_embedded_rig_agent(
    attempt_id: &str,
    execution: Arc<ovule_agent::execution::ToolExecutor>,
    kernel: Arc<ovule_agent::AgentKernel>,
    turn: ovule_agent::ModelTurn,
    workspace: PathBuf,
    additional_workspaces: Vec<PathBuf>,
    workspace_roots: Vec<AcpWorkspaceRoot>,
    mcp_servers: Vec<McpServer>,
    prompt: String,
    emit_deltas: bool,
    message_block_kinds: BTreeSet<String>,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome {
    let (client_transport, agent_transport) = Channel::duplex();
    let server_cancellation = cancellation.clone();
    let rig_attempt_id = attempt_id.to_owned();
    let diagnostic_notify = Arc::clone(&notify);
    let server = tokio::spawn(async move {
        Agent
            .builder()
            .name("ovule-rig-acp")
            .on_receive_request(
                async move |request: InitializeRequest, responder, _connection| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new()),
                    )
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: NewSessionRequest, responder, _connection| {
                    responder.respond(NewSessionResponse::new("ovule-rig-session"))
                },
                on_receive_request!(),
            )
            .on_receive_request(
                move |request: PromptRequest,
                      responder: agent_client_protocol::Responder<PromptResponse>,
                      connection: ConnectionTo<Client>| {
                    let prompt = request
                        .prompt
                        .iter()
                        .filter_map(|block| match block {
                            ContentBlock::Text(text) => Some(text.text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    let kernel = kernel.clone();
                    let mut provider_turn = turn.clone();
                    provider_turn.prompt = prompt;
                    let session_id = request.session_id.clone();
                    let updates = connection.clone();
                    let server_cancellation = server_cancellation.clone();
                    let rig_attempt_id = rig_attempt_id.clone();
                    let diagnostic_notify = Arc::clone(&diagnostic_notify);
                    async move {
                        connection.spawn(async move {
                            let update_notify: Arc<dyn Fn(WorkerEvent) + Send + Sync> =
                                Arc::new(move |event| {
                                    if matches!(&event, WorkerEvent::Diagnostic { .. }) {
                                        diagnostic_notify(event);
                                        return;
                                    }
                                    if let WorkerEvent::MessageBlock {
                                        kind, data_json, ..
                                    } = &event
                                        && kind == "thinking"
                                        && let Ok(value) =
                                            serde_json::from_str::<serde_json::Value>(data_json)
                                        && let Some(delta) =
                                            value.get("delta").and_then(serde_json::Value::as_str)
                                    {
                                        let _ =
                                            updates.send_notification(SessionNotification::new(
                                                session_id.clone(),
                                                SessionUpdate::AgentThoughtChunk(
                                                    ContentChunk::new(ContentBlock::Text(
                                                        TextContent::new(delta),
                                                    )),
                                                ),
                                            ));
                                    }
                                    if let WorkerEvent::Output { delta, .. } = event {
                                        let _ =
                                            updates.send_notification(SessionNotification::new(
                                                session_id.clone(),
                                                SessionUpdate::AgentMessageChunk(
                                                    ContentChunk::new(ContentBlock::Text(
                                                        TextContent::new(delta),
                                                    )),
                                                ),
                                            ));
                                    }
                                });
                            let outcome = kernel
                                .run(
                                    &rig_attempt_id,
                                    provider_turn,
                                    server_cancellation,
                                    update_notify,
                                    true,
                                    &BTreeSet::new(),
                                )
                                .await;
                            match outcome.status.as_str() {
                                "succeeded" => {
                                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                                }
                                "cancelled" => {
                                    responder.respond(PromptResponse::new(StopReason::Cancelled))
                                }
                                _ => responder.respond_with_internal_error(outcome.summary),
                            }
                        })?;
                        Ok(())
                    }
                },
                on_receive_request!(),
            )
            .connect_to(agent_transport)
            .await
    });
    let result = drive_acp_client_scoped(
        attempt_id,
        execution,
        client_transport,
        workspace,
        additional_workspaces,
        workspace_roots,
        mcp_servers,
        prompt,
        emit_deltas,
        message_block_kinds,
        cancellation,
        notify,
    )
    .await;
    server.abort();
    result
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(in crate::agent_host) async fn drive_acp_client<T>(
    attempt_id: &str,
    transport: T,
    workspace: PathBuf,
    additional_workspaces: Vec<PathBuf>,
    workspace_roots: Vec<AcpWorkspaceRoot>,
    mcp_servers: Vec<McpServer>,
    prompt: String,
    emit_deltas: bool,
    message_block_kinds: BTreeSet<String>,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome
where
    T: ConnectTo<Client> + Send + 'static,
{
    let execution = Arc::new(ovule_agent::execution::ToolExecutor::new(
        attempt_id.into(),
        cancellation.clone(),
        ovule_agent::execution::approval::ApprovalBroker::unavailable(),
        notify.clone(),
    ));
    drive_acp_client_scoped(
        attempt_id,
        execution,
        transport,
        workspace,
        additional_workspaces,
        workspace_roots,
        mcp_servers,
        prompt,
        emit_deltas,
        message_block_kinds,
        cancellation,
        notify,
    )
    .await
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub(in crate::agent_host) async fn drive_acp_client_scoped<T>(
    attempt_id: &str,
    execution: Arc<ovule_agent::execution::ToolExecutor>,
    transport: T,
    workspace: PathBuf,
    additional_workspaces: Vec<PathBuf>,
    workspace_roots: Vec<AcpWorkspaceRoot>,
    mcp_servers: Vec<McpServer>,
    prompt: String,
    emit_deltas: bool,
    message_block_kinds: BTreeSet<String>,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome
where
    T: ConnectTo<Client> + Send + 'static,
{
    notify(WorkerEvent::Started {
        attempt_id: attempt_id.to_owned(),
    });

    let final_message = Arc::new(Mutex::new(String::new()));
    let thinking = Arc::new(Mutex::new(thought_stream::ThoughtStream::default()));
    let thinking_for_notifications = Arc::clone(&thinking);
    let accumulator = Arc::new(Mutex::new(OutputSequence { sequence: 0 }));
    let attempt_id_owned = attempt_id.to_owned();

    let notify_for_notifications = Arc::clone(&notify);
    let final_for_notifications = Arc::clone(&final_message);
    let accumulator_for_notifications = Arc::clone(&accumulator);
    let attempt_id_for_notifications = attempt_id_owned.clone();

    let cancellation_for_task = cancellation.clone();
    let roots_for_read = workspace_roots.clone();
    let roots_for_write = workspace_roots;
    let execution_for_read = execution.clone();
    let execution_for_write = execution.clone();

    let tool_trace = std::sync::Mutex::new(super::acp_tool_trace::AcpToolTrace::default());
    let session_result = tokio::time::timeout(
        ACP_TURN_TIMEOUT,
        Client
            .builder()
            .name("ovule-acp-client")
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    // Do not serialize reasoning chunks or raw tool payloads just
                    // to render a status line: they can contain large image data.
                    let tool_update = match &notification.update {
                        SessionUpdate::ToolCall(call) => Some(serde_json::json!({
                            "sessionUpdate":"tool_call", "toolCallId":call.tool_call_id,
                            "title":call.title.chars().take(512).collect::<String>(), "status":call.status,
                        })),
                        SessionUpdate::ToolCallUpdate(call) => Some(serde_json::json!({
                            "sessionUpdate":"tool_call_update", "toolCallId":call.tool_call_id,
                            "title":call.fields.title.as_deref().map(|title| title.chars().take(512).collect::<String>()), "status":call.fields.status,
                        })),
                        _ => None,
                    };
                    if let Some(value) = tool_update {
                        let projection = tool_trace.lock().unwrap_or_else(std::sync::PoisonError::into_inner).update(&value);
                        if let Some((block_id, data_json)) = projection {
                            (notify_for_notifications)(WorkerEvent::MessageBlock { attempt_id: attempt_id_for_notifications.clone(), block_id, kind: "tool".into(), data_json });
                        }
                    }
                    let images = match &notification.update {
                        SessionUpdate::AgentMessageChunk(chunk) => vec![(&chunk.content, format!("message-image-{:032x}", rand::random::<u128>()))],
                        SessionUpdate::ToolCall(call) => call.content.iter().enumerate().filter_map(|(index, item)| match item {
                            ToolCallContent::Content(content) => Some((&content.content, acp_image_block_id(&call.tool_call_id.to_string(), index))),
                            _ => None,
                        }).collect(),
                        SessionUpdate::ToolCallUpdate(call) => call.fields.content.iter().flatten().enumerate().filter_map(|(index, item)| match item {
                            ToolCallContent::Content(content) => Some((&content.content, acp_image_block_id(&call.tool_call_id.to_string(), index))),
                            _ => None,
                        }).collect(),
                        _ => Vec::new(),
                    };
                    for (content, block_id) in images {
                        if let ContentBlock::Image(image) = content {
                            if image.data.len() > 16 * 1024 * 1024 { continue; }
                            (notify_for_notifications)(WorkerEvent::MessageBlock {
                                attempt_id: attempt_id_for_notifications.clone(), block_id, kind: "image".into(),
                                data_json: serde_json::json!({"data":image.data,"mediaType":image.mime_type,"name":"Image"}).to_string(),
                            });
                        }
                    }
                    let delta = extract_text_delta(&notification.update);
                    if delta.is_empty() {
                        return Ok(());
                    }
                    if matches!(notification.update, SessionUpdate::AgentThoughtChunk(_)) {
                        thought_stream::ThoughtStream::queue(
                            &thinking_for_notifications,
                            &attempt_id_for_notifications,
                            &notify_for_notifications,
                            &delta,
                        );
                        return Ok(());
                    }

                    {
                        let mut buffer = final_for_notifications
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        buffer.push_str(&delta);
                    }
                    if emit_deltas {
                        let sequence = {
                            let mut accumulator = accumulator_for_notifications
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner);
                            let sequence = accumulator.sequence;
                            accumulator.sequence = sequence.saturating_add(1);
                            sequence
                        };
                        (notify_for_notifications)(WorkerEvent::Output {
                            attempt_id: attempt_id_for_notifications.clone(),
                            sequence,
                            delta,
                        });
                    }
                    Ok(())
                },
                on_receive_notification!(),
            )
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _cx| {
                    let allowed = execution
                        .authorize(
                            "acp.permission",
                            &serde_json::to_value(&request.tool_call).unwrap_or_default(),
                        )
                        .await
                        .is_ok();
                    let outcome = request
                        .options
                        .iter()
                        .find(|option| allowed && option.kind == PermissionOptionKind::AllowOnce)
                        .map_or(RequestPermissionOutcome::Cancelled, |option| {
                            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                option.option_id.clone(),
                            ))
                        });
                    responder.respond(RequestPermissionResponse::new(outcome))
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |request: ReadTextFileRequest, responder, _cx| match execution_for_read
                    .run(
                        "acp.read",
                        &serde_json::json!({"path":request.path}),
                        ovule_agent::execution::Effect::Workspace,
                        std::time::Duration::from_secs(30),
                        |_| async { read_workspace_text(&roots_for_read, &request).await },
                    )
                    .await
                {
                    Ok(content) => responder.respond(ReadTextFileResponse::new(content)),
                    Err(error) => responder.respond_with_internal_error(error.to_string()),
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |request: WriteTextFileRequest, responder, _cx| match execution_for_write
                    .run(
                        "acp.write",
                        &serde_json::json!({"path":request.path}),
                        ovule_agent::execution::Effect::Workspace,
                        std::time::Duration::from_secs(30),
                        |_| async { write_workspace_text(&roots_for_write, &request).await },
                    )
                    .await
                {
                    Ok(()) => responder.respond(WriteTextFileResponse::new()),
                    Err(error) => responder.respond_with_internal_error(error.to_string()),
                },
                on_receive_request!(),
            )
            .connect_with(transport, |connection: ConnectionTo<Agent>| async move {
                run_client_conversation(
                    &connection,
                    &workspace,
                    &additional_workspaces,
                    &mcp_servers,
                    &prompt,
                    &cancellation_for_task,
                )
                .await
            }),
    )
    .await;

    thinking
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .close(&attempt_id_owned, &notify);

    match session_result {
        Err(_) => failed_outcome(
            &attempt_id_owned,
            "ACP Agent exceeded its execution deadline",
        ),
        Ok(Err(error)) => failed_outcome(&attempt_id_owned, &error.to_string()),
        Ok(Ok(ConversationOutcome::Cancelled)) => cancelled_outcome(&attempt_id_owned),
        Ok(Ok(ConversationOutcome::Completed(reason))) => {
            let summary = {
                let buffer = final_message
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                buffer.clone()
            };
            notify(WorkerEvent::Diagnostic {
                attempt_id: attempt_id_owned.clone(),
                kind: "harness/acp_completion".to_owned(),
                detail_json: serde_json::json!({
                    "schema_version": 1, "stop_reason": format!("{reason:?}"),
                    "text_bytes": summary.len(), "empty_answer": summary.trim().is_empty(),
                })
                .to_string(),
            });
            if matches!(reason, StopReason::Cancelled) {
                return cancelled_outcome(&attempt_id_owned);
            }
            if summary.trim().is_empty() {
                return failed_outcome(
                    &attempt_id_owned,
                    &format!(
                        "ACP Agent ended without an answer ({reason:?}). Thinking or tool activity alone does not complete a reply; retry or choose another model."
                    ),
                );
            }
            let summary = project_message_blocks(
                &attempt_id_owned,
                &summary,
                &message_block_kinds,
                &notify,
                emit_deltas,
            );
            let status = if matches!(reason, StopReason::Cancelled) {
                "cancelled".to_owned()
            } else {
                "succeeded".to_owned()
            };
            WorkerOutcome {
                attempt_id: attempt_id_owned,
                status,
                summary,
            }
        }
    }
}

enum ConversationOutcome {
    Completed(StopReason),
    Cancelled,
}

async fn run_client_conversation(
    connection: &ConnectionTo<Agent>,
    workspace: &Path,
    additional_workspaces: &[PathBuf],
    mcp_servers: &[McpServer],
    prompt: &str,
    cancellation: &CancellationToken,
) -> Result<ConversationOutcome, agent_client_protocol::Error> {
    if cancellation.is_cancelled() {
        return Ok(ConversationOutcome::Cancelled);
    }
    let _initialize = connection
        .send_request(
            InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(
                    ClientCapabilities::new().fs(FileSystemCapabilities::new()
                        .read_text_file(true)
                        .write_text_file(true)),
                )
                .client_info(Implementation::new("ovule", env!("CARGO_PKG_VERSION"))),
        )
        .block_task()
        .await?;
    if cancellation.is_cancelled() {
        return Ok(ConversationOutcome::Cancelled);
    }
    let new_session = connection
        .send_request(
            NewSessionRequest::new(workspace.to_path_buf())
                .additional_directories(additional_workspaces.to_vec())
                .mcp_servers(mcp_servers.to_vec()),
        )
        .block_task()
        .await?;
    if cancellation.is_cancelled() {
        return Ok(ConversationOutcome::Cancelled);
    }
    let session_id = new_session.session_id;
    let prompt_future = connection
        .send_request(PromptRequest::new(
            session_id.clone(),
            vec![ContentBlock::Text(TextContent::new(prompt.to_owned()))],
        ))
        .block_task();
    tokio::pin!(prompt_future);
    tokio::select! {
        biased;
        () = cancellation.cancelled() => {
            connection.send_notification(CancelNotification::new(session_id))?;
            Ok(ConversationOutcome::Cancelled)
        },
        result = &mut prompt_future => Ok(ConversationOutcome::Completed(result?.stop_reason)),
    }
}

const MAX_ACP_TEXT_BYTES: usize = 2 * 1024 * 1024;

async fn read_workspace_text(
    roots: &[AcpWorkspaceRoot],
    request: &ReadTextFileRequest,
) -> Result<String, String> {
    let (root, relative) = resolve_workspace_path(roots, &request.path)?;
    let bytes = root
        .transport
        .read_file(&relative)
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_ACP_TEXT_BYTES {
        return Err("ACP text file exceeds the 2 MiB limit".to_owned());
    }
    let content = String::from_utf8(bytes).map_err(|_| "ACP text file is not UTF-8".to_owned())?;
    let line = request.line.unwrap_or(1).max(1) as usize;
    let limit = request.limit.map_or(usize::MAX, |value| value as usize);
    Ok(content
        .lines()
        .skip(line.saturating_sub(1))
        .take(limit)
        .collect::<Vec<_>>()
        .join("\n"))
}

async fn write_workspace_text(
    roots: &[AcpWorkspaceRoot],
    request: &WriteTextFileRequest,
) -> Result<(), String> {
    if request.content.len() > MAX_ACP_TEXT_BYTES {
        return Err("ACP text file exceeds the 2 MiB limit".to_owned());
    }
    let (root, relative) = resolve_workspace_path(roots, &request.path)?;
    root.transport
        .write_file(&relative, request.content.as_bytes())
        .await
        .map_err(|error| error.to_string())
}

fn resolve_workspace_path<'a>(
    roots: &'a [AcpWorkspaceRoot],
    path: &Path,
) -> Result<(&'a AcpWorkspaceRoot, String), String> {
    let input = normalized_path(path);
    roots
        .iter()
        .filter_map(|root| {
            let normalized_root = normalized_path(&root.root);
            strip_root(&input, &normalized_root)
                .map(|relative| (root, relative, normalized_root.len()))
        })
        .max_by_key(|(_, _, length)| *length)
        .map(|(root, relative, _)| (root, relative))
        .ok_or_else(|| "ACP file path is outside the selected Workspaces".to_owned())
}

fn normalized_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    let normalized = value.replace('\\', "/").trim_end_matches('/').to_owned();
    if normalized.is_empty() && value.starts_with('/') {
        "/".to_owned()
    } else {
        normalized
    }
}

fn strip_root(path: &str, root: &str) -> Option<String> {
    if root == "/" && path.starts_with('/') {
        return Some(path.trim_start_matches('/').to_owned());
    }
    let windows = root.as_bytes().get(1) == Some(&b':') || root.starts_with("//");
    let matches = if windows {
        path.eq_ignore_ascii_case(root)
            || path
                .get(..root.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(root))
                && path.as_bytes().get(root.len()) == Some(&b'/')
    } else {
        path == root
            || path
                .strip_prefix(root)
                .is_some_and(|suffix| suffix.starts_with('/'))
    };
    matches.then(|| path[root.len()..].trim_start_matches('/').to_owned())
}

fn acp_image_block_id(call_id: &str, index: usize) -> String {
    use std::hash::{Hash as _, Hasher as _};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    call_id.hash(&mut hash);
    format!("acp-image-{:016x}-{index}", hash.finish())
}

fn extract_text_delta(update: &SessionUpdate) -> String {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) | SessionUpdate::AgentThoughtChunk(chunk) => {
            match &chunk.content {
                ContentBlock::Text(text) => text.text.clone(),
                _ => String::new(),
            }
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_spec_uses_the_official_acp_sdk_process_boundary() {
        let launch = AcpLaunchSpec {
            command: PathBuf::from("example-agent"),
            arguments: vec!["--acp".to_owned()],
            environment: BTreeMap::from([("NO_COLOR".to_owned(), "1".to_owned())]),
        };

        assert!(launch.validate().is_ok());
    }

    #[test]
    fn launch_spec_rejects_invalid_environment_names() {
        let launch = AcpLaunchSpec {
            command: PathBuf::from("example-agent"),
            arguments: Vec::new(),
            environment: BTreeMap::from([("BAD=NAME".to_owned(), "value".to_owned())]),
        };

        assert!(launch.validate().is_err());
    }
}
