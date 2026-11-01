use std::sync::Mutex;
use std::time::Duration;

/// Owns the domain executor and exposes only its execution and lifecycle capabilities.
pub struct FileExecutor {
    runtime: Mutex<Option<tokio::runtime::Runtime>>,
}
pub type FileExecutorService = tuffite_ioc::Service<FileExecutor>;

impl FileExecutor {
    pub(super) fn new() -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ovule-files")
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
            .map_err(|_| "Files executor lock poisoned")?
            .as_ref()
            .map(|runtime| runtime.handle().clone())
            .ok_or_else(|| "Files executor stopped".to_owned())
    }
    pub fn stop(&self, timeout: Duration) {
        if let Some(runtime) = self
            .runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            runtime.shutdown_timeout(timeout);
        }
    }
}
impl Drop for FileExecutor {
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
        let executor = FileExecutor::new().unwrap();
        let handle = executor.handle().unwrap();
        assert_eq!(handle.block_on(async { 42 }), 42);
        executor.stop(Duration::ZERO);
        assert!(executor.handle().is_err());
    }
}
