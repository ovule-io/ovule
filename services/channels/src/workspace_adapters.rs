use serde_json::Value;
use std::sync::Arc;

use crate::{
    CHANNEL_TYPE, ChannelConfiguration, ChannelConfigurationRecord, ChannelConversationState,
    ChannelDelivery, ChannelInboundAcceptance, ChannelInboundMessage, ChannelOutbox,
    ChannelReplyTarget, ChannelToolHost,
};
use ovule_workspace::channel_repository::{
    ChannelFeedInbound as StoredChannelFeedInbound, ChannelInbound as StoredChannelInbound,
};

use ovule_workspace::{WorkspaceEventSink, WorkspaceSession};

pub(crate) struct WorkspaceChannelConfiguration {
    state: Arc<WorkspaceSession>,
}

impl WorkspaceChannelConfiguration {
    pub(crate) const fn new(state: Arc<WorkspaceSession>) -> Self {
        Self { state }
    }
}

impl ChannelConfiguration for WorkspaceChannelConfiguration {
    fn thread_options(&self) -> Vec<crate::configuration::ChannelThreadOption> {
        self.state
            .lock()
            .workspace
            .snapshot()
            .threads
            .into_iter()
            .map(|thread| crate::configuration::ChannelThreadOption {
                id: thread.id,
                title: thread.title,
            })
            .collect()
    }
    fn thread_target(&self, connection_id: &str) -> Result<Option<String>, String> {
        self.state
            .lock()
            .store
            .channels()?
            .channel_thread_target(CHANNEL_TYPE, connection_id)
    }
    fn bind_thread(&self, connection_id: &str, thread_id: Option<&str>) -> Result<(), String> {
        let mut persistent = self.state.lock();
        if persistent
            .store
            .channels()?
            .channel_config(CHANNEL_TYPE, connection_id)?
            .is_none()
        {
            return Err("Connect this bot before binding a Thread".to_owned());
        }
        if let Some(id) = thread_id
            && !persistent
                .workspace
                .snapshot()
                .threads
                .iter()
                .any(|thread| thread.id == id)
        {
            return Err("The selected Thread no longer exists".to_owned());
        }
        persistent.store.channels()?.set_channel_thread_target(
            CHANNEL_TYPE,
            connection_id,
            thread_id,
        )
    }

    fn connections(&self) -> Result<Vec<ChannelConfigurationRecord>, String> {
        self.state
            .lock()
            .store
            .channels()?
            .channel_connections(CHANNEL_TYPE)
            .map(|records| {
                records
                    .into_iter()
                    .map(|record| ChannelConfigurationRecord {
                        connection_id: record.connection_id,
                        region: record.region,
                        enabled: record.enabled,
                        app_id_hint: record.app_id_hint,
                    })
                    .collect()
            })
    }

    fn configuration(
        &self,
        connection_id: &str,
    ) -> Result<Option<ChannelConfigurationRecord>, String> {
        self.state
            .lock()
            .store
            .channels()?
            .channel_config(CHANNEL_TYPE, connection_id)
            .map(|record| {
                record.map(|record| ChannelConfigurationRecord {
                    connection_id: record.connection_id,
                    region: record.region,
                    enabled: record.enabled,
                    app_id_hint: record.app_id_hint,
                })
            })
    }

    fn save(
        &self,
        connection_id: &str,
        region: &str,
        enabled: bool,
        app_id_hint: &str,
    ) -> Result<(), String> {
        self.state.lock().store.channels()?.save_channel_config(
            CHANNEL_TYPE,
            connection_id,
            region,
            enabled,
            app_id_hint,
        )
    }
}

pub(crate) struct WorkspaceChannelOutbox {
    state: Arc<WorkspaceSession>,
}

impl WorkspaceChannelOutbox {
    pub(crate) const fn new(state: Arc<WorkspaceSession>) -> Self {
        Self { state }
    }
}

impl ChannelOutbox for WorkspaceChannelOutbox {
    fn reply_target(&self, attempt_id: &str) -> Result<Option<ChannelReplyTarget>, String> {
        self.state
            .lock()
            .store
            .channels()?
            .channel_reply_route(attempt_id)
            .map(|route| {
                route.map(|route| ChannelReplyTarget {
                    conversation_id: route.conversation_id,
                    platform_thread_id: route.platform_thread_id,
                    reply_to_message_id: route.reply_to_message_id,
                })
            })
    }

