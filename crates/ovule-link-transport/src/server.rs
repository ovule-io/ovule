//! The transport owns connection and stream tasks; the host owns authorization and dispatch.
use crate::LinkError;
use iroh::{
    Endpoint, EndpointAddr, SecretKey,
    endpoint::{RecvStream, SendStream, presets},
};
use std::sync::Arc;
use tokio::{
    sync::{Semaphore, watch},
    task::JoinSet,
};

#[async_trait::async_trait]
pub trait LinkHandler: Send + Sync + 'static {
    fn connected(&self, _peer: &str) {}
    fn disconnected(&self, _peer: &str) {}
    async fn handle(&self, peer: String, send: SendStream, recv: RecvStream);
}

struct ConnectionLease {
    handler: Arc<dyn LinkHandler>,
    peer: String,
}
impl Drop for ConnectionLease {
    fn drop(&mut self) {
        self.handler.disconnected(&self.peer);
    }
}
pub struct LinkServer {
    endpoint: Endpoint,
}
impl LinkServer {
    pub async fn bind(secret: SecretKey) -> Result<Self, LinkError> {
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret)
            .alpns(vec![ovule_link_protocol::ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| LinkError::Unavailable(format!("bind Link host: {e}")))?;
        Ok(Self { endpoint })
    }
    #[must_use]
    pub fn address(&self) -> EndpointAddr {
        self.endpoint.addr()
    }

    /// Runs until shutdown, then closes connections and joins every transport task.
    pub async fn serve(
        self,
        handler: Arc<dyn LinkHandler>,
        mut shutdown: watch::Receiver<bool>,
        address_changed: impl Fn(EndpointAddr) + Send,
    ) {
        let permits = Arc::new(Semaphore::new(256));
        let connections = Arc::new(Semaphore::new(64));
        let mut tasks = JoinSet::new();
        let mut refresh = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            if *shutdown.borrow() {
                break;
            }
            tokio::select! {
                _ = refresh.tick() => address_changed(self.address()),
                incoming = self.endpoint.accept() => {
                    let Some(incoming) = incoming else { break };
                    let Ok(connection_permit) = connections.clone().try_acquire_owned() else { incoming.refuse(); continue; };
                    let handler = handler.clone();
                    let permits = permits.clone();
                    tasks.spawn(async move {
                        let _connection_permit = connection_permit;
                        let Ok(Ok(connection)) = tokio::time::timeout(std::time::Duration::from_secs(10), incoming).await else { return };
                        let peer = connection.remote_id().to_string();
                        handler.connected(&peer);
                        let _lease = ConnectionLease { handler: handler.clone(), peer: peer.clone() };
                        let mut streams = JoinSet::new();
                        loop {
                            tokio::select! {
                                accepted = connection.accept_bi() => {
                                    let Ok((send, recv)) = accepted else { break };
                                    let Ok(permit) = permits.clone().try_acquire_owned() else { drop(send); drop(recv); continue; };
                                    let handler = handler.clone();
                                    let peer = peer.clone();
                                    streams.spawn(async move { let _permit = permit; handler.handle(peer, send, recv).await; });
                                },
                                _ = streams.join_next(), if !streams.is_empty() => {},
                            }
                        }
                        streams.abort_all();
                        while streams.join_next().await.is_some() {}
                    });
                },
                _ = tasks.join_next(), if !tasks.is_empty() => {},
                changed = shutdown.changed() => { if changed.is_err() || *shutdown.borrow() { break; } },
            }
        }
        self.endpoint.close().await;
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    }
}
