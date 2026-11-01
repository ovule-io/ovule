use super::{
    AgentOutput, BTreeSet, Component, Deserialize, MAX_ARGUMENTS, MAX_REQUEST_ID_BYTES,
    MAX_STRING_BYTES, Path, Serialize,
};

/// Identity authenticated when Rust opens an extension Utility session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionPrincipal {
    pub application_id: String,
    pub extension_id: String,
    pub extension_hash: String,
    pub session_id: String,
    pub workspace_id: Option<String>,
    pub attempt_id: Option<String>,
    pub connection_id: Option<String>,
}

/// Effective permissions after manifest, application policy, and user grants
/// are intersected by the trusted Host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionGrant {
    capabilities: BTreeSet<String>,
    executables: BTreeSet<String>,
    network_patterns: Vec<NetworkPattern>,
    credential_references: BTreeSet<String>,
    environment_names: BTreeSet<String>,
    max_payload_bytes: usize,
}

impl ExtensionGrant {
    /// Creates an immutable effective grant.
    pub fn new(
        capabilities: impl IntoIterator<Item = String>,
        executables: impl IntoIterator<Item = String>,
        network_patterns: impl IntoIterator<Item = String>,
        credential_references: impl IntoIterator<Item = String>,
        environment_names: impl IntoIterator<Item = String>,
        max_payload_bytes: usize,
    ) -> Result<Self, HostProtocolError> {
        if max_payload_bytes == 0 || max_payload_bytes > 256 * 1024 {
            return Err(HostProtocolError::InvalidGrant);
        }
        let capabilities = capabilities.into_iter().collect::<BTreeSet<_>>();
        let executables = executables.into_iter().collect::<BTreeSet<_>>();
        let network_patterns = network_patterns
            .into_iter()
            .map(|value| NetworkPattern::parse(&value))
            .collect::<Result<Vec<_>, _>>()?;
        let credential_references = credential_references.into_iter().collect::<BTreeSet<_>>();
        let environment_names = environment_names.into_iter().collect::<BTreeSet<_>>();
        if capabilities.iter().any(|value| !valid_token(value))
            || executables.iter().any(|value| !valid_executable(value))
            || credential_references
                .iter()
                .any(|value| !valid_token(value))
            || environment_names
                .iter()
                .any(|value| !valid_environment_name(value))
        {
            return Err(HostProtocolError::InvalidGrant);
        }
        Ok(Self {
            capabilities,
            executables,
            network_patterns,
            credential_references,
            environment_names,
            max_payload_bytes,
        })
    }

    /// Validates one untrusted extension request before any resource is touched.
    pub fn authorize(&self, request: &HostRequest) -> Result<(), HostProtocolError> {
        if request.id.is_empty()
            || request.id.len() > MAX_REQUEST_ID_BYTES
            || request.id.contains('\0')
        {
            return Err(HostProtocolError::InvalidRequest);
        }
        let capability = request.operation.required_capability();
        if !self.capabilities.contains(capability) {
            return Err(HostProtocolError::CapabilityDenied);
        }
        if request.operation.payload_bytes() > self.max_payload_bytes {
            return Err(HostProtocolError::PayloadTooLarge);
        }
        if let HostOperation::ProcessSpawn { executable, .. }
        | HostOperation::ProcessProbe { executable } = &request.operation
            && !self.executables.contains(executable)
        {
            return Err(HostProtocolError::ExecutableDenied);
        }
        if let HostOperation::WebSocketOpen { endpoint }
        | HostOperation::HttpRequest { endpoint, .. } = &request.operation
            && !self
                .network_patterns
                .iter()
                .any(|pattern| pattern.matches(endpoint))
        {
            return Err(HostProtocolError::NetworkDenied);
        }
        if let HostOperation::SecretBind {
            credential_reference,
            ..
        } = &request.operation
            && !self.credential_references.contains(credential_reference)
        {
            return Err(HostProtocolError::CredentialDenied);
        }
        if let HostOperation::ProcessSpawn { environment, .. } = &request.operation
            && environment
                .iter()
                .any(|entry| !self.environment_names.contains(&entry.name))
        {
            return Err(HostProtocolError::EnvironmentDenied);
        }
        request.operation.validate()
    }
}

