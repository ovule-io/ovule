mod approval;
mod authorization;
pub(crate) mod capabilities;
pub mod context;
mod drivers;
#[cfg(feature = "native-framework")]
mod framework;
mod mcp;
mod model_config;
mod prompts;
pub mod providers;
mod support;
#[cfg(test)]
mod tests;
mod thought_stream;

use drivers::acp;
use mcp::computer;
use mcp::context as context_mcp;
use model_config::{deep_seek_api_base, ollama_openai_api_base};
#[cfg(test)]
use model_config::{normalize_ollama_openai_api_base, validate_deep_seek_api_base};
use ovule_agent::ModelTurn;
use ovule_agent::output::project_message_blocks;
#[cfg(test)]
use ovule_channels::capability::{channel_definitions, channel_dynamic_tools, snake_to_camel};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use support::{execution_prompt, lock_workers, summarize_error, summarize_output};

use processkit::{CancellationToken, Command, OutputBufferPolicy, Stdin};

use serde_json::Value;
use tokio::sync::Semaphore;

use ovule_conversation::{
    AgentSessionService, AttemptRegistered, WorkerEvent, WorkerEventCallback, WorkerOutcome,
};
use ovule_extensions::protocol::{FileEditorContribution, MessageBlockContribution};
use ovule_extensions::runtime::ExtensionAgentRuntime;
use ovule_hosts::WorkspaceTransportResolver;
use ovule_secrets::SecretStore;
use ovule_settings::catalog::ToolRecord;
use ovule_toolchains as toolchains;
use ovule_workspace::state::{AttemptSpec, external_path};

const MAX_CONCURRENT_WORKERS: usize = 4;
/// Trusted backend for `AgentDriver` adapters.
///
/// This type owns process creation, cancellation, limits, and probes. Bundled
/// JS/TS extensions prepare commands and normalize output through restricted V8
/// Utility sessions; they never receive raw process handles or secrets.
pub(crate) struct DriverHost {
    runtime: Option<tokio::runtime::Runtime>,
    active: Arc<AtomicBool>,
    approvals: Arc<ovule_agent::execution::approval::ApprovalBroker>,
    journal: Arc<Mutex<ovule_storage::journal::CallJournal>>,
    workers: Arc<Mutex<HashMap<String, CancellationToken>>>,
    capacity: Arc<Semaphore>,
    managed_toolchains: PathBuf,
    memory: Arc<ovule_memory::MemoryService>,
    browser: Arc<ovule_browser::BrowserBroker>,
    secrets: Arc<dyn SecretStore>,
    provider_assembly: Arc<capabilities::ProviderAssembly>,
    kernel: Arc<ovule_agent::AgentKernel>,
    transports: Arc<dyn WorkspaceTransportResolver>,
    extensions: Arc<dyn ExtensionAgentRuntime>,
    computer_use: Arc<dyn ovule_remoting::backend::ComputerUseHost>,
    computer_use_mcp: Option<computer::ComputerUseMcpServer>,
}

/// Cloneable scheduler handle used by background channel transports.
#[derive(Clone)]
pub(crate) struct DriverHandle {
    runtime: tokio::runtime::Handle,
    active: Arc<AtomicBool>,
    approvals: Arc<ovule_agent::execution::approval::ApprovalBroker>,
    journal: Arc<Mutex<ovule_storage::journal::CallJournal>>,
    workers: Arc<Mutex<HashMap<String, CancellationToken>>>,
    capacity: Arc<Semaphore>,
    managed_toolchains: PathBuf,
    memory: Arc<ovule_memory::MemoryService>,
    browser: Arc<ovule_browser::BrowserBroker>,
    secrets: Arc<dyn SecretStore>,
    provider_assembly: Arc<capabilities::ProviderAssembly>,
    kernel: Arc<ovule_agent::AgentKernel>,
    transports: Arc<dyn WorkspaceTransportResolver>,
    extensions: Arc<dyn ExtensionAgentRuntime>,
    computer_use: Arc<dyn ovule_remoting::backend::ComputerUseHost>,
    computer_use_mcp: Option<ovule_hosts::ComputerUseMcpEndpoint>,
}

struct PreparedWorker {
    execution: PreparedExecution,
    _artifacts: tempfile::TempDir,
    _context_server: Option<context_mcp::ContextServer>,
}

