//! Stable Link envelope and feature contracts. Storage migrations never enter this layer.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ALPN: &[u8] = b"ovule/link";

#[derive(Clone, Copy, Debug)]
pub enum Capability {
    WorkspaceFiles,
    WorkspaceProcess,
    AgentAcp,
    DesktopControl,
    PointerLatest,
    ClipboardText,
    ComputerUseMcp,
}
impl Capability {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceFiles => "workspace.files",
            Self::WorkspaceProcess => "workspace.process",
            Self::AgentAcp => "agent.acp",
            Self::DesktopControl => "desktop.control",
            Self::PointerLatest => "desktop.pointer.latest",
            Self::ClipboardText => "desktop.clipboard.text",
            Self::ComputerUseMcp => "computer-use.mcp",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostHello {
    pub host_id: String,
    pub platform: String,
    pub workspace_root: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub agents: Vec<HostAgentDescriptor>,
    #[serde(default)]
    pub workspaces: Vec<HostWorkspaceDescriptor>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostAgentDescriptor {
    pub id: String,
    pub available: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostWorkspaceDescriptor {
    pub id: String,
    pub root: String,
    pub alias: String,
}

impl HostHello {
    pub fn require(&self, capability: Capability) -> Result<(), String> {
        let name = capability.as_str();
        if self.capabilities.iter().any(|value| value == name) {
            Ok(())
        } else {
            Err(format!(
                "Host does not provide {name}; other advertised features remain available"
            ))
        }
    }
}

#[derive(Serialize)]
pub struct TunnelRequest<Input, Start, Signal> {
    #[serde(default)]
    pub share_id: String,
    #[serde(default)]
    pub client_name: String,
    #[serde(flatten)]
    pub operation: TunnelOperation<Input, Start, Signal>,
}
// Method identifiers are declared once, independently of Rust variant names.
macro_rules! link_methods {
    ($( $wire:literal => [$($variant:tt)+], )*) => {
        #[derive(Serialize, Deserialize)]
        #[serde(tag = "method", content = "params")]
        pub enum TunnelOperation<Input, Start, Signal> {
            $(#[serde(rename = $wire)] $($variant)+,)*
            #[serde(skip_deserializing)]
            Unsupported,
        }
        fn known_method(method: &str) -> bool { matches!(method, $($wire)|*) }
    };
}
link_methods! {
    "host.hello" => [Hello],
    "agent.spawn" => [SpawnAgent {
        agent_id: String,
        model_provider: Option<String>,
        model_remote_id: Option<String>,
    }],
    "process.spawn" => [Spawn {
        argv: Vec<String>,
        environment: BTreeMap<String, String>,
    }],
    "process.shell" => [SpawnShell(String)],
    "host.pair" => [Pair { code: String }],
    "workspace.probe" => [Probe],
    "workspace.stat" => [Stat(String)],
    "workspace.list" => [List(String)],
    "workspace.read" => [Read(String)],
    "workspace.write" => [Write(String, Vec<u8>)],
    "workspace.exec" => [Exec(Vec<String>)],
    "workspace.exec_shell" => [ExecShell(String)],
    "desktop.start" => [RemoteControlStart(Start)],
    "desktop.signal" => [RemoteControlSignal { session_id: u64, signal: Signal }],
    "desktop.watch" => [RemoteControlWatch {
        session_id: u64,
        after_sequence: u64,
    }],
    "desktop.clipboard" => [RemoteControlClipboard { session_id: u64, text: String }],
    "desktop.stop" => [RemoteControlStop { session_id: u64 }],
    "computer_use.endpoint" => [ComputerUseMcpEndpoint],
    "computer_use.capture" => [ComputerUseSnapshot { screen_id: Option<i64> }],
    "computer_use.input" => [ComputerUseInput { event: Input }],
}

/// Inspect the envelope without materializing a JSON value tree for large file
/// payloads. Unknown methods discard their params and receive a request-local error.
pub fn decode_request<
    Input: serde::de::DeserializeOwned,
    Start: serde::de::DeserializeOwned,
    Signal: serde::de::DeserializeOwned,
>(
    bytes: &[u8],
) -> Result<TunnelRequest<Input, Start, Signal>, serde_json::Error> {
    #[derive(Deserialize)]
    struct Header {
        method: String,
        #[serde(default)]
        share_id: String,
        #[serde(default)]
        client_name: String,
    }
    let header: Header = serde_json::from_slice(bytes)?;
    let operation = if known_method(&header.method) {
        serde_json::from_slice(bytes)?
    } else {
        TunnelOperation::Unsupported
    };
    Ok(TunnelRequest {
        share_id: header.share_id,
        client_name: header.client_name,
        operation,
    })
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum TunnelPayload<Stat, Exec, Session, Update, Endpoint, Snapshot> {
    #[serde(rename = "host.hello")]
    Hello(HostHello),
    #[serde(rename = "ack")]
    Empty,
    #[serde(rename = "workspace.stat")]
    Stat(Stat),
    #[serde(rename = "workspace.entries")]
    Entries(Vec<Stat>),
    #[serde(rename = "bytes")]
    Bytes(Vec<u8>),
    #[serde(rename = "process.exit")]
    Exec(Exec),
    #[serde(rename = "desktop.session")]
    RemotingSession(Session),
    #[serde(rename = "desktop.update")]
    RemoteControlUpdate(Update),
    #[serde(rename = "computer_use.endpoint")]
    ComputerUseMcpEndpoint(Endpoint),
    #[serde(rename = "computer_use.capture")]
    ComputerUseSnapshot(Snapshot),
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "status", content = "payload")]
pub enum TunnelResponse<Payload> {
    #[serde(rename = "ok")]
    Ok(Payload),
    #[serde(rename = "pairing_required")]
    Pending,
    #[serde(rename = "error")]
    Error(String),
}

/// Shared bounded frame size for request and process streams.
pub const MAX_FRAME: usize = 24 * 1024 * 1024;
#[cfg(test)]
mod tests {
    use super::*;
    type Request = TunnelRequest<serde_json::Value, serde_json::Value, serde_json::Value>;
    #[test]
    fn unknown_methods_remain_request_local_and_known_methods_validate_parameters() {
        let request: Request = decode_request(
            br#"{"method":"future.feature","share_id":"workspace","params":{"future":true}}"#,
        )
        .unwrap();
        assert!(matches!(request.operation, TunnelOperation::Unsupported));
        assert_eq!(request.share_id, "workspace");
        assert!(
            decode_request::<serde_json::Value, serde_json::Value, serde_json::Value>(
                br#"{"method":"desktop.stop","params":{}}"#
            )
            .is_err()
        );
    }
    #[test]
    fn capability_negotiation_and_wire_method_names_are_independent_of_rust_names() {
        let request: Request = TunnelRequest {
            share_id: "workspace".into(),
            client_name: "client".into(),
            operation: TunnelOperation::RemoteControlStop { session_id: 7 },
        };
        let value = serde_json::to_value(request).unwrap();
        assert_eq!(value["method"], "desktop.stop");
        let hello = HostHello {
            host_id: "host".into(),
            platform: "test".into(),
            workspace_root: "/work".into(),
            capabilities: vec![Capability::WorkspaceFiles.as_str().into()],
            agents: vec![],
            workspaces: vec![],
        };
        assert!(hello.require(Capability::WorkspaceFiles).is_ok());
        assert!(hello.require(Capability::DesktopControl).is_err());
    }
}
