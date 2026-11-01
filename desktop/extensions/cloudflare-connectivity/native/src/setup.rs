//! Fixed official CLI operations. No arbitrary commands or raw output reach the UI.
use ovule_extensions::{
    ExtensionActionOutcome, ExtensionConnectivityActions, protocol::ExtensionActionHandler,
};
use ovule_secrets::SecretStore;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const VERSION: &str = "1.0.0-beta.12";
const PROFILE: &str = "ovule-connectivity";
const MAX_OUTPUT: usize = 256 * 1024;
#[derive(Default)]
struct State {
    phase: String,
    url: Option<String>,
    code: Option<String>,
    opened: bool,
    accounts: Vec<Value>,
    detail: String,
    pending_key: Option<(String, crate::provider::CloudflareTurnConfig)>,
}
struct Shared {
    state: Mutex<State>,
    cancel: AtomicBool,
}
type BrowserOpener = dyn Fn(&str) -> Result<(), String> + Send + Sync;
pub(crate) struct CloudflareSetup {
    secrets: Arc<dyn SecretStore>,
    root: PathBuf,
    shared: Arc<Shared>,
    browser_opener: Arc<BrowserOpener>,
}
impl CloudflareSetup {
    pub fn new(secrets: Arc<dyn SecretStore>, root: PathBuf) -> Self {
        let configured = secrets
            .load_provider_credential(crate::provider::CONFIG_REFERENCE)
            .ok()
            .flatten()
            .and_then(|value| {
                serde_json::from_str::<crate::provider::CloudflareTurnConfig>(
                    &value.to_string_lossy(),
                )
                .ok()
            })
            .is_some_and(|config| config.validate().is_ok());
        Self {
            secrets,
            root,
            browser_opener: Arc::new(open_system_browser),
            shared: Arc::new(Shared {
                state: Mutex::new(State {
                    phase: if configured { "configured" } else { "idle" }.into(),
                    ..State::default()
                }),
                cancel: AtomicBool::new(false),
            }),
        }
    }
    fn snapshot(&self) -> ExtensionActionOutcome {
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let open_url = if state.phase == "authorizing"
            && !state.opened
            && (state.code.is_some()
                || state
                    .url
                    .as_deref()
                    .is_some_and(|url| url.starts_with("https://dash.cloudflare.com/oauth2/auth?")))
        {
            authorization_url(&state).inspect(|_| state.opened = true)
        } else {
            None
        };
        ExtensionActionOutcome { data_json: json!({"phase": state.phase, "authorizationUrl": state.url, "userCode": state.code, "accounts": state.accounts, "detail": state.detail, "cliVersion": VERSION, "host": "local", "pendingSave": state.pending_key.is_some(), "pendingAccount": state.pending_key.as_ref().map(|(account, _)| account)}).to_string(), open_url }
    }
    fn start(&self, account: Option<String>) -> Result<(), String> {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if matches!(
                state.phase.as_str(),
                "installing" | "authorizing" | "loading-accounts" | "creating"
            ) {
                return Err("A connection setup operation is already running".into());
            }
            if let Some(account) = &account
                && !state
                    .accounts
                    .iter()
                    .any(|v| v["id"].as_str() == Some(account))
            {
                return Err("Choose an account returned by this authorization".into());
            }
            if account.is_none() && state.pending_key.is_some() {
                return Err("A created Key is waiting for secure storage. Retry saving it before starting another login".into());
            }
            state.phase = if account.is_some() {
                "creating"
            } else {
                "installing"
            }
            .into();
            state.url = None;
            state.code = None;
            state.opened = false;
            state.detail.clear();
            if account.is_none() {
                state.accounts.clear();
            }
            self.shared.cancel.store(false, Ordering::Release);
        }
        let root = self.root.clone();
        let secrets = self.secrets.clone();
        let shared = self.shared.clone();
        std::thread::spawn(move || {
            if let Err(error) = execute(&root, secrets.as_ref(), &shared, account.as_deref()) {
                let mut state = shared
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                state.phase = if shared.cancel.load(Ordering::Acquire) {
                    "cancelled"
                } else {
                    "error"
                }
                .into();
                state.detail = error;
                state.url = None;
                state.code = None;
            }
        });
        Ok(())
    }
}
impl Drop for CloudflareSetup {
    fn drop(&mut self) {
        self.shared.cancel.store(true, Ordering::Release);
    }
}