enum PreparedExecution {
    Acp(acp::AcpTurn),
}
struct OutputSequence {
    sequence: u64,
}
impl DriverHost {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)] // Explicit consumer ports avoid an aggregate app runtime dependency.
    pub fn new(
        managed_toolchains: PathBuf,
        memory: Arc<ovule_memory::MemoryService>,
        browser: Arc<ovule_browser::BrowserBroker>,
        secrets: Arc<dyn SecretStore>,
        provider_assembly: Arc<capabilities::ProviderAssembly>,
        kernel: Arc<ovule_agent::AgentKernel>,
        transports: Arc<dyn WorkspaceTransportResolver>,
        extensions: Arc<dyn ExtensionAgentRuntime>,
        computer_use: Arc<dyn ovule_remoting::backend::ComputerUseHost>,
    ) -> Result<Self, String> {
        let journal = Arc::new(Mutex::new(ovule_storage::journal::CallJournal::open(
            &managed_toolchains.join("agent-execution.sqlite"),
        )?));
        Self::new_with_journal(
            managed_toolchains,
            memory,
            browser,
            secrets,
            provider_assembly,
            kernel,
            transports,
            extensions,
            computer_use,
            journal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new_with_journal(
        managed_toolchains: PathBuf,
        memory: Arc<ovule_memory::MemoryService>,
        browser: Arc<ovule_browser::BrowserBroker>,
        secrets: Arc<dyn SecretStore>,
        provider_assembly: Arc<capabilities::ProviderAssembly>,
        kernel: Arc<ovule_agent::AgentKernel>,
        transports: Arc<dyn WorkspaceTransportResolver>,
        extensions: Arc<dyn ExtensionAgentRuntime>,
        computer_use: Arc<dyn ovule_remoting::backend::ComputerUseHost>,
        journal: Arc<Mutex<ovule_storage::journal::CallJournal>>,
    ) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ovule-agent")
            .enable_all()
            .build()
            .map_err(|error| format!("create Agent runtime: {error}"))?;
        let computer_use_mcp = if computer_use.is_supported() {
            Some(runtime.block_on(computer::ComputerUseMcpServer::start(&computer_use))?)
        } else {
            None
        };
        Ok(Self {
            runtime: Some(runtime),
            active: Arc::new(AtomicBool::new(true)),
            approvals: ovule_agent::execution::approval::ApprovalBroker::unavailable(),
            journal,
            workers: Arc::new(Mutex::new(HashMap::new())),
            capacity: Arc::new(Semaphore::new(MAX_CONCURRENT_WORKERS)),
            managed_toolchains,
            memory,
            browser,
            secrets,
            provider_assembly,
            kernel,
            transports,
            extensions,
            computer_use,
            computer_use_mcp,
        })
    }

    pub(crate) fn with_approvals(
        mut self,
        approvals: Arc<ovule_agent::execution::approval::ApprovalBroker>,
    ) -> Self {
        if let Some(server) = &self.computer_use_mcp {
            server.set_approvals(approvals.clone());
        }
        self.approvals = approvals;
        self
    }

    pub fn handle(&self) -> DriverHandle {
        DriverHandle {
            runtime: self
                .runtime
                .as_ref()
                .expect("DriverHost handle requested during shutdown")
                .handle()
                .clone(),
            active: Arc::clone(&self.active),
            approvals: self.approvals.clone(),
            journal: self.journal.clone(),
            workers: Arc::clone(&self.workers),
            capacity: Arc::clone(&self.capacity),
            managed_toolchains: self.managed_toolchains.clone(),
            memory: self.memory.clone(),
            browser: self.browser.clone(),
            secrets: Arc::clone(&self.secrets),
            provider_assembly: self.provider_assembly.clone(),
            kernel: self.kernel.clone(),
            transports: Arc::clone(&self.transports),
            extensions: Arc::clone(&self.extensions),
            computer_use: self.computer_use.clone(),
            computer_use_mcp: self
                .computer_use_mcp
                .as_ref()
                .map(computer::ComputerUseMcpServer::endpoint),
        }
    }

    pub fn computer_use_mcp_endpoint(&self) -> Option<ovule_hosts::ComputerUseMcpEndpoint> {
        self.computer_use_mcp
            .as_ref()
            .map(computer::ComputerUseMcpServer::endpoint)
    }
}

