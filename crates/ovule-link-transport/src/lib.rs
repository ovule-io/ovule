//! Link network client. Authentication policy and feature dispatch are supplied by the application.
use iroh::{Endpoint, EndpointAddr, SecretKey, endpoint::presets};
use ovule_link_protocol::ALPN;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
#[derive(Debug)]
pub enum LinkError {
    Unavailable(String),
    Protocol(String),
}
impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(s) | Self::Protocol(s) => f.write_str(s),
        }
    }
}
impl std::error::Error for LinkError {}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LinkClientConfig {
    pub endpoint_addr: EndpointAddr,
    pub share_id: String,
    pub client_secret: String,
}

pub struct LinkTransport {
    config: LinkClientConfig,
    session: tokio::sync::OnceCell<Arc<HostConnection>>,
}

struct HostConnection {
    endpoint: tokio::sync::OnceCell<Endpoint>,
    connection: tokio::sync::Mutex<Option<iroh::endpoint::Connection>>,
}

impl LinkTransport {
    #[must_use]
    pub fn new(config: LinkClientConfig) -> Self {
        Self {
            config,
            session: tokio::sync::OnceCell::new(),
        }
    }

    // Pool by device identity and exact Host route, never by workspace grant.
    // Each request still carries its own grant and is authorized by the Host.
    async fn session(&self) -> Result<&Arc<HostConnection>, LinkError> {
        self.session
            .get_or_try_init(|| async {
                let secret: SecretKey = serde_json::from_str(&self.config.client_secret)
                    .map_err(|_| LinkError::Protocol("invalid client identity".into()))?;
                let route = serde_json::to_string(&self.config.endpoint_addr)
                    .map_err(|_| LinkError::Protocol("invalid Host route".into()))?;
                Ok::<_, LinkError>(pooled_session(format!("{}:{route}", secret.public())))
            })
            .await
    }

    pub async fn connection(&self) -> Result<iroh::endpoint::Connection, LinkError> {
        let session = self.session().await?;
        let mut cached = session.connection.lock().await;
        if let Some(connection) = cached.as_ref()
            && connection.close_reason().is_none()
        {
            return Ok(connection.clone());
        }
        let endpoint = self.endpoint().await?;
        let connection = tokio::time::timeout(
            Duration::from_secs(10),
            endpoint.connect(self.config.endpoint_addr.clone(), ALPN),
        )
        .await
        .map_err(|_| LinkError::Unavailable("Link connection timed out".into()))?
        .map_err(|error| LinkError::Unavailable(format!("connect Ovule Link Host: {error}")))?;
        *cached = Some(connection.clone());
        Ok(connection)
    }

    pub async fn endpoint(&self) -> Result<&Endpoint, LinkError> {
        self.session()
            .await?
            .endpoint
            .get_or_try_init(|| async {
                let secret: SecretKey =
                    serde_json::from_str(&self.config.client_secret).map_err(|error| {
                        LinkError::Protocol(format!("invalid client identity: {error}"))
                    })?;
                Endpoint::builder(presets::N0)
                    .secret_key(secret)
                    .bind()
                    .await
                    .map_err(|error| LinkError::Unavailable(format!("start Link client: {error}")))
            })
            .await
    }
}

pub mod frame;
mod server;
pub use server::{LinkHandler, LinkServer};

fn pooled_session(key: String) -> Arc<HostConnection> {
    static POOL: OnceLock<Mutex<HashMap<String, Weak<HostConnection>>>> = OnceLock::new();
    let mut pool = POOL
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    pool.retain(|_, session| session.strong_count() > 0);
    if let Some(session) = pool.get(&key).and_then(Weak::upgrade) {
        return session;
    }
    let session = Arc::new(HostConnection {
        endpoint: tokio::sync::OnceCell::new(),
        connection: tokio::sync::Mutex::new(None),
    });
    pool.insert(key, Arc::downgrade(&session));
    session
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn grants_share_control_session_but_identities_and_hosts_do_not() {
        let secret = SecretKey::generate();
        let config = LinkClientConfig {
            endpoint_addr: EndpointAddr::new(SecretKey::generate().public()),
            client_secret: serde_json::to_string(&secret).unwrap(),
            share_id: "workspace-a".into(),
        };
        let first = LinkTransport::new(config.clone());
        let mut other = config.clone();
        other.share_id = "desktop".into();
        let second = LinkTransport::new(other.clone());
        assert!(Arc::ptr_eq(
            first.session().await.unwrap(),
            second.session().await.unwrap()
        ));
        other.client_secret = serde_json::to_string(&SecretKey::generate()).unwrap();
        let third = LinkTransport::new(other);
        assert!(!Arc::ptr_eq(
            first.session().await.unwrap(),
            third.session().await.unwrap()
        ));
        let mut other = config;
        other.endpoint_addr = EndpointAddr::new(SecretKey::generate().public());
        let fourth = LinkTransport::new(other);
        assert!(!Arc::ptr_eq(
            first.session().await.unwrap(),
            fourth.session().await.unwrap()
        ));
    }
}
