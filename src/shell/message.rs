use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{AppSnapshot, MessageAttachmentInput};
use ovule_conversation::messages::{ImageAttachment, MessageError};

use super::mapper;

fn map_message_error(error: MessageError) -> CommandError {
    match error {
        MessageError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        MessageError::Persistence(message) => CommandError::Failed(message),
    }
}

impl crate::shell_api::Message for App {
    fn fork_message(
        &self,
        thread_id: String,
        message_id: String,
    ) -> Result<crate::shell_api::MessageActionResult, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .fork_message(&thread_id, &message_id)
            .map(|result| crate::shell_api::MessageActionResult {
                thread_id: result.thread_id,
                snapshot: mapper::snapshot(result.snapshot),
            })
            .map_err(map_message_error)
    }
    fn restart_message(
        &self,
        thread_id: String,
        message_id: String,
        content: String,
    ) -> Result<crate::shell_api::MessageActionResult, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .restart_message(&thread_id, &message_id, &content)
            .map(|result| crate::shell_api::MessageActionResult {
                thread_id: result.thread_id,
                snapshot: mapper::snapshot(result.snapshot),
            })
            .map_err(map_message_error)
    }

    fn select_agent(&self, thread_id: String, agent: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .select_agent(&thread_id, &agent)
            .map(mapper::snapshot)
            .map_err(map_message_error)
    }

    fn select_host(&self, thread_id: String, host_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .select_host(&thread_id, &host_id)
            .map(mapper::snapshot)
            .map_err(map_message_error)
    }

    fn send_message(
        &self,
        thread_id: String,
        content: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .send(&thread_id, &content, &[])
            .map(mapper::snapshot)
            .map_err(map_message_error)
    }

    fn send_message_with_attachments(
        &self,
        thread_id: String,
        content: String,
        attachments: Vec<MessageAttachmentInput>,
    ) -> Result<AppSnapshot, CommandError> {
        let attachments: Vec<_> = attachments
            .into_iter()
            .map(|attachment| ImageAttachment {
                name: attachment.name,
                media_type: attachment.media_type,
                bytes: attachment.bytes,
            })
            .collect();
        self.service::<ovule_conversation::messages::MessageService>()?
            .send(&thread_id, &content, &attachments)
            .map(mapper::snapshot)
            .map_err(map_message_error)
    }

    fn read_message_attachment(&self, attachment_id: String) -> Result<Vec<u8>, CommandError> {
        self.service::<ovule_conversation::messages::MessageService>()?
            .read_attachment(&attachment_id)
            .map_err(map_message_error)
    }

    fn cancel_attempt(&self, attempt_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_conversation::ConversationService>()?
            .cancel_attempt(&attempt_id)
            .map_err(CommandError::Failed)?;
        Ok(mapper::snapshot(
            self.service::<ovule_workspace::WorkspaceService>()?
                .snapshot(),
        ))
    }
}
