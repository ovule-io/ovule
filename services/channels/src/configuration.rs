#[derive(Clone)]
pub struct ChannelConfigurationRecord {
    pub connection_id: String,
    pub region: String,
    pub enabled: bool,
    pub app_id_hint: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelThreadOption {
    pub id: String,
    pub title: String,
}

pub trait ChannelConfiguration: Send + Sync {
    fn thread_options(&self) -> Vec<ChannelThreadOption>;
    fn thread_target(&self, connection_id: &str) -> Result<Option<String>, String>;
    fn bind_thread(&self, connection_id: &str, thread_id: Option<&str>) -> Result<(), String>;
    fn connections(&self) -> Result<Vec<ChannelConfigurationRecord>, String>;
    fn configuration(
        &self,
        connection_id: &str,
    ) -> Result<Option<ChannelConfigurationRecord>, String>;
    fn save(
        &self,
        connection_id: &str,
        region: &str,
        enabled: bool,
        app_id_hint: &str,
    ) -> Result<(), String>;
}
