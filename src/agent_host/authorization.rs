//! Bounded authorization process transport. Provider protocol data belongs to extensions.
use ovule_extensions::protocol::AuthorizationProtocol;
use serde_json::Value;
use std::{ffi::OsString, path::PathBuf, process::Stdio, sync::mpsc::SyncSender};
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader};

enum Action {
    Send(Vec<Value>),
    Url(String),
    Complete,
}
struct Session {
    protocol: AuthorizationProtocol,
    stage: u8,
}
impl Session {
    fn receive(&mut self, value: &Value) -> Result<Option<Action>, String> {
        if value.get("error").is_some() {
            return Err("Authorization process rejected a request".into());
        }
        if self.stage == 0 && value.get("id") == self.protocol.initialize.get("id") {
            self.stage = 1;
            return Ok(Some(Action::Send(self.protocol.after_initialize.clone())));
        }
        if self.stage == 1
            && value.get("id").and_then(Value::as_u64)
                == Some(self.protocol.authorization_response_id)
        {
            let url = value
                .pointer(&self.protocol.url_pointer)
                .and_then(Value::as_str)
                .ok_or("Authorization response has no URL")?;
            let parsed = url::Url::parse(url).map_err(|_| "Invalid authorization URL")?;
            if !parsed.username().is_empty()
                || parsed.password().is_some()
                || !(parsed.scheme() == "https"
                    || (parsed.scheme() == "http"
                        && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))))
            {
                return Err("Unsupported authorization URL".into());
            }
            self.stage = 2;
            return Ok(Some(Action::Url(parsed.into())));
        }
        if value.get("method").and_then(Value::as_str)
            == Some(self.protocol.completion_method.as_str())
        {
            if self.stage != 2
                || value
                    .pointer(&self.protocol.success_pointer)
                    .and_then(Value::as_bool)
                    != Some(true)
            {
                return Err("Authorization did not complete successfully".into());
            }
            return Ok(Some(Action::Complete));
        }
        Ok(None)
    }
}
pub(super) async fn launch(
    executable: PathBuf,
    args: Vec<String>,
    path: Option<OsString>,
    protocol: AuthorizationProtocol,
    sender: SyncSender<Result<String, String>>,
) -> Result<(), String> {
    protocol.validate()?;
    let mut command = tokio::process::Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start authorization process")?;
    let mut input = child
        .stdin
        .take()
        .ok_or("Authorization stdin unavailable")?;
    let mut output = BufReader::new(
        child
            .stdout
            .take()
            .ok_or("Authorization stdout unavailable")?,
    );
    let initial = format!("{}\n", protocol.initialize);
    input
        .write_all(initial.as_bytes())
        .await
        .map_err(|_| "Authorization write failed")?;
    let mut session = Session { protocol, stage: 0 };
    let mut total = 0;
    loop {
        let mut line = Vec::new();
        let count = (&mut output)
            .take(65_537)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "Authorization read failed")?;
        if count == 0 {
            return Err("Authorization process exited before completion".into());
        }
        total += count;
        if count > 65_536 || total > 2 * 1024 * 1024 {
            return Err("Authorization protocol output exceeds limit".into());
        }
        let value: Value =
            serde_json::from_slice(&line).map_err(|_| "Invalid authorization protocol message")?;
        match session.receive(&value)? {
            Some(Action::Send(messages)) => {
                for message in messages {
                    input
                        .write_all(format!("{message}\n").as_bytes())
                        .await
                        .map_err(|_| "Authorization write failed")?;
                }
            }
            Some(Action::Url(url)) => sender
                .try_send(Ok(url))
                .map_err(|_| "Authorization request was abandoned")?,
            Some(Action::Complete) => return Ok(()),
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn session() -> Session {
        Session { stage:0, protocol:serde_json::from_value(json!({"initialize":{"id":7,"method":"start"},"afterInitialize":[{"id":9,"method":"login"}],"authorizationResponseId":9,"urlPointer":"/result/url","completionMethod":"finished","successPointer":"/params/ok"})).unwrap() }
    }
    #[test]
    fn protocol_is_extension_owned_and_duplicate_urls_are_not_reopened() {
        let mut s = session();
        s.protocol.validate().unwrap();
        assert!(matches!(
            s.receive(&json!({"id":7,"result":{}})).unwrap(),
            Some(Action::Send(_))
        ));
        assert!(matches!(
            s.receive(&json!({"id":9,"result":{"url":"https://example.test/login"}}))
                .unwrap(),
            Some(Action::Url(_))
        ));
        assert!(
            s.receive(&json!({"id":9,"result":{"url":"https://example.test/login"}}))
                .unwrap()
                .is_none()
        );
        assert!(matches!(
            s.receive(&json!({"method":"finished","params":{"ok":true}}))
                .unwrap(),
            Some(Action::Complete)
        ));
    }
    #[test]
    fn untrusted_urls_and_out_of_order_success_are_rejected() {
        for url in [
            "javascript:alert(1)",
            "http://example.test/login",
            "https://user:secret@example.test/",
        ] {
            let mut s = session();
            s.stage = 1;
            assert!(s.receive(&json!({"id":9,"result":{"url":url}})).is_err());
        }
        assert!(
            session()
                .receive(&json!({"method":"finished","params":{"ok":true}}))
                .is_err()
        );
    }
}
