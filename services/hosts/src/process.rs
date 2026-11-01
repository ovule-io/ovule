use std::pin::Pin;
use tokio::io::{AsyncRead, AsyncWrite};

pub struct WorkspaceProcess {
    pub stdin: Pin<Box<dyn AsyncWrite + Send + Unpin>>,
    pub stdout: Pin<Box<dyn AsyncRead + Send + Unpin>>,
    pub stderr: Pin<Box<dyn AsyncRead + Send + Unpin>>,
    _lifetime: tokio::sync::oneshot::Sender<()>,
    completion: Option<tokio::sync::oneshot::Receiver<Option<i32>>>,
}

impl WorkspaceProcess {
    pub fn new(
        stdin: impl AsyncWrite + Send + Unpin + 'static,
        stdout: impl AsyncRead + Send + Unpin + 'static,
        stderr: impl AsyncRead + Send + Unpin + 'static,
        lifetime: tokio::sync::oneshot::Sender<()>,
        completion: tokio::sync::oneshot::Receiver<Option<i32>>,
    ) -> Self {
        Self {
            stdin: Box::pin(stdin),
            stdout: Box::pin(stdout),
            stderr: Box::pin(stderr),
            _lifetime: lifetime,
            completion: Some(completion),
        }
    }

    pub async fn wait(&mut self) -> Option<i32> {
        self.completion.take()?.await.ok().flatten()
    }
}
