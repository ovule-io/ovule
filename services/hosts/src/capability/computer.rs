use crate::{TransportKind as WorkspaceKind, WorkspaceTransport};
use async_trait::async_trait;
use ovule_agent_api::{
    CancellationToken, CapabilityDefinition, CapabilityLease, CapabilityProvider,
    ProviderDescriptor, ProviderError, ToolEffect,
};
use ovule_remoting::backend::{ComputerUseHost, RemotingInputEvent};
use serde_json::Value;
use std::sync::Arc;
const TOOL_NAME: &str = "ovule_computer_control";
#[derive(Clone)]
pub struct ComputerUse {
    target: ComputerUseTarget,
}

#[derive(Clone)]
enum ComputerUseTarget {
    Local(Arc<dyn ComputerUseHost>),
    Workspace(Arc<dyn WorkspaceTransport>),
}

impl ComputerUse {
    #[must_use]
    pub fn for_tools(
        host: &Arc<dyn ComputerUseHost>,
        transport: &Arc<dyn WorkspaceTransport>,
        selected: bool,
    ) -> Option<Self> {
        if !selected {
            return None;
        }
        match transport.kind() {
            WorkspaceKind::Local if host.is_supported() => Some(Self {
                target: ComputerUseTarget::Local(host.clone()),
            }),
            WorkspaceKind::Tunnel => Some(Self {
                target: ComputerUseTarget::Workspace(Arc::clone(transport)),
            }),
            WorkspaceKind::Local | WorkspaceKind::Ssh => None,
        }
    }

