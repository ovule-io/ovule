//! MCP acquisition is lazy and Attempt-owned. Credentials never enter discovery metadata.
use async_trait::async_trait;
use ovule_agent_api::{
    CapabilityDefinition, CapabilityLease, CapabilityProvider, ProviderDescriptor, ProviderError,
};

use processkit::CancellationToken;
use rmcp::{
    RoleClient, ServiceExt,
    model::CallToolRequestParams,
    service::RunningService,
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::process::{Child, Command};

#[derive(Clone)]
pub struct McpProviderSpec {
    pub id: String,
    pub label: String,
    pub transport: String,
    pub target: String,
    pub args: Vec<String>,
    pub credential_env: Option<String>,
}

#[must_use]
pub fn providers(tools: &[McpProviderSpec], workspace: &Path) -> Vec<Arc<dyn CapabilityProvider>> {
    tools
        .iter()
        .enumerate()
        .map(|(index, tool)| {
            Arc::new(McpProvider {
                record: tool.clone(),
                workspace: workspace.to_path_buf(),
                namespace: format!("mcp_{index}"),
            }) as Arc<dyn CapabilityProvider>
        })
        .collect()
}
struct McpProvider {
    record: McpProviderSpec,
    workspace: PathBuf,
    namespace: String,
}
struct McpLease {
    client: Option<RunningService<RoleClient, ()>>,
    child: Option<Child>,
    group: Option<processkit::ProcessGroup>,
    definitions: Vec<CapabilityDefinition>,
    bindings: BTreeMap<String, String>,
}
impl McpLease {
    fn empty() -> Self {
        Self {
            client: None,
            child: None,
            group: None,
            definitions: Vec::new(),
            bindings: BTreeMap::new(),
        }
    }
}
impl McpLease {
    async fn connect(
        &mut self,
        provider: &McpProvider,
        credential: Option<String>,
    ) -> Result<(), String> {
        // The guard owns the process before any await, including initialize and tools/list.
        let client = match provider.record.transport.as_str() {
            "stdio" => {
                let mut command = Command::new(&provider.record.target);
                command
                    .args(&provider.record.args)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .kill_on_drop(true);
                if provider.workspace.is_dir() {
                    command.current_dir(&provider.workspace);
                }
                if let (Some(name), Some(value)) = (&provider.record.credential_env, &credential) {
                    command.env(name, value);
                }
                #[cfg(windows)]
                command.creation_flags(0x0800_0000);
                self.group = Some(
                    processkit::ProcessGroup::new().map_err(|_| "MCP process group unavailable")?,
                );
                let child = self
                    .group
                    .as_ref()
                    .ok_or("MCP process group unavailable")?
                    .spawn(command)
                    .map_err(|_| "MCP process could not start")?;
                self.child = Some(child);
                let process = self.child.as_mut().ok_or("MCP process unavailable")?;
                let stdout = process.stdout.take().ok_or("MCP stdout unavailable")?;
                let stdin = process.stdin.take().ok_or("MCP stdin unavailable")?;
                ().serve((stdout, stdin))
                    .await
                    .map_err(|_| "MCP initialization failed")?
            }
            "http" => {
                let mut config =
                    StreamableHttpClientTransportConfig::with_uri(provider.record.target.clone());
                if let Some(value) = credential {
                    config = config.auth_header(value);
                }
                ().serve(StreamableHttpClientTransport::from_config(config))
                    .await
                    .map_err(|_| "MCP initialization failed")?
            }
            _ => return Err("Unsupported MCP transport".to_owned()),
        };
        self.client = Some(client);
        Ok(())
    }
    async fn discover(&mut self, namespace: &str, label: &str) -> Result<(), String> {
        // Enumerate bounded pages; a cyclic or unbounded server cannot fill the catalog.
        let client = self.client.as_ref().ok_or("MCP client unavailable")?;
        let mut cursor = None;
        let mut cursors = BTreeSet::new();
        loop {
            let page = client
                .list_tools(cursor.map(|cursor| {
                    rmcp::model::PaginatedRequestParams::default().with_cursor(Some(cursor))
                }))
                .await
                .map_err(|_| "MCP tool discovery failed")?;
            if self.definitions.len() + page.tools.len() > 2048 {
                return Err("MCP provider exceeds 2048 tools".into());
            }
            for tool in page.tools {
                if self
                    .bindings
                    .values()
                    .any(|name| name == tool.name.as_ref())
                {
                    return Err("MCP provider repeated a tool name".into());
                }
                let name = unique_name(namespace, tool.name.as_ref(), &self.bindings);
                let definition = CapabilityDefinition {
                    name: name.clone(),
                    description: tool.description.map_or_else(
                        || format!("{label} tool {}", tool.name),
                        std::borrow::Cow::into_owned,
                    ),
                    input_schema: Value::Object((*tool.input_schema).clone()),
                };
                if ovule_agent_api::serialized_size_up_to(&definition, 128_000)
                    .map_err(|_| "MCP schema encoding failed")?
                    > 128_000
                {
                    return Err("MCP tool definition exceeds 128,000 bytes".into());
                }
                self.definitions.push(definition);
                self.bindings.insert(name, tool.name.into_owned());
            }
            match page.next_cursor {
                Some(next) if cursors.insert(next.clone()) => cursor = Some(next),
                Some(_) => return Err("MCP tool discovery repeated a cursor".into()),
                None => break,
            }
        }
        Ok(())
    }
}
impl Drop for McpLease {
    fn drop(&mut self) {
        // Synchronous fallback for aborted acquisition/Attempt tasks. Normal paths await close.
        if let Some(client) = &self.client {
            client.cancellation_token().cancel();
        }
        self.group.take();
        if let Some(child) = &mut self.child {
            let _ = child.start_kill();
        }
    }
}
#[async_trait]
impl CapabilityProvider for McpProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: format!("mcp:{}", self.record.id),
            description: format!(
                "MCP service {}. Acquire to connect and discover its tools.",
                self.record.label
            ),
        }
    }
    async fn acquire(
        &self,
        cancellation: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        if cancellation.is_cancelled() {
            return Err("MCP acquisition cancelled".into());
        }
        let credential = self
            .record
            .credential_env
            .as_ref()
            .map(|name| std::env::var(name).map_err(|_| "MCP credential is unavailable".to_owned()))
            .transpose()?;
        let mut lease = McpLease::empty();
        let initialized: Result<(), String> = async {
            lease.connect(self, credential).await?;
            lease.discover(&self.namespace, &self.record.label).await?;
            Ok(())
        }
        .await;
        if let Err(error) = initialized {
            let _ = lease.close().await;
            return Err(error);
        }
        Ok(Box::new(lease))
    }
}
#[async_trait]
impl CapabilityLease for McpLease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        self.definitions.clone()
    }
    async fn invoke(
        &mut self,
        name: &str,
        arguments: &Value,
        cancellation: CancellationToken,
    ) -> Result<Value, ProviderError> {
        let tool = self
            .bindings
            .get(name)
            .ok_or_else(|| ProviderError::Tool("Unknown MCP tool".into()))?;
        let arguments = arguments
            .as_object()
            .ok_or_else(|| ProviderError::Tool("MCP arguments must be a JSON object".into()))?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| ProviderError::Unavailable("MCP client closed".into()))?;
        let result = tokio::select! {biased;
            ()=cancellation.cancelled()=>return Err(ProviderError::Unavailable("MCP call cancelled; side effects may be uncertain".into())),
            result=client.call_tool(CallToolRequestParams::new(tool.clone()).with_arguments(arguments.clone()))=>result.map_err(call_error)?,
        };
        let value = serde_json::to_value(result).map_err(|e| ProviderError::Tool(e.to_string()))?;
        if ovule_agent_api::serialized_size_up_to(&value, 512 * 1024)
            .map_err(|e| ProviderError::Tool(e.to_string()))?
            > 512 * 1024
        {
            return Err(ProviderError::Tool(
                "MCP result exceeded the 512 KiB safety limit".into(),
            ));
        }
        Ok(value)
    }
    async fn close(&mut self) -> Result<(), String> {
        let mut settled = true;
        if let Some(client) = &self.client {
            client.cancellation_token().cancel();
        }
        // ProcessGroup owns the platform containment boundary. Escaped descendants
        // remain outside this guarantee; Drop always attempts the hard kill too.
        if let Some(group) = self.group.take() {
            settled &= group.kill_all().is_ok();
            drop(group);
        }
        if let Some(child) = &mut self.child {
            let _ = child.start_kill();
            settled &= child.wait().await.is_ok();
        }
        self.child.take();
        if let Some(client) = &mut self.client {
            settled &= matches!(
                client.close_with_timeout(Duration::from_secs(1)).await,
                Ok(Some(_))
            );
        }
        self.client.take();
        if settled {
            Ok(())
        } else {
            Err("MCP cleanup could not confirm process or HTTP session closure".into())
        }
    }
}
fn call_error(error: rmcp::service::ServiceError) -> ProviderError {
    match error {
        rmcp::service::ServiceError::McpError(error) => ProviderError::Tool(error.to_string()),
        _ => {
            ProviderError::Unavailable("MCP transport failed; side effects may be uncertain".into())
        }
    }
}
fn unique_name(namespace: &str, tool: &str, existing: &BTreeMap<String, String>) -> String {
    let sanitize = |value: &str| {
        value
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    let base = format!("{}_{}", namespace, sanitize(tool));
    let mut name = base.chars().take(60).collect::<String>();
    let mut suffix = 2;
    while existing.contains_key(&name) {
        let tail = format!("_{suffix}");
        name = base.chars().take(64 - tail.len()).collect();
        name.push_str(&tail);
        suffix += 1;
    }
    name
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use ovule_agent::harness::{CapabilityRegistry, DISCOVERY_TOOL, ProviderLimits};
    use ovule_agent_api::WorkerEventCallback;
    use serde_json::json;
    struct Fixture {
        root: tempfile::TempDir,
        provider: Arc<dyn CapabilityProvider>,
    }
    impl Fixture {
        fn new(mode: &str) -> Self {
            let root = tempfile::tempdir().unwrap();
            let python = which::which("python3").expect("MCP stdio fixture requires python3");
            let record = McpProviderSpec {
                id: "fixture".into(),
                label: "fixture".into(),
                transport: "stdio".into(),
                target: python.to_string_lossy().into(),
                args: vec![
                    format!(
                        "{}/tests/fixtures/mcp_provider.py",
                        env!("CARGO_MANIFEST_DIR")
                    ),
                    mode.into(),
                    root.path().join("pid").to_string_lossy().into(),
                    root.path().join("events").to_string_lossy().into(),
                ],
                credential_env: None,
            };
            let provider = providers(&[record], root.path()).pop().unwrap();
            Self { root, provider }
        }
        fn alive(&self) -> bool {
            let pid = std::fs::read_to_string(self.root.path().join("pid")).unwrap();
            std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        }
        async fn wait_for(&self, phase: &str) {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if std::fs::read_to_string(self.root.path().join("events"))
                        .unwrap_or_default()
                        .contains(phase)
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
        }
        async fn assert_reaped(&self) {
            tokio::time::timeout(Duration::from_secs(5), async {
                while self.alive() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("MCP fixture process must be killed and reaped");
        }
    }
    fn registry(
        provider: Arc<dyn CapabilityProvider>,
        cancel: CancellationToken,
    ) -> CapabilityRegistry {
        let notify: WorkerEventCallback = Arc::new(|_| {});
        let execution = Arc::new(ovule_agent::execution::ToolExecutor::new(
            "mcp-fixture".into(),
            cancel,
            ovule_agent::execution::approval::ApprovalBroker::unavailable(),
            notify.clone(),
        ));
        CapabilityRegistry::new(
            vec![provider],
            execution,
            notify,
            ProviderLimits {
                acquire: Duration::from_secs(2),
                close: Duration::from_secs(2),
            },
        )
        .unwrap()
    }
    async fn acquire(registry: &mut CapabilityRegistry) -> Result<Value, String> {
        registry
            .invoke(
                DISCOVERY_TOOL,
                &json!({"action":"acquire","provider":"mcp:fixture"}),
                &BTreeSet::from([DISCOVERY_TOOL.into()]),
            )
            .await
    }
    #[tokio::test]
    async fn stdio_metadata_never_starts_and_close_reaps_the_acquired_process() {
        let fixture = Fixture::new("healthy");
        let mut registry = registry(fixture.provider.clone(), CancellationToken::new());
        registry
            .invoke(
                DISCOVERY_TOOL,
                &json!({"action":"search"}),
                &BTreeSet::from([DISCOVERY_TOOL.into()]),
            )
            .await
            .unwrap();
        assert!(!fixture.root.path().join("pid").exists());
        acquire(&mut registry).await.unwrap();
        assert!(fixture.alive());
        let events = std::fs::read_to_string(fixture.root.path().join("events")).unwrap();
        assert!(events.contains("tools/list"));
        assert!(!events.contains("tools/call"));
        acquire(&mut registry).await.unwrap();
        registry.shutdown().await.unwrap();
        fixture.assert_reaped().await;
    }
    #[tokio::test]
    async fn cancellation_during_initialize_or_list_reclaims_partial_process() {
        for mode in ["initialize_hang", "list_hang"] {
            let fixture = Fixture::new(mode);
            let cancel = CancellationToken::new();
            let mut registry = registry(fixture.provider.clone(), cancel.clone());
            let request = acquire(&mut registry);
            let trigger = async {
                fixture
                    .wait_for(if mode == "initialize_hang" {
                        "initialize"
                    } else {
                        "tools/list"
                    })
                    .await;
                cancel.cancel();
            };
            let (result, ()) = tokio::join!(request, trigger);
            assert!(result.is_err());
            registry.shutdown().await.unwrap();
            fixture.assert_reaped().await;
        }
    }
    #[tokio::test]
    async fn acquire_deadline_reclaims_initialized_but_unlisted_process() {
        let fixture = Fixture::new("list_hang");
        let mut registry = registry(fixture.provider.clone(), CancellationToken::new());
        // The production registry deadline bounds the whole initialize/list sequence.
        let result = tokio::time::timeout(Duration::from_secs(5), acquire(&mut registry))
            .await
            .unwrap();
        assert!(result.is_err());
        fixture.assert_reaped().await;
        registry.shutdown().await.unwrap();
    }
    #[tokio::test]
    async fn repeated_cursor_failure_reaps_process_and_does_not_reconnect() {
        let fixture = Fixture::new("cycle");
        let mut registry = registry(fixture.provider.clone(), CancellationToken::new());
        assert!(acquire(&mut registry).await.is_err());
        fixture.assert_reaped().await;
        let previous = std::fs::read_to_string(fixture.root.path().join("pid")).unwrap();
        assert!(acquire(&mut registry).await.is_err());
        assert_eq!(
            std::fs::read_to_string(fixture.root.path().join("pid")).unwrap(),
            previous
        );
        registry.shutdown().await.unwrap();
    }
    #[tokio::test]
    async fn dropped_ready_registry_reclaims_stdio_process() {
        let fixture = Fixture::new("healthy");
        let mut registry = registry(fixture.provider.clone(), CancellationToken::new());
        acquire(&mut registry).await.unwrap();
        drop(registry);
        fixture.assert_reaped().await;
    }
    #[tokio::test]
    async fn process_group_cleanup_reaches_descendants_on_shutdown_drop_and_cancel() {
        for path in ["shutdown", "drop", "cancel"] {
            let fixture = Fixture::new(if path == "cancel" {
                "tree_initialize_hang"
            } else {
                "tree"
            });
            let cancel = CancellationToken::new();
            let mut registry = registry(fixture.provider.clone(), cancel.clone());
            if path == "cancel" {
                let request = acquire(&mut registry);
                let trigger = async {
                    fixture.wait_for("initialize").await;
                    cancel.cancel();
                };
                assert!(tokio::join!(request, trigger).0.is_err());
            } else {
                acquire(&mut registry).await.unwrap();
            }
            if path == "shutdown" {
                registry.shutdown().await.unwrap();
            }
            drop(registry);
            fixture.assert_reaped().await;
            let pid = std::fs::read_to_string(fixture.root.path().join("pid.child")).unwrap();
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let state = std::process::Command::new("ps")
                        .args(["-p", pid.trim(), "-o", "stat="])
                        .output()
                        .unwrap();
                    let state = String::from_utf8_lossy(&state.stdout);
                    if state.trim().is_empty() || state.trim().starts_with('Z') {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("contained MCP descendant must stop");
        }
    }
    #[tokio::test]
    async fn stdio_tool_errors_preserve_connection_and_cancelled_calls_are_reclaimed() {
        for mode in ["tool_error", "protocol_error", "disconnect", "call_hang"] {
            let fixture = Fixture::new(mode);
            let cancel = CancellationToken::new();
            let mut lease = fixture.provider.acquire(cancel.clone()).await.unwrap();
            let name = lease.definitions()[0].name.clone();
            let arguments = json!({});
            let request = lease.invoke(&name, &arguments, cancel.clone());
            let trigger = async {
                if mode == "call_hang" {
                    fixture.wait_for("tools/call").await;
                    cancel.cancel();
                }
            };
            let (result, ()) = tokio::join!(request, trigger);
            if mode == "tool_error" {
                assert_eq!(result.unwrap()["isError"], true);
                assert!(fixture.alive());
            } else if mode == "protocol_error" {
                assert!(matches!(result, Err(ProviderError::Tool(_))));
                assert!(fixture.alive());
            } else {
                assert!(matches!(result, Err(ProviderError::Unavailable(_))));
            }
            lease.close().await.unwrap();
            fixture.assert_reaped().await;
        }
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use rmcp::{
        ServerHandler,
        model::{ServerCapabilities, ServerConfig},
        transport::{
            StreamableHttpServerConfig, StreamableHttpService,
            streamable_http_server::session::local::LocalSessionManager,
        },
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Handler(Arc<AtomicUsize>);
    impl Drop for Handler {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    impl ServerHandler for Handler {
        fn get_info(&self) -> ServerConfig {
            ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
        }
    }
    #[tokio::test]
    #[ignore = "requires local HTTP listener"]
    #[allow(deprecated)]
    async fn http_provider_is_lazy_and_close_deletes_the_remote_session() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
        let active = Arc::new(AtomicUsize::new(0));
        let opened = Arc::new(AtomicUsize::new(0));
        let capture = active.clone();
        let count = opened.clone();
        let service: StreamableHttpService<Handler, LocalSessionManager> =
            StreamableHttpService::new(
                move || {
                    capture.fetch_add(1, Ordering::SeqCst);
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok(Handler(capture.clone()))
                },
                Arc::default(),
                StreamableHttpServerConfig::default().with_sse_keep_alive(None),
            );
        let stop = CancellationToken::new();
        let shutdown = stop.clone();
        let server = tokio::spawn(async move {
            axum::serve(listener, axum::Router::new().nest_service("/mcp", service))
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
                .unwrap();
        });
        let record = McpProviderSpec {
            id: "http-fixture".into(),
            label: "HTTP fixture".into(),
            transport: "http".into(),
            target: endpoint,
            args: vec![],
            credential_env: None,
        };
        let provider = providers(&[record], std::path::Path::new("."))
            .pop()
            .unwrap();
        assert!(provider.definitions().is_empty());
        assert_eq!(opened.load(Ordering::SeqCst), 0);
        let mut lease = tokio::time::timeout(
            Duration::from_secs(5),
            provider.acquire(CancellationToken::new()),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(opened.load(Ordering::SeqCst) > 0);
        assert!(active.load(Ordering::SeqCst) > 0);
        lease.close().await.unwrap();
        drop(lease);
        tokio::time::timeout(Duration::from_secs(5), async {
            while active.load(Ordering::SeqCst) > 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("MCP session must close");
        stop.cancel();
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
    }
}