impl SpawnPlan {
    /// Validates a declarative Agent launch before the trusted Host resolves an
    /// executable or creates a process.
    pub fn validate_for(
        &self,
        manifest: &super::ExtensionManifest,
        agent: &super::AgentContribution,
    ) -> Result<(), HostProtocolError> {
        if self.executable_candidates.is_empty()
            || self.executable_candidates.len() > 16
            || self
                .executable_candidates
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != self.executable_candidates.len()
            || self.executable_candidates.iter().any(|candidate| {
                !valid_executable(candidate)
                    || !agent.executable_candidates.contains(candidate)
                    || !manifest.permissions.process.contains(candidate)
            })
            || self.args.len() > MAX_ARGUMENTS
            || self.args.iter().any(|argument| !valid_argument(argument))
            || self.environment.len() > MAX_ARGUMENTS
            || self.environment.iter().any(|entry| {
                !entry.is_valid() || !manifest.permissions.environment.contains(&entry.name)
            })
            || self
                .environment
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                != self.environment.len()
            || self.stdin != "jsonl-rpc"
        {
            return Err(HostProtocolError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkPattern {
    scheme: String,
    host: String,
    port: Option<u16>,
    path: String,
}

impl NetworkPattern {
    pub fn parse(value: &str) -> Result<Self, HostProtocolError> {
        if !valid_network_pattern(value) {
            return Err(HostProtocolError::InvalidGrant);
        }
        let separator = value.find("://").ok_or(HostProtocolError::InvalidGrant)?;
        let scheme = &value[..separator];
        let remainder = &value[separator + 3..];
        let path_start = remainder.find('/').unwrap_or(remainder.len());
        let authority = &remainder[..path_start];
        let path = if path_start == remainder.len() {
            "/*"
        } else {
            &remainder[path_start..]
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) if !host.contains(':') => {
                let port = port
                    .parse::<u16>()
                    .map_err(|_| HostProtocolError::InvalidGrant)?;
                (host, Some(port))
            }
            _ => (authority, None),
        };
        if host.is_empty()
            || (host.contains('*') && !(host.starts_with("*.") && host[2..].find('*').is_none()))
            || (path.contains('*')
                && !(path.ends_with('*') && path[..path.len() - 1].find('*').is_none()))
            || path.contains('?')
            || path.contains('#')
            || path.contains("..")
        {
            return Err(HostProtocolError::InvalidGrant);
        }
        Ok(Self {
            scheme: scheme.to_owned(),
            host: host.to_ascii_lowercase(),
            port,
            path: path.to_owned(),
        })
    }

    pub fn matches(&self, value: &str) -> bool {
        let Ok(url) = url::Url::parse(value) else {
            return false;
        };
        let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
            return false;
        };
        let host_matches = self.host.strip_prefix("*.").map_or_else(
            || host == self.host,
            |suffix| host.len() > suffix.len() && host.ends_with(&format!(".{suffix}")),
        );
        url.scheme() == self.scheme
            && host_matches
            && url.port_or_known_default() == self.port.or_else(|| default_port(&self.scheme))
            && self.path.strip_suffix('*').map_or_else(
                || url.path() == self.path,
                |prefix| url.path().starts_with(prefix),
            )
            && url.username().is_empty()
            && url.password().is_none()
    }
}

/// One extension-to-Host request. Principal and grants are never carried here.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRequest {
    pub id: String,
    #[serde(flatten)]
    pub operation: HostOperation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnPlan {
    pub executable_candidates: Vec<String>,
    pub args: Vec<String>,
    pub cwd: WorkingDirectory,
    pub environment: Vec<EnvironmentEntry>,
    pub stdin: String,
    #[serde(default)]
    pub output: AgentOutput,
    #[serde(default)]
    pub final_message: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionResult {
    pub state: serde_json::Value,
    pub events: Vec<ExtensionEvent>,
    pub operations: Vec<HostRequest>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionEvent {
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageBlockEvent {
    pub id: String,
    pub kind: String,
    pub data: serde_json::Value,
}

/// Typed operations implemented by the Rust `DriverHost` or `ChannelHost`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", content = "input")]
pub enum HostOperation {
    #[serde(rename = "process.probe")]
    ProcessProbe { executable: String },
    #[serde(rename = "process.spawn", rename_all = "camelCase")]
    ProcessSpawn {
        executable: String,
        args: Vec<String>,
        cwd: WorkingDirectory,
        environment: Vec<EnvironmentEntry>,
    },
    #[serde(rename = "process.write", rename_all = "camelCase")]
    ProcessWrite { worker_id: String, bytes: Vec<u8> },
    #[serde(rename = "process.resize", rename_all = "camelCase")]
    ProcessResize {
        worker_id: String,
        columns: u16,
        rows: u16,
    },
    #[serde(rename = "process.cancel", rename_all = "camelCase")]
    ProcessCancel { worker_id: String },
    #[serde(rename = "process.kill", rename_all = "camelCase")]
    ProcessKill { worker_id: String },
    #[serde(rename = "transport.websocket.open", rename_all = "camelCase")]
    WebSocketOpen { endpoint: String },
    #[serde(rename = "transport.websocket.send", rename_all = "camelCase")]
    WebSocketSend {
        transport_id: String,
        bytes: Vec<u8>,
    },
    #[serde(rename = "transport.http.request", rename_all = "camelCase")]
    HttpRequest {
        method: String,
        endpoint: String,
        body: Vec<u8>,
    },
    #[serde(rename = "transport.timer.schedule", rename_all = "camelCase")]
    TimerSchedule { timer_id: String, delay_ms: u64 },
    #[serde(rename = "workspace.read", rename_all = "camelCase")]
    WorkspaceRead { path: String, max_bytes: u32 },
    #[serde(rename = "artifact.put", rename_all = "camelCase")]
    ArtifactPut { media_type: String, bytes: Vec<u8> },
    #[serde(rename = "secret.bind", rename_all = "camelCase")]
    SecretBind {
        credential_reference: String,
        resource_id: String,
        field: String,
    },
    #[serde(rename = "approval.request")]
    ApprovalRequest { summary: String },
    #[serde(rename = "state.checkpoint")]
    StateCheckpoint { state: serde_json::Value },
    #[serde(rename = "telemetry.emit")]
    TelemetryEmit { event: serde_json::Value },
}

impl HostOperation {
    fn required_capability(&self) -> &'static str {
        match self {
            Self::ProcessProbe { .. } | Self::ProcessSpawn { .. } => "process",
            Self::ProcessWrite { .. }
            | Self::ProcessResize { .. }
            | Self::ProcessCancel { .. }
            | Self::ProcessKill { .. } => "process.control",
            Self::WebSocketOpen { .. } | Self::WebSocketSend { .. } | Self::HttpRequest { .. } => {
                "network"
            }
            Self::TimerSchedule { .. } => "timer",
            Self::WorkspaceRead { .. } => "workspace.read",
            Self::ArtifactPut { .. } => "artifact.write",
            Self::SecretBind { .. } => "secret.bind",
            Self::ApprovalRequest { .. } => "approval.request",
            Self::StateCheckpoint { .. } => "state.checkpoint",
            Self::TelemetryEmit { .. } => "telemetry.emit",
        }
    }

    fn payload_bytes(&self) -> usize {
        match self {
            Self::ProcessSpawn {
                args, environment, ..
            } => args
                .iter()
                .map(String::len)
                .chain(environment.iter().map(|entry| entry.value.len()))
                .sum(),
            Self::ProcessWrite { bytes, .. }
            | Self::WebSocketSend { bytes, .. }
            | Self::ArtifactPut { bytes, .. } => bytes.len(),
            Self::HttpRequest { body, .. } => body.len(),
            Self::StateCheckpoint { state } => {
                serde_json::to_vec(state).map_or(usize::MAX, |v| v.len())
            }
            Self::TelemetryEmit { event } => {
                serde_json::to_vec(event).map_or(usize::MAX, |v| v.len())
            }
            _ => 0,
        }
    }

    fn validate(&self) -> Result<(), HostProtocolError> {
        let valid = match self {
            Self::ProcessProbe { executable } => valid_executable(executable),
            Self::ProcessSpawn {
                executable,
                args,
                cwd,
                environment,
            } => {
                valid_executable(executable)
                    && args.len() <= MAX_ARGUMENTS
                    && args.iter().all(|value| valid_argument(value))
                    && matches!(
                        cwd,
                        WorkingDirectory::Workspace | WorkingDirectory::Temporary
                    )
                    && environment.len() <= MAX_ARGUMENTS
                    && environment.iter().all(EnvironmentEntry::is_valid)
            }
            Self::ProcessWrite { worker_id, .. }
            | Self::ProcessCancel { worker_id }
            | Self::ProcessKill { worker_id } => valid_token(worker_id),
            Self::ProcessResize {
                worker_id,
                columns,
                rows,
            } => valid_token(worker_id) && *columns > 0 && *rows > 0,
            Self::WebSocketOpen { endpoint } => valid_endpoint(endpoint, &["wss"]),
            Self::WebSocketSend { transport_id, .. } => valid_token(transport_id),
            Self::HttpRequest {
                method, endpoint, ..
            } => {
                matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
                    && valid_endpoint(endpoint, &["https"])
            }
            Self::TimerSchedule { timer_id, delay_ms } => {
                valid_token(timer_id) && *delay_ms > 0 && *delay_ms <= 86_400_000
            }
            Self::WorkspaceRead { path, max_bytes } => {
                valid_text(path)
                    && !path.starts_with(['/', '\\'])
                    && !path.split(['/', '\\']).any(|part| part == "..")
                    && *max_bytes > 0
            }
            Self::ArtifactPut { media_type, .. } => valid_text(media_type),
            Self::SecretBind {
                credential_reference,
                resource_id,
                field,
            } => {
                valid_token(credential_reference) && valid_token(resource_id) && valid_token(field)
            }
            Self::ApprovalRequest { summary } => valid_text(summary),
            Self::StateCheckpoint { .. } | Self::TelemetryEmit { .. } => true,
        };
        valid.then_some(()).ok_or(HostProtocolError::InvalidRequest)
    }
}

/// One non-secret child environment entry. Secrets use `secret.bind`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct EnvironmentEntry {
    pub name: String,
    pub value: String,
}

impl EnvironmentEntry {
    fn is_valid(&self) -> bool {
        valid_environment_name(&self.name) && valid_text(&self.value)
    }
}

/// A Host-resolved directory; extensions never submit an arbitrary absolute cwd.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkingDirectory {
    Workspace,
    Temporary,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostProtocolError {
    InvalidManifest,
    InvalidGrant,
    InvalidRequest,
    CapabilityDenied,
    ExecutableDenied,
    NetworkDenied,
    CredentialDenied,
    EnvironmentDenied,
    PayloadTooLarge,
}

impl std::fmt::Display for HostProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidManifest => "extension manifest is invalid",
            Self::InvalidGrant => "extension grant is invalid",
            Self::InvalidRequest => "extension Host request is invalid",
            Self::CapabilityDenied => "extension Host capability is denied",
            Self::ExecutableDenied => "extension executable is denied",
            Self::NetworkDenied => "extension network endpoint is denied",
            Self::CredentialDenied => "extension credential reference is denied",
            Self::EnvironmentDenied => "extension environment entry is denied",
            Self::PayloadTooLarge => "extension Host payload is too large",
        })
    }
}

