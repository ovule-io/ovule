//! Host-owned ICE policy. TURN REST secrets never cross the Link boundary.
use super::backend::IceConfigProvider;
use super::model::IceServer;
use base64::Engine as _;
use hmac::{Hmac, KeyInit as _, Mac as _};
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_STUN_URLS: &[&str] = &[
    "stun:stun.cloudflare.com:3478",
    "stun:stun.l.google.com:19302",
    "stun:global.stun.twilio.com:3478",
];
const DEFAULT_TTL_SECONDS: u64 = 86_400;
const MIN_TTL_SECONDS: u64 = 600;
const MAX_TTL_SECONDS: u64 = 86_400;

#[derive(Clone)]
pub(crate) struct HostIceConfigProvider {
    stun_urls: Vec<String>,
    turn: Option<TurnRestPolicy>,
    error: Option<String>,
}

#[derive(Clone)]
struct TurnRestPolicy {
    urls: Vec<String>,
    shared_secret: Vec<u8>,
    username_prefix: String,
    ttl_seconds: u64,
}

impl HostIceConfigProvider {
    pub(crate) fn from_environment() -> Result<Self, String> {
        let stun_urls = list("OVULE_STUN_URLS")
            .unwrap_or_else(|| DEFAULT_STUN_URLS.iter().map(ToString::to_string).collect());
        validate_urls(&stun_urls, &["stun:"])?;
        let turn_urls = list("OVULE_TURN_URLS");
        let shared_secret = turn_shared_secret()?;
        let turn = match (turn_urls, shared_secret) {
            (None, None) => None,
            (Some(urls), Some(secret)) => {
                validate_urls(&urls, &["turn:", "turns:"])?;
                if secret.len() < 32 {
                    return Err("TURN REST shared secret must contain at least 32 bytes".into());
                }
                let ttl_seconds = std::env::var("OVULE_TURN_TTL_SECONDS")
                    .ok()
                    .map(|value| {
                        value
                            .parse::<u64>()
                            .map_err(|_| "OVULE_TURN_TTL_SECONDS must be an integer".to_owned())
                    })
                    .transpose()?
                    .unwrap_or(DEFAULT_TTL_SECONDS);
                if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl_seconds) {
                    return Err(format!(
                        "OVULE_TURN_TTL_SECONDS must be between {MIN_TTL_SECONDS} and {MAX_TTL_SECONDS}"
                    ));
                }
                let username_prefix =
                    std::env::var("OVULE_TURN_USERNAME_PREFIX").unwrap_or_else(|_| "ovule".into());
                if username_prefix.is_empty()
                    || username_prefix.len() > 32
                    || !username_prefix
                        .chars()
                        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
                {
                    return Err("invalid OVULE_TURN_USERNAME_PREFIX".into());
                }
                Some(TurnRestPolicy {
                    urls,
                    shared_secret: secret,
                    username_prefix,
                    ttl_seconds,
                })
            }
            _ => {
                return Err(
                    "OVULE_TURN_URLS and exactly one TURN REST shared secret source must be configured together"
                        .into(),
                );
            }
        };
        Ok(Self {
            stun_urls,
            turn,
            error: None,
        })
    }

    pub(crate) fn unavailable(error: String) -> Self {
        Self {
            stun_urls: Vec::new(),
            turn: None,
            error: Some(error),
        }
    }

    fn configuration_at(
        &self,
        owner: &str,
        session_id: u64,
        now: u64,
    ) -> Result<Vec<IceServer>, String> {
        let mut servers = Vec::new();
        if !self.stun_urls.is_empty() {
            servers.push(IceServer {
                urls: self.stun_urls.clone(),
                username: None,
                credential: None,
            });
        }
        if let Some(turn) = &self.turn {
            let expires = now
                .checked_add(turn.ttl_seconds)
                .ok_or_else(|| "TURN credential expiry overflow".to_owned())?;
            let owner = owner
                .chars()
                .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
                .take(64)
                .collect::<String>();
            let owner = if owner.is_empty() { "device" } else { &owner };
            let username = format!(
                "{expires}:{}:{owner}:{session_id:016x}",
                turn.username_prefix
            );
            let mut signer = Hmac::<Sha1>::new_from_slice(&turn.shared_secret)
                .map_err(|_| "invalid TURN REST shared secret".to_owned())?;
            signer.update(username.as_bytes());
            let credential =
                base64::engine::general_purpose::STANDARD.encode(signer.finalize().into_bytes());
            servers.push(IceServer {
                urls: turn.urls.clone(),
                username: Some(username),
                credential: Some(credential),
            });
        }
        Ok(servers)
    }
}

