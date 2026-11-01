//! `ShellAPI` mapping only. Network and session lifetime belong to `RemotingService`.
use crate::runtime::App;
use crate::shell_api::{RemoteControlSignal, RemoteControlStartOptions, RemoteControlUpdate};
use ovule_remoting::model::{Description, IceCandidate, SdpType, Signal, StartRequest};
use tuffite::CommandError;

fn cursor(value: i64) -> Result<u64, CommandError> {
    u64::try_from(value).map_err(|_| CommandError::InvalidArgument("negative cursor".into()))
}
fn id(value: i64) -> Result<u64, CommandError> {
    if value == 0 {
        return Err(CommandError::InvalidArgument("invalid session".into()));
    }
    cursor(value)
}
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn number(value: f64) -> Result<u32, CommandError> {
    if value.is_finite() && value.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&value) {
        Ok(value as u32)
    } else {
        Err(CommandError::InvalidArgument("invalid integer".into()))
    }
}

impl crate::shell_api::Remoting for App {
    fn start(
        &self,
        endpoint_id: String,
        options: RemoteControlStartOptions,
    ) -> Result<i64, CommandError> {
        let request = StartRequest {
            auth_key: options.auth_key,
            screen_id: options.screen_id,
            max_bitrate_kbps: options.max_bitrate_kbps.map(number).transpose()?,
            target_framerate: options.target_framerate.map(number).transpose()?,
        };
        self.service::<ovule_remoting::RemotingService>()?
            .start(endpoint_id, request)
            .map_err(CommandError::Failed)
            .and_then(|id| {
                i64::try_from(id).map_err(|_| CommandError::Failed("session ID exhausted".into()))
            })
    }

    fn signal(&self, session_id: i64, signal: RemoteControlSignal) -> Result<bool, CommandError> {
        let signal = Signal {
            sequence: cursor(signal.sequence)?,
            description: signal
                .description
                .map(|d| {
                    Ok(Description {
                        r#type: match d.r#type.as_str() {
                            "offer" => SdpType::Offer,
                            "answer" => SdpType::Answer,
                            _ => {
                                return Err(CommandError::InvalidArgument(
                                    "unsupported SDP type".into(),
                                ));
                            }
                        },
                        sdp: d.sdp,
                    })
                })
                .transpose()?,
            candidates: signal
                .candidates
                .into_iter()
                .map(|c| {
                    Ok(IceCandidate {
                        mid: c.mid,
                        candidate: c.candidate,
                        m_line_index: number(c.m_line_index)?,
                    })
                })
                .collect::<Result<Vec<_>, CommandError>>()?,
        };
        self.service::<ovule_remoting::RemotingService>()?
            .signal(id(session_id)?, signal)
            .map(|()| true)
            .map_err(CommandError::Failed)
    }

    fn snapshot(
        &self,
        session_id: i64,
        after_sequence: i64,
    ) -> Result<RemoteControlUpdate, CommandError> {
        let update = self
            .service::<ovule_remoting::RemotingService>()?
            .snapshot(id(session_id)?, cursor(after_sequence)?)
            .map_err(CommandError::Failed)?;
        Ok(RemoteControlUpdate {
            session_id: update.session_id,
            state: match update.state {
                ovule_remoting::model::SessionState::Connecting => "connecting",
                ovule_remoting::model::SessionState::Connected => "connected",
                ovule_remoting::model::SessionState::Reconnecting => "reconnecting",
                ovule_remoting::model::SessionState::Stopped => "stopped",
                ovule_remoting::model::SessionState::Failed => "failed",
            }
            .into(),
            route: update.route,
            error: update.error,
            ice_servers: update.ice_servers.map(|servers| {
                servers
                    .into_iter()
                    .map(|server| crate::shell_api::RemoteControlIceServer {
                        urls: server.urls,
                        username: server.username,
                        credential: server.credential,
                    })
                    .collect()
            }),
            signals: update
                .signals
                .into_iter()
                .map(|s| {
                    Ok(RemoteControlSignal {
                        sequence: i64::try_from(s.sequence)
                            .map_err(|_| CommandError::Failed("signal cursor exhausted".into()))?,
                        description: s.description.map(|d| {
                            crate::shell_api::RemoteControlSessionDescription {
                                r#type: match d.r#type {
                                    SdpType::Offer => "offer",
                                    SdpType::Answer => "answer",
                                }
                                .into(),
                                sdp: d.sdp,
                            }
                        }),
                        candidates: s
                            .candidates
                            .into_iter()
                            .map(|c| crate::shell_api::RemoteControlIceCandidate {
                                mid: c.mid,
                                m_line_index: f64::from(c.m_line_index),
                                candidate: c.candidate,
                            })
                            .collect(),
                    })
                })
                .collect::<Result<Vec<_>, CommandError>>()?,
        })
    }

    fn clipboard(&self, session_id: i64, text: String) -> Result<bool, CommandError> {
        self.service::<ovule_remoting::RemotingService>()?
            .clipboard(id(session_id)?, text)
            .map(|()| true)
            .map_err(CommandError::Failed)
    }

    fn stop(&self, session_id: i64) -> Result<bool, CommandError> {
        self.service::<ovule_remoting::RemotingService>()?
            .stop(id(session_id)?);
        Ok(true)
    }
}
