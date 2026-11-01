use super::*;

pub(super) struct ChannelRuntimeContext {
    pub(super) commands: mpsc::Receiver<RuntimeCommand>,
    pub(super) wake: mpsc::SyncSender<RuntimeCommand>,
    pub(super) statuses: Arc<Mutex<BTreeMap<String, ChannelStatus>>>,
    pub(super) conversation_state: Arc<dyn ChannelConversationState>,
    pub(super) configuration: Arc<dyn ChannelConfiguration>,
    pub(super) outbox: Arc<dyn ChannelOutbox>,
    pub(super) default_workspace_path: String,
    pub(super) conversations: Arc<dyn ConversationIngress>,
    pub(super) events: Arc<dyn ChannelEvents>,
    pub(super) managed_toolchains: PathBuf,
    pub(super) secrets: Arc<dyn SecretStore>,
    pub(super) extensions: Arc<dyn ChannelWorkerSource>,
}

#[allow(clippy::too_many_lines)]
// The runtime loop owns command dispatch and delegates transport work to sibling modules.
pub(super) fn run_channel(context: ChannelRuntimeContext) {
    let ChannelRuntimeContext {
        commands,
        wake,
        statuses,
        conversation_state,
        configuration,
        outbox,
        default_workspace_path,
        conversations,
        events,
        managed_toolchains,
        secrets,
        extensions,
    } = context;
    let mut runtimes = HashMap::<String, ConnectionRuntime>::new();
    let mut restore_retries = HashMap::<String, (std::time::Instant, u32)>::new();
    loop {
        // Services may restore saved connections before Framework Utility services
        // are ready. Retry opening that boundary with a bounded backoff off the
        // serial ShellAPI thread; authorization failures are not retried here.
        let retry_id = restore_retries
            .iter_mut()
            .find_map(|(id, (due, attempts))| {
                if *attempts >= 5 || *due > std::time::Instant::now() {
                    return None;
                }
                *attempts += 1;
                *due = std::time::Instant::now() + Duration::from_secs(1 << *attempts);
                Some(id.clone())
            });
        let retry = retry_id.and_then(|connection_id| {
            let credentials = secrets.load_channel(&connection_id).ok().flatten()?;
            let config = configuration.configuration(&connection_id).ok().flatten()?;
            config.enabled.then_some(RuntimeCommand::Configure {
                connection_id,
                app_id: credentials.app_id,
                app_secret: credentials.app_secret,
                region: config.region,
                owner_id: credentials.owner_id,
                provisioned: credentials.provisioned,
                reply: None,
            })
        });
        match retry.map_or_else(|| commands.recv_timeout(Duration::from_millis(250)), Ok) {
            Ok(RuntimeCommand::Configure {
                connection_id,
                app_id,
                app_secret,
                region,
                owner_id,
                provisioned,
                reply,
            }) => {
                update_status(&statuses, &events, &connection_id, |value| {
                    value.configured = true;
                    value.enabled = true;
                    value.connected = false;
                    value.provisioned = false;
                    "connecting".clone_into(&mut value.state);
                    value.region.clone_from(&region);
                    value.app_id_hint = credential_hint(&app_id);
                    "Connecting to the Channel long connection.".clone_into(&mut value.detail);
                    value.owner_paired = owner_id.is_some();
                    value.pairing_code = owner_id
                        .is_none()
                        .then(|| pairing_code(&app_id, &app_secret));
                    value.setup_url = None;
                    value.setup_expires_at_ms = None;
                });
                let result: Result<ChannelStatus, String> = (|| {
                    let runtime = runtimes.entry(connection_id.clone()).or_default();
                    if runtime.worker.is_none() {
                        runtime.pending = Arc::default();
                        runtime.in_flight = Arc::default();
                        runtime.worker = Some(spawn_worker(
                            extensions.as_ref(),
                            &managed_toolchains,
                            connection_id.clone(),
                            Arc::clone(&runtime.pending),
                            Arc::clone(&runtime.in_flight),
                            Arc::clone(&statuses),
                            Arc::clone(&conversation_state),
                            default_workspace_path.clone(),
                            Arc::clone(&conversations),
                            Arc::clone(&outbox),
                            events.clone(),
                            wake.clone(),
                            Arc::clone(&secrets),
                        )?);
                    }
                    let process = runtime.worker.as_mut().expect("worker was started");
                    let provisioning = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "checkProvisioning",
                        serde_json::json!({
                            "appId": &app_id,
                            "appSecret": &app_secret,
                            "region": &region,
                            "assumeProvisioned": provisioned,
                        }),
                    );
                    send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "configure",
                        serde_json::json!({
                            "appId": app_id,
                            "appSecret": app_secret,
                            "region": region,
                            // The Host applies mention-only dispatch until an Agent explicitly
                            // subscribes this group as a passive raw-message feed.
                            "requireMention": false,
                        }),
                    )?;
                    let connected = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "connect",
                        serde_json::json!({}),
                    )?;
                    let bot_name = connected
                        .pointer("/bot/name")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    let bot_open_id = connected
                        .pointer("/bot/openId")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.connected = true;
                        apply_connected_provisioning_status(
                            value,
                            &provisioning,
                            owner_id.is_some(),
                        );
                        value.bot_name = bot_name;
                        value.bot_open_id = bot_open_id;
                    });
                    Ok(connection_status(&statuses, &connection_id))
                })();
                if let Err(error) = &result {
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.connected = false;
                        "error".clone_into(&mut value.state);
                        value.detail = error.chars().take(2_000).collect();
                    });
                }
                if let Err(error) = &result {
                    if runtimes
                        .get(&connection_id)
                        .is_some_and(|runtime| runtime.worker.is_none())
                        && (error.contains("Utility session")
                            || error.contains("runtime is not ready"))
                    {
                        restore_retries
                            .entry(connection_id.clone())
                            .or_insert_with(|| {
                                (std::time::Instant::now() + Duration::from_secs(1), 0)
                            });
                    }
                } else {
                    restore_retries.remove(&connection_id);
                }
                if let Some(reply) = reply {
                    let _ = reply.send(result);
                }
            }
            Ok(RuntimeCommand::StartRegistration {
                connection_id,
                app_id,
                reuse_existing,
            }) => {
                update_status(&statuses, &events, &connection_id, |value| {
                    "registering".clone_into(&mut value.state);
                    "Preparing secure Channel bot setup.".clone_into(&mut value.detail);
                    value.setup_url = None;
                    value.setup_expires_at_ms = None;
                });
                let result: Result<ChannelStatus, String> = (|| {
                    let runtime = runtimes.entry(connection_id.clone()).or_default();
                    if runtime.worker.is_none() {
                        runtime.pending = Arc::default();
                        runtime.in_flight = Arc::default();
                        runtime.worker = Some(spawn_worker(
                            extensions.as_ref(),
                            &managed_toolchains,
                            connection_id.clone(),
                            Arc::clone(&runtime.pending),
                            Arc::clone(&runtime.in_flight),
                            Arc::clone(&statuses),
                            Arc::clone(&conversation_state),
                            default_workspace_path.clone(),
                            Arc::clone(&conversations),
                            Arc::clone(&outbox),
                            events.clone(),
                            wake.clone(),
                            Arc::clone(&secrets),
                        )?);
                    }
                    let process = runtime.worker.as_mut().expect("worker was started");
                    let started = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "startRegistration",
                        serde_json::json!({
                            "appId": app_id,
                            "reuseExisting": reuse_existing,
                        }),
                    )?;
                    let url = started.get("url").and_then(Value::as_str).ok_or_else(|| {
                        "Channel registration did not return a setup URL".to_owned()
                    })?;
                    let expire_in = started
                        .get("expireIn")
                        .and_then(Value::as_i64)
                        .unwrap_or(600);
                    update_status(&statuses, &events, &connection_id, |value| {
                        "waiting_for_authorization".clone_into(&mut value.state);
                        "Approve the bot configuration in channel.".clone_into(&mut value.detail);
                        value.setup_url = Some(url.to_owned());
                        value.setup_expires_at_ms = Some(now_millis() + expire_in * 1_000);
                    });
                    Ok(connection_status(&statuses, &connection_id))
                })();
                if let Err(error) = &result {
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.connected = false;
                        "error".clone_into(&mut value.state);
                        value.detail = error.chars().take(2_000).collect();
                    });
                }
            }
            Ok(RuntimeCommand::Refresh { connection_id }) => {
                let result: Result<ChannelStatus, String> = (|| {
                    let credentials = secrets.load_channel(&connection_id)?;
                    let runtime = runtimes.entry(connection_id.clone()).or_default();
                    // An authorization session lives in its worker. Saved credentials,
                    // however, can restore a connection after a worker exit or restart.
                    if let Some(worker) = runtime.worker.as_mut()
                        && worker
                            .child
                            .try_wait()
                            .map_err(|error| error.to_string())?
                            .is_some()
                    {
                        runtime.worker = None;
                    }
                    let restarting = runtime.worker.is_none();
                    if restarting {
                        if credentials.is_none() {
                            return Err(
                                "Authorization session ended. Connect the bot again.".to_owned()
                            );
                        }
                        runtime.pending = Arc::default();
                        runtime.in_flight = Arc::default();
                        runtime.worker = Some(spawn_worker(
                            extensions.as_ref(),
                            &managed_toolchains,
                            connection_id.clone(),
                            Arc::clone(&runtime.pending),
                            Arc::clone(&runtime.in_flight),
                            Arc::clone(&statuses),
                            Arc::clone(&conversation_state),
                            default_workspace_path.clone(),
                            Arc::clone(&conversations),
                            Arc::clone(&outbox),
                            events.clone(),
                            wake.clone(),
                            Arc::clone(&secrets),
                        )?);
                    }
                    let process = runtime.worker.as_mut().expect("worker was started");
                    let Some(credentials) = credentials else {
                        let registration = send_request(
                            process,
                            &runtime.pending,
                            &mut runtime.next_id,
                            "refreshRegistration",
                            serde_json::json!({}),
                        )?;
                        if registration.get("state").and_then(Value::as_str) == Some("failed") {
                            return Err("Authorization failed or expired. Connect the bot again."
                                .to_owned());
                        }
                        update_status(&statuses, &events, &connection_id, |value| {
                            "waiting_for_authorization".clone_into(&mut value.state);
                            "Waiting for the current authorization session to complete."
                                .clone_into(&mut value.detail);
                        });
                        return Ok(connection_status(&statuses, &connection_id));
                    };
                    let current = connection_status(&statuses, &connection_id);
                    let provisioning = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "provision",
                        serde_json::json!({
                            "appId": &credentials.app_id,
                            "appSecret": &credentials.app_secret,
                            "region": &current.region,
                        }),
                    );
                    if provisioning
                        .as_ref()
                        .ok()
                        .and_then(|value| value.get("ready"))
                        .and_then(Value::as_bool)
                        == Some(true)
                        && !credentials.provisioned
                    {
                        secrets.save_channel(
                            &connection_id,
                            &credentials.app_id,
                            &credentials.app_secret,
                            credentials.owner_id.as_deref(),
                            true,
                        )?;
                    }
                    if restarting || !current.connected {
                        send_request(
                            process,
                            &runtime.pending,
                            &mut runtime.next_id,
                            "configure",
                            serde_json::json!({
                                "appId": &credentials.app_id,
                                "appSecret": &credentials.app_secret,
                                "region": &current.region,
                                "requireMention": false,
                            }),
                        )?;
                        let connected = send_request(
                            process,
                            &runtime.pending,
                            &mut runtime.next_id,
                            "connect",
                            serde_json::json!({}),
                        )?;
                        update_status(&statuses, &events, &connection_id, |value| {
                            value.owner_paired = credentials.owner_id.is_some();
                            value.pairing_code = credentials.owner_id.is_none().then(|| {
                                pairing_code(&credentials.app_id, &credentials.app_secret)
                            });
                            value.bot_name = connected
                                .pointer("/bot/name")
                                .and_then(Value::as_str)
                                .map(str::to_owned);
                            value.bot_open_id = connected
                                .pointer("/bot/openId")
                                .and_then(Value::as_str)
                                .map(str::to_owned);
                        });
                    }
                    let worker_status = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "status",
                        serde_json::json!({}),
                    )?;
                    let connected = worker_status
                        .get("connected")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.connected = connected;
                        if connected {
                            apply_connected_provisioning_status(
                                value,
                                &provisioning,
                                credentials.owner_id.is_some(),
                            );
                        } else {
                            "disconnected".clone_into(&mut value.state);
                            "The Channel worker is configured but its WebSocket transport is disconnected. Use Connect selected bot to reconnect."
                                .clone_into(&mut value.detail);
                        }
                    });
                    Ok(connection_status(&statuses, &connection_id))
                })();
                if let Err(error) = &result {
                    update_status(&statuses, &events, &connection_id, |value| {
                        "error".clone_into(&mut value.state);
                        value.detail = format!(
                            "Could not refresh the Channel connection: {}",
                            error.chars().take(1_500).collect::<String>()
                        );
                    });
                }
            }
            Ok(RuntimeCommand::RegistrationCompleted {
                connection_id,
                app_id,
                app_secret,
                region,
            }) => {
                update_status(&statuses, &events, &connection_id, |value| {
                    value.connected = false;
                    value.provisioned = false;
                    "provisioning".clone_into(&mut value.state);
                    "Authorization completed. Enabling the bot and WebSocket message events."
                        .clone_into(&mut value.detail);
                });
                let result = (|| {
                    // Registration proves control of the app, not who may control Ovule.
                    // Owner identity is established only by a private `/pair CODE` message.
                    secrets.save_channel(&connection_id, &app_id, &app_secret, None, false)?;
                    configuration.save(&connection_id, &region, true, &credential_hint(&app_id))?;
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.configured = true;
                        value.enabled = true;
                        value.region.clone_from(&region);
                        value.app_id_hint = credential_hint(&app_id);
                        value.setup_url = None;
                        value.setup_expires_at_ms = None;
                    });
                    let runtime = runtimes
                        .get_mut(&connection_id)
                        .ok_or_else(|| "Channel registration runtime stopped".to_owned())?;
                    let process = runtime
                        .worker
                        .as_mut()
                        .ok_or_else(|| "Channel registration worker stopped".to_owned())?;
                    let provisioning = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "provision",
                        serde_json::json!({
                            "appId": &app_id,
                            "appSecret": &app_secret,
                            "region": &region,
                        }),
                    );
                    if provisioning
                        .as_ref()
                        .ok()
                        .and_then(|value| value.get("ready"))
                        .and_then(Value::as_bool)
                        == Some(true)
                    {
                        secrets.save_channel(&connection_id, &app_id, &app_secret, None, true)?;
                    }
                    send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "configure",
                        serde_json::json!({
                            "appId": app_id,
                            "appSecret": app_secret,
                            "region": region,
                            "requireMention": false,
                        }),
                    )?;
                    let connected = send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "connect",
                        serde_json::json!({}),
                    )?;
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.configured = true;
                        value.enabled = true;
                        value.connected = true;
                        apply_connected_provisioning_status(value, &provisioning, false);
                        value.region.clone_from(&region);
                        value.app_id_hint = credential_hint(&app_id);
                        value.bot_name = connected
                            .pointer("/bot/name")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        value.bot_open_id = connected
                            .pointer("/bot/openId")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        value.owner_paired = false;
                        value.pairing_code = Some(pairing_code(&app_id, &app_secret));
                        value.setup_url = None;
                        value.setup_expires_at_ms = None;
                    });
                    Ok::<(), String>(())
                })();
                if let Err(error) = result {
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.connected = false;
                        "error".clone_into(&mut value.state);
                        value.detail = error.chars().take(2_000).collect();
                    });
                }
            }
            Ok(RuntimeCommand::SendPairingConfirmation {
                connection_id,
                conversation_id,
                reply_to_message_id,
                already_paired,
            }) => {
                let result = (|| {
                    let runtime = runtimes
                        .get_mut(&connection_id)
                        .ok_or_else(|| "Channel connection runtime stopped".to_owned())?;
                    let process = runtime
                        .worker
                        .as_mut()
                        .ok_or_else(|| "Channel connection worker stopped".to_owned())?;
                    let text = if already_paired {
                        "Ovule 已配对，此 Bot 连接可以正常接收消息。"
                    } else {
                        "Ovule 配对成功。此 Bot 连接已就绪，请发送一条新消息开始对话。"
                    };
                    send_request(
                        process,
                        &runtime.pending,
                        &mut runtime.next_id,
                        "send",
                        serde_json::json!({
                            "deliveryId": pairing_delivery_id(
                                &connection_id,
                                &reply_to_message_id,
                            ),
                            "deliveryKind": "pairing-confirmation",
                            "to": conversation_id,
                            "text": text,
                            "replyTo": reply_to_message_id,
                            "replyInThread": false,
                        }),
                    )?;
                    Ok::<(), String>(())
                })();
                if let Err(error) = result {
                    update_status(&statuses, &events, &connection_id, |value| {
                        value.detail = format!(
                            "Owner paired, but the Channel confirmation reply failed: {}",
                            error.chars().take(1_500).collect::<String>()
                        );
                    });
                }
            }
            Ok(RuntimeCommand::Wake { connection_id }) => {
                let _ = connection_id;
            }
            Ok(RuntimeCommand::SendProgress {
                connection_id,
                attempt_id,
                sequence,
                text,
            }) => {
                let result = (|| {
                    let route = outbox
                        .reply_target(&attempt_id)?
                        .ok_or_else(|| "Channel progress route is unavailable".to_owned())?;
                    let runtime = runtimes
                        .get_mut(&connection_id)
                        .ok_or_else(|| "Channel connection runtime stopped".to_owned())?;
                    let process = runtime
                        .worker
                        .as_mut()
                        .ok_or_else(|| "Channel connection worker stopped".to_owned())?;
                    let body = text;
                    if let Some(message_id) = runtime
                        .progress_messages
                        .get(&route.reply_to_message_id)
                        .cloned()
                    {
                        send_request(
                            process,
                            &runtime.pending,
                            &mut runtime.next_id,
                            "updateProgress",
                            serde_json::json!({"messageId": message_id, "text": body}),
                        )?;
                    } else {
                        let sent = send_request(
                            process,
                            &runtime.pending,
                            &mut runtime.next_id,
                            "sendProgress",
                            serde_json::json!({
                                "deliveryId": format!("progress-{attempt_id}-{sequence}"),
                                "to": route.conversation_id,
                                "text": body,
                                "replyTo": route.reply_to_message_id,
                                "replyInThread": route.platform_thread_id.is_some(),
                            }),
                        )?;
                        if let Some(message_id) = sent.get("messageId").and_then(Value::as_str) {
                            runtime
                                .progress_messages
                                .insert(route.reply_to_message_id.clone(), message_id.to_owned());
                        }
                    }
                    Ok::<(), String>(())
                })();
                if let Err(error) = result {
                    tracing::debug!(%error, %attempt_id, sequence, "send Channel progress update");
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Ok(RuntimeCommand::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                for runtime in runtimes.values_mut() {
                    stop_worker(&mut runtime.worker, &runtime.pending, &mut runtime.next_id);
                }
                break;
            }
        }
        for (connection_id, runtime) in &mut runtimes {
            if runtime
                .worker
                .as_mut()
                .is_some_and(|process| process.child.try_wait().ok().flatten().is_some())
            {
                runtime.worker = None;
                lock(&runtime.in_flight).clear();
                update_status(&statuses, &events, connection_id, |value| {
                    value.connected = false;
                    "error".clone_into(&mut value.state);
                    "Channel worker exited. Use Refresh to restore the saved connection."
                        .clone_into(&mut value.detail);
                });
            } else if connection_status(&statuses, connection_id).connected
                && let Some(process) = runtime.worker.as_mut()
            {
                flush_outbox(
                    process,
                    outbox.as_ref(),
                    &runtime.in_flight,
                    &mut runtime.next_id,
                    connection_id,
                    &runtime.progress_messages,
                );
            }
        }
    }
}
