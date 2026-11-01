//! Channel delivery, pairing, and worker lifecycle contracts.
mod extension_worker_source;
#[cfg(feature = "framework")]
mod framework;
mod workspace_adapters;

pub trait ChannelToolHost: Send + Sync {
    fn invoke(&self, attempt_id: &str, tool: &str, arguments: &Value) -> Result<Value, String>;
}

use ovule_conversation as conversation;
pub use ovule_conversation::messages::ChannelStatusProvider;
use ovule_extensions as extensions;
use ovule_secrets as secret_store;
use ovule_toolchains as toolchains;
use ovule_workspace::state;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead as _, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use crate::conversation::{ConversationIngress, WorkerEvent, WorkerEventCallback, WorkerOutcome};

use crate::secret_store::SecretStore;
use ovule_platform::resources::ensure_default_workspace_path;

pub const CHANNEL_TYPE: &str = "channel";
const DEFAULT_CONNECTION_ID: &str = "default";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_DELIVERY_ATTEMPTS: u32 = 8;

mod service;
mod status;
pub use status::ChannelStatusState;

pub use configuration::{ChannelConfiguration, ChannelConfigurationRecord};
pub use control::ChannelControl;
pub use conversation_state::{
    ChannelConversationState, ChannelInboundAcceptance, ChannelInboundMessage,
};
pub use outbox::{ChannelDelivery, ChannelOutbox, ChannelReplyTarget};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // Flat booleans are part of the renderer-facing status wire shape.
pub struct ChannelStatus {
    pub connection_id: String,
    pub bound_thread_id: Option<String>,
    pub configured: bool,
    pub enabled: bool,
    pub connected: bool,
    pub provisioned: bool,
    pub state: String,
    pub region: String,
    pub app_id_hint: String,
    pub detail: String,
    pub bot_name: Option<String>,
    pub bot_open_id: Option<String>,
    pub setup_url: Option<String>,
    pub setup_expires_at_ms: Option<i64>,
    pub owner_paired: bool,
    pub pairing_code: Option<String>,
    pub last_message_at_ms: Option<i64>,
    pub last_agent_attempt_at_ms: Option<i64>,
    pub last_delivery_at_ms: Option<i64>,
}