#[async_trait::async_trait]
impl IceConfigProvider for HostIceConfigProvider {
    async fn configuration(&self, owner: &str, session_id: u64) -> Result<Vec<IceServer>, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "system clock is before Unix epoch".to_owned())?
            .as_secs();
        self.configuration_at(owner, session_id, now)
    }
}

fn list(name: &str) -> Option<Vec<String>> {
    std::env::var(name).ok().map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    })
}

fn turn_shared_secret() -> Result<Option<Vec<u8>>, String> {
    let inline = std::env::var("OVULE_TURN_SHARED_SECRET")
        .ok()
        .filter(|value| !value.is_empty());
    let file = std::env::var("OVULE_TURN_SHARED_SECRET_FILE")
        .ok()
        .filter(|value| !value.is_empty());
    match (inline, file) {
        (Some(_), Some(_)) => Err(
            "configure only one of OVULE_TURN_SHARED_SECRET or OVULE_TURN_SHARED_SECRET_FILE"
                .into(),
        ),
        (Some(secret), None) => Ok(Some(secret.into_bytes())),
        (None, Some(path)) => {
            let secret = std::fs::read(path)
                .map_err(|error| format!("read TURN REST shared secret file: {error}"))?;
            let end = secret
                .iter()
                .rposition(|value| !matches!(value, b'\r' | b'\n'))
                .map_or(0, |index| index + 1);
            Ok(Some(secret[..end].to_vec()))
        }
        (None, None) => Ok(None),
    }
}

fn validate_urls(urls: &[String], schemes: &[&str]) -> Result<(), String> {
    if urls.len() > 8
        || urls.iter().any(|url| {
            url.len() > 2048
                || url.contains('@')
                || !schemes.iter().any(|scheme| url.starts_with(scheme))
        })
    {
        return Err("invalid Host ICE policy URL".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> HostIceConfigProvider {
        HostIceConfigProvider {
            stun_urls: vec!["stun:stun.example.com:3478".into()],
            turn: Some(TurnRestPolicy {
                urls: vec![
                    "turn:relay.example.com:3478?transport=udp".into(),
                    "turns:relay.example.com:443?transport=tcp".into(),
                ],
                shared_secret: b"0123456789abcdef0123456789abcdef".to_vec(),
                username_prefix: "ovule".into(),
                ttl_seconds: 600,
            }),
            error: None,
        }
    }

    #[test]
    fn mints_session_scoped_turn_rest_credentials_without_exposing_the_secret() {
        let config = provider()
            .configuration_at("device/unsafe", 7, 1_000)
            .unwrap();
        assert_eq!(config.len(), 2);
        assert_eq!(
            config[1].username.as_deref(),
            Some("1600:ovule:deviceunsafe:0000000000000007")
        );
        assert!(
            config[1]
                .credential
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        );
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(!serialized.contains("0123456789abcdef"));
    }

    #[test]
    fn credentials_are_bound_to_the_device_and_expiry() {
        let provider = provider();
        let first = provider.configuration_at("first", 1, 1_000).unwrap();
        let second = provider.configuration_at("second", 1, 1_000).unwrap();
        let later = provider.configuration_at("first", 1, 1_001).unwrap();
        let other_session = provider.configuration_at("first", 2, 1_000).unwrap();
        assert_ne!(first[1].credential, second[1].credential);
        assert_ne!(first[1].credential, later[1].credential);
        assert_ne!(first[1].credential, other_session[1].credential);
    }

    #[test]
    fn direct_only_policy_returns_redundant_stun_without_credentials() {
        let provider = HostIceConfigProvider {
            stun_urls: DEFAULT_STUN_URLS.iter().map(ToString::to_string).collect(),
            turn: None,
            error: None,
        };
        let config = provider.configuration_at("device", 7, 1_000).unwrap();
        assert_eq!(config[0].urls.len(), DEFAULT_STUN_URLS.len());
        assert!(config[0].username.is_none());
        assert!(config[0].credential.is_none());
    }
}
