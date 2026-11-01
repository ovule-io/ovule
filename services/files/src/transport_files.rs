use crate::BoundWorkspaceFiles;
use ovule_hosts::WorkspaceTransportResolver;
use std::sync::Arc;
pub(super) struct TransportFiles {
    router: Arc<dyn WorkspaceTransportResolver>,
    runtime: tokio::runtime::Handle,
}
impl TransportFiles {
    pub(super) fn new(
        router: Arc<dyn WorkspaceTransportResolver>,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self { router, runtime }
    }
}
impl BoundWorkspaceFiles for TransportFiles {
    fn read(&self, id: &str, root: &str, path: &str) -> Result<Vec<u8>, String> {
        let transport = self
            .router
            .resolve(Some(id), root)
            .map_err(|e| e.to_string())?;
        self.runtime
            .block_on(transport.read_file(path))
            .map_err(|e| e.to_string())
    }
    fn write(&self, id: &str, root: &str, path: &str, bytes: &[u8]) -> Result<(), String> {
        let transport = self
            .router
            .resolve(Some(id), root)
            .map_err(|e| e.to_string())?;
        self.runtime
            .block_on(transport.write_file(path, bytes))
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ovule_hosts::{TransportError, WorkspaceTransport};
    use std::sync::Mutex;

    struct InjectedResolver {
        transport: Arc<dyn WorkspaceTransport>,
        calls: Mutex<Vec<(String, String)>>,
    }
    impl WorkspaceTransportResolver for InjectedResolver {
        fn resolve(
            &self,
            binding_id: Option<&str>,
            root: &str,
        ) -> Result<Arc<dyn WorkspaceTransport>, TransportError> {
            self.calls
                .lock()
                .unwrap()
                .push((binding_id.unwrap().to_owned(), root.to_owned()));
            Ok(Arc::clone(&self.transport))
        }
    }
    #[test]
    fn bound_files_execute_the_injected_transport() {
        let directory = tempfile::tempdir().unwrap();
        let resolver = Arc::new(InjectedResolver {
            transport: ovule_hosts::providers::local(directory.path().to_owned()).unwrap(),
            calls: Mutex::new(Vec::new()),
        });
        let executor = crate::FileExecutor::new().unwrap();
        let files = TransportFiles::new(resolver.clone(), executor.handle().unwrap());
        files
            .write(
                "binding",
                "/remote/workspace",
                "readme.md",
                b"bound content",
            )
            .unwrap();
        assert_eq!(
            files
                .read("binding", "/remote/workspace", "readme.md")
                .unwrap(),
            b"bound content"
        );
        assert_eq!(
            *resolver.calls.lock().unwrap(),
            vec![("binding".to_owned(), "/remote/workspace".to_owned()); 2]
        );
        executor.stop(std::time::Duration::ZERO);
    }
}