impl Default for ChannelStatus {
    fn default() -> Self {
        Self {
            connection_id: DEFAULT_CONNECTION_ID.to_owned(),
            bound_thread_id: None,
            configured: false,
            enabled: false,
            connected: false,
            provisioned: false,
            state: "not_configured".to_owned(),
            region: String::new(),
            app_id_hint: String::new(),
            detail: "Enter a bot App ID and App Secret to connect.".to_owned(),
            bot_name: None,
            bot_open_id: None,
            setup_url: None,
            setup_expires_at_ms: None,
            owner_paired: false,
            pairing_code: None,
            last_message_at_ms: None,
            last_agent_attempt_at_ms: None,
            last_delivery_at_ms: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelOverview {
    pub selected_connection_id: Option<String>,
    pub connections: Vec<ChannelStatus>,
    pub threads: Vec<configuration::ChannelThreadOption>,
}

struct ChannelHost {
    handle: ChannelHandle,
    thread: Option<thread::JoinHandle<()>>,
}

pub struct ChannelHostContext {
    pub status_state: Arc<ChannelStatusState>,
    pub data_root: PathBuf,
    pub secrets: Arc<dyn SecretStore>,
    pub managed_toolchains: PathBuf,
    pub conversation_state: Arc<dyn ChannelConversationState>,
    pub configuration: Arc<dyn ChannelConfiguration>,
    pub outbox: Arc<dyn ChannelOutbox>,
    pub conversations: Arc<dyn ConversationIngress>,
    pub events: Arc<dyn ChannelEvents>,
    pub extensions: Arc<dyn ChannelWorkerSource>,
}

#[derive(Clone)]
struct ChannelHandle {
    commands: mpsc::SyncSender<RuntimeCommand>,
    statuses: Arc<Mutex<BTreeMap<String, ChannelStatus>>>,
    configuration: Arc<dyn ChannelConfiguration>,
    secrets: Arc<dyn SecretStore>,
}

enum RuntimeCommand {
    Configure {
        connection_id: String,
        app_id: String,
        app_secret: String,
        region: String,
        owner_id: Option<String>,
        provisioned: bool,
        reply: Option<mpsc::SyncSender<Result<ChannelStatus, String>>>,
    },
    StartRegistration {
        connection_id: String,
        app_id: Option<String>,
        reuse_existing: bool,
    },
    Refresh {
        connection_id: String,
    },
    RegistrationCompleted {
        connection_id: String,
        app_id: String,
        app_secret: String,
        region: String,
    },
    SendPairingConfirmation {
        connection_id: String,
        conversation_id: String,
        reply_to_message_id: String,
        already_paired: bool,
    },
    Wake {
        connection_id: String,
    },
    SendProgress {
        connection_id: String,
        attempt_id: String,
        sequence: u64,
        text: String,
    },
    Shutdown,
}

#[derive(Deserialize)]
struct WorkerEnvelope {
    version: u32,
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    ok: Option<bool>,
    result: Option<Value>,
    error: Option<WorkerError>,
    event: Option<String>,
    payload: Option<Value>,
}

#[derive(Deserialize)]
struct WorkerError {
    code: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerInboundMessage {
    message_id: String,
    chat_id: String,
    chat_type: String,
    sender_id: String,
    sender_name: Option<String>,
    content: String,
    raw_content_type: String,
    thread_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_string_or_number")]
    create_time: Option<String>,
}

fn deserialize_optional_string_or_number<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<Value>::deserialize(deserializer)? {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(Value::Number(value)) => Ok(Some(value.to_string())),
        Some(_) => Err(serde::de::Error::custom(
            "expected a string, number, or null",
        )),
    }
}

struct WorkerProcess {
    child: Child,
    stdin: ChildStdin,
}

struct ConnectionRuntime {
    pending: PendingRequests,
    in_flight: Arc<Mutex<HashSet<String>>>,
    worker: Option<WorkerProcess>,
    next_id: u64,
    progress_messages: HashMap<String, String>,
}

struct MessageContext<'a> {
    state: &'a Arc<dyn ChannelConversationState>,
    default_workspace_path: &'a str,
    conversations: &'a Arc<dyn ConversationIngress>,
    events: &'a Arc<dyn ChannelEvents>,
    wake: &'a mpsc::SyncSender<RuntimeCommand>,
    statuses: &'a Mutex<BTreeMap<String, ChannelStatus>>,
    secrets: &'a dyn SecretStore,
    connection_id: &'a str,
}

impl Default for ConnectionRuntime {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            in_flight: Arc::new(Mutex::new(HashSet::new())),
            worker: None,
            next_id: 1,
            progress_messages: HashMap::new(),
        }
    }
}

type PendingRequests = Arc<Mutex<HashMap<String, mpsc::SyncSender<Result<Value, String>>>>>;

impl ChannelHost {
    pub fn new(context: ChannelHostContext) -> Result<Self, String> {
        let ChannelHostContext {
            status_state,
            data_root,
            secrets,
            managed_toolchains,
            conversation_state,
            configuration,
            outbox,
            conversations,
            events,
            extensions,
        } = context;
        let default_workspace_path = ensure_default_workspace_path(&data_root)?;
        let configured = configuration.connections()?;
        let initial = configured
            .iter()
            .map(|config| {
                let status = ChannelStatus {
                    connection_id: config.connection_id.clone(),
                    bound_thread_id: configuration
                        .thread_target(&config.connection_id)
                        .ok()
                        .flatten(),
                    configured: true,
                    enabled: config.enabled,
                    connected: false,
                    provisioned: false,
                    state: if config.enabled {
                        "starting"
                    } else {
                        "disabled"
                    }
                    .to_owned(),
                    region: config.region.clone(),
                    app_id_hint: config.app_id_hint.clone(),
                    detail: if config.enabled {
                        "Restoring the Channel bot connection.".to_owned()
                    } else {
                        "Channel bot is configured but disabled.".to_owned()
                    },
                    ..ChannelStatus::default()
                };
                (config.connection_id.clone(), status)
            })
            .collect::<BTreeMap<_, _>>();
        let statuses = Arc::clone(&status_state.statuses);
        *lock(&statuses) = initial;
        let (commands, receiver) = mpsc::sync_channel(64);
        let runtime_statuses = Arc::clone(&statuses);
        let runtime_conversation_state = Arc::clone(&conversation_state);
        let runtime_configuration = Arc::clone(&configuration);
        let runtime_outbox = Arc::clone(&outbox);
        let runtime_conversations = Arc::clone(&conversations);
        let runtime_events = events.clone();
        let runtime_commands = commands.clone();
        let runtime_secrets = Arc::clone(&secrets);
        let thread = thread::Builder::new()
            .name("ovule-channel-channel".to_owned())
            .spawn(move || {
                run_channel(ChannelRuntimeContext {
                    commands: receiver,
                    wake: runtime_commands,
                    statuses: runtime_statuses,
                    conversation_state: runtime_conversation_state,
                    configuration: runtime_configuration,
                    outbox: runtime_outbox,
                    default_workspace_path,
                    conversations: runtime_conversations,
                    events: runtime_events,
                    managed_toolchains,
                    secrets: runtime_secrets,
                    extensions,
                });
            })
            .map_err(|error| format!("start Channel channel runtime: {error}"))?;
        let handle = ChannelHandle {
            commands,
            statuses,
            configuration,
            secrets,
        };
        for connection_id in configured
            .into_iter()
            .filter(|config| config.enabled)
            .map(|config| config.connection_id)
        {
            if let Err(error) = handle.restore(&connection_id) {
                handle.set_error(&connection_id, &error);
            }
        }
        Ok(Self {
            handle,
            thread: Some(thread),
        })
    }

