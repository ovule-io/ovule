use crate::state::AttemptSpec;

pub struct ChannelInboundMessage<'a> {
    pub connection_id: &'a str,
    pub event_id: &'a str,
    pub conversation_key: &'a str,
    pub conversation_id: &'a str,
    pub conversation_type: &'a str,
    pub platform_thread_id: Option<&'a str>,
    pub sender_id: &'a str,
    pub sender_name: Option<&'a str>,
    pub content: &'a str,
    pub content_type: &'a str,
    pub platform_created_at: Option<&'a str>,
    pub default_workspace_path: &'a str,
    pub allow_attempt: bool,
}

pub enum ChannelInboundAcceptance {
    Duplicate,
    FeedbackCaptured,
    Ignored,
    Attempt(Box<AttemptSpec>),
}

pub trait ChannelConversationState: Send + Sync {
    fn accept(
        &self,
        message: ChannelInboundMessage<'_>,
    ) -> Result<ChannelInboundAcceptance, String>;

    fn response_content_for_attempt(&self, attempt_id: &str) -> Option<String>;
}
