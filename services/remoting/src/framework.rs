pub(crate) type Context = tuffite::ApplicationContext;
use crate::backend::RemotingSnapshot;
use tuffite::shell_api::{RemotingInputEvent, RemotingSignal, RemotingStartOptions};
#[derive(Clone)]
pub(crate) struct Remoting(tuffite::remoting::Remoting, tuffite::EventEmitter);
impl Remoting {
    pub(crate) fn new(context: &tuffite::ApplicationContext) -> Self {
        Self(tuffite::remoting::Remoting::new(context), context.events())
    }
}
impl std::ops::Deref for Remoting {
    type Target = tuffite::remoting::Remoting;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
#[async_trait::async_trait]
impl crate::backend::DesktopBackend for Remoting {
    async fn start(&self, options: crate::model::NativeStartOptions) -> Result<u64, String> {
        options.validate()?;
        self.refresh_capabilities().await;
        if !self.supports_control() {
            return Err("native desktop control is unavailable in this Framework".into());
        }
        self.0
            .start(RemotingStartOptions {
                auth_key: options.auth_key,
                ice_servers: options
                    .ice_servers
                    .into_iter()
                    .map(|s| tuffite::shell_api::RemotingIceServer {
                        urls: s.urls,
                        username: s.username,
                        credential: s.credential,
                    })
                    .collect(),
                max_bitrate_kbps: options.max_bitrate_kbps.map(f64::from),
                target_framerate: options.target_framerate.map(f64::from),
                screen_id: options.screen_id,
            })
            .await
            .map(|session| session.id)
    }

    async fn signal(&self, id: u64, signal: crate::model::Signal) -> Result<(), String> {
        use crate::model::SdpType;
        signal.validate()?;
        self.process_signal(
            id,
            RemotingSignal {
                sequence: i64::try_from(signal.sequence).map_err(|_| "invalid signal cursor")?,
                description: signal.description.map(|d| {
                    tuffite::shell_api::RemotingSessionDescription {
                        r#type: match d.r#type {
                            SdpType::Offer => "offer",
                            SdpType::Answer => "answer",
                        }
                        .into(),
                        sdp: d.sdp,
                    }
                }),
                candidates: signal
                    .candidates
                    .into_iter()
                    .map(|c| tuffite::shell_api::RemotingIceCandidate {
                        mid: c.mid,
                        m_line_index: f64::from(c.m_line_index),
                        candidate: c.candidate,
                    })
                    .collect(),
            },
        )
        .await
    }

