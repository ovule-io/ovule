use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use super::{CHANNEL_TYPE, ChannelOverview, ChannelStatus, lock};
use crate::ChannelStatusProvider;

/// Shared read model: drivers can inspect channels without depending on their runtime.
#[derive(Default)]
pub struct ChannelStatusState {
    pub(super) statuses: Arc<Mutex<BTreeMap<String, ChannelStatus>>>,
}

impl ChannelStatusProvider for ChannelStatusState {
    fn status_json(&self, target: &str, connection_id: &str) -> Result<String, String> {
        if target != CHANNEL_TYPE {
            return Err(format!("unsupported channel: {target}"));
        }
        let statuses = lock(&self.statuses);
        if !connection_id.is_empty() && !statuses.contains_key(connection_id) {
            return Err(format!("unknown Channel connection: {connection_id}"));
        }
        serde_json::to_string(&ChannelOverview {
            selected_connection_id: (!connection_id.is_empty()).then(|| connection_id.to_owned()),
            threads: Vec::new(),
            connections: statuses
                .values()
                .filter(|status| connection_id.is_empty() || status.connection_id == connection_id)
                .cloned()
                .collect(),
        })
        .map_err(|error| format!("encode channel status: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_connection_scoped_and_pairing_does_not_fabricate_delivery() {
        let state = ChannelStatusState::default();
        lock(&state.statuses).insert(
            "one".to_owned(),
            ChannelStatus {
                connection_id: "one".to_owned(),
                owner_paired: true,
                last_message_at_ms: Some(100),
                ..ChannelStatus::default()
            },
        );
        lock(&state.statuses).insert(
            "two".to_owned(),
            ChannelStatus {
                connection_id: "two".to_owned(),
                ..ChannelStatus::default()
            },
        );
        let value: serde_json::Value =
            serde_json::from_str(&state.status_json(CHANNEL_TYPE, "one").unwrap()).unwrap();
        assert_eq!(value["connections"].as_array().unwrap().len(), 1);
        assert_eq!(value["connections"][0]["ownerPaired"], true);
        assert_eq!(
            value["connections"][0]["lastDeliveryAtMs"],
            serde_json::Value::Null
        );
        assert!(state.status_json(CHANNEL_TYPE, "missing").is_err());
        assert!(state.status_json("other", "one").is_err());
        assert!(!value.to_string().contains("appSecret"));
    }
}
