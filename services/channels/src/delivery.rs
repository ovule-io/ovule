use super::*;

#[allow(clippy::too_many_lines)]
pub(super) fn accept_message(
    context: &MessageContext<'_>,
    message: &WorkerInboundMessage,
) -> Result<(), String> {
    if message.message_id.is_empty()
        || message.chat_id.is_empty()
        || message.sender_id.is_empty()
        || message.content.trim().is_empty()
        || message.content.len() > 65_536
        || message.raw_content_type != "text"
    {
        return Ok(());
    }
    let Some(credentials) = context.secrets.load_channel(context.connection_id)? else {
        return Ok(());
    };
    let expected = pairing_code(&credentials.app_id, &credentials.app_secret);
    let is_pairing_command = message.content.split_whitespace().next() == Some("/pair");
    let supplied_pairing_code = pairing_command_code(&message.content);
    let Some(owner_id) = credentials.owner_id else {
        if message.chat_type != "p2p" {
            return Ok(());
        }
        if supplied_pairing_code != Some(expected.as_str()) {
            return Ok(());
        }
        context.secrets.save_channel(
            context.connection_id,
            &credentials.app_id,
            &credentials.app_secret,
            Some(&message.sender_id),
            credentials.provisioned,
        )?;
        update_status(
            context.statuses,
            context.events,
            context.connection_id,
            |value| {
                value.owner_paired = true;
                value.pairing_code = None;
                value.last_message_at_ms = Some(now_millis());
                "Owner paired. Send another message to start a Ovule conversation."
                    .clone_into(&mut value.detail);
            },
        );
        queue_pairing_confirmation(context, message, false);
        return Ok(());
    };
    if is_pairing_command {
        if message.chat_type == "p2p"
            && owner_id == message.sender_id
            && supplied_pairing_code == Some(expected.as_str())
        {
            update_status(
                context.statuses,
                context.events,
                context.connection_id,
                |value| {
                    value.last_message_at_ms = Some(now_millis());
                    "Owner is already paired. Sending confirmation in Channel."
                        .clone_into(&mut value.detail);
                },
            );
            queue_pairing_confirmation(context, message, true);
        }
        // Pairing commands are channel control traffic and must never become
        // an Agent Turn, including stale or repeated codes.
        return Ok(());
    }
    let conversation_key = message.thread_id.as_ref().map_or_else(
        || message.chat_id.clone(),
        |thread_id| format!("{}:thread:{thread_id}", message.chat_id),
    );
    // The worker is configured with `requireMention: false`. Preserve the
    // security boundary at the paired owner identity instead of silently
    // reintroducing a group-mention requirement in the Host.
    let allow_attempt = owner_can_start_attempt(&owner_id, &message.sender_id);
    let acceptance = context.state.accept(ChannelInboundMessage {
        connection_id: context.connection_id,
        event_id: &message.message_id,
        conversation_key: &conversation_key,
        conversation_id: &message.chat_id,
        conversation_type: &message.chat_type,
        platform_thread_id: message.thread_id.as_deref(),
        sender_id: &message.sender_id,
        sender_name: message.sender_name.as_deref(),
        content: message.content.trim(),
        content_type: &message.raw_content_type,
        platform_created_at: message.create_time.as_deref(),
        default_workspace_path: context.default_workspace_path,
        allow_attempt,
    })?;
    let spec = match acceptance {
        ChannelInboundAcceptance::Duplicate => return Ok(()),
        ChannelInboundAcceptance::FeedbackCaptured => {
            update_status(
                context.statuses,
                context.events,
                context.connection_id,
                |value| {
                    value.last_message_at_ms = Some(now_millis());
                    "Captured a Channel feedback message for the subscribed Agent workflow."
                        .clone_into(&mut value.detail);
                },
            );
            return Ok(());
        }
        ChannelInboundAcceptance::Ignored => {
            if owner_id != message.sender_id {
                tracing::warn!(
                    sender = %message.sender_id,
                    chat_type = %message.chat_type,
                    "ignored Channel message outside an Agent-authorized feedback subscription"
                );
            }
            return Ok(());
        }
        ChannelInboundAcceptance::Attempt(spec) => *spec,
    };
    update_status(
        context.statuses,
        context.events,
        context.connection_id,
        |value| {
            value.last_message_at_ms = Some(now_millis());
            value.last_agent_attempt_at_ms = Some(now_millis());
            "Received a Channel message and delegated it to the configured Agent."
                .clone_into(&mut value.detail);
        },
    );
    let progress_state = Arc::clone(context.state);
    let conversations = Arc::clone(context.conversations);
    let event_wake = context.wake.clone();
    let wake_connection_id = context.connection_id.to_owned();
    let observer: WorkerEventCallback = Arc::new(move |event| {
        let progress = match &event {
            WorkerEvent::Output {
                attempt_id,
                sequence,
                ..
            } if *sequence == 1 || *sequence % 8 == 0 => Some((attempt_id.clone(), *sequence)),
            _ => None,
        };
        let finished = matches!(event, WorkerEvent::Finished(_));
        if let Some((attempt_id, sequence)) = progress {
            let text = progress_state
                .response_content_for_attempt(&attempt_id)
                .unwrap_or_default();
            if !text.trim().is_empty() {
                let text = text.chars().rev().take(12_000).collect::<String>();
                let text = text.chars().rev().collect();
                let _ = event_wake.try_send(RuntimeCommand::SendProgress {
                    connection_id: wake_connection_id.clone(),
                    attempt_id,
                    sequence,
                    text,
                });
            }
        }
        if finished {
            let _ = event_wake.try_send(RuntimeCommand::Wake {
                connection_id: wake_connection_id.clone(),
            });
        }
    });
    if let Err(error) = conversations.spawn_attempt(&spec, Some(observer)) {
        context
            .conversations
            .worker_event(WorkerEvent::Finished(WorkerOutcome {
                attempt_id: spec.id,
                status: "failed".to_owned(),
                summary: error,
            }));
        let _ = context.wake.try_send(RuntimeCommand::Wake {
            connection_id: context.connection_id.to_owned(),
        });
    }
    Ok(())
}