impl DriverHandle {
    fn ensure_active(&self) -> Result<(), String> {
        self.active
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "Agent runtime is shutting down".to_owned())
    }

    #[allow(clippy::too_many_lines)] // Reservation, preparation and cancellation form one lifecycle boundary.
    pub fn spawn(
        &self,
        spec: &AttemptSpec,
        registered: impl FnOnce() -> Result<(), String>,
        notify: impl Fn(WorkerEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        self.ensure_active()?;
        if spec.host_id == "local"
            && spec.driver != "ovule"
            && ovule_extensions::providers::resolve_extension_agent(&spec.driver)
                .map_err(|error| error.to_string())?
                .is_none()
        {
            return Err(format!("Unsupported ACP Agent: {}", spec.driver));
        }
        let attempt_id = spec.id.clone();
        let spec = spec.clone();
        let cancellation = CancellationToken::new();
        {
            let mut workers = lock_workers(&self.workers);
            match workers.entry(attempt_id.clone()) {
                std::collections::hash_map::Entry::Occupied(_) => {
                    return Err(format!(
                        "Attempt already has an active Worker: {attempt_id}"
                    ));
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(cancellation.clone());
                }
            }
        }
        if let Err(error) = registered() {
            lock_workers(&self.workers).remove(&attempt_id);
            return Err(error);
        }

        let workers = Arc::clone(&self.workers);
        let capacity = Arc::clone(&self.capacity);
        let notify: Arc<dyn Fn(WorkerEvent) + Send + Sync> = Arc::new(notify);
        let mut context = WorkerPreparationContext {
            execution: Arc::new(
                ovule_agent::execution::ToolExecutor::new(
                    attempt_id.clone(),
                    cancellation.clone(),
                    self.approvals.clone(),
                    notify.clone(),
                )
                .with_journal(Arc::new(JournalAdapter(self.journal.clone()))),
            ),
            managed_toolchains: self.managed_toolchains.clone(),
            memory: self.memory.clone(),
            browser: self.browser.clone(),
            provider_assembly: self.provider_assembly.clone(),
            kernel: self.kernel.clone(),
            secrets: Arc::clone(&self.secrets),
            transports: Arc::clone(&self.transports),
            extensions: Arc::clone(&self.extensions),
            computer_use: self.computer_use.clone(),
            local_computer_use_mcp: self.computer_use_mcp.clone(),
            remote_computer_use_mcp: None,
        };
        self.runtime.spawn(async move {
          let permit = tokio::select! {
            () = cancellation.cancelled() => {
              notify(WorkerEvent::Finished(cancelled_outcome(&attempt_id)));
              lock_workers(&workers).remove(&attempt_id);
              return;
            },
            permit = capacity.acquire_owned() => if let Ok(permit) = permit { permit } else {
                notify(WorkerEvent::Finished(failed_outcome(&attempt_id,"Agent scheduler closed")));
                lock_workers(&workers).remove(&attempt_id);
                return;
            }
          };
          let prepared_attempt_id = attempt_id.clone();
          if spec.host_id == "local" && !spec.structured_goal && spec.tools.iter().any(|tool| tool.enabled && tool.transport == "native-crd") {
            // Capability state starts unknown; probe on the worker, never block UI composition.
            let _ = tokio::time::timeout(Duration::from_secs(5), context.computer_use.refresh_capabilities()).await;
          }
          context.remote_computer_use_mcp =
            match resolve_remote_computer_use_mcp(&spec, &context.transports).await {
              Ok(endpoint) => endpoint,
              Err(error) => {
                notify(WorkerEvent::Finished(failed_outcome(
                  &prepared_attempt_id,
                  &error,
                )));
                lock_workers(&workers).remove(&prepared_attempt_id);
                return;
              }
            };
          let prepare_notify = Arc::clone(&notify);
          let worker = tokio::task::spawn_blocking(move || prepare_worker(&spec, &context, &prepare_notify))
            .await
            .map_err(|error| format!("Agent extension preparation failed: {error}"))
            .and_then(|result| result);
          let worker = match worker {
            Ok(worker) => worker,
            Err(error) => {
              notify(WorkerEvent::Diagnostic {attempt_id:prepared_attempt_id.clone(),kind:"harness/failed".into(),detail_json:serde_json::json!({"schema_version":1,"phase":"prepare","status":"failed","code":"assembly_failed"}).to_string()});
              notify(WorkerEvent::Finished(failed_outcome(
                &prepared_attempt_id,
                &error,
              )));
              lock_workers(&workers).remove(&prepared_attempt_id);
              return;
            }
          };
          let outcome = run_worker(
            &attempt_id,
            worker,
            cancellation,
            permit,
            Arc::clone(&notify),
          )
          .await;
          notify(WorkerEvent::Finished(outcome));
          lock_workers(&workers).remove(&attempt_id);
        });
        Ok(())
    }

    pub fn cancel(
        &self,
        attempt_id: &str,
        registered: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let token = lock_workers(&self.workers)
            .get(attempt_id)
            .cloned()
            .ok_or_else(|| format!("Attempt has no active Worker: {attempt_id}"))?;
        registered()?;
        token.cancel();
        Ok(())
    }
}

struct WorkerPreparationContext {
    execution: Arc<ovule_agent::execution::ToolExecutor>,
    managed_toolchains: PathBuf,
    memory: Arc<ovule_memory::MemoryService>,
    browser: Arc<ovule_browser::BrowserBroker>,
    provider_assembly: Arc<capabilities::ProviderAssembly>,
    kernel: Arc<ovule_agent::AgentKernel>,
    secrets: Arc<dyn SecretStore>,
    transports: Arc<dyn WorkspaceTransportResolver>,
    extensions: Arc<dyn ExtensionAgentRuntime>,
    computer_use: Arc<dyn ovule_remoting::backend::ComputerUseHost>,
    local_computer_use_mcp: Option<ovule_hosts::ComputerUseMcpEndpoint>,
    remote_computer_use_mcp: Option<ovule_hosts::ComputerUseMcpEndpoint>,
}

