//! Host-only connection configuration. Cloud management credentials never enter Link.
use ovule_remoting::{backend::IceConfigProvider, model::IceServer};
use ovule_secrets::SecretStore;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

pub const CONFIG_REFERENCE: &str = "OVULE_CLOUDFLARE_TURN";
const API_ROOT: &str = "https://rtc.live.cloudflare.com/v1/turn/keys";
const TTL_SECONDS: u32 = 86_400;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudflareTurnConfig {
    pub key_id: String,
    pub api_token: String,
}

impl CloudflareTurnConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.key_id.is_empty()
            || self.key_id.len() > 128
            || !self
                .key_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Connection service key ID is missing or invalid".into());
        }
        if self.api_token.len() < 20
            || self.api_token.len() > 8192
            || self.api_token.chars().any(char::is_whitespace)
        {
            return Err("Connection service API token is missing or invalid".into());
        }
        Ok(())
    }

    /// A credential-generation probe, not proof of media reachability.
    pub fn probe(&self) -> Result<(), String> {
        self.credentials().map(|_| ())
    }

    fn credentials(&self) -> Result<Vec<IceServer>, String> {
        self.validate()?;
        self.fetch(&format!(
            "{API_ROOT}/{}/credentials/generate-ice-servers",
            self.key_id
        ))
    }

    fn fetch(&self, endpoint: &str) -> Result<Vec<IceServer>, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(8)))
            .max_redirects(0)
            .build()
            .into();
        let mut response = agent
            .post(endpoint)
            .header("Authorization", &format!("Bearer {}", self.api_token))
            .header("Content-Type", "application/json")
            .send(serde_json::json!({"ttl": TTL_SECONDS}).to_string())
            .map_err(|error| match error {
                ureq::Error::StatusCode(401 | 403) => {
                    "Connection service rejected the credentials. Update the TURN key on this Host"
                        .to_owned()
                }
                ureq::Error::StatusCode(429) => {
                    "Connection service is busy or over quota. Retry later".to_owned()
                }
                _ => "Connection service is unreachable. Check this Host's network and retry"
                    .to_owned(),
            })?;
        let body = response
            .body_mut()
            .with_config()
            .limit(64 * 1024)
            .read_to_string()
            .map_err(|_| "Connection service response could not be read".to_owned())?;
        parse_credentials(&body)
    }
}

fn parse_credentials(body: &str) -> Result<Vec<IceServer>, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Response {
        ice_servers: Vec<IceServer>,
    }
    let response: Response = serde_json::from_str(body)
        .map_err(|_| "Connection service returned invalid ICE credentials".to_owned())?;
    if response.ice_servers.is_empty() || response.ice_servers.len() > 16 {
        return Err("Connection service returned no usable relay".into());
    }
    let mut relay = false;
    for server in &response.ice_servers {
        if server.urls.is_empty()
            || server.urls.len() > 8
            || server.urls.iter().any(|url| {
                url.len() > 2048
                    || url.contains('@')
                    || url.chars().any(char::is_whitespace)
                    || !["stun:", "turn:", "turns:"]
                        .iter()
                        .any(|scheme| url.starts_with(scheme))
            })
        {
            return Err("Connection service returned invalid ICE servers".into());
        }
        if server
            .urls
            .iter()
            .any(|url| url.starts_with("turn:") || url.starts_with("turns:"))
        {
            relay = true;
            if server
                .username
                .as_ref()
                .is_none_or(|value| value.is_empty() || value.len() > 8192)
                || server
                    .credential
                    .as_ref()
                    .is_none_or(|value| value.is_empty() || value.len() > 8192)
            {
                return Err("Connection service returned incomplete relay credentials".into());
            }
        }
    }
    if !relay {
        return Err("Connection service returned no usable relay".into());
    }
    Ok(response.ice_servers)
}

