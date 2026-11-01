use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::{ExtensionActionInput, ExtensionActionResult, ExtensionCatalogView};
use ovule_extensions::ExtensionActionOutcome;

use super::mapper;

impl crate::shell_api::Extensions for App {
    fn extension_catalog(&self) -> Result<ExtensionCatalogView, CommandError> {
        let _ = self;
        ovule_extensions::providers::catalog()
            .map(mapper::extension_catalog)
            .map_err(CommandError::Failed)
    }

    fn run_extension_action(
        &self,
        input: ExtensionActionInput,
    ) -> Result<ExtensionActionResult, CommandError> {
        self.service::<ovule_extensions::ExtensionService>()?
            .run_action(
                &input.extension_id,
                &input.action_id,
                input.connection_id.as_deref(),
                input.thread_id.as_deref(),
            )
            .map(|outcome: ExtensionActionOutcome| ExtensionActionResult {
                data_json: outcome.data_json,
                open_url: outcome.open_url,
            })
            .map_err(|message| {
                if message == "unknown extension action"
                    || message.starts_with("unsupported extension channel target:")
                {
                    CommandError::InvalidArgument(message)
                } else {
                    CommandError::Failed(message)
                }
            })
    }
}