    fn pending(
        &self,
        connection_id: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<ChannelDelivery>, String> {
        self.state
            .lock()
            .store
            .channels()?
            .pending_channel_deliveries(CHANNEL_TYPE, connection_id, now_ms, limit)
            .map(|deliveries| {
                deliveries
                    .into_iter()
                    .map(|delivery| ChannelDelivery {
                        delivery_id: delivery.delivery_id,
                        conversation_id: delivery.conversation_id,
                        platform_thread_id: delivery.platform_thread_id,
                        reply_to_message_id: delivery.reply_to_message_id,
                        body: delivery.body,
                        attempts: delivery.attempts,
                    })
                    .collect()
            })
    }

    fn mark_sent(&self, delivery_id: &str, platform_message_id: &str) -> Result<(), String> {
        self.state
            .lock()
            .store
            .channels()?
            .mark_channel_delivery_sent(delivery_id, platform_message_id)
    }

    fn mark_failed(
        &self,
        delivery_id: &str,
        error: &str,
        next_attempt_at_ms: i64,
        terminal: bool,
    ) -> Result<(), String> {
        self.state
            .lock()
            .store
            .channels()?
            .mark_channel_delivery_failed(delivery_id, error, next_attempt_at_ms, terminal)
    }
}

pub(crate) struct WorkspaceChannelConversations {
    state: Arc<WorkspaceSession>,
    events: Arc<dyn WorkspaceEventSink>,
}

impl WorkspaceChannelConversations {
    pub(crate) const fn new(
        state: Arc<WorkspaceSession>,
        events: Arc<dyn WorkspaceEventSink>,
    ) -> Self {
        Self { state, events }
    }
}

impl ChannelConversationState for WorkspaceChannelConversations {
    fn accept(
        &self,
        message: ChannelInboundMessage<'_>,
    ) -> Result<ChannelInboundAcceptance, String> {
        let mut persistent = self.state.lock();
        if persistent.store.channels()?.channel_event_seen(
            CHANNEL_TYPE,
            message.connection_id,
            message.event_id,
        )? {
            return Ok(ChannelInboundAcceptance::Duplicate);
        }
        let bound_thread = persistent
            .store
            .channels()?
            .channel_thread_target(CHANNEL_TYPE, message.connection_id)?;
        let subscription = persistent.store.channels()?.channel_subscription(
            CHANNEL_TYPE,
            message.connection_id,
            message.conversation_key,
        )?;
        if let Some(subscription) =
            subscription.filter(|subscription| subscription.active && bound_thread.is_none())
        {
            let inserted =
                persistent
                    .store
                    .channels()?
                    .append_channel_feed(&StoredChannelFeedInbound {
                        channel_type: CHANNEL_TYPE,
                        connection_id: message.connection_id,
                        subscription_id: &subscription.subscription_id,
                        event_id: message.event_id,
                        conversation_key: message.conversation_key,
                        conversation_id: message.conversation_id,
                        platform_thread_id: message.platform_thread_id,
                        platform_message_id: message.event_id,
                        sender_id: message.sender_id,
                        sender_name: message.sender_name,
                        content: message.content,
                        content_type: message.content_type,
                        platform_created_at: message.platform_created_at,
                    })?;
            return Ok(if inserted {
                ChannelInboundAcceptance::FeedbackCaptured
            } else {
                ChannelInboundAcceptance::Duplicate
            });
        }

        if !message.allow_attempt {
            return Ok(ChannelInboundAcceptance::Ignored);
        }

        let mut candidate = persistent.workspace.clone();
        let thread_id = if let Some(thread_id) = bound_thread {
            thread_id
        } else if let Some(thread_id) = persistent.store.channels()?.channel_thread_id(
            CHANNEL_TYPE,
            message.connection_id,
            message.conversation_key,
        )? {
            thread_id
        } else {
            create_inbound_thread(&mut candidate, &message)?
        };
        let spec = candidate.prepare_message_attempt(&thread_id, message.content)?;
        let inbound = StoredChannelInbound {
            channel_type: CHANNEL_TYPE,
            connection_id: message.connection_id,
            event_id: message.event_id,
            conversation_key: message.conversation_key,
            conversation_id: message.conversation_id,
            conversation_type: message.conversation_type,
            platform_thread_id: message.platform_thread_id,
            platform_message_id: message.event_id,
            sender_id: message.sender_id,
            workspace_thread_id: &thread_id,
            attempt_id: &spec.id,
        };
        if !persistent
            .store
            .channels()?
            .commit_channel_inbound(&candidate, &inbound)?
        {
            return Ok(ChannelInboundAcceptance::Duplicate);
        }
        let revision = candidate.revision();
        persistent.workspace = candidate;
        drop(persistent);
        self.events.revision_changed(revision);
        Ok(ChannelInboundAcceptance::Attempt(Box::new(spec)))
    }