pub(super) fn owner_can_start_attempt(owner_id: &str, sender_id: &str) -> bool {
    owner_id == sender_id
}

pub(super) fn pairing_command_code(content: &str) -> Option<&str> {
    let mut parts = content.split_whitespace();
    if parts.next()? != "/pair" {
        return None;
    }
    let code = parts.next()?;
    (parts.next().is_none() && code.len() == 6 && code.bytes().all(|value| value.is_ascii_digit()))
        .then_some(code)
}

pub(super) fn queue_pairing_confirmation(
    context: &MessageContext<'_>,
    message: &WorkerInboundMessage,
    already_paired: bool,
) {
    if let Err(error) = context
        .wake
        .try_send(RuntimeCommand::SendPairingConfirmation {
            connection_id: context.connection_id.to_owned(),
            conversation_id: message.chat_id.clone(),
            reply_to_message_id: message.message_id.clone(),
            already_paired,
        })
    {
        tracing::warn!(%error, "queue Channel pairing confirmation");
    }
}

pub(super) fn flush_outbox(
    worker: &mut WorkerProcess,
    outbox: &dyn ChannelOutbox,
    in_flight: &Mutex<HashSet<String>>,
    next_id: &mut u64,
    connection_id: &str,
    progress_messages: &std::collections::HashMap<String, String>,
) {
    let deliveries = match outbox.pending(connection_id, now_millis(), 20) {
        Ok(deliveries) => deliveries,
        Err(error) => {
            tracing::error!(error, "read Channel outbox");
            return;
        }
    };
    for delivery in deliveries {
        if lock(in_flight).contains(&delivery.delivery_id) {
            continue;
        }
        if delivery.attempts >= MAX_DELIVERY_ATTEMPTS {
            let _ = outbox.mark_failed(
                &delivery.delivery_id,
                "maximum Channel delivery attempts exceeded",
                0,
                true,
            );
            continue;
        }
        lock(in_flight).insert(delivery.delivery_id.clone());
        let id = format!("outbox-{}", *next_id);
        *next_id += 1;
        let command = serde_json::json!({
            "version": 1,
            "id": id,
            "method": "send",
            "params": {
                "deliveryId": delivery.delivery_id,
                "deliveryKind": "agent-reply",
                "messageId": progress_messages.get(&delivery.reply_to_message_id),
                "to": delivery.conversation_id,
                "text": delivery.body,
                "replyTo": delivery.reply_to_message_id,
                "replyInThread": delivery.platform_thread_id.is_some(),
            }
        });
        if let Err(error) = write_command(&mut worker.stdin, &command) {
            let delivery_id = command
                .pointer("/params/deliveryId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            lock(in_flight).remove(delivery_id);
            let _ = outbox.mark_failed(delivery_id, &error, now_millis() + 2_000, false);
        }
    }
}

#[allow(clippy::needless_pass_by_value)] // Requests take ownership of their JSON payload at the IPC boundary.
pub(super) fn send_request(
    worker: &mut WorkerProcess,
    pending: &PendingRequests,
    next_id: &mut u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = format!("request-{}", *next_id);
    *next_id += 1;
    let (reply, response) = mpsc::sync_channel(1);
    lock(pending).insert(id.clone(), reply);
    let command = serde_json::json!({
        "version": 1,
        "id": id,
        "method": method,
        "params": params,
    });
    if let Err(error) = write_command(&mut worker.stdin, &command) {
        lock(pending).remove(&id);
        return Err(error);
    }
    response.recv_timeout(REQUEST_TIMEOUT).map_err(|_| {
        lock(pending).remove(&id);
        format!("Channel worker {method} request timed out")
    })?
}

pub(super) fn write_command(stdin: &mut ChildStdin, command: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdin, command)
        .map_err(|error| format!("encode Channel worker command: {error}"))?;
    stdin
        .write_all(b"\n")
        .and_then(|()| stdin.flush())
        .map_err(|error| format!("write Channel worker command: {error}"))
}

