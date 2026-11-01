use super::{ChannelHandle, ChannelOverview};

pub trait ChannelControl: Send + Sync {
    fn status(&self, selected: Option<&str>) -> ChannelOverview;
    fn bind_thread(
        &self,
        _connection_id: &str,
        _thread_id: Option<&str>,
    ) -> Result<ChannelOverview, String> {
        Err("Channel Thread binding is unavailable".to_owned())
    }
    fn refresh(&self, connection_id: &str) -> Result<ChannelOverview, String>;
    fn start_registration(
        &self,
        connection_id: &str,
        reuse_existing: bool,
    ) -> Result<ChannelOverview, String>;
}

impl ChannelControl for ChannelHandle {
    fn status(&self, selected: Option<&str>) -> ChannelOverview {
        ChannelHandle::status(self, selected)
    }

    fn bind_thread(
        &self,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<ChannelOverview, String> {
        ChannelHandle::bind_thread(self, connection_id, thread_id)
    }
    fn refresh(&self, connection_id: &str) -> Result<ChannelOverview, String> {
        ChannelHandle::refresh(self, connection_id)
    }

    fn start_registration(
        &self,
        connection_id: &str,
        reuse_existing: bool,
    ) -> Result<ChannelOverview, String> {
        ChannelHandle::start_registration(self, connection_id, reuse_existing)
    }
}
