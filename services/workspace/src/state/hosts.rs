use super::RemoteEndpoint;
use serde::{Deserialize, Serialize};

/// Persisted state owned by the hosts capability.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct HostState {
    #[serde(default)]
    pub(super) endpoints: Vec<RemoteEndpoint>,
}