async fn resolve_remote_computer_use_mcp(
    spec: &AttemptSpec,
    transports: &Arc<dyn WorkspaceTransportResolver>,
) -> Result<Option<ovule_hosts::ComputerUseMcpEndpoint>, String> {
    if spec.host_id == "local"
        || !projects_tools_over_acp(spec)
        || !spec
            .tools
            .iter()
            .any(|tool| tool.enabled && tool.transport == "native-crd")
    {
        return Ok(None);
    }
    let transport = transports
        .resolve(spec.workspace_binding_id.as_deref(), &spec.workspace_path)
        .map_err(|error| error.to_string())?;
    transport
        .computer_use_mcp_endpoint()
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

impl AgentSessionService for DriverHandle {
    fn spawn(
        &self,
        spec: &AttemptSpec,
        registered: AttemptRegistered,
        notify: WorkerEventCallback,
    ) -> Result<(), String> {
        Self::spawn(self, spec, registered, move |event| notify(event))
    }

    fn cancel(&self, attempt_id: &str, registered: AttemptRegistered) -> Result<(), String> {
        Self::cancel(self, attempt_id, registered)
    }
}

impl DriverHandle {
    pub fn probe_executable(&self, executable: &Path, args: &[&str]) -> Result<String, String> {
        self.ensure_active()?;
        let output = self
            .runtime
            .block_on(
                Command::new(executable)
                    .args(args)
                    .create_no_window()
                    .stdin(Stdin::empty())
                    .timeout(Duration::from_secs(8))
                    .inactivity_timeout(Duration::from_secs(5))
                    .output_buffer(OutputBufferPolicy::bounded(1_000).with_max_bytes(512 * 1024))
                    .output_string(),
            )
            .map_err(|error| format!("probe command: {}", summarize_error(&error)))?;
        if output.is_success() {
            Ok(output.stdout().to_owned())
        } else {
            Err(summarize_output(
                output.stderr(),
                output.stdout(),
                "probe command failed",
            ))
        }
    }

    pub fn run_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        stdin: Option<String>,
        path: Option<&std::ffi::OsStr>,
    ) -> Result<String, String> {
        self.ensure_active()?;
        let mut command = Command::new(executable)
            .args(args)
            .create_no_window()
            .timeout(Duration::from_secs(90))
            .inactivity_timeout(Duration::from_secs(90))
            .output_buffer(OutputBufferPolicy::bounded(2_000).with_max_bytes(1024 * 1024));
        if let Some(path) = path {
            command = command.env("PATH", path);
        }
        command = command.stdin(stdin.map_or_else(Stdin::empty, Stdin::from_string));
        let output = self
            .runtime
            .block_on(command.output_string())
            .map_err(|error| format!("authorization command: {}", summarize_error(&error)))?;
        if output.is_success() {
            Ok([output.stdout(), output.stderr()]
                .into_iter()
                .filter(|part| !part.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n"))
        } else {
            Err(summarize_output(
                output.stderr(),
                output.stdout(),
                "authorization command failed",
            ))
        }
    }

    pub fn launch_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        path: Option<&std::ffi::OsStr>,
        protocol: ovule_extensions::protocol::AuthorizationProtocol,
    ) -> Result<Option<String>, String> {
        static NEXT_AUTHORIZATION: std::sync::atomic::AtomicU64 =
            std::sync::atomic::AtomicU64::new(0);
        self.ensure_active()?;
        protocol.validate()?;
        let executable = executable.to_path_buf();
        let args = args.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
        let path = path.map(std::ffi::OsStr::to_os_string);
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let cancellation = CancellationToken::new();
        let key = format!(
            "authorization-{}",
            NEXT_AUTHORIZATION.fetch_add(1, Ordering::Relaxed)
        );
        {
            let mut workers = lock_workers(&self.workers);
            for (id, token) in workers.iter() {
                if id.starts_with("authorization-") {
                    token.cancel();
                }
            }
            workers.insert(key.clone(), cancellation.clone());
        }
        let startup_cancellation = cancellation.clone();
        let workers = Arc::clone(&self.workers);
        self.runtime.spawn(async move {
            let result = tokio::select! {
                () = cancellation.cancelled() => Err("Authorization cancelled".to_owned()),
                result = tokio::time::timeout(Duration::from_mins(15), authorization::launch(executable, args, path, protocol, sender.clone())) =>
                    result.unwrap_or_else(|_| Err("Authorization timed out; start sign-in again".to_owned())),
            };
            if let Err(error) = result { let _ = sender.try_send(Err(error)); }
            lock_workers(&workers).remove(&key);
        });
        if let Ok(result) = receiver.recv_timeout(Duration::from_secs(20)) {
            result.map(Some)
        } else {
            startup_cancellation.cancel();
            Err("Authorization process did not provide a sign-in URL within 20 seconds".to_owned())
        }
    }
}

impl DriverHost {
    pub fn shutdown(&mut self, timeout: Duration) {
        self.active.store(false, Ordering::Release);
        self.computer_use_mcp.take();
        let tokens: Vec<CancellationToken> =
            lock_workers(&self.workers).values().cloned().collect();
        for token in tokens {
            token.cancel();
        }
        let deadline = Instant::now() + timeout;
        while !lock_workers(&self.workers).is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_timeout(timeout);
        }
    }
}

#[allow(clippy::too_many_lines)]
async fn run_worker(
    attempt_id: &str,
    worker: PreparedWorker,
    cancellation: CancellationToken,
    permit: tokio::sync::OwnedSemaphorePermit,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> WorkerOutcome {
    let PreparedWorker {
        execution,
        _artifacts,
        _context_server,
    } = worker;
    match execution {
        PreparedExecution::Acp(turn) => {
            let outcome =
                acp::run_acp_agent(attempt_id, turn, cancellation, Arc::clone(&notify)).await;
            drop(permit);
            outcome
        }
    }
}

fn available_message_blocks() -> Result<Vec<MessageBlockContribution>, String> {
    ovule_extensions::providers::load_extensions()
        .map_err(|error| format!("load extension Message Blocks: {error}"))
        .map(|packages| {
            packages
                .into_iter()
                .flat_map(|package| package.manifest.contributes.message_blocks)
                .chain(ovule_extensions::protocol::host::contributions().message_blocks)
                .collect()
        })
}

fn available_file_editors() -> Result<Vec<FileEditorContribution>, String> {
    ovule_extensions::providers::load_extensions()
        .map_err(|error| format!("load extension File Editors: {error}"))
        .map(|packages| {
            packages
                .into_iter()
                .flat_map(|package| package.manifest.contributes.file_editors)
                .collect()
        })
}

fn file_editor_prompt(editors: &[FileEditorContribution]) -> String {
    let extensions = editors
        .iter()
        .flat_map(|editor| editor.extensions.iter())
        .map(|extension| format!(".{extension}"))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        include_str!("agent_host/prompts/file-editors.md"),
        extensions = extensions
    )
}