    #[must_use]
    pub fn handle(&self) -> ChannelHandle {
        self.handle.clone()
    }

    pub fn shutdown(&mut self) {
        let _ = self.handle.commands.send(RuntimeCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for ChannelHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl ChannelHandle {
    #[must_use]
    pub fn status(&self, selected: Option<&str>) -> ChannelOverview {
        // Do not hold the status mutex while consulting the workspace repository.
        let statuses = lock(&self.statuses).clone();
        let selected_connection_id = selected
            .filter(|id| statuses.contains_key(*id))
            .map(str::to_owned)
            .or_else(|| statuses.keys().next().cloned());
        ChannelOverview {
            selected_connection_id,
            connections: statuses
                .values()
                .cloned()
                .map(|mut status| {
                    status.bound_thread_id = self
                        .configuration
                        .thread_target(&status.connection_id)
                        .ok()
                        .flatten();
                    status
                })
                .collect(),
            threads: self.configuration.thread_options(),
        }
    }

    pub fn bind_thread(
        &self,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<ChannelOverview, String> {
        let connection_id = validate_connection_id(connection_id)?;
        self.configuration.bind_thread(&connection_id, thread_id)?;
        if let Some(status) = lock(&self.statuses).get_mut(&connection_id) {
            status.bound_thread_id = thread_id.map(str::to_owned);
        }
        Ok(self.status(Some(&connection_id)))
    }

    pub fn start_registration(
        &self,
        connection_id: &str,
        reuse_existing: bool,
    ) -> Result<ChannelOverview, String> {
        let connection_id = validate_connection_id(connection_id)?;
        let app_id = reuse_existing
            .then(|| self.secrets.load_channel(&connection_id))
            .transpose()?
            .flatten()
            .map(|value| value.app_id);
        self.queue_operation(
            &connection_id,
            "registering",
            RuntimeCommand::StartRegistration {
                connection_id: connection_id.clone(),
                app_id,
                reuse_existing,
            },
        )?;
        Ok(self.status(Some(&connection_id)))
    }

    pub fn refresh(&self, connection_id: &str) -> Result<ChannelOverview, String> {
        let connection_id = validate_connection_id(connection_id)?;
        if self.configuration.configuration(&connection_id)?.is_none()
            && !lock(&self.statuses).contains_key(&connection_id)
        {
            return Ok(self.status(Some(&connection_id)));
        }
        self.queue_operation(
            &connection_id,
            "refreshing",
            RuntimeCommand::Refresh {
                connection_id: connection_id.clone(),
            },
        )?;
        Ok(self.status(Some(&connection_id)))
    }

    // ShellAPI dispatch is serial. Never wait for the network worker here: doing so
    // can time out this request and every message command queued behind it.
    fn queue_operation(
        &self,
        connection_id: &str,
        state: &str,
        command: RuntimeCommand,
    ) -> Result<(), String> {
        {
            let mut statuses = lock(&self.statuses);
            let status = statuses
                .entry(connection_id.to_owned())
                .or_insert_with(|| status_for(connection_id));
            if matches!(status.state.as_str(), "registering" | "refreshing") {
                return Ok(());
            }
            state.clone_into(&mut status.state);
            "Checking the bot connection…".clone_into(&mut status.detail);
            if state == "registering" {
                status.setup_url = None;
                status.setup_expires_at_ms = None;
            }
        }
        self.commands.try_send(command).map_err(|error| {
            let message = format!("Could not queue Channel operation: {error}");
            self.set_error(connection_id, &message);
            message
        })
    }

    fn restore(&self, connection_id: &str) -> Result<(), String> {
        let credentials = self
            .secrets
            .load_channel(connection_id)?
            .ok_or_else(|| "encrypted Channel credentials are missing".to_owned())?;
        let region = self
            .configuration
            .configuration(connection_id)?
            .map_or_else(String::new, |config| config.region);
        self.commands
            .send(RuntimeCommand::Configure {
                connection_id: connection_id.to_owned(),
                app_id: credentials.app_id,
                app_secret: credentials.app_secret,
                owner_id: credentials.owner_id,
                provisioned: credentials.provisioned,
                region,
                reply: None,
            })
            .map_err(|_| "Channel channel runtime has stopped".to_owned())
    }

    fn set_error(&self, connection_id: &str, error: &str) {
        let mut statuses = lock(&self.statuses);
        let status = statuses
            .entry(connection_id.to_owned())
            .or_insert_with(|| status_for(connection_id));
        status.connected = false;
        "error".clone_into(&mut status.state);
        status.detail = error.chars().take(2_000).collect();
    }
}

#[allow(
    clippy::needless_pass_by_value,
    clippy::too_many_arguments,
    clippy::too_many_lines
)] // These owned handles define the resources held by the dedicated runtime thread.
mod configuration;
mod control;
mod conversation_state;
mod delivery;
mod outbox;
mod runtime;
mod worker;

use delivery::{
    accept_message, apply_connected_provisioning_status, connection_status, credential_hint,
    emit_status, flush_outbox, health_state_can_deliver, lock, now_millis, pairing_code,
    pairing_delivery_id, send_request, status_for, stop_worker, update_status,
    validate_connection_id,
};
use runtime::{ChannelRuntimeContext, run_channel};
use worker::spawn_worker;

#[cfg(test)]
mod tests;

pub use ovule_workspace::channel_repository as repository;

pub use ovule_extensions::runtime::ResolvedChannelWorker;
pub trait ChannelWorkerSource: Send + Sync {
    fn prepare_channel_worker(&self, channel_type: &str) -> Result<ResolvedChannelWorker, String>;
}
pub trait ChannelEvents: Send + Sync {
    fn status_changed(&self, payload: &[u8]) -> Result<(), String>;
}
/// The container owns this runtime; `Drop` stops workers before releasing dependencies.
pub trait ChannelRuntime: Send {
    fn control(&self) -> Arc<dyn ChannelControl>;
    fn shutdown(&mut self);
}
impl ChannelRuntime for ChannelHost {
    fn control(&self) -> Arc<dyn ChannelControl> {
        Arc::new(self.handle())
    }
    fn shutdown(&mut self) {
        ChannelHost::shutdown(self);
    }
}
pub trait ChannelIntegration:
    crate::ChannelStatusProvider + crate::extensions::ExtensionChannelActions
{
}
impl ChannelIntegration for service::ChannelService {}
pub type Channels = tuffite_ioc::Service<dyn ChannelIntegration>;
pub type ChannelRuntimeService = tuffite_ioc::Service<Mutex<Box<dyn ChannelRuntime>>>;
pub mod providers {
    /// Bind framework event delivery to the browser context.
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)?;

        Ok(())
    }

