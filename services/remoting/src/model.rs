//! Host desktop contracts. No framework, transport, persistence, or UI types.
use serde::{Deserialize, Serialize};

pub const CAPABILITY: &str = "desktop.control";
pub const MAX_SESSIONS: usize = 4;
pub const LEASE_SECONDS: u64 = 20;
// Chromium can throttle background renderer timers to one wakeup per minute.
pub const RENDERER_LEASE_SECONDS: u64 = 90;
pub const HANDSHAKE_SECONDS: u64 = 30;
pub const LINK_OPERATION_TIMEOUT_SECONDS: u64 = 12;
// Host startup includes TURN issuance (8s), native capabilities (5s) and native Start (5s).
pub const HOST_START_TIMEOUT_SECONDS: u64 = 25;
// Authorization and Host startup run sequentially, with a small scheduling margin.
pub const CLIENT_START_TIMEOUT_SECONDS: u64 = 40;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Connecting,
    Connected,
    Reconnecting,
    Stopped,
    Failed,
}
impl SessionState {
    #[must_use]
    pub const fn terminal(self) -> bool {
        matches!(self, Self::Stopped | Self::Failed)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub auth_key: String,
    pub max_bitrate_kbps: Option<u32>,
    pub target_framerate: Option<u32>,
    pub screen_id: Option<i64>,
}
impl StartRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.auth_key.len() < 32
            || self.auth_key.len() > 1024
            || self
                .target_framerate
                .is_some_and(|v| !(15..=120).contains(&v))
            || self
                .max_bitrate_kbps
                .is_some_and(|v| !(128..=100_000).contains(&v))
        {
            return Err("invalid remote control options".into());
        }
        Ok(())
    }

    #[must_use]
    pub fn with_ice_servers(self, ice_servers: Vec<IceServer>) -> NativeStartOptions {
        NativeStartOptions {
            auth_key: self.auth_key,
            ice_servers,
            max_bitrate_kbps: self.max_bitrate_kbps,
            target_framerate: self.target_framerate,
            screen_id: self.screen_id,
        }
    }
}

#[derive(Clone, Debug)]
pub struct NativeStartOptions {
    pub auth_key: String,
    pub ice_servers: Vec<IceServer>,
    pub max_bitrate_kbps: Option<u32>,
    pub target_framerate: Option<u32>,
    pub screen_id: Option<i64>,
}
impl NativeStartOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.ice_servers.len() > 16 {
            return Err("invalid ICE server".into());
        }
        for server in &self.ice_servers {
            if server.urls.is_empty()
                || server.urls.len() > 8
                || server.urls.iter().any(|url| {
                    url.len() > 2048
                        || !["stun:", "turn:", "turns:"]
                            .iter()
                            .any(|prefix| url.starts_with(prefix))
                })
            {
                return Err("invalid ICE server".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedSession {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connectivity_warning: Option<String>,
    pub ice_servers: Vec<IceServer>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SdpType {
    Offer,
    Answer,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Description {
    pub r#type: SdpType,
    pub sdp: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IceCandidate {
    pub mid: String,
    pub m_line_index: u32,
    pub candidate: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Signal {
    pub sequence: u64,
    pub description: Option<Description>,
    pub candidates: Vec<IceCandidate>,
}
impl Signal {
    pub fn validate(&self) -> Result<(), String> {
        if self
            .description
            .as_ref()
            .is_some_and(|d| d.sdp.is_empty() || d.sdp.len() > 512 * 1024)
            || self.candidates.len() > 64
            || self
                .candidates
                .iter()
                .any(|c| c.candidate.len() > 16 * 1024 || c.mid.len() > 256)
        {
            return Err("invalid remote control signal".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdate {
    pub state: SessionState,
    pub route: String,
    pub signals: Vec<Signal>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdate {
    // Strings preserve u64 identifiers in JSON events without precision loss.
    pub session_id: String,
    pub state: SessionState,
    pub route: String,
    pub error: Option<String>,
    pub ice_servers: Option<Vec<IceServer>>,
    pub signals: Vec<Signal>,
}