fn message_block_prompt(blocks: &[MessageBlockContribution]) -> String {
    let descriptions = blocks
        .iter()
        .map(|block| {
            let example = serde_json::json!({
                "id": format!("{}-1", block.kind),
                "kind": block.kind,
                "data": &block.example,
            });
            format!(
                "- kind `{}`: {} Example payload: {}",
                block.kind, block.agent_instructions, example
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        include_str!("agent_host/prompts/message-blocks.md"),
        descriptions = descriptions
    )
}

fn acp_mcp_servers(
    tools: &[ToolRecord],
    allow_credentials: bool,
    project_native_crd: bool,
    computer_use_mcp: Option<&ovule_hosts::ComputerUseMcpEndpoint>,
) -> Result<Vec<agent_client_protocol::schema::v1::McpServer>, String> {
    use agent_client_protocol::schema::v1::{
        EnvVariable, HttpHeader, McpServer, McpServerHttp, McpServerStdio,
    };

    tools
        .iter()
        .filter(|tool| tool.enabled)
        .filter_map(|tool| match tool.transport.as_str() {
            "native-crd" => {
                if !project_native_crd {
                    return None;
                }
                Some(computer_use_mcp.map_or_else(
                    || Err("CRD Computer Use loopback MCP server is unavailable".to_owned()),
                    |endpoint| {
                        Ok(McpServer::Http(
                            McpServerHttp::new(&tool.label, &endpoint.url).headers(vec![
                                HttpHeader::new(
                                    "Authorization",
                                    format!("Bearer {}", endpoint.bearer_token),
                                ),
                            ]),
                        ))
                    },
                ))
            }
            "stdio" => {
                if tool.credential_env.is_some() && !allow_credentials {
                    return Some(Err(format!(
                        "MCP Tool {} uses a local credential and cannot be sent to a remote Agent",
                        tool.id
                    )));
                }
                let environment = match tool.credential_env.as_deref() {
                    Some(name) => match std::env::var(name) {
                        Ok(value) => vec![EnvVariable::new(name, value)],
                        Err(_) => {
                            return Some(Err(format!(
                                "MCP Tool {} requires environment variable {name}",
                                tool.id
                            )));
                        }
                    },
                    None => Vec::new(),
                };
                Some(Ok(McpServer::Stdio(
                    McpServerStdio::new(&tool.label, &tool.target)
                        .args(tool.args.clone())
                        .env(environment),
                )))
            }
            "http" => {
                if tool.credential_env.is_some() && !allow_credentials {
                    return Some(Err(format!(
                        "MCP Tool {} uses a local credential and cannot be sent to a remote Agent",
                        tool.id
                    )));
                }
                let headers = match tool.credential_env.as_deref() {
                    Some(name) => match std::env::var(name) {
                        Ok(value) => {
                            vec![HttpHeader::new("Authorization", format!("Bearer {value}"))]
                        }
                        Err(_) => {
                            return Some(Err(format!(
                                "MCP Tool {} requires environment variable {name}",
                                tool.id
                            )));
                        }
                    },
                    None => Vec::new(),
                };
                Some(Ok(McpServer::Http(
                    McpServerHttp::new(&tool.label, &tool.target).headers(headers),
                )))
            }
            transport => Some(Err(format!(
                "MCP Tool {} uses unsupported ACP transport {transport}",
                tool.id
            ))),
        })
        .collect()
}

fn projects_tools_over_acp(spec: &AttemptSpec) -> bool {
    spec.driver != "ovule" || spec.model_provider.as_deref() == Some("openai")
}

fn resolve_local_toolchains(
    tools: &[ToolRecord],
    managed_toolchains: &Path,
) -> Result<Vec<ToolRecord>, String> {
    tools
        .iter()
        .filter_map(|tool| {
            if !tool.enabled {
                return None;
            }
            let Some(toolchain_id) = tool.toolchain_id.as_deref() else {
                return Some(Ok(tool.clone()));
            };
            let Some(executable) = toolchains::resolve(toolchain_id, managed_toolchains) else {
                return tool.required.then(|| {
                    Err(format!(
                        "Toolchain {toolchain_id} required by Tool {} is not installed; install it from Manage > Toolchains",
                        tool.label
                    ))
                });
            };
            let mut resolved = tool.clone();
            resolved.target = executable.to_string_lossy().into_owned();
            Some(Ok(resolved))
        })
        .collect()
}
fn cancelled_outcome(attempt_id: &str) -> WorkerOutcome {
    WorkerOutcome {
        attempt_id: attempt_id.to_owned(),
        status: "cancelled".to_owned(),
        summary: "Generation stopped".to_owned(),
    }
}

fn failed_outcome(attempt_id: &str, summary: &str) -> WorkerOutcome {
    WorkerOutcome {
        attempt_id: attempt_id.to_owned(),
        status: "failed".to_owned(),
        summary: summary.to_owned(),
    }
}

#[allow(clippy::too_many_lines)]
fn prepare_worker(
    spec: &AttemptSpec,
    context: &WorkerPreparationContext,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
) -> Result<PreparedWorker, String> {
    let WorkerPreparationContext {
        execution,
        managed_toolchains,
        memory,
        browser,
        provider_assembly,
        kernel,
        secrets,
        transports,
        extensions,
        computer_use,
        local_computer_use_mcp,
        remote_computer_use_mcp,
    } = context;
    if spec.host_id != "local" && spec.workspace_binding_id.is_none() {
        return Err(format!(
            "Remote Host {} requires at least one attached Workspace",
            spec.host_id
        ));
    }
    if spec
        .workspaces
        .iter()
        .any(|workspace| workspace.host_id != spec.host_id)
    {
        return Err("an Attempt cannot attach Workspaces from different Hosts".to_owned());
    }
    if spec.host_id != "local"
        && spec
            .workspaces
            .iter()
            .any(|workspace| !host_path_is_absolute(&workspace.root))
    {
        return Err(
            "Remote Host Workspace has no absolute root; reconnect the Host and attach the Workspace again"
                .to_owned(),
        );
    }
    let transport = transports
        .resolve(spec.workspace_binding_id.as_deref(), &spec.workspace_path)
        .map_err(|error| error.to_string())?;
    let primary = spec.workspaces.first();
    let selected_root = primary.map_or(spec.workspace_path.as_str(), |binding| {
        binding.root.as_str()
    });
    let workspace = PathBuf::from(selected_root);
    if transport.kind() == ovule_hosts::TransportKind::Local && !workspace.is_dir() {
        return Err(format!("workspace disappeared: {}", workspace.display()));
    }
    let process_workspace = PathBuf::from(external_path(&workspace));
    let workspace_roots = if spec.workspaces.is_empty() {
        vec![acp::AcpWorkspaceRoot {
            id: "thread-default".to_owned(),
            root: process_workspace.clone(),
            transport: Arc::clone(&transport),
        }]
    } else {
        spec.workspaces
            .iter()
            .map(|binding| {
                transports
                    .resolve(Some(&binding.id), &binding.root)
                    .map(|binding_transport| acp::AcpWorkspaceRoot {
                        id: binding.id.clone(),
                        root: PathBuf::from(&binding.root),
                        transport: binding_transport,
                    })
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let additional_workspaces = primary.map_or_else(Vec::new, |primary| {
        spec.workspaces
            .iter()
            .skip(1)
            .filter(|binding| {
                binding.kind == primary.kind && binding.endpoint_id == primary.endpoint_id
            })
            .map(|binding| PathBuf::from(&binding.root))
            .collect()
    });
    let artifacts = tempfile::Builder::new()
        .prefix("ovule-attempt-")
        .tempdir()
        .map_err(|error| format!("create Agent artifact directory: {error}"))?;

    let message_blocks = if spec.source_message_id.is_some() && !spec.structured_goal {
        available_message_blocks()?
    } else {
        Vec::new()
    };
    let file_editors = if spec.source_message_id.is_some() && !spec.structured_goal {
        available_file_editors()?
    } else {
        Vec::new()
    };
    let message_block_kinds = message_blocks
        .iter()
        .map(|block| block.kind.clone())
        .collect::<BTreeSet<_>>();
    let trace_notify = notify.clone();
    let mut assembled = crate::agent_host::context::AssembledAttempt::assemble(
        crate::agent_host::context::AssemblyInput {
            attempt_id: &spec.id,
            thread_id: &spec.thread_id,
            project_id: spec.project_id.as_deref(),
            host_id: &spec.host_id,
            driver: &spec.driver,
            provider: spec.model_provider.as_deref(),
            local_transport: transport.kind() == ovule_hosts::TransportKind::Local,
            planning: spec.structured_goal,
            skill_paths: &spec.skill_paths,
            base_prompt: execution_prompt(spec, &message_blocks, &file_editors),
            context_budget_chars: 96_000,
        },
        memory.clone(),
        Some(Arc::new(move |trace| {
            trace_notify(WorkerEvent::Diagnostic {
                attempt_id: trace.attempt_id.clone(),
                kind: "harness/tool".into(),
                detail_json: serde_json::to_string(trace).unwrap_or_default(),
            });
        })),
    )?;
    let tools = if transport.kind() == ovule_hosts::TransportKind::Local {
        resolve_local_toolchains(&spec.tools, managed_toolchains)?
    } else {
        spec.tools.clone()
    };
    let computer_facade = ovule_hosts::capability::computer::ComputerUse::for_tools(
        computer_use,
        &transport,
        tools
            .iter()
            .any(|tool| tool.enabled && tool.transport == "native-crd"),
    );
    let projection = if assembled.manifest.route == crate::agent_host::context::DriverRoute::Rig {
        "rig_direct"
    } else if assembled.manifest.route == crate::agent_host::context::DriverRoute::LocalAcp {
        "attempt_http_mcp"
    } else {
        "host_http_mcp"
    };
    assembled.manifest.bindings.extend([
        crate::agent_host::context::CapabilityBinding {
            id: "browser-use".into(),
            projection: projection.into(),
            available: spec.host_id == "local" && !spec.structured_goal,
            reason: "Attempt-owned Explorer; DOM input, ephemeral partition, fresh document refs"
                .into(),
        },
        crate::agent_host::context::CapabilityBinding {
            id: "computer-use".into(),
            projection: projection.into(),
            available: computer_facade.is_some() && !spec.structured_goal,
            reason: "Selected CRD Tool and execution transport determine reachability".into(),
        },
        crate::agent_host::context::CapabilityBinding {
            id: "workspace-operations".into(),
            projection: if assembled.manifest.route == crate::agent_host::context::DriverRoute::Rig
            {
                "rig_direct"
            } else {
                "acp_client"
            }
            .into(),
            available: !spec.structured_goal,
            reason: "Bound to the Attempt's selected Workspace roots".into(),
        },
    ]);
    notify(WorkerEvent::Diagnostic {
        attempt_id: spec.id.clone(),
        kind: "harness/assembled".into(),
        detail_json: serde_json::to_string(&assembled.manifest).map_err(|e| e.to_string())?,
    });
    let context_tools = assembled.context;
    let browser_lease = if spec.host_id == "local"
        && !spec.structured_goal
        && assembled.manifest.route != crate::agent_host::context::DriverRoute::Rig
    {
        Some(browser.lease(&spec.id, &spec.thread_id)?)
    } else {
        None
    };
    let context_server = if assembled.manifest.route
        == crate::agent_host::context::DriverRoute::LocalAcp
        && !spec.structured_goal
    {
        Some(
            tokio::runtime::Handle::current().block_on(context_mcp::ContextServer::start(
                context_tools.clone(),
                browser_lease.clone(),
                computer_facade.clone(),
                notify.clone(),
                spec.id.clone(),
                execution.clone(),
            ))?,
        )
    } else {
        None
    };
    let prompt = assembled.prompt;
    let mut mcp_servers = if assembled.manifest.route
        == crate::agent_host::context::DriverRoute::Rig
    {
        Vec::new()
    } else {
        acp_mcp_servers(
            &tools,
            transport.kind() == ovule_hosts::TransportKind::Local,
            projects_tools_over_acp(spec) && transport.kind() != ovule_hosts::TransportKind::Local,
            if transport.kind() == ovule_hosts::TransportKind::Local {
                local_computer_use_mcp.as_ref()
            } else {
                remote_computer_use_mcp.as_ref()
            },
        )?
    };
    if let Some(server) = &context_server {
        use agent_client_protocol::schema::v1::{HttpHeader, McpServer, McpServerHttp};
        mcp_servers.push(McpServer::Http(
            McpServerHttp::new("Ovule Attempt context", &server.endpoint.url).headers(vec![
                HttpHeader::new(
                    "Authorization",
                    format!("Bearer {}", server.endpoint.bearer_token),
                ),
            ]),
        ));
    }
    let extension_provider = spec
        .model_provider
        .as_deref()
        .zip(spec.model_remote_id.as_deref())
        .map(|(provider, remote_id)| {
            ovule_extensions::providers::resolve_extension_model_provider(provider)
                .map_err(|error| error.to_string())
                .map(|package| package.map(|package| (package, remote_id.to_owned())))
        })
        .transpose()?
        .flatten();
    if spec.driver == "ovule"
        && (spec.model_provider.as_deref() == Some("ollama") || extension_provider.is_some())
    {
        let provider = spec.model_provider.as_deref().expect("provider matched");
        let (api_key, api_base, model) = if let Some((package, remote_id)) = extension_provider {
            let plan = extensions.prepare_model_provider(
                &package,
                provider,
                serde_json::json!({ "model": remote_id.clone() }),
            )?;
            if plan.provider != provider || plan.model != remote_id {
                return Err(
                    "model-provider extension returned a mismatched provider plan".to_owned(),
                );
            }
            let grant = package
                .declared_grant()
                .map_err(|error| error.to_string())?;
            grant
                .authorize(&ovule_extensions::protocol::HostRequest {
                    id: "provider-endpoint".to_owned(),
                    operation: ovule_extensions::protocol::HostOperation::HttpRequest {
                        method: "POST".to_owned(),
                        endpoint: format!(
                            "{}/chat/completions",
                            plan.api_base.trim_end_matches('/')
                        ),
                        body: Vec::new(),
                    },
                })
                .map_err(|error| error.to_string())?;
            grant
                .authorize(&ovule_extensions::protocol::HostRequest {
                    id: "provider-credential".to_owned(),
                    operation: ovule_extensions::protocol::HostOperation::SecretBind {
                        credential_reference: plan.credential_reference.clone(),
                        resource_id: provider.to_owned(),
                        field: "authorization".to_owned(),
                    },
                })
                .map_err(|error| error.to_string())?;
            let api_key = std::env::var_os(&plan.credential_reference)
                .map_or_else(
                    || secrets.load_provider_credential(&plan.credential_reference),
                    |value| Ok(Some(value)),
                )?
                .ok_or_else(|| format!("{} is not configured", plan.credential_reference))?
                .into_string()
                .map_err(|_| format!("{} is not valid UTF-8", plan.credential_reference))?;
            (
                api_key,
                if plan.provider == "deepseek"
                    && std::env::var_os("OVULE_TEST_DEEPSEEK_API_BASE").is_some()
                {
                    deep_seek_api_base()?
                } else {
                    plan.api_base
                },
                plan.model,
            )
        } else {
            let model = spec
                .model_remote_id
                .as_deref()
                .and_then(|model| model.strip_prefix("ollama:"))
                .ok_or_else(|| "Ovule Agent requires an Ollama Model".to_owned())?
                .to_owned();
            ("ollama".to_owned(), ollama_openai_api_base()?, model)
        };
        let capability_providers = if spec.structured_goal {
            Vec::new()
        } else {
            provider_assembly.build(
                &context_tools,
                &workspace_roots,
                computer_facade,
                &tools,
                &process_workspace,
                &spec.id,
                &spec.thread_id,
                spec.host_id == "local",
            )
        };
        return Ok(PreparedWorker {
            execution: PreparedExecution::Acp(acp::AcpTurn {
                execution: execution.clone(),
                server: acp::AcpServer::Rig {
                    kernel: kernel.clone(),
                    turn: ModelTurn {
                        execution: execution.clone(),
                        provider: provider.to_owned(),
                        api_key,
                        api_base,
                        model,
                        prompt: String::new(),
                        structured_goal: spec.structured_goal,
                        capability_providers,
                    },
                },
                workspace: process_workspace,
                additional_workspaces,
                workspace_roots,
                mcp_servers,
                prompt,
                emit_deltas: !spec.structured_goal,
                message_block_kinds: message_block_kinds.clone(),
            }),
            _artifacts: artifacts,
            _context_server: context_server,
        });
    }
    let extension_driver =
        if spec.driver == "ovule" && spec.model_provider.as_deref() == Some("openai") {
            "codex"
        } else {
            &spec.driver
        };
    let server =
        if transport.kind() == ovule_hosts::TransportKind::Tunnel && extension_driver != "ovule" {
            acp::AcpServer::Remote {
                agent_id: extension_driver.to_owned(),
                model_provider: spec.model_provider.clone(),
                model_remote_id: spec.model_remote_id.clone(),
                transport,
            }
        } else {
            let resolved = ovule_extensions::providers::resolve_extension_agent(extension_driver)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("Unsupported ACP Agent: {extension_driver}"))?;
            let plan = extensions.prepare_agent(
                &resolved.package,
                &resolved.contribution,
                serde_json::json!({
                    "agent": { "id": extension_driver },
                    "model": spec.model_remote_id.as_ref().map(|remote_id| serde_json::json!({
                        "remoteId": remote_id,
                        "provider": spec.model_provider,
                    })),
                }),
            )?;
            let command = if transport.kind() == ovule_hosts::TransportKind::Local {
                resolved
                    .contribution
                    .toolchain
                    .as_deref()
                    .and_then(|toolchain| toolchains::resolve(toolchain, managed_toolchains))
                    .or_else(|| {
                        plan.executable_candidates
                            .iter()
                            .find_map(|candidate| which::which(candidate).ok())
                    })
                    .ok_or_else(|| {
                        format!(
                            "ACP server is not installed: {}",
                            plan.executable_candidates.join(" or ")
                        )
                    })?
            } else {
                PathBuf::from(
                    plan.executable_candidates
                        .first()
                        .expect("validated Agent extension has an executable"),
                )
            };
            let launch = acp::AcpLaunchSpec {
                command,
                arguments: plan.args,
                environment: plan
                    .environment
                    .into_iter()
                    .map(|entry| (entry.name, entry.value))
                    .collect(),
            };
            acp::AcpServer::External { launch, transport }
        };
    Ok(PreparedWorker {
        execution: PreparedExecution::Acp(acp::AcpTurn {
            execution: execution.clone(),
            server,
            workspace: process_workspace,
            additional_workspaces,
            workspace_roots,
            mcp_servers,
            prompt,
            emit_deltas: !spec.structured_goal,
            message_block_kinds: message_block_kinds.clone(),
        }),
        _artifacts: artifacts,
        _context_server: context_server,
    })
}

fn host_path_is_absolute(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("\\\\")
        || value.as_bytes().get(1) == Some(&b':')
            && value
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
            && matches!(value.as_bytes().get(2), Some(b'\\' | b'/'))
}

impl ovule_setup::SetupAgentCommands for DriverHandle {
    fn probe_executable(&self, executable: &Path, args: &[&str]) -> Result<String, String> {
        DriverHandle::probe_executable(self, executable, args)
    }

    fn run_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        stdin: Option<String>,
        path: Option<&std::ffi::OsStr>,
    ) -> Result<String, String> {
        DriverHandle::run_authorization(self, executable, args, stdin, path)
    }

    fn launch_authorization(
        &self,
        executable: &Path,
        args: &[&str],
        path: Option<&std::ffi::OsStr>,
        protocol: ovule_extensions::protocol::AuthorizationProtocol,
    ) -> Result<Option<String>, String> {
        DriverHandle::launch_authorization(self, executable, args, path, protocol)
    }
}

impl Drop for DriverHost {
    fn drop(&mut self) {
        self.shutdown(Duration::from_secs(5));
    }
}

/// Container identity for the owned agent process lifecycle.
pub type AgentRuntimeService = tuffite_ioc::Service<Mutex<Box<dyn AgentRuntime>>>;

/// Session execution and trusted setup commands share the same process lifecycle.
pub trait AgentRuntimeSession:
    ovule_conversation::AgentSessionService + ovule_setup::SetupAgentCommands
{
}
impl AgentRuntimeSession for DriverHandle {}

/// Owned lifecycle capability for the agent scheduler and its MCP listener.
pub trait AgentRuntime: Send {
    fn sessions(&self) -> Arc<dyn AgentRuntimeSession>;
    fn computer_use_mcp_endpoint(&self) -> Option<ovule_hosts::ComputerUseMcpEndpoint>;
    fn stop(&mut self, timeout: Duration);
}
impl AgentRuntime for DriverHost {
    fn sessions(&self) -> Arc<dyn AgentRuntimeSession> {
        Arc::new(self.handle())
    }
    fn computer_use_mcp_endpoint(&self) -> Option<ovule_hosts::ComputerUseMcpEndpoint> {
        DriverHost::computer_use_mcp_endpoint(self)
    }
    fn stop(&mut self, timeout: Duration) {
        self.shutdown(timeout);
    }
}

pub type ExecutionJournalRuntime =
    tuffite_ioc::Service<std::sync::Mutex<ovule_storage::journal::CallJournal>>;
struct JournalAdapter(Arc<Mutex<ovule_storage::journal::CallJournal>>);
impl ovule_agent::execution::ExecutionJournal for JournalAdapter {
    fn begin(&self, call: &str, attempt: &str, tool: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Execution journal lock poisoned")?
            .begin(call, attempt, tool)
    }
    fn finish(&self, call: &str, state: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Execution journal lock poisoned")?
            .finish(call, state)
    }
}
fn effect_for_tool(name: &str, args: &Value) -> ovule_agent_api::ToolEffect {
    if name.starts_with("ovule_workspace_")
        || matches!(
            name,
            "ovule_skills" | "ovule_memory" | "ovule_browser" | "ovule_capabilities"
        )
        || (name == "ovule_computer_control"
            && args.get("action").and_then(Value::as_str) == Some("screenshot"))
    {
        ovule_agent_api::ToolEffect::Workspace
    } else {
        ovule_agent_api::ToolEffect::External
    }
}
