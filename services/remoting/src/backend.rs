use super::model::{
    HostUpdate, IceServer, NativeStartOptions, SessionUpdate, Signal, StartRequest, StartedSession,
};
use async_trait::async_trait;
use std::sync::Arc;

/// A device-authenticated control connection to one Host. Media never uses this port.
#[async_trait]
pub trait ControlTransport: Send + Sync {
    async fn start(&self, request: StartRequest) -> Result<StartedSession, String>;
    async fn signal(&self, id: u64, signal: Signal) -> Result<(), String>;
    async fn watch(&self, id: u64, after: u64) -> Result<HostUpdate, String>;
    async fn clipboard(&self, id: u64, text: String) -> Result<(), String>;
    async fn stop(&self, id: u64) -> Result<(), String>;
}

pub trait HostDirectory: Send + Sync {
    fn connect(&self, endpoint_id: &str) -> Result<Arc<dyn ControlTransport>, String>;
}

pub trait SessionEvents: Send + Sync {
    fn changed(&self, update: &SessionUpdate);
}

#[async_trait]
pub trait IceConfigProvider: Send + Sync {
    async fn configuration(&self, owner: &str, session_id: u64) -> Result<Vec<IceServer>, String>;
    async fn configuration_report(
        &self,
        owner: &str,
        session_id: u64,
    ) -> Result<(Vec<IceServer>, Option<String>), String> {
        self.configuration(owner, session_id)
            .await
            .map(|servers| (servers, None))
    }
}

/// Native desktop capability, independently replaceable in lifecycle tests.
#[async_trait]
pub trait DesktopBackend: Send + Sync {
    async fn start(&self, options: NativeStartOptions) -> Result<u64, String>;
    async fn signal(&self, id: u64, signal: Signal) -> Result<(), String>;
    async fn update(&self, id: u64, after: u64) -> Result<HostUpdate, String>;
    async fn clipboard(&self, id: u64, text: String) -> Result<(), String>;
    async fn stop(&self, id: u64) -> Result<(), String>;
}

/// Wire-compatible computer input, independent of the desktop SDK.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotingInputEvent {
    pub kind: String,
    pub pressed: Option<bool>,
    pub usb_keycode: Option<f64>,
    pub text: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub button: Option<String>,
    pub button_down: Option<bool>,
    pub wheel_delta_x: Option<f64>,
    pub wheel_delta_y: Option<f64>,
    pub wheel_ticks_x: Option<f64>,
    pub wheel_ticks_y: Option<f64>,
    pub clipboard_mime_type: Option<String>,
    pub clipboard_data: Option<Vec<u8>>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotingSnapshot {
    pub width: f64,
    pub height: f64,
    #[serde(alias = "data_base64")]
    pub data_base64: String,
    #[serde(alias = "mime_type")]
    pub mime_type: String,
    #[serde(flatten)]
    pub metadata: std::collections::BTreeMap<String, serde_json::Value>,
}
#[async_trait]
pub trait ComputerUseHost: Send + Sync {
    fn is_supported(&self) -> bool;
    async fn refresh_capabilities(&self);
    async fn snapshot(&self, screen_id: Option<i64>) -> Result<RemotingSnapshot, String>;
    async fn inject_input(&self, event: RemotingInputEvent) -> Result<(), String>;
}

pub(crate) struct UnavailableDesktop;
#[async_trait]
impl ComputerUseHost for UnavailableDesktop {
    fn is_supported(&self) -> bool {
        false
    }
    async fn refresh_capabilities(&self) {}
    async fn snapshot(&self, _: Option<i64>) -> Result<RemotingSnapshot, String> {
        Err("native desktop control is unavailable".into())
    }
    async fn inject_input(&self, _: RemotingInputEvent) -> Result<(), String> {
        Err("native desktop control is unavailable".into())
    }
}
#[async_trait]
impl DesktopBackend for UnavailableDesktop {
    async fn start(&self, _: NativeStartOptions) -> Result<u64, String> {
        Err("native desktop control is unavailable".into())
    }
    async fn signal(&self, _: u64, _: Signal) -> Result<(), String> {
        Err("native desktop control is unavailable".into())
    }
    async fn update(&self, _: u64, _: u64) -> Result<HostUpdate, String> {
        Err("native desktop control is unavailable".into())
    }
    async fn clipboard(&self, _: u64, _: String) -> Result<(), String> {
        Err("native desktop control is unavailable".into())
    }
    async fn stop(&self, _: u64) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod computer_use_wire_tests {
    use super::{RemotingInputEvent, RemotingSnapshot};

    #[test]
    fn binary_clipboard_and_optional_input_fields_keep_shell_api_wire_shape() {
        let wire = serde_json::json!({
            "kind": "clipboard", "clipboardMimeType": "text/plain; charset=UTF-8",
            "clipboardData": [104, 105], "pressed": null, "usbKeycode": null,
            "text": null, "x": null, "y": null, "button": null,
            "buttonDown": null, "wheelDeltaX": null, "wheelDeltaY": null,
            "wheelTicksX": null, "wheelTicksY": null,
        });
        let event: RemotingInputEvent = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(event.clipboard_data.as_deref(), Some(b"hi".as_slice()));
        assert_eq!(serde_json::to_value(event).unwrap(), wire);
    }

    #[test]
    fn snapshots_preserve_future_optional_metadata() {
        let wire = serde_json::json!({"width": 1920.0, "height": 1080.0,
            "dataBase64": "aGk=", "mimeType": "image/png", "screenId": 4});
        let snapshot: RemotingSnapshot = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(snapshot.metadata["screenId"], 4);
        assert_eq!(serde_json::to_value(snapshot).unwrap(), wire);
    }
}