    fn response_content_for_attempt(&self, attempt_id: &str) -> Option<String> {
        self.state
            .read(|workspace| workspace.response_content_for_attempt(attempt_id))
    }
}

fn create_inbound_thread(
    workspace: &mut ovule_workspace::state::Workspace,
    message: &ChannelInboundMessage<'_>,
) -> Result<String, String> {
    let title = message.sender_name.map_or_else(
        || {
            format!(
                "Channel · {}",
                message.conversation_id.chars().take(12).collect::<String>()
            )
        },
        |name| format!("Channel · {}", name.chars().take(48).collect::<String>()),
    );
    workspace.create_thread(&title, message.default_workspace_path)?;
    workspace
        .snapshot()
        .threads
        .last()
        .map(|thread| thread.id.clone())
        .ok_or_else(|| "channel Thread was not created".to_owned())
}

pub(crate) struct WorkspaceChannelTools {
    state: Arc<WorkspaceSession>,
    status: Arc<dyn ovule_conversation::messages::ChannelStatusProvider>,
}

impl WorkspaceChannelTools {
    pub(crate) fn new(
        state: Arc<WorkspaceSession>,
        status: Arc<dyn ovule_conversation::messages::ChannelStatusProvider>,
    ) -> Self {
        Self { state, status }
    }
}

impl ChannelToolHost for WorkspaceChannelTools {
    fn invoke(&self, attempt_id: &str, tool: &str, arguments: &Value) -> Result<Value, String> {
        if tool == "status" {
            if !self.state.read(|workspace| {
                workspace
                    .snapshot()
                    .attempts
                    .iter()
                    .any(|attempt| attempt.id == attempt_id)
            }) {
                return Err(format!("unknown Attempt: {attempt_id}"));
            }
            let connection_id = arguments
                .get("connectionId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            return serde_json::from_str(&self.status.status_json(CHANNEL_TYPE, connection_id)?)
                .map_err(|error| format!("decode channel status: {error}"));
        }
        let mut persistent = self.state.lock();
        let thread_id = persistent
            .workspace
            .snapshot()
            .attempts
            .into_iter()
            .find(|attempt| attempt.id == attempt_id)
            .map(|attempt| attempt.thread_id)
            .ok_or_else(|| format!("unknown Attempt: {attempt_id}"))?;
        match tool {
            "subscribeCurrent" => {
                let label = arguments
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("Channel feedback")
                    .trim();
                if label.is_empty() || label.len() > 128 {
                    return Err("Subscription label must contain 1 to 128 bytes".to_owned());
                }
                serde_json::to_value(
                    persistent
                        .store
                        .channels()?
                        .subscribe_channel_for_attempt(attempt_id, label)?,
                )
                .map_err(|error| format!("encode channel subscription: {error}"))
            }
            "listSubscriptions" => serde_json::to_value(
                persistent
                    .store
                    .channels()?
                    .channel_subscriptions(&thread_id)?,
            )
            .map_err(|error| format!("encode channel subscriptions: {error}")),
            "readFeed" => {
                let subscription_id = arguments
                    .get("subscriptionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "subscriptionId is required".to_owned())?;
                let after_sequence = arguments
                    .get("afterSequence")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0);
                let limit = usize::try_from(
                    arguments
                        .get("limit")
                        .and_then(Value::as_u64)
                        .unwrap_or(50)
                        .clamp(1, 100),
                )
                .map_err(|_| "invalid channel feed limit")?;
                serde_json::to_value(persistent.store.channels()?.channel_feed(
                    &thread_id,
                    subscription_id,
                    after_sequence,
                    limit,
                )?)
                .map_err(|error| format!("encode channel feed: {error}"))
            }
            "unsubscribe" => {
                let subscription_id = arguments
                    .get("subscriptionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "subscriptionId is required".to_owned())?;
                serde_json::to_value(
                    persistent
                        .store
                        .channels()?
                        .set_channel_subscription_active(&thread_id, subscription_id, false)?,
                )
                .map_err(|error| format!("encode channel subscription: {error}"))
            }
            _ => Err("Unsupported channel dynamic tool".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use ovule_workspace::{WorkspaceEventSink, WorkspaceSession};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[derive(Default)]
    struct Events(AtomicUsize);
    impl WorkspaceEventSink for Events {
        fn revision_changed(&self, _: i64) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn session(path: &std::path::Path) -> Arc<WorkspaceSession> {
        Arc::new(WorkspaceSession::new(
            ovule_workspace::state::Workspace::default(),
            ovule_workspace::providers::open(path).unwrap(),
        ))
    }

    #[test]
    fn configuration_provider_round_trips_durable_storage() {
        let data = tempfile::tempdir().unwrap();
        let database = data.path().join("workspace.sqlite3");
        {
            let configuration = crate::providers::workspace_configuration(session(&database));
            configuration
                .save("product-bot", "global", true, "cli_hint")
                .unwrap();
        }
        let configuration = crate::providers::workspace_configuration(session(&database));
        let record = configuration.configuration("product-bot").unwrap().unwrap();
        assert_eq!(record.connection_id, "product-bot");
        assert_eq!(record.region, "global");
        assert!(record.enabled);
        assert_eq!(record.app_id_hint, "cli_hint");
        assert_eq!(configuration.connections().unwrap().len(), 1);
        assert!(configuration.configuration("missing").unwrap().is_none());
    }

    #[test]
    fn ignored_inbound_does_not_mutate_or_publish_workspace() {
        let data = tempfile::tempdir().unwrap();
        let state = session(&data.path().join("workspace.sqlite3"));
        let revision = state.read(ovule_workspace::state::Workspace::revision);
        let events = Arc::new(Events::default());
        let conversations =
            crate::providers::workspace_conversations(state.clone(), events.clone());
        let result = conversations
            .accept(crate::ChannelInboundMessage {
                connection_id: "product-bot",
                event_id: "event",
                conversation_key: "conversation",
                conversation_id: "conversation",
                conversation_type: "group",
                platform_thread_id: None,
                sender_id: "sender",
                sender_name: None,
                content: "hello",
                content_type: "text",
                platform_created_at: None,
                default_workspace_path: "",
                allow_attempt: false,
            })
            .unwrap();
        assert!(matches!(result, crate::ChannelInboundAcceptance::Ignored));
        assert_eq!(
            state.read(ovule_workspace::state::Workspace::revision),
            revision
        );
        assert_eq!(events.0.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn explicit_thread_binding_routes_owner_messages_and_survives_reopen() {
        use crate::{ChannelInboundAcceptance, ChannelInboundMessage};
        let data = tempfile::tempdir().unwrap();
        let database = data.path().join("workspace.sqlite3");
        let mut workspace = ovule_workspace::state::test_support::workspace();
        workspace
            .upsert_agent(
                "binding-test",
                "Binding test",
                "test",
                None,
                Vec::new(),
                Vec::new(),
                "",
                true,
            )
            .unwrap();
        let root = data.path().to_string_lossy().into_owned();
        workspace
            .create_thread("Chosen destination", &root)
            .unwrap();
        let target = workspace.snapshot().threads.last().unwrap().id.clone();
        workspace.select_agent(&target, "binding-test").unwrap();
        workspace.create_thread("Unrelated", &root).unwrap();
        let state = Arc::new(WorkspaceSession::new(
            workspace,
            ovule_workspace::providers::open(&database).unwrap(),
        ));
        let configuration = crate::providers::workspace_configuration(state.clone());
        configuration
            .save("product-bot", "feishu", true, "hint")
            .unwrap();
        assert!(configuration.bind_thread("missing", Some(&target)).is_err());
        assert!(
            configuration
                .bind_thread("product-bot", Some("missing-thread"))
                .is_err()
        );
        configuration
            .bind_thread("product-bot", Some(&target))
            .unwrap();
        let events = Arc::new(Events::default());
        let conversations = crate::providers::workspace_conversations(state.clone(), events);
        let message = || ChannelInboundMessage {
            connection_id: "product-bot",
            event_id: "event-one",
            conversation_key: "chat-one",
            conversation_id: "chat-one",
            conversation_type: "p2p",
            platform_thread_id: None,
            sender_id: "owner",
            sender_name: None,
            content: "hello",
            content_type: "text",
            platform_created_at: None,
            default_workspace_path: &root,
            allow_attempt: true,
        };
        let result = conversations.accept(message()).unwrap();
        let ChannelInboundAcceptance::Attempt(spec) = result else {
            panic!("owner message must start an attempt")
        };
        assert_eq!(
            state.read(|workspace| workspace.snapshot().threads.len()),
            2
        );
        let route = state
            .lock()
            .store
            .channels()
            .unwrap()
            .channel_reply_route(&spec.id)
            .unwrap()
            .unwrap();
        assert_eq!(route.workspace_thread_id, target);
        assert_eq!(route.conversation_id, "chat-one");
        assert!(matches!(
            conversations.accept(message()).unwrap(),
            ChannelInboundAcceptance::Duplicate
        ));
        drop(conversations);
        drop(configuration);
        drop(state);
        let reopened = session(&database);
        let configuration = crate::providers::workspace_configuration(reopened);
        assert_eq!(
            configuration.thread_target("product-bot").unwrap(),
            Some(target)
        );
        assert_eq!(configuration.thread_target("other-bot").unwrap(), None);
        configuration.bind_thread("product-bot", None).unwrap();
        assert_eq!(configuration.thread_target("product-bot").unwrap(), None);
    }
}