    async fn update(&self, id: u64, after: u64) -> Result<crate::model::HostUpdate, String> {
        use crate::model::{Description, HostUpdate, IceCandidate, SdpType, SessionState, Signal};
        let snapshot = self.stats(id).await?;
        let state = match snapshot.state.as_str() {
            "starting" | "connecting" => SessionState::Connecting,
            "connected" => SessionState::Connected,
            "stopped" => SessionState::Stopped,
            _ => SessionState::Failed,
        };
        let signals = self
            .take_signals(id, after)
            .await?
            .into_iter()
            .map(|s| {
                Ok(Signal {
                    sequence: u64::try_from(s.sequence)
                        .map_err(|_| "invalid native signal sequence")?,
                    description: s
                        .description
                        .map(|d| {
                            Ok(Description {
                                r#type: match d.r#type.as_str() {
                                    "offer" => SdpType::Offer,
                                    "answer" => SdpType::Answer,
                                    _ => return Err("unsupported native SDP type".to_owned()),
                                },
                                sdp: d.sdp,
                            })
                        })
                        .transpose()?,
                    candidates: s
                        .candidates
                        .into_iter()
                        .map(|c| {
                            let index = c.m_line_index;
                            if !index.is_finite()
                                || index.fract() != 0.0
                                || !(0.0..=65535.0).contains(&index)
                            {
                                return Err("invalid native ICE index".to_owned());
                            }
                            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                            Ok(IceCandidate {
                                mid: c.mid,
                                m_line_index: index as u32,
                                candidate: c.candidate,
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(HostUpdate {
            state,
            route: snapshot.route,
            signals,
        })
    }

    async fn clipboard(&self, id: u64, text: String) -> Result<(), String> {
        if text.len() > 1024 * 1024 {
            return Err("clipboard exceeds 1 MiB".into());
        }
        self.input(
            id,
            RemotingInputEvent {
                kind: "clipboard".into(),
                clipboard_mime_type: Some("text/plain; charset=UTF-8".into()),
                clipboard_data: Some(text.into_bytes()),
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
            },
        )
        .await
    }

    async fn stop(&self, id: u64) -> Result<(), String> {
        self.0.stop(id).await
    }
}

#[async_trait::async_trait]
impl crate::backend::ComputerUseHost for Remoting {
    fn is_supported(&self) -> bool {
        self.supports_control()
    }
    async fn refresh_capabilities(&self) {
        self.0.refresh_capabilities().await;
    }
    async fn snapshot(&self, screen_id: Option<i64>) -> Result<RemotingSnapshot, String> {
        let snapshot = self.0.snapshot(screen_id).await?;
        Ok(RemotingSnapshot {
            width: f64::from(snapshot.width),
            height: f64::from(snapshot.height),
            mime_type: snapshot.mime_type,
            data_base64: snapshot.data_base64,
            metadata: std::collections::BTreeMap::new(),
        })
    }
    async fn inject_input(&self, event: crate::backend::RemotingInputEvent) -> Result<(), String> {
        self.0
            .inject_input(RemotingInputEvent {
                kind: event.kind,
                pressed: event.pressed,
                usb_keycode: event.usb_keycode,
                text: event.text,
                x: event.x,
                y: event.y,
                button: event.button,
                button_down: event.button_down,
                wheel_delta_x: event.wheel_delta_x,
                wheel_delta_y: event.wheel_delta_y,
                wheel_ticks_x: event.wheel_ticks_x,
                wheel_ticks_y: event.wheel_ticks_y,
                clipboard_mime_type: event.clipboard_mime_type,
                clipboard_data: event.clipboard_data,
            })
            .await?;
        // Only the ComputerUseHost path emits Agent activity. Human remoting
        // input uses DesktopBackend and must not masquerade as Agent control.
        if let Err(error) = self.1.emit("ovule:computer-use-activity", b"{}") {
            tracing::debug!(%error, "Computer Use feedback delivery failed");
        }
        Ok(())
    }
}

use tuffite::EventEmitter;
pub(crate) struct TuffiteRemotingEvents {
    events: EventEmitter,
}
impl TuffiteRemotingEvents {
    pub(crate) const fn new(events: EventEmitter) -> Self {
        Self { events }
    }
}
impl crate::backend::SessionEvents for TuffiteRemotingEvents {
    fn changed(&self, update: &crate::model::SessionUpdate) {
        match serde_json::to_vec(update) {
            Ok(payload) => {
                if let Err(error) = self.events.emit("ovule:remote-control", &payload) {
                    tracing::warn!(%error, "remote control event delivery failed");
                }
            }
            Err(error) => tracing::warn!(%error, "remote control event encoding failed"),
        }
    }
}

use std::sync::Arc;
use tuffite_ioc::{Registrar, Service};

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registry: &mut impl Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registry.register(tuffite_ioc::factory::<Service<Remoting>, _, _>(|build| {
        let context: &C = build.context();
        Ok(Arc::new(Remoting::new(context.as_ref())))
    }))?;
    registry.register(tuffite_ioc::factory::<
        Service<dyn crate::backend::ComputerUseHost>,
        _,
        _,
    >(|deps| Ok(deps.depends_on::<Service<Remoting>>()?)))?;
    registry.register(tuffite_ioc::factory::<
        Service<dyn crate::backend::DesktopBackend>,
        _,
        _,
    >(|deps| Ok(deps.depends_on::<Service<Remoting>>()?)))?;
    registry.register(tuffite_ioc::factory::<
        Service<dyn crate::backend::SessionEvents>,
        _,
        _,
    >(|build| {
        let context: &C = build.context();
        let browser = context.as_ref();
        Ok(Arc::new(TuffiteRemotingEvents::new(browser.events())))
    }))?;

    Ok(())
}