impl std::error::Error for HostProtocolError {}

#[must_use]
pub fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[must_use]
pub fn valid_display_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.contains(['\0', '\r', '\n'])
}

#[must_use]
pub fn valid_custom_element_name(value: &str) -> bool {
    value.len() <= 128
        && value.contains('-')
        && !value.starts_with("xml")
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

#[must_use]
pub fn valid_relative_asset(value: &str, expected_extension: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && value.len() <= 256
        && !value.contains('\\')
        && !path.is_absolute()
        && path.extension().and_then(|value| value.to_str()) == Some(expected_extension)
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[must_use]
pub fn valid_extension_id(value: &str) -> bool {
    valid_token(value) && value.contains('.')
}

#[must_use]
pub fn valid_version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[must_use]
pub fn valid_network_pattern(value: &str) -> bool {
    (value.starts_with("https://") || value.starts_with("wss://"))
        && value.len() <= MAX_STRING_BYTES
        && !value.contains(['\0', '@'])
}

#[must_use]
pub fn valid_environment_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && (value.as_bytes()[0].is_ascii_alphabetic() || value.as_bytes()[0] == b'_')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "https" | "wss" => Some(443),
        _ => None,
    }
}

#[must_use]
pub fn valid_executable(value: &str) -> bool {
    valid_token(value) && !value.contains('.')
}

#[must_use]
pub fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_STRING_BYTES && !value.contains('\0')
}

#[must_use]
pub fn valid_argument(value: &str) -> bool {
    value.len() <= 128 * 1024 && !value.contains('\0')
}

#[must_use]
pub fn valid_endpoint(value: &str, schemes: &[&str]) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        schemes.contains(&url.scheme())
            && url.has_host()
            && url.username().is_empty()
            && url.password().is_none()
    })
}
