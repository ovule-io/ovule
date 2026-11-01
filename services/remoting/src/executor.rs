use std::sync::Mutex;
use std::time::Duration;

/// Owns the domain executor and exposes only its execution and lifecycle capabilities.
pub struct RemotingExecutor {
    runtime: Mutex<Option<tokio::runtime::Runtime>>,
}
pub type RemotingExecutorService = tuffite_ioc::Service<RemotingExecutor>;

impl RemotingExecutor {
    pub(super) fn new() -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ovule-remoting")
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            runtime: Mutex::new(Some(runtime)),
        })
    }
    pub fn handle(&self) -> Result<tokio::runtime::Handle, String> {
        self.runtime
            .lock()
            .map_err(|_| "Remoting executor lock poisoned")?
            .as_ref()
            .map(|runtime| runtime.handle().clone())
            .ok_or_else(|| "Remoting executor stopped".to_owned())
    }
    pub fn shutdown(&self, remoting: Option<&dyn crate::Remoting>, timeout: Duration) {
        if let Some(runtime) = self
            .runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            if let Some(remoting) = remoting {
                runtime.block_on(remoting.shutdown_and_wait(timeout));
            }
            runtime.shutdown_timeout(Duration::from_secs(1));
        }
    }
}
impl Drop for RemotingExecutor {
    fn drop(&mut self) {
        if let Some(runtime) = self
            .runtime
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            runtime.shutdown_timeout(Duration::from_secs(1));
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopped_executor_rejects_new_handles() {
        let executor = RemotingExecutor::new().unwrap();
        let handle = executor.handle().unwrap();
        assert_eq!(handle.block_on(async { 42 }), 42);
        executor.shutdown(None, Duration::ZERO);
        assert!(executor.handle().is_err());
    }
}
