use std::sync::Arc;

use super::{CHANNEL_TYPE, ChannelControl, ChannelOverview};
use crate::ChannelStatusProvider;
use crate::extensions::{ExtensionChannelActions, ExtensionChannelResult};

pub(super) struct ChannelService {
    control: Arc<dyn ChannelControl>,
}

impl ChannelService {
    #[must_use]
    pub fn new(control: Arc<dyn ChannelControl>) -> Self {
        Self { control }
    }
}

impl ChannelStatusProvider for ChannelService {
    fn status_json(&self, target: &str, connection_id: &str) -> Result<String, String> {
        if target != CHANNEL_TYPE {
            return Err(format!("unsupported extension channel target: {target}"));
        }
        serde_json::to_string(&self.control.status(Some(connection_id)))
            .map_err(|error| format!("encode channel setup status: {error}"))
    }
}

impl ExtensionChannelActions for ChannelService {
    fn bind_thread(
        &self,
        target: &str,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<ExtensionChannelResult, String> {
        self.action_result(target, connection_id, |control| {
            control.bind_thread(connection_id, thread_id)
        })
    }

    fn read_status(
        &self,
        target: &str,
        connection_id: &str,
    ) -> Result<ExtensionChannelResult, String> {
        self.action_result(target, connection_id, |control| {
            Ok(control.status(Some(connection_id)))
        })
    }

    fn refresh(&self, target: &str, connection_id: &str) -> Result<ExtensionChannelResult, String> {
        self.action_result(target, connection_id, |control| {
            control.refresh(connection_id)
        })
    }

    fn start_registration(
        &self,
        target: &str,
        connection_id: &str,
        reuse_existing: bool,
    ) -> Result<ExtensionChannelResult, String> {
        self.action_result(target, connection_id, |control| {
            control.start_registration(connection_id, reuse_existing)
        })
    }
}

impl ChannelService {
    fn action_result(
        &self,
        target: &str,
        connection_id: &str,
        operation: impl FnOnce(&dyn ChannelControl) -> Result<ChannelOverview, String>,
    ) -> Result<ExtensionChannelResult, String> {
        if target != CHANNEL_TYPE {
            return Err(format!("unsupported extension channel target: {target}"));
        }
        let status = operation(self.control.as_ref())?;
        let open_url = status
            .connections
            .iter()
            .find(|connection| connection.connection_id == connection_id)
            .and_then(|connection| connection.setup_url.clone());
        let data_json = serde_json::to_string(&status)
            .map_err(|error| format!("encode extension action result: {error}"))?;
        Ok(ExtensionChannelResult {
            data_json,
            open_url,
        })
    }
}