impl ExtensionConnectivityActions for CloudflareSetup {
    fn run(
        &self,
        action: ExtensionActionHandler,
        account: Option<&str>,
    ) -> Result<ExtensionActionOutcome, String> {
        match action {
            ExtensionActionHandler::ConnectivityLogin => self.start(None)?,
            ExtensionActionHandler::ConnectivityCreate => {
                let account = account
                    .filter(|id| valid_account(id))
                    .ok_or("Invalid Cloudflare account selection")?;
                self.start(Some(account.to_owned()))?;
            }
            ExtensionActionHandler::ConnectivityOpen
            | ExtensionActionHandler::ConnectivityOpenExternal => {
                let mut state = self
                    .shared
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.phase != "authorizing" {
                    return Err("No active Cloudflare authorization. Start login again".into());
                }
                let open_url = authorization_url(&state)
                    .ok_or("Cloudflare authorization link is not ready yet")?;
                let external = action == ExtensionActionHandler::ConnectivityOpenExternal;
                state.detail.clear();
                state.opened = true;
                drop(state);
                if external {
                    let shared = self.shared.clone();
                    let opener = self.browser_opener.clone();
                    let url = open_url.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = opener(&url) {
                            let mut state = shared
                                .state
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner);
                            if state.phase == "authorizing"
                                && authorization_url(&state).as_deref() == Some(&url)
                            {
                                state.detail = error;
                            }
                        }
                    });
                }
                let mut outcome = self.snapshot();
                outcome.open_url = (!external).then_some(open_url);
                return Ok(outcome);
            }
            ExtensionActionHandler::ConnectivityAccounts
            | ExtensionActionHandler::ConnectivityStatus => {}
            ExtensionActionHandler::ConnectivityCancel => {
                let mut state = self
                    .shared
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.phase == "creating" {
                    return Err("Key creation is in progress; wait for the saved result".into());
                }
                self.shared.cancel.store(true, Ordering::Release);
                // Installation has a bounded installer lifecycle; do not start a
                // replacement until the cancelled worker has actually exited.
                if !matches!(
                    state.phase.as_str(),
                    "installing" | "authorizing" | "loading-accounts"
                ) {
                    state.phase = "cancelled".into();
                }
                state.url = None;
                state.code = None;
            }
            _ => return Err("Unsupported connection setup action".into()),
        }
        Ok(self.snapshot())
    }
}
fn valid_account(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn phase(shared: &Shared, value: &str) {
    shared
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .phase = value.into();
}
fn execute(
    root: &Path,
    secrets: &dyn SecretStore,
    shared: &Arc<Shared>,
    account: Option<&str>,
) -> Result<(), String> {
    if ovule_toolchains::resolve("nodejs", root).is_none() {
        ovule_toolchains::install("nodejs", root)?;
    }
    let script = root
        .join("installs/cf-cli")
        .join(VERSION)
        .join("node_modules/cf/bin/cf");
    ovule_toolchains::install_pinned_npm("cf-cli", root)?;
    if shared.cancel.load(Ordering::Acquire) {
        return Err("Setup cancelled".into());
    }
    let node = ovule_toolchains::resolve("nodejs", root)
        .ok_or("Node.js 22.18+ is required. Install Node.js, then retry")?;
    let version = invoke(
        &node,
        &script,
        root,
        shared,
        &["--version"],
        None,
        false,
        20,
    )?;
    if !version.contains(&format!("v{VERSION}")) {
        return Err("The installed Cloudflare CLI does not match the pinned version".into());
    }
    if let Some(account) = account {
        create_and_save(&node, &script, root, secrets, shared, account)?;
    } else {
        authorize_and_list(&node, &script, root, shared)?;
    }
    Ok(())
}
fn create_and_save(
    node: &Path,
    script: &Path,
    root: &Path,
    secrets: &dyn SecretStore,
    shared: &Arc<Shared>,
    account: &str,
) -> Result<(), String> {
    let pending = shared
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .pending_key
        .clone();
    let config = if let Some((owner, config)) = pending {
        if owner != account {
            return Err("Save the pending Key in its original account first".into());
        }
        config
    } else {
        let output = invoke(
            node,
            script,
            root,
            shared,
            &[
                "realtime",
                "turn",
                "keys",
                "create",
                "--name",
                "Ovule Host",
                "--profile",
                PROFILE,
            ],
            Some(account),
            false,
            60,
        )?;
        let config = turn_configuration(&output)?;
        shared
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending_key = Some((account.into(), config.clone()));
        config
    };
    config.validate()?;
    // Save immediately after create. Do not return or log the API response.
    // If saving fails, retain it in this worker and retry before reporting failure.
    let encoded =
        serde_json::to_string(&config).map_err(|_| "Cannot encode connection configuration")?;
    let mut saved = false;
    for _ in 0..3 {
        if secrets
            .save_provider_credential(crate::provider::CONFIG_REFERENCE, &encoded)
            .is_ok()
        {
            saved = true;
            break;
        }
    }
    if !saved {
        return Err("TURN Key was created but secure storage failed. Retry saving from this card after checking this Host's credential storage. The created Key is retained while this app runs".into());
    }
    shared
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .pending_key = None;
    phase(shared, "configured");
    Ok(())
}
fn authorize_and_list(
    node: &Path,
    script: &Path,
    root: &Path,
    shared: &Arc<Shared>,
) -> Result<(), String> {
    phase(shared, "authorizing");
    invoke(
        node,
        script,
        root,
        shared,
        &[
            "auth",
            "create",
            PROFILE,
            "--no-browser",
            "--no-device",
            "--scopes",
            "account:read",
            "user:read",
            "calls.write",
        ],
        None,
        true,
        600,
    )?;
    phase(shared, "loading-accounts");
    let output = invoke(
        node,
        script,
        root,
        shared,
        &["accounts", "list", "--profile", PROFILE, "--quiet"],
        None,
        false,
        30,
    )?;
    let accounts = parse_accounts(&output)?;
    let mut state = shared
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.accounts = accounts;
    state.phase = "choose-account".into();
    state.url = None;
    state.code = None;
    Ok(())
}

fn turn_configuration(output: &str) -> Result<crate::provider::CloudflareTurnConfig, String> {
    let value: Value =
        serde_json::from_str(output).map_err(|_| "Cloudflare returned an invalid Key response")?;
    let value = value.get("result").unwrap_or(&value);
    let key_id = value["uid"]
        .as_str()
        .filter(|id| valid_account(id))
        .ok_or("Cloudflare returned an invalid Key ID")?;
    // The live API returns `secret`; the published API schema uses `key`.
    // Accept either response without exposing the credential to the card.
    let key = value
        .get("secret")
        .or_else(|| value.get("key"))
        .and_then(Value::as_str)
        .filter(|key| key.len() == 64 && key.bytes().all(|b| b.is_ascii_graphic()))
        .ok_or("Cloudflare returned an invalid TURN Key")?;
    Ok(crate::provider::CloudflareTurnConfig {
        key_id: key_id.into(),
        api_token: key.into(),
    })
}
fn parse_accounts(output: &str) -> Result<Vec<Value>, String> {
    let value: Value =
        serde_json::from_str(output).map_err(|_| "Cloudflare returned an invalid account list")?;
    let items = value
        .get("result")
        .unwrap_or(&value)
        .as_array()
        .ok_or("Cloudflare returned an invalid account list")?;
    if items.is_empty() || items.len() > 1000 {
        return Err("No usable Cloudflare account was returned".into());
    }
    items
        .iter()
        .map(|v| {
            let id = v["id"]
                .as_str()
                .filter(|id| valid_account(id))
                .ok_or("Invalid account ID")?;
            let name = v["name"]
                .as_str()
                .filter(|name| name.len() <= 512)
                .ok_or("Invalid account name")?;
            Ok(json!({"id": id, "name": name}))
        })
        .collect()
}
fn cli_command(
    node: &Path,
    script: &Path,
    root: &Path,
    args: &[&str],
    account: Option<&str>,
) -> Result<Command, String> {
    let cwd = root.join("cloudflare-setup");
    std::fs::create_dir_all(&cwd).map_err(|_| "Cannot prepare the connection setup directory")?;
    let mut command = Command::new(node);
    command
        .arg(script)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLOUDFLARE_AUTH_USE_KEYRING", "true")
        .env("NO_COLOR", "1")
        .env("CI", "true")
        .env("PATH", ovule_toolchains::execution_path(root)?);
    for name in [
        "CF_API_TOKEN",
        "CF_API_KEY",
        "CF_EMAIL",
        "CF_ACCOUNT_ID",
        "WRANGLER_AUTH_DOMAIN",
        "WRANGLER_AUTH_URL",
        "WRANGLER_TOKEN_URL",
        "WRANGLER_REVOKE_URL",
        "CLOUDFLARE_API_BASE_URL",
        "CF_API_BASE_URL",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_EMAIL",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_CLIENT_ID",
        "NODE_OPTIONS",
        "CLOUDFLARE_API_ENVIRONMENT",
        "WRANGLER_API_ENVIRONMENT",
        "WRANGLER_LOG",
    ] {
        command.env_remove(name);
    }
    if let Some(account) = account {
        command.env("CLOUDFLARE_ACCOUNT_ID", account);
    }
    Ok(command)
}
#[allow(clippy::too_many_arguments)] // Fixed executable, environment, timeout and output policy are centralized here.
fn invoke(
    node: &Path,
    script: &Path,
    root: &Path,
    shared: &Arc<Shared>,
    args: &[&str],
    account: Option<&str>,
    login: bool,
    seconds: u64,
) -> Result<String, String> {
    let mut command = cli_command(node, script, root, args, account)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot start the pinned Cloudflare CLI")?;
    let stdout = child.stdout.take().ok_or("CLI output unavailable")?;
    let stderr = child.stderr.take().ok_or("CLI output unavailable")?;
    let shared_output = shared.clone();
    let output = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        for line in BufReader::new(stdout.take((MAX_OUTPUT + 1) as u64)).split(b'\n') {
            let line = line?;
            if login {
                publish_authorization(&shared_output, &String::from_utf8_lossy(&line));
            }
            bytes.extend_from_slice(&line);
            bytes.push(b'\n');
            if bytes.len() > MAX_OUTPUT {
                break;
            }
        }
        Ok::<_, std::io::Error>(bytes)
    });
    let shared_reader = shared.clone();
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        for line in BufReader::new(stderr.take((MAX_OUTPUT + 1) as u64)).lines() {
            let Ok(line) = line else {
                return None;
            };
            text.push_str(&line);
            text.push('\n');
            if text.len() > MAX_OUTPUT {
                return None;
            }
            if login {
                publish_authorization(&shared_reader, &line);
            }
        }
        Some(text)
    });
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline && !shared.cancel.load(Ordering::Acquire) => {
                std::thread::sleep(Duration::from_millis(100));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let bytes = output
        .join()
        .map_err(|_| "CLI output interrupted")?
        .map_err(|_| "CLI output unreadable")?;
    let errors = errors.join().ok().flatten();
    if !result {
        if shared.cancel.load(Ordering::Acquire) {
            return Err("Cloudflare authorization cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err(
                "Cloudflare operation timed out. Check the network or retry authorization".into(),
            );
        }
        return Err(classify_failure(errors.as_deref().unwrap_or(""), login).into());
    }
    if errors.is_none() || bytes.len() > MAX_OUTPUT {
        return Err("Cloudflare output exceeded the safety limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "Invalid CLI output encoding".into())
}
// Return only allowlisted diagnoses, never CLI output (which may contain credentials).
fn classify_failure(output: &str, login: bool) -> &'static str {
    let output = output.to_ascii_lowercase();
    if [
        "fetch failed",
        "enotfound",
        "econn",
        "und_err",
        "certificate",
    ]
    .iter()
    .any(|value| output.contains(value))
    {
        "Cannot reach Cloudflare authorization service. Check this Host's network, proxy and certificates, then retry"
    } else if output.contains("keyring")
        || output.contains("keychain")
        || output.contains("secret-tool")
    {
        "Cloudflare secure credential storage is unavailable. Check this Host's OS credential service and retry"
    } else if output.contains("invalid_scope") || output.contains("invalid scope") {
        "Cloudflare rejected the requested permissions. Update the connectivity plugin and retry"
    } else if output.contains("403") || output.contains("challenge") {
        "Cloudflare blocked the authorization request. Check this Host's network access and retry"
    } else if output.contains("port is already in use") || output.contains("eaddrinuse") {
        "Cloudflare login callback port is in use. Finish the other login or close it, then retry"
    } else if output.contains("access_denied") || output.contains("consent denied") {
        "Cloudflare authorization was declined. Start login again to authorize"
    } else if output.contains("expired_token") {
        "Cloudflare authorization expired. Start login again"
    } else if login {
        "Cloudflare authorization could not start or complete. Retry login"
    } else {
        "Cloudflare operation failed. Check account permissions and network, then retry"
    }
}
fn authorization_url(state: &State) -> Option<String> {
    let mut url = url::Url::parse(state.url.as_deref()?).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("dash.cloudflare.com")
        || !matches!(url.path(), "/oauth2/auth" | "/oauth2/device")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return None;
    }
    if let Some(code) = &state.code {
        // The official CLI uses the same parameter for its default browser link.
        if url.path() != "/oauth2/auth" && !url.query_pairs().any(|(name, _)| name == "user_code") {
            url.query_pairs_mut().append_pair("user_code", code);
        }
    }
    Some(url.to_string())
}
fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    let status = command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| {
            "Could not open the system browser. Check this Host's default browser and retry"
                .to_owned()
        })?;
    if !status.success() {
        return Err("The system browser could not open the authorization page. Check this Host's default browser and retry".into());
    }
    Ok(())
}
fn publish_authorization(shared: &Shared, line: &str) {
    let mut state = shared
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for word in line.split_whitespace() {
        let word = word.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | ','));
        if let Ok(url) = url::Url::parse(word)
            && url.scheme() == "https"
            && url.host_str() == Some("dash.cloudflare.com")
            && matches!(url.path(), "/oauth2/auth" | "/oauth2/device")
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
        {
            state.url = Some(url.to_string());
        }
        if (6..=32).contains(&word.len())
            && line.trim() == word
            && word
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
        {
            state.code = Some(word.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_links_reject_untrusted_system_browser_destinations() {
        for url in [
            "http://dash.cloudflare.com/oauth2/auth",
            "https://dash.cloudflare.com.evil.example/oauth2/auth",
            "https://user:password@dash.cloudflare.com/oauth2/auth",
            "https://dash.cloudflare.com:8443/oauth2/auth",
            "https://dash.cloudflare.com/other",
            "file:///tmp/auth",
        ] {
            assert!(
                authorization_url(&State {
                    url: Some(url.into()),
                    ..State::default()
                })
                .is_none()
            );
        }
    }
    #[test]
    fn only_account_ids_and_turn_credentials_are_accepted() {
        assert!(!valid_account("--profile=other"));
        let account = "a".repeat(32);
        let accounts = parse_accounts(
            &json!([{"id": account, "name": "Personal", "unneeded": "hidden"}]).to_string(),
        )
        .unwrap();
        assert_eq!(accounts[0].as_object().unwrap().len(), 2);
        assert!(turn_configuration(r#"{"uid":"bad","key":"SECRET"}"#).is_err());
        let config = turn_configuration(
            &json!({"result":{"uid":"b".repeat(32),"key":"c".repeat(64)}}).to_string(),
        )
        .unwrap();
        assert_eq!(config.api_token.len(), 64);
        let config =
            turn_configuration(&json!({"uid":"b".repeat(32),"secret":"d".repeat(64)}).to_string())
                .unwrap();
        assert_eq!(config.api_token, "d".repeat(64));
        for secret in [
            json!(null),
            json!(12),
            json!("too-short"),
            json!(" ".repeat(64)),
        ] {
            assert!(
                turn_configuration(&json!({"uid":"b".repeat(32),"secret":secret}).to_string())
                    .is_err()
            );
        }
    }
    #[test]
    fn authorization_output_exposes_only_safe_device_fields() {
        let shared = Shared {
            state: Mutex::new(State::default()),
            cancel: AtomicBool::new(false),
        };
        publish_authorization(&shared, "https://attacker.example/auth ABCD-EFGH");
        assert!(shared.state.lock().unwrap().url.is_none());
        publish_authorization(
            &shared,
            "Visit https://dash.cloudflare.com/oauth2/device?user_code=ABCD-EFGH then enter ABCD-EFGH",
        );
        publish_authorization(&shared, "ABCD-EFGH");
        let state = shared.state.lock().unwrap();
        assert_eq!(state.code.as_deref(), Some("ABCD-EFGH"));
        assert!(
            state
                .url
                .as_ref()
                .unwrap()
                .starts_with("https://dash.cloudflare.com/")
        );
    }
}

#[cfg(all(test, unix))]
mod cli_tests {
    use super::*;
    use std::{ffi::OsString, os::unix::fs::PermissionsExt};
    struct Secrets {
        root: PathBuf,
        saved: Mutex<Option<String>>,
        fail: AtomicBool,
    }
    impl SecretStore for Secrets {
        fn root(&self) -> &Path {
            &self.root
        }
        fn save_channel(
            &self,
            _: &str,
            _: &str,
            _: &str,
            _: Option<&str>,
            _: bool,
        ) -> Result<(), String> {
            unreachable!()
        }
        fn load_channel(
            &self,
            _: &str,
        ) -> Result<Option<ovule_secrets::ChannelCredentials>, String> {
            unreachable!()
        }
        fn save_provider_credential(&self, name: &str, value: &str) -> Result<(), String> {
            assert_eq!(name, crate::provider::CONFIG_REFERENCE);
            if self.fail.load(Ordering::Relaxed) {
                return Err("storage unavailable".into());
            }
            *self.saved.lock().unwrap() = Some(value.into());
            Ok(())
        }
        fn load_provider_credential(&self, _: &str) -> Result<Option<OsString>, String> {
            Ok(None)
        }
        fn has_provider_credential(&self, _: &str) -> Result<bool, String> {
            Ok(false)
        }
        fn save_workspace_credential(&self, _: &str, _: &str) -> Result<String, String> {
            unreachable!()
        }
        fn load_workspace_credential(&self, _: &str) -> Result<Option<String>, String> {
            unreachable!()
        }
        fn load_or_create_workspace_identity(&self, _: &str) -> Result<String, String> {
            unreachable!()
        }
        fn reset_workspace_identity(&self, _: &str) -> Result<(), String> {
            unreachable!()
        }
    }
    #[test]
    fn login_account_selection_and_failed_save_never_return_credentials_or_recreate_key() {
        let root = std::env::temp_dir().join(format!(
            "ovule-cf-fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let node = root.join("fake-node");
        let account = "a".repeat(32);
        let key = "c".repeat(64);
        let id = "b".repeat(32);
        let source = format!(
            r#"#!/bin/sh
shift
[ "$CLOUDFLARE_AUTH_USE_KEYRING" = true ] || exit 1
[ -z "$CLOUDFLARE_API_TOKEN" ] || exit 1
case "$1" in
 auth) case "$*" in *--no-device*calls.write*) ;; *) exit 1;; esac
       printf '%s\n' 'https://dash.cloudflare.com/oauth2/device' 'ABCD-EFGH' >&2;;
 accounts) printf '%s\n' '[{{"id":"{account}","name":"Personal"}}]';;
 realtime) [ "$CLOUDFLARE_ACCOUNT_ID" = '{account}' ] || exit 1
           printf x >> created-count
           printf '%s\n' '{{"uid":"{id}","secret":"{key}"}}';;
 *) exit 1;;
esac
"#
        );
        std::fs::write(&node, source).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        let secrets = Arc::new(Secrets {
            root: root.clone(),
            saved: Mutex::new(None),
            fail: AtomicBool::new(true),
        });
        let setup = CloudflareSetup::new(secrets.clone(), root.clone());
        authorize_and_list(&node, Path::new("unused"), &root, &setup.shared).unwrap();
        assert_eq!(
            setup.shared.state.lock().unwrap().accounts[0]["id"],
            account
        );
        assert!(setup.start(Some("d".repeat(32))).is_err());
        assert!(
            create_and_save(
                &node,
                Path::new("unused"),
                &root,
                secrets.as_ref(),
                &setup.shared,
                &account
            )
            .is_err()
        );
        assert!(setup.snapshot().data_json.contains("pendingSave"));
        assert!(!setup.snapshot().data_json.contains(&key));
        assert!(setup.start(None).is_err());
        secrets.fail.store(false, Ordering::Relaxed);
        create_and_save(
            &node,
            Path::new("unused"),
            &root,
            secrets.as_ref(),
            &setup.shared,
            &account,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("cloudflare-setup/created-count")).unwrap(),
            "x"
        );
        let saved: Value =
            serde_json::from_str(secrets.saved.lock().unwrap().as_ref().unwrap()).unwrap();
        assert_eq!(saved["apiToken"], key);
        assert_eq!(setup.shared.state.lock().unwrap().phase, "configured");
        assert!(!setup.snapshot().data_json.contains(&key));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pkce_login_opens_once_and_can_be_reopened_without_restart() {
        let mut setup = CloudflareSetup::new(
            Arc::new(Secrets {
                root: PathBuf::new(),
                saved: Mutex::new(None),
                fail: AtomicBool::new(false),
            }),
            PathBuf::new(),
        );
        phase(&setup.shared, "authorizing");
        publish_authorization(
            &setup.shared,
            "Visit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?state=synthetic&code_challenge=synthetic",
        );
        assert!(
            setup
                .snapshot()
                .open_url
                .unwrap()
                .contains("code_challenge=synthetic")
        );
        assert!(setup.snapshot().open_url.is_none());
        let opened = Arc::new(Mutex::new(Vec::new()));
        let captured = opened.clone();
        setup.browser_opener = Arc::new(move |url| {
            captured.lock().unwrap().push(url.to_owned());
            Ok(())
        });
        let external = setup
            .run(ExtensionActionHandler::ConnectivityOpenExternal, None)
            .unwrap();
        assert!(external.open_url.is_none());
        assert!(external.data_json.contains("authorizing"));
        for _ in 0..100 {
            if !opened.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            opened.lock().unwrap().as_slice(),
            &["https://dash.cloudflare.com/oauth2/auth?state=synthetic&code_challenge=synthetic"]
        );
        assert!(
            setup
                .run(ExtensionActionHandler::ConnectivityOpen, None)
                .unwrap()
                .open_url
                .is_some()
        );
        setup.browser_opener = Arc::new(|_| Err("System browser launch failed".into()));
        setup
            .run(ExtensionActionHandler::ConnectivityOpenExternal, None)
            .unwrap();
        for _ in 0..100 {
            if setup
                .snapshot()
                .data_json
                .contains("System browser launch failed")
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            setup
                .snapshot()
                .data_json
                .contains("System browser launch failed")
        );
        assert!(setup.shared.state.lock().unwrap().url.is_some());
        phase(&setup.shared, "choose-account");
        assert!(
            setup
                .run(ExtensionActionHandler::ConnectivityOpenExternal, None)
                .is_err()
        );
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert!(
            setup
                .run(ExtensionActionHandler::ConnectivityOpen, None)
                .is_err()
        );
    }
    #[test]
    fn failures_distinguish_network_storage_and_consent_without_echoing_output() {
        for (output, expected) in [
            ("fetch failed SECRET", "network"),
            ("keyring backend unavailable SECRET", "credential storage"),
            ("invalid_scope SECRET", "permissions"),
            ("HTTP 403 SECRET", "blocked"),
            ("Consent denied SECRET", "declined"),
            ("expired_token SECRET", "expired"),
        ] {
            let error = classify_failure(output, true);
            assert!(error.contains(expected));
            assert!(!error.contains("SECRET"));
        }
    }
    #[test]
    fn cancelled_cli_errors_are_sanitized() {
        let root = std::env::temp_dir().join(format!("ovule-cf-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let node = root.join("fake-node");
        std::fs::write(
            &node,
            "#!/bin/sh\nprintf 'SECRET-MUST-NOT-ESCAPE' >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            cancel: AtomicBool::new(true),
        });
        let error = invoke(
            &node,
            Path::new("unused"),
            &root,
            &shared,
            &["auth"],
            None,
            true,
            1,
        )
        .unwrap_err();
        assert!(!error.contains("SECRET-MUST-NOT-ESCAPE"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
