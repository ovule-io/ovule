use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_worker(
    extensions: &dyn ChannelWorkerSource,
    managed_toolchains: &Path,
    connection_id: String,
    pending: PendingRequests,
    in_flight: Arc<Mutex<HashSet<String>>>,
    statuses: Arc<Mutex<BTreeMap<String, ChannelStatus>>>,
    conversation_state: Arc<dyn ChannelConversationState>,
    default_workspace_path: String,
    conversations: Arc<dyn ConversationIngress>,
    outbox: Arc<dyn ChannelOutbox>,
    events: Arc<dyn ChannelEvents>,
    wake: mpsc::SyncSender<RuntimeCommand>,
    secrets: Arc<dyn SecretStore>,
) -> Result<WorkerProcess, String> {
    let plan = extensions.prepare_channel_worker(CHANNEL_TYPE)?;
    let directory = plan
        .module
        .parent()
        .ok_or_else(|| "Channel extension worker has no parent directory".to_owned())?;
    let executable = plan
        .toolchain
        .as_deref()
        .and_then(|toolchain| crate::toolchains::resolve(toolchain, managed_toolchains))
        .or_else(|| {
            plan.executable_candidates
                .iter()
                .find_map(|candidate| which::which(candidate).ok())
        })
        .ok_or_else(|| {
            format!(
                "Channel extension runtime is not installed: {}",
                plan.executable_candidates.join(" or ")
            )
        })?;
    let mut command = Command::new(executable);
    command.arg(&plan.module);
    command
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("start Channel plugin worker: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Channel worker stdin is unavailable".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Channel worker stdout is unavailable".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Channel worker stderr is unavailable".to_owned())?;
    let stderr_connection_id = connection_id.clone();
    thread::Builder::new()
        .name("ovule-channel-stderr".to_owned())
        .spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                let detail = line.chars().take(2_000).collect::<String>();
                if !detail.trim().is_empty() {
                    tracing::warn!(
                        connection_id = %stderr_connection_id,
                        %detail,
                        "Channel worker stderr"
                    );
                }
            }
        })
        .map_err(|error| format!("start Channel worker stderr reader: {error}"))?;
    thread::Builder::new()
        .name("ovule-channel-events".to_owned())
        .spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(envelope) = serde_json::from_str::<WorkerEnvelope>(&line) else {
                    tracing::warn!("ignored malformed Channel worker output");
                    continue;
                };
                process_envelope(
                    envelope,
                    &connection_id,
                    &pending,
                    &in_flight,
                    &statuses,
                    &conversation_state,
                    &default_workspace_path,
                    &conversations,
                    &outbox,
                    &events,
                    &wake,
                    secrets.as_ref(),
                );
            }
            // EOF means no response can arrive. Release callers immediately rather
            // than blocking the runtime command queue for the request timeout.
            for (_, reply) in std::mem::take(&mut *lock(&pending)) {
                let _ = reply.send(Err("Channel worker closed its response stream".to_owned()));
            }
        })
        .map_err(|error| format!("start Channel worker event reader: {error}"))?;
    Ok(WorkerProcess { child, stdin })
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn process_envelope(
    envelope: WorkerEnvelope,
    connection_id: &str,
    pending: &PendingRequests,
    in_flight: &Mutex<HashSet<String>>,
    statuses: &Mutex<BTreeMap<String, ChannelStatus>>,
    conversation_state: &Arc<dyn ChannelConversationState>,
    default_workspace_path: &str,
    conversations: &Arc<dyn ConversationIngress>,
    outbox: &Arc<dyn ChannelOutbox>,
    events: &Arc<dyn ChannelEvents>,
    wake: &mpsc::SyncSender<RuntimeCommand>,
    secrets: &dyn SecretStore,
) {
    if envelope.version != 1 {
        return;
    }
    if envelope.kind == "response" {
        if let Some(id) = envelope.id
            && let Some(reply) = lock(pending).remove(&id)
        {
            let result = if envelope.ok == Some(true) {
                Ok(envelope.result.unwrap_or(Value::Null))
            } else {
                let error = envelope.error.map_or_else(
                    || "Channel worker request failed".to_owned(),
                    |error| format!("{}: {}", error.code, error.message),
                );
                Err(error)
            };
            let _ = reply.send(result);
        }
        return;
    }
    if envelope.kind != "event" {
        return;
    }
    match envelope.event.as_deref() {
        Some("message") => {
            if let Some(payload) = envelope.payload {
                match serde_json::from_value::<WorkerInboundMessage>(payload) {
                    Ok(message) => {
                        if let Err(error) = accept_message(
                            &MessageContext {
                                state: conversation_state,
                                default_workspace_path,
                                conversations,
                                events,
                                wake,
                                statuses,
                                secrets,
                                connection_id,
                            },
                            &message,
                        ) {
                            tracing::error!(%error, "accept Channel message");
                        }
                    }
                    Err(error) => {
                        tracing::error!(%error, %connection_id, "decode Channel message");
                        update_status(statuses, events, connection_id, |value| {
                            value.detail = format!(
                                "Channel delivered a message, but Ovule could not decode it: {}",
                                error.to_string().chars().take(1_500).collect::<String>()
                            );
                        });
                    }
                }
            }
        }
        Some("health") => {
            if let Some(payload) = envelope.payload {
                let next = payload
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let mut values = lock(statuses);
                let current = values
                    .entry(connection_id.to_owned())
                    .or_insert_with(|| status_for(connection_id));
                current.connected = health_state_can_deliver(next);
                if next == "connected" {
                    if current.provisioned {
                        if current.owner_paired {
                            "connected".clone_into(&mut current.state);
                        } else {
                            "waiting_for_pair".clone_into(&mut current.state);
                        }
                    } else if !matches!(
                        current.state.as_str(),
                        "provisioning_error" | "provisioning_pending"
                    ) {
                        "transport_connected".clone_into(&mut current.state);
                    }
                } else {
                    next.clone_into(&mut current.state);
                }
                if let Some(detail) = payload.get("detail").and_then(Value::as_str) {
                    current.detail = detail.chars().take(2_000).collect();
                }
                emit_status(events, current);
            }
        }
        Some("provisioning") => {
            if let Some(payload) = envelope.payload {
                let phase = payload
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                update_status(statuses, events, connection_id, |value| match phase {
                    "ready" => {
                        value.provisioned = true;
                        "provisioned".clone_into(&mut value.state);
                        "Channel app permissions and WebSocket message subscription are verified."
                            .clone_into(&mut value.detail);
                    }
                    "applying" => {
                        value.provisioned = false;
                        "provisioning".clone_into(&mut value.state);
                        "Enabling the bot, permissions, and WebSocket message subscription."
                            .clone_into(&mut value.detail);
                    }
                    "awaiting_publication" | "verification_pending" => {
                        value.provisioned = false;
                        "provisioning_pending".clone_into(&mut value.state);
                        value.detail = payload
                            .get("detail")
                            .and_then(Value::as_str)
                            .unwrap_or(
                                "Channel accepted the app changes, but publication or verification is still pending.",
                            )
                            .chars()
                            .take(2_000)
                            .collect();
                    }
                    "not_ready" => {
                        value.provisioned = false;
                        "provisioning_required".clone_into(&mut value.state);
                        "The Channel app is authorized, but its WebSocket message event or tenant scopes are not effective yet. Use Refresh to repair and publish the app configuration."
                            .clone_into(&mut value.detail);
                    }
                    "checking_failed" => {
                        value.provisioned = false;
                        "provisioning".clone_into(&mut value.state);
                        if let Some(detail) = payload.get("detail").and_then(Value::as_str) {
                            value.detail = format!(
                                "Could not inspect the current app configuration; applying it again: {}",
                                detail.chars().take(1_500).collect::<String>()
                            );
                        }
                    }
                    _ => {}
                });
            }
        }
        Some("reject") => {
            if let Some(payload) = envelope.payload {
                let reason = payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                update_status(statuses, events, connection_id, |value| {
                    value.detail = format!(
                        "Channel delivered a message, but the channel policy rejected it: {reason}."
                    );
                });
            }
        }
        Some("delivery") => {
            if let Some(payload) = envelope.payload {
                let Some(delivery_id) = payload.get("deliveryId").and_then(Value::as_str) else {
                    return;
                };
                lock(in_flight).remove(delivery_id);
                if payload.get("state").and_then(Value::as_str) == Some("sent") {
                    let delivery_kind = payload
                        .get("deliveryKind")
                        .and_then(Value::as_str)
                        .unwrap_or("agent-reply");
                    let message_id = payload
                        .get("messageId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if let Err(error) = outbox.mark_sent(delivery_id, message_id) {
                        tracing::error!(error, "persist Channel delivery completion");
                    }
                    update_status(statuses, events, connection_id, |value| {
                        if delivery_kind == "pairing-confirmation" {
                            "Owner paired. Pairing confirmation delivered in Channel."
                                .clone_into(&mut value.detail);
                        } else {
                            value.last_delivery_at_ms = Some(now_millis());
                            "A Channel message completed an Agent turn and received its reply."
                                .clone_into(&mut value.detail);
                        }
                    });
                } else {
                    let detail = payload
                        .get("detail")
                        .and_then(Value::as_str)
                        .unwrap_or("Channel delivery failed");
                    if let Err(error) =
                        outbox.mark_failed(delivery_id, detail, now_millis() + 2_000, false)
                    {
                        tracing::error!(error, "persist Channel delivery retry");
                    }
                }
            }
        }
        Some("registration") => {
            if let Some(payload) = envelope.payload {
                match payload.get("state").and_then(Value::as_str) {
                    Some("succeeded") => {
                        let app_id = payload
                            .get("appId")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        let app_secret = payload
                            .get("appSecret")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        let region = payload
                            .get("region")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned();
                        if let (Some(app_id), Some(app_secret)) = (app_id, app_secret) {
                            let _ = wake.try_send(RuntimeCommand::RegistrationCompleted {
                                connection_id: connection_id.to_owned(),
                                app_id,
                                app_secret,
                                region,
                            });
                        }
                    }
                    Some("failed") => {
                        let detail = payload
                            .get("detail")
                            .and_then(Value::as_str)
                            .unwrap_or("Channel bot registration failed");
                        update_status(statuses, events, connection_id, |value| {
                            value.connected = false;
                            "error".clone_into(&mut value.state);
                            value.detail = detail.chars().take(2_000).collect();
                            value.setup_url = None;
                            value.setup_expires_at_ms = None;
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}
