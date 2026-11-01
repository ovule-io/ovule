//! Application feature payloads bound to the transport-independent Link envelope.
use super::{ComputerUseMcpEndpoint, EntryStat, ExecOutcome, RemotingSnapshot};
pub(super) use ovule_link_protocol::Capability;
pub use ovule_link_protocol::{HostAgentDescriptor, HostHello, HostWorkspaceDescriptor};
use ovule_remoting::backend::RemotingInputEvent;
use ovule_remoting::model::{HostUpdate, Signal, StartRequest, StartedSession};
pub(super) type TunnelRequest =
    ovule_link_protocol::TunnelRequest<RemotingInputEvent, StartRequest, Signal>;
pub(super) type TunnelOperation =
    ovule_link_protocol::TunnelOperation<RemotingInputEvent, StartRequest, Signal>;
pub(super) type TunnelPayload = ovule_link_protocol::TunnelPayload<
    EntryStat,
    ExecOutcome,
    StartedSession,
    HostUpdate,
    ComputerUseMcpEndpoint,
    RemotingSnapshot,
>;
pub(super) type TunnelResponse = ovule_link_protocol::TunnelResponse<TunnelPayload>;
pub(super) fn decode_request(bytes: &[u8]) -> Result<TunnelRequest, serde_json::Error> {
    ovule_link_protocol::decode_request(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_names_are_stable_and_optional_extensions_are_ignored() {
        let value = serde_json::to_value(TunnelRequest {
            share_id: "share".into(),
            client_name: "Laptop".into(),
            operation: TunnelOperation::RemoteControlStop { session_id: 7 },
        })
        .unwrap();
        assert_eq!(value["method"], "desktop.stop");
        assert_eq!(value["params"]["session_id"], 7);
        assert!(value.get("operation").is_none());
        let request = decode_request(br#"{"method":"desktop.stop","params":{"session_id":7,"future_option":true},"trace_context":"future"}"#).unwrap();
        assert!(matches!(
            request.operation,
            TunnelOperation::RemoteControlStop { session_id: 7 }
        ));
        let future =
            decode_request(br#"{"method":"desktop.future","params":{"value":1}}"#).unwrap();
        assert!(matches!(future.operation, TunnelOperation::Unsupported));
    }

    #[test]
    fn missing_desktop_support_does_not_reject_workspace_hosts() {
        let hello: HostHello = serde_json::from_value(serde_json::json!({
            "host_id":"host", "platform":"test", "workspace_root":"/workspace",
            "capabilities":["workspace.files", "future.feature"], "future_metadata": true
        }))
        .unwrap();
        assert!(hello.require(Capability::WorkspaceFiles).is_ok());
        assert!(hello.require(Capability::DesktopControl).is_err());
        let encoded = serde_json::to_value(hello).unwrap();
        assert!(encoded.get("protocol_major").is_none());
    }

    #[test]
    fn desktop_start_request_cannot_supply_ice_servers() {
        let value = serde_json::to_value(TunnelRequest {
            share_id: String::new(),
            client_name: "Client".into(),
            operation: TunnelOperation::RemoteControlStart(StartRequest {
                auth_key: "a".repeat(32),
                max_bitrate_kbps: Some(12_000),
                target_framerate: Some(60),
                screen_id: None,
            }),
        })
        .unwrap();
        assert_eq!(value["method"], "desktop.start");
        assert!(value["params"].get("iceServers").is_none());
        assert!(value["params"].get("ice_servers").is_none());
    }
}