    /// Bind channel configuration to durable workspace storage.
    #[must_use]
    pub fn workspace_configuration(
        state: std::sync::Arc<ovule_workspace::WorkspaceSession>,
    ) -> std::sync::Arc<dyn crate::ChannelConfiguration> {
        std::sync::Arc::new(crate::workspace_adapters::WorkspaceChannelConfiguration::new(state))
    }
    /// Bind channel outbox operations to durable workspace storage.
    #[must_use]
    pub fn workspace_outbox(
        state: std::sync::Arc<ovule_workspace::WorkspaceSession>,
    ) -> std::sync::Arc<dyn crate::ChannelOutbox> {
        std::sync::Arc::new(crate::workspace_adapters::WorkspaceChannelOutbox::new(
            state,
        ))
    }
    /// Bind inbound acceptance to atomic workspace persistence and revision events.
    #[must_use]
    pub fn workspace_conversations(
        state: std::sync::Arc<ovule_workspace::WorkspaceSession>,
        events: std::sync::Arc<dyn ovule_workspace::WorkspaceEventSink>,
    ) -> std::sync::Arc<dyn crate::ChannelConversationState> {
        std::sync::Arc::new(
            crate::workspace_adapters::WorkspaceChannelConversations::new(state, events),
        )
    }

    use super::{
        Arc, ChannelControl, ChannelHost, ChannelHostContext, ChannelIntegration, ChannelRuntime,
        ChannelRuntimeService, Channels, Mutex, service,
    };
    use tuffite_ioc::Service;

    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<Channels, _, _>(|deps| {
            Ok(Arc::new(service::ChannelService::new(
                deps.depends_on::<tuffite_ioc::Service<dyn ChannelControl>>()?,
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::ChannelStatusProvider>,
            _,
            _,
        >(|deps| Ok(deps.depends_on::<Channels>()?)))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::extensions::ExtensionChannelActions>,
            _,
            _,
        >(|deps| Ok(deps.depends_on::<Channels>()?)))?;

        Ok(())
    }

    /// Register lazy runtime ownership and its independently replaceable workspace ports.
    pub fn register_runtime<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<Service<dyn crate::ChannelWorkerSource>, _, _>(|deps| {
            Ok(Arc::new(crate::extension_worker_source::ExtensionWorkerSource::new(
                deps.depends_on::<Service<dyn ovule_extensions::runtime::ExtensionWorkerRuntime>>()?,
            )))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::ChannelToolHost>,
            _,
            _,
        >(|deps| {
            Ok(Arc::new(
                crate::workspace_adapters::WorkspaceChannelTools::new(
                    deps.depends_on::<Service<ovule_workspace::WorkspaceSession>>()?,
                    deps.depends_on::<Service<crate::ChannelStatusState>>()?,
                ),
            ))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<crate::ChannelStatusState>,
            _,
            _,
        >(|_| {
            Ok(Arc::new(crate::ChannelStatusState::default()))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::ChannelConfiguration>,
            _,
            _,
        >(|deps| {
            Ok(workspace_configuration(
                deps.depends_on::<Service<ovule_workspace::WorkspaceSession>>()?,
            ))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::ChannelOutbox>,
            _,
            _,
        >(|deps| {
            Ok(workspace_outbox(
                deps.depends_on::<Service<ovule_workspace::WorkspaceSession>>()?,
            ))
        }))?;
        registrar.register(tuffite_ioc::factory::<
            Service<dyn crate::ChannelConversationState>,
            _,
            _,
        >(|deps| {
            Ok(workspace_conversations(
                deps.depends_on::<Service<ovule_workspace::WorkspaceSession>>()?,
                deps.depends_on::<Service<dyn ovule_workspace::WorkspaceEventSink>>()?,
            ))
        }))?;
        registrar.register_eager(tuffite_ioc::factory::<ChannelRuntimeService, _, _>(
            |deps| {
                let context = ChannelHostContext {
                    status_state: deps.depends_on::<Service<crate::ChannelStatusState>>()?,
                    secrets: deps.depends_on::<Service<dyn crate::secret_store::SecretStore>>()?,
                    data_root: deps
                        .depends_on::<Service<ovule_workspace::WorkspaceDataRoot>>()?
                        .0
                        .clone(),
                    managed_toolchains: deps
                        .depends_on::<Service<ovule_toolchains::ToolchainRoot>>()?
                        .0
                        .clone(),
                    conversation_state: deps
                        .depends_on::<Service<dyn crate::ChannelConversationState>>()?,
                    configuration: deps.depends_on::<Service<dyn crate::ChannelConfiguration>>()?,
                    outbox: deps.depends_on::<Service<dyn crate::ChannelOutbox>>()?,
                    conversations: deps
                        .depends_on::<Service<dyn crate::conversation::ConversationIngress>>()?,
                    events: deps.depends_on::<Service<dyn crate::ChannelEvents>>()?,
                    extensions: deps.depends_on::<Service<dyn crate::ChannelWorkerSource>>()?,
                };
                Ok(Arc::new(Mutex::new(start(context)?)))
            },
        ))?;
        registrar.register(tuffite_ioc::factory::<Service<dyn ChannelControl>, _, _>(
            |deps| {
                let runtime = deps.depends_on::<ChannelRuntimeService>()?;
                let control = runtime
                    .lock()
                    .map_err(|_| "channel runtime owner lock poisoned".to_owned())?
                    .control();
                Ok(control)
            },
        ))?;

        Ok(())
    }
    pub fn start(context: ChannelHostContext) -> Result<Box<dyn ChannelRuntime>, String> {
        Ok(Box::new(ChannelHost::new(context)?))
    }
    #[must_use]
    pub fn integration(control: Arc<dyn ChannelControl>) -> Arc<dyn ChannelIntegration> {
        Arc::new(service::ChannelService::new(control))
    }
}

pub mod capability;