pub(crate) struct ConfiguredIceProvider {
    secrets: Arc<dyn SecretStore>,
    fallback: Arc<dyn IceConfigProvider>,
}
impl ConfiguredIceProvider {
    pub fn new(secrets: Arc<dyn SecretStore>, fallback: Arc<dyn IceConfigProvider>) -> Self {
        Self { secrets, fallback }
    }
}
#[async_trait::async_trait]
impl IceConfigProvider for ConfiguredIceProvider {
    async fn configuration_report(
        &self,
        owner: &str,
        session_id: u64,
    ) -> Result<(Vec<IceServer>, Option<String>), String> {
        match self.configuration(owner, session_id).await {
            Ok(servers) => Ok((servers, None)),
            Err(error) => self
                .fallback
                .configuration(owner, session_id)
                .await
                .map(|servers| (servers, Some(error))),
        }
    }
    async fn configuration(&self, owner: &str, session_id: u64) -> Result<Vec<IceServer>, String> {
        // Reload at session creation: a setup change takes effect without restart.
        let secrets = self.secrets.clone();
        let config =
            tokio::task::spawn_blocking(move || secrets.load_provider_credential(CONFIG_REFERENCE))
                .await
                .map_err(|_| "Host connection configuration is unavailable".to_owned())?
                .map_err(|_| {
                    "Host connection configuration is unavailable. Run connection setup again"
                        .to_owned()
                })?;
        let Some(config) = config else {
            return self.fallback.configuration(owner, session_id).await;
        };
        let config = config
            .into_string()
            .map_err(|_| "Host connection configuration has invalid encoding".to_owned())?;
        if config.is_empty() {
            return self.fallback.configuration(owner, session_id).await;
        }
        let config: CloudflareTurnConfig = serde_json::from_str(&config).map_err(|_| {
            "Host connection configuration is invalid. Run connection setup again".to_owned()
        })?;
        tokio::task::spawn_blocking(move || config.credentials())
            .await
            .map_err(|_| "Connection service request was interrupted".to_owned())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_management_credentials_without_url_injection() {
        let mut config = CloudflareTurnConfig {
            key_id: "key-123".into(),
            api_token: "a".repeat(32),
        };
        assert!(config.validate().is_ok());
        config.key_id = "key/../other".into();
        assert!(config.validate().is_err());
    }
    #[test]
    fn preserves_issued_ice_urls_and_credentials() {
        let servers = parse_credentials(r#"{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]},{"urls":["turn:turn.cloudflare.com:3478?transport=udp","turns:turn.cloudflare.com:443?transport=tcp"],"username":"issued-user","credential":"issued-secret"}]}"#).unwrap();
        assert_eq!(servers[1].credential.as_deref(), Some("issued-secret"));
        assert!(servers[1].urls[1].contains(":443"));
    }
    #[test]
    fn rejects_missing_relay_credentials_and_secret_bearing_urls() {
        for body in [
            r#"{"iceServers":[]}"#,
            r#"{"iceServers":[{"urls":["stun:x"]}]}"#,
            r#"{"iceServers":[{"urls":["turn:x"]}]}"#,
            r#"{"iceServers":[{"urls":["turn:user:password@x"],"username":"u","credential":"p"}]}"#,
        ] {
            assert!(parse_credentials(body).is_err());
        }
    }
    #[test]
    fn requests_temporary_credentials_and_redacts_provider_errors() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        for status in [201, 403, 302] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/credentials", listener.local_addr().unwrap());
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let read = stream.read(&mut buffer).unwrap();
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                    if bytes.windows(13).any(|v| v == b"{\"ttl\":86400}") {
                        break;
                    }
                }
                let request = String::from_utf8(bytes).unwrap();
                assert!(
                    request
                        .to_lowercase()
                        .contains("authorization: bearer synthetic-token-for-test")
                );
                let body = if status == 201 {
                    r#"{"iceServers":[{"urls":["turn:relay.example:3478"],"username":"u","credential":"temporary"}]}"#
                } else {
                    "synthetic-token-for-test"
                };
                write!(stream, "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/do-not-forward\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let config = CloudflareTurnConfig {
                key_id: "test-key".into(),
                api_token: "synthetic-token-for-test".into(),
            };
            let result = config.fetch(&endpoint);
            worker.join().unwrap();
            if status == 201 {
                assert_eq!(result.unwrap()[0].credential.as_deref(), Some("temporary"));
            } else {
                assert!(!result.unwrap_err().contains("synthetic-token"));
            }
        }
    }
    #[tokio::test]
    async fn missing_configuration_uses_direct_policy_and_corrupt_storage_does_not_block_it() {
        struct Direct;
        #[async_trait::async_trait]
        impl IceConfigProvider for Direct {
            async fn configuration(&self, _: &str, _: u64) -> Result<Vec<IceServer>, String> {
                Ok(vec![IceServer {
                    urls: vec!["stun:example.com:3478".into()],
                    username: None,
                    credential: None,
                }])
            }
        }
        let root = std::env::temp_dir().join(format!(
            "ovule-connectivity-secret-test-{}",
            std::process::id()
        ));
        let secrets = Arc::new(ovule_secrets::providers::open(&root).unwrap());
        let provider = ConfiguredIceProvider::new(secrets, Arc::new(Direct));
        let (servers, warning) = provider.configuration_report("device", 1).await.unwrap();
        assert_eq!(servers[0].urls[0], "stun:example.com:3478");
        assert!(warning.is_none());
        std::fs::write(
            root.join("secrets/provider-cloudflare-turn.dpapi"),
            b"invalid protected data",
        )
        .unwrap();
        let (servers, warning) = provider.configuration_report("device", 2).await.unwrap();
        assert_eq!(servers[0].urls[0], "stun:example.com:3478");
        assert!(warning.unwrap().contains("Run connection setup again"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