pub(super) fn stop_worker(
    worker: &mut Option<WorkerProcess>,
    pending: &PendingRequests,
    next_id: &mut u64,
) {
    if let Some(process) = worker.as_mut() {
        let _ = send_request(process, pending, next_id, "shutdown", serde_json::json!({}));
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    *worker = None;
}

pub(super) fn update_status(
    statuses: &Mutex<BTreeMap<String, ChannelStatus>>,
    events: &Arc<dyn ChannelEvents>,
    connection_id: &str,
    update: impl FnOnce(&mut ChannelStatus),
) {
    let mut values = lock(statuses);
    let value = values
        .entry(connection_id.to_owned())
        .or_insert_with(|| status_for(connection_id));
    update(value);
    emit_status(events, value);
}

pub(super) fn connection_status(
    statuses: &Mutex<BTreeMap<String, ChannelStatus>>,
    connection_id: &str,
) -> ChannelStatus {
    lock(statuses)
        .get(connection_id)
        .cloned()
        .unwrap_or_else(|| status_for(connection_id))
}

pub(super) fn status_for(connection_id: &str) -> ChannelStatus {
    ChannelStatus {
        connection_id: connection_id.to_owned(),
        ..ChannelStatus::default()
    }
}

pub(super) fn validate_connection_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("connectionId must contain only letters, digits, '-' or '_'".to_owned());
    }
    Ok(value.to_owned())
}

pub(super) fn emit_status(events: &Arc<dyn ChannelEvents>, status: &ChannelStatus) {
    if let Ok(payload) = serde_json::to_vec(status)
        && let Err(error) = events.status_changed(&payload)
    {
        tracing::warn!(%error, "broadcast Channel channel status");
    }
}

pub(super) fn credential_hint(app_id: &str) -> String {
    if app_id.chars().count() <= 8 {
        return app_id.to_owned();
    }
    let prefix = app_id.chars().take(6).collect::<String>();
    let suffix = app_id
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("{prefix}…{suffix}")
}

pub(super) fn pairing_code(app_id: &str, app_secret: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"ovule-channel-owner-v1\0");
    hash.update(app_id.as_bytes());
    hash.update(b"\0");
    hash.update(app_secret.as_bytes());
    let digest = hash.finalize();
    let number = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{number:06}")
}

pub(super) fn pairing_delivery_id(connection_id: &str, message_id: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"ovule-channel-pairing-delivery-v1\0");
    hash.update(connection_id.as_bytes());
    hash.update(b"\0");
    hash.update(message_id.as_bytes());
    format!("pairing:{:x}", hash.finalize())
}

pub(super) fn health_state_can_deliver(state: &str) -> bool {
    matches!(state, "connected" | "degraded")
}

pub(super) fn apply_connected_provisioning_status(
    status: &mut ChannelStatus,
    provisioning: &Result<Value, String>,
    owner_paired: bool,
) {
    match provisioning {
        Ok(result) if result.get("ready").and_then(Value::as_bool) == Some(true) => {
            status.provisioned = true;
            let verified = result.get("verified").and_then(Value::as_bool) != Some(false);
            if owner_paired {
                "connected".clone_into(&mut status.state);
                if verified {
                    "Channel WebSocket events are verified and the owner is paired. Send a message to test the Agent reply."
                } else {
                    "Channel accepted and published the required bot configuration, and the owner is paired. Send a message to verify inbound delivery and the Agent reply."
                }
                .clone_into(&mut status.detail);
            } else {
                "waiting_for_pair".clone_into(&mut status.state);
                if verified {
                    "Channel WebSocket events are verified. Send the shown /pair code in a private chat."
                } else {
                    "Channel accepted and published the required bot configuration. Send the shown /pair code in a private chat to verify inbound delivery."
                }
                .clone_into(&mut status.detail);
            }
        }
        Ok(result) => {
            status.provisioned = false;
            "provisioning_pending".clone_into(&mut status.state);
            let mut errors = result
                .get("stepErrors")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>();
            if let Some(error) = result
                .get("publishError")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                errors.push(error.to_owned());
            }
            status.detail = if errors.is_empty() {
                "The worker transport is connected, but Channel has not yet confirmed the WebSocket message event and permissions. Check the app version in the developer console, publish it if requested, then Refresh.".to_owned()
            } else {
                format!(
                    "The worker transport is connected, but Channel app provisioning is incomplete: {}",
                    errors.join(" · ").chars().take(1_600).collect::<String>()
                )
            };
        }
        Err(error) => {
            status.provisioned = false;
            "provisioning_error".clone_into(&mut status.state);
            status.detail = format!(
                "The worker transport is connected, but automatic Channel app provisioning failed: {}",
                error.chars().take(1_400).collect::<String>()
            );
        }
    }
}

pub(super) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or_default()
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