    #[must_use]
    pub fn tool_definition() -> CapabilityDefinition {
        CapabilityDefinition {
            name: TOOL_NAME.to_owned(),
            description: "Capture and control the local physical desktop through Chromium Remote Desktop. Actions: screenshot, move, click, mouse_down, mouse_up, scroll, type, key, clipboard. Key input requires explicit pressed=true/false and balanced down/up events; success confirms input delivery, not application focus or shortcut execution. Verify the resulting screen before retrying.".to_owned(),
            input_schema: serde_json::json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["action"],
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["screenshot", "move", "click", "mouse_down", "mouse_up", "scroll", "type", "key", "clipboard"]
                    },
                    "x": {"type": "integer", "minimum": 0},
                    "y": {"type": "integer", "minimum": 0},
                    "button": {"type": "string", "enum": ["left", "middle", "right", "back", "forward"]},
                    "deltaX": {"type": "number"},
                    "deltaY": {"type": "number"},
                    "text": {"type": "string", "maxLength": 1_048_576},
                    "usbKeycode": {"type": "integer", "minimum": 0, "maximum": 4_294_967_295_u64},
                    "pressed": {"type": "boolean", "description": "Required for key: true sends key-down, false sends key-up. Release every pressed key, including modifiers. usbKeycode is a full USB HID usage code, not a macOS virtual keycode."},
                    "screenId": {"type": "integer"}
                }
            }),
        }
    }

    pub async fn call(&self, name: &str, arguments: &Value) -> Result<Value, String> {
        if name != TOOL_NAME {
            return Err(format!("unknown native Computer Use tool: {name}"));
        }
        let action = arguments
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| "Computer Use action is required".to_owned())?;
        match action {
            "screenshot" => {
                let screen_id = optional_i64(arguments, "screenId")?;
                let snapshot = match &self.target {
                    ComputerUseTarget::Local(host) => {
                        let image = host.snapshot(screen_id).await?;
                        ovule_platform::permissions::record_screen_capture_success();
                        image
                    }
                    ComputerUseTarget::Workspace(transport) => transport
                        .computer_use_snapshot(screen_id)
                        .await
                        .map_err(|error| error.to_string())?,
                };
                Ok(serde_json::json!({
                    "content": [
                        {"type": "image", "data": snapshot.data_base64, "mimeType": snapshot.mime_type},
                        {"type": "text", "text": format!("Captured {}x{} physical desktop", snapshot.width, snapshot.height)}
                    ],
                    "isError": false
                }))
            }
            "move" => self.inject(mouse_event(arguments, None)?).await,
            "click" => {
                let button = button(arguments);
                self.inject(mouse_event(arguments, None)?).await?;
                self.inject(mouse_event(arguments, Some((button.clone(), true)))?)
                    .await?;
                self.inject(mouse_event(arguments, Some((button, false)))?)
                    .await
            }
            "mouse_down" => {
                self.inject(mouse_event(arguments, Some((button(arguments), true)))?)
                    .await
            }
            "mouse_up" => {
                self.inject(mouse_event(arguments, Some((button(arguments), false)))?)
                    .await
            }
            "scroll" => {
                let mut event = mouse_event(arguments, None)?;
                event.wheel_delta_x = optional_f64(arguments, "deltaX")?;
                event.wheel_delta_y = optional_f64(arguments, "deltaY")?;
                event.wheel_ticks_x = event.wheel_delta_x.map(|value| value / 120.0);
                event.wheel_ticks_y = event.wheel_delta_y.map(|value| value / 120.0);
                if event.wheel_delta_x.is_none() && event.wheel_delta_y.is_none() {
                    return Err("scroll requires deltaX or deltaY".to_owned());
                }
                self.inject(event).await
            }
            "type" => {
                let text = required_text(arguments, "text")?;
                self.inject(RemotingInputEvent {
                    kind: "text".to_owned(),
                    text: Some(text.to_owned()),
                    ..empty_event()
                })
                .await
            }
            "key" => {
                let usb_keycode = required_u32(arguments, "usbKeycode")?;
                let pressed = arguments
                    .get("pressed")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| "Computer Use key requires explicit pressed=true (down) or false (up); release every key and modifier".to_owned())?;
                self.inject(RemotingInputEvent {
                    kind: "key".to_owned(),
                    pressed: Some(pressed),
                    usb_keycode: Some(f64::from(usb_keycode)),
                    ..empty_event()
                })
                .await
            }
            "clipboard" => {
                let text = required_text(arguments, "text")?;
                self.inject(RemotingInputEvent {
                    kind: "clipboard".to_owned(),
                    clipboard_mime_type: Some("text/plain; charset=UTF-8".to_owned()),
                    clipboard_data: Some(text.as_bytes().to_vec()),
                    ..empty_event()
                })
                .await
            }
            _ => Err(format!("unsupported Computer Use action: {action}")),
        }
    }

    async fn inject(&self, event: RemotingInputEvent) -> Result<Value, String> {
        match &self.target {
            ComputerUseTarget::Local(host) => host.inject_input(event).await?,
            ComputerUseTarget::Workspace(transport) => transport
                .computer_use_input(event)
                .await
                .map_err(|error| error.to_string())?,
        }
        Ok(serde_json::json!({
            "content": [{"type": "text", "text": "ok"}],
            "isError": false
        }))
    }
}

fn empty_event() -> RemotingInputEvent {
    RemotingInputEvent {
        kind: String::new(),
        pressed: None,
        usb_keycode: None,
        text: None,
        x: None,
        y: None,
        button: None,
        button_down: None,
        wheel_delta_x: None,
        wheel_delta_y: None,
        wheel_ticks_x: None,
        wheel_ticks_y: None,
        clipboard_mime_type: None,
        clipboard_data: None,
    }
}

fn mouse_event(
    arguments: &Value,
    button_state: Option<(String, bool)>,
) -> Result<RemotingInputEvent, String> {
    let (button, button_down) = button_state.unzip();
    Ok(RemotingInputEvent {
        kind: "mouse".to_owned(),
        x: optional_i32(arguments, "x")?.map(f64::from),
        y: optional_i32(arguments, "y")?.map(f64::from),
        button,
        button_down,
        ..empty_event()
    })
}

fn button(arguments: &Value) -> String {
    arguments
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left")
        .to_owned()
}

fn required_text<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 1024 * 1024)
        .ok_or_else(|| format!("Computer Use {name} is required"))
}

