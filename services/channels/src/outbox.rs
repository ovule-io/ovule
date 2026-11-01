#[allow(clippy::struct_field_names)]
pub struct ChannelReplyTarget {
    pub conversation_id: String,
    pub platform_thread_id: Option<String>,
    pub reply_to_message_id: String,
}

pub struct ChannelDelivery {
    pub delivery_id: String,
    pub conversation_id: String,
    pub platform_thread_id: Option<String>,
    pub reply_to_message_id: String,
    pub body: String,
    pub attempts: u32,
}

pub trait ChannelOutbox: Send + Sync {
    fn reply_target(&self, attempt_id: &str) -> Result<Option<ChannelReplyTarget>, String>;

    fn pending(
        &self,
        connection_id: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<ChannelDelivery>, String>;

    fn mark_sent(&self, delivery_id: &str, platform_message_id: &str) -> Result<(), String>;

    fn mark_failed(
        &self,
        delivery_id: &str,
        error: &str,
        next_attempt_at_ms: i64,
        terminal: bool,
    ) -> Result<(), String>;
}
