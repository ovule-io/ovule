#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelConfig {
    pub connection_id: String,
    pub channel_type: String,
    pub region: String,
    pub enabled: bool,
    pub app_id_hint: String,
}

pub struct ChannelInbound<'a> {
    pub channel_type: &'a str,
    pub connection_id: &'a str,
    pub event_id: &'a str,
    pub conversation_key: &'a str,
    pub conversation_id: &'a str,
    pub conversation_type: &'a str,
    pub platform_thread_id: Option<&'a str>,
    pub platform_message_id: &'a str,
    pub sender_id: &'a str,
    pub workspace_thread_id: &'a str,
    pub attempt_id: &'a str,
}

pub struct ChannelFeedInbound<'a> {
    pub channel_type: &'a str,
    pub connection_id: &'a str,
    pub subscription_id: &'a str,
    pub event_id: &'a str,
    pub conversation_key: &'a str,
    pub conversation_id: &'a str,
    pub platform_thread_id: Option<&'a str>,
    pub platform_message_id: &'a str,
    pub sender_id: &'a str,
    pub sender_name: Option<&'a str>,
    pub content: &'a str,
    pub content_type: &'a str,
    pub platform_created_at: Option<&'a str>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSubscription {
    pub subscription_id: String,
    pub channel_type: String,
    pub connection_id: String,
    pub conversation_key: String,
    pub conversation_id: String,
    pub platform_thread_id: Option<String>,
    pub workspace_thread_id: String,
    pub label: String,
    pub active: bool,
    pub last_sequence: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFeedItem {
    pub sequence: i64,
    pub subscription_id: String,
    pub connection_id: String,
    pub conversation_id: String,
    pub platform_thread_id: Option<String>,
    pub platform_message_id: String,
    pub sender_id: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub content_type: String,
    pub platform_created_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(clippy::struct_field_names)] // IDs identify distinct external routing namespaces.
pub struct ChannelReplyRoute {
    pub channel_type: String,
    pub connection_id: String,
    pub conversation_key: String,
    pub conversation_id: String,
    pub conversation_type: String,
    pub platform_thread_id: Option<String>,
    pub workspace_thread_id: String,
    pub reply_to_message_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingDelivery {
    pub delivery_id: String,
    pub conversation_id: String,
    pub platform_thread_id: Option<String>,
    pub reply_to_message_id: String,
    pub body: String,
    pub attempts: u32,
}

/// Durable channel routing, inbound deduplication, feed and outbox.
pub trait ChannelRepository<S: crate::Checkpoint>: Send {
    fn channel_connections(&self, channel_type: &str) -> Result<Vec<ChannelConfig>, String>;
    fn channel_config(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<ChannelConfig>, String>;
    fn save_channel_config(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        region: &str,
        enabled: bool,
        app_id_hint: &str,
    ) -> Result<(), String>;
    fn channel_event_seen(
        &self,
        channel_type: &str,
        connection_id: &str,
        event_id: &str,
    ) -> Result<bool, String>;
    fn channel_thread_target(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<String>, String>;
    fn set_channel_thread_target(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<(), String>;
    fn channel_thread_id(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<String>, String>;
    fn commit_channel_inbound(
        &mut self,
        workspace: &S,
        inbound: &ChannelInbound<'_>,
    ) -> Result<bool, String>;
    fn channel_reply_route(&self, attempt_id: &str) -> Result<Option<ChannelReplyRoute>, String>;
    fn channel_subscription(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<ChannelSubscription>, String>;
    fn subscribe_channel_for_attempt(
        &mut self,
        attempt_id: &str,
        label: &str,
    ) -> Result<ChannelSubscription, String>;
    fn channel_subscriptions(
        &self,
        workspace_thread_id: &str,
    ) -> Result<Vec<ChannelSubscription>, String>;
    fn set_channel_subscription_active(
        &mut self,
        workspace_thread_id: &str,
        subscription_id: &str,
        active: bool,
    ) -> Result<ChannelSubscription, String>;
    fn append_channel_feed(&mut self, inbound: &ChannelFeedInbound<'_>) -> Result<bool, String>;
    fn channel_feed(
        &self,
        workspace_thread_id: &str,
        subscription_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<ChannelFeedItem>, String>;
    fn commit_with_channel_reply(
        &mut self,
        workspace: &S,
        kind: &str,
        attempt_id: &str,
        payload: &serde_json::Value,
        route: &ChannelReplyRoute,
        body: &str,
    ) -> Result<(), String>;
    fn pending_channel_deliveries(
        &self,
        channel_type: &str,
        connection_id: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<PendingDelivery>, String>;
    fn mark_channel_delivery_sent(
        &mut self,
        delivery_id: &str,
        platform_message_id: &str,
    ) -> Result<(), String>;
    fn mark_channel_delivery_failed(
        &mut self,
        delivery_id: &str,
        error: &str,
        next_attempt_at_ms: i64,
        terminal: bool,
    ) -> Result<(), String>;
}