fn optional_i32(arguments: &Value, name: &str) -> Result<Option<i32>, String> {
    arguments
        .get(name)
        .map(|value| {
            value
                .as_i64()
                .and_then(|value| i32::try_from(value).ok())
                .ok_or_else(|| format!("Computer Use {name} must be a 32-bit integer"))
        })
        .transpose()
}

fn optional_i64(arguments: &Value, name: &str) -> Result<Option<i64>, String> {
    arguments
        .get(name)
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("Computer Use {name} must be an integer"))
        })
        .transpose()
}

fn optional_f64(arguments: &Value, name: &str) -> Result<Option<f64>, String> {
    arguments
        .get(name)
        .map(|value| {
            value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| format!("Computer Use {name} must be a finite number"))
        })
        .transpose()
}

fn required_u32(arguments: &Value, name: &str) -> Result<u32, String> {
    arguments
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("Computer Use {name} must be an unsigned 32-bit integer"))
}

impl ComputerUse {
    #[must_use]
    pub fn local(host: Arc<dyn ComputerUseHost>) -> Self {
        Self {
            target: ComputerUseTarget::Local(host),
        }
    }
}
#[derive(Clone)]
struct ComputerLease(ComputerUse);
#[async_trait]
impl CapabilityLease for ComputerLease {
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        let d = ComputerUse::tool_definition();
        vec![CapabilityDefinition {
            name: d.name,
            description: d.description,
            input_schema: d.input_schema,
        }]
    }
    async fn invoke(
        &mut self,
        name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> Result<Value, ProviderError> {
        self.0.call(name, args).await.map_err(ProviderError::Tool)
    }
    async fn close(&mut self) -> Result<(), String> {
        Ok(())
    }
}
#[async_trait]
impl CapabilityProvider for ComputerLease {
    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "computer".into(),
            description: "Native CRD Computer Use".into(),
        }
    }
    fn effect(&self, _name: &str, args: &Value) -> ToolEffect {
        if args.get("action").and_then(Value::as_str) == Some("screenshot") {
            ToolEffect::Workspace
        } else {
            ToolEffect::External
        }
    }
    fn definitions(&self) -> Vec<CapabilityDefinition> {
        vec![ComputerUse::tool_definition()]
    }
    async fn acquire(
        &self,
        _cancel: CancellationToken,
    ) -> Result<Box<dyn CapabilityLease>, String> {
        Ok(Box::new(self.clone()))
    }
}

#[must_use]
pub fn provider(facade: ComputerUse) -> Arc<dyn CapabilityProvider> {
    Arc::new(ComputerLease(facade))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Host(std::sync::Mutex<Vec<RemotingInputEvent>>);
    #[async_trait]
    impl ComputerUseHost for Host {
        fn is_supported(&self) -> bool {
            true
        }
        async fn refresh_capabilities(&self) {}
        async fn snapshot(
            &self,
            _: Option<i64>,
        ) -> Result<ovule_remoting::backend::RemotingSnapshot, String> {
            Err("unused".into())
        }
        async fn inject_input(&self, event: RemotingInputEvent) -> Result<(), String> {
            self.0.lock().unwrap().push(event);
            Ok(())
        }
    }
    #[tokio::test]
    async fn raw_keys_require_explicit_direction_before_injecting_input() {
        let host = Arc::new(Host::default());
        let computer = ComputerUse::local(host.clone());
        let error = computer
            .call(
                TOOL_NAME,
                &serde_json::json!({"action":"key","usbKeycode":458_976}),
            )
            .await
            .unwrap_err();
        assert!(error.contains("explicit pressed"));
        assert!(host.0.lock().unwrap().is_empty());
        for pressed in [true, false] {
            computer
                .call(
                    TOOL_NAME,
                    &serde_json::json!({"action":"key","usbKeycode":458_976,"pressed":pressed}),
                )
                .await
                .unwrap();
        }
        let events = host.0.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].pressed, Some(true));
        assert_eq!(events[1].pressed, Some(false));
    }
}
