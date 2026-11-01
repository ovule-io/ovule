use std::sync::Arc;

use ovule_extensions::runtime::ExtensionWorkerRuntime;

use crate::{ChannelWorkerSource, ResolvedChannelWorker};

pub(crate) struct ExtensionWorkerSource {
    runtime: Arc<dyn ExtensionWorkerRuntime>,
}

impl ExtensionWorkerSource {
    pub(crate) fn new(runtime: Arc<dyn ExtensionWorkerRuntime>) -> Self {
        Self { runtime }
    }
}

impl ChannelWorkerSource for ExtensionWorkerSource {
    fn prepare_channel_worker(&self, channel_type: &str) -> Result<ResolvedChannelWorker, String> {
        self.runtime.prepare_channel_worker(channel_type)
    }
}
