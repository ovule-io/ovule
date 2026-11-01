use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use processkit::{CancellationToken, Command, OutputBufferPolicy, ProcessEvent, Stdin};
use serde_json::json;
use tokio_stream::StreamExt as _;
use tuffite::EventEmitter;

use ovule_conversation::AttemptPrerequisites;
use ovule_toolchains as toolchains;
use ovule_workspace::state::AttemptSpec;

const MODEL_EVENT: &str = "ovule:ollama-model-changed";
const PULL_TIMEOUT: Duration = Duration::from_hours(4);
const PULL_INACTIVITY_TIMEOUT: Duration = Duration::from_mins(15);
const SERVICE_START_TIMEOUT: Duration = Duration::from_secs(15);

use crate::OllamaModelJobView;

#[derive(Clone)]
struct ModelJob {
    status: String,
    detail: String,
    error: Option<String>,
}

pub struct OllamaRuntime {
    runtime: Option<tokio::runtime::Runtime>,
    active: Arc<AtomicBool>,
    managed_toolchains: PathBuf,
    events: EventEmitter,
    jobs: Arc<Mutex<HashMap<String, ModelJob>>>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    server: Arc<Mutex<Option<Child>>>,
    owns_service: Arc<Mutex<bool>>,
}

#[derive(Clone)]
pub(crate) struct OllamaHandle {
    runtime: tokio::runtime::Handle,
    active: Arc<AtomicBool>,
    managed_toolchains: PathBuf,
    events: EventEmitter,
    jobs: Arc<Mutex<HashMap<String, ModelJob>>>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    server: Arc<Mutex<Option<Child>>>,
    owns_service: Arc<Mutex<bool>>,
}

impl OllamaRuntime {
    pub fn new(managed_toolchains: PathBuf, events: EventEmitter) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ovule-ollama")
            .enable_all()
            .build()
            .map_err(|error| format!("create Ollama runtime: {error}"))?;
        Ok(Self {
            runtime: Some(runtime),
            active: Arc::new(AtomicBool::new(true)),
            managed_toolchains,
            events,
            jobs: Arc::new(Mutex::new(HashMap::new())),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            server: Arc::new(Mutex::new(None)),
            owns_service: Arc::new(Mutex::new(false)),
        })
    }

    pub(crate) fn handle(&self) -> OllamaHandle {
        OllamaHandle {
            runtime: self
                .runtime
                .as_ref()
                .expect("Ollama handle requested during shutdown")
                .handle()
                .clone(),
            active: Arc::clone(&self.active),
            managed_toolchains: self.managed_toolchains.clone(),
            events: self.events.clone(),
            jobs: Arc::clone(&self.jobs),
            cancellations: Arc::clone(&self.cancellations),
            server: Arc::clone(&self.server),
            owns_service: Arc::clone(&self.owns_service),
        }
    }

    pub fn shutdown(&mut self, timeout: Duration) {
        self.active.store(false, Ordering::Release);
        for token in lock(&self.cancellations).values() {
            token.cancel();
        }
        let deadline = Instant::now() + timeout;
        while !lock(&self.cancellations).is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if *lock(&self.owns_service)
            && let Some(mut child) = lock(&self.server).take()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_timeout(timeout);
        }
    }
}

impl OllamaHandle {
    fn ensure_active(&self) -> Result<(), String> {
        self.active
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "Ollama runtime is shutting down".to_owned())
    }

    pub(crate) fn discover_models(&self) -> Result<Vec<String>, String> {
        self.ensure_service()?;
        api_models()
    }

    pub(crate) fn jobs(&self) -> Vec<OllamaModelJobView> {
        let mut jobs = lock(&self.jobs)
            .iter()
            .map(|(model, job)| job_view(model, job))
            .collect::<Vec<_>>();
        jobs.sort_by(|left, right| left.model.cmp(&right.model));
        jobs
    }

    pub(crate) fn start_pull(&self, model: &str) -> Result<OllamaModelJobView, String> {
        let model = validate_model_name(model)?;
        self.ensure_service()?;
        if let Some(job) = lock(&self.jobs).get(&model)
            && job.status == "pulling"
        {
            return Ok(job_view(&model, job));
        }
        let executable = toolchains::resolve("ollama", &self.managed_toolchains)
            .ok_or_else(|| "Ollama Toolchain is not installed".to_owned())?;
        let cancellation = CancellationToken::new();
        lock(&self.cancellations).insert(model.clone(), cancellation.clone());
        let initial = ModelJob {
            status: "pulling".to_owned(),
            detail: format!("Preparing {model}"),
            error: None,
        };
        lock(&self.jobs).insert(model.clone(), initial.clone());
        emit_job(&self.events, &model, &initial);

        let jobs = Arc::clone(&self.jobs);
        let cancellations = Arc::clone(&self.cancellations);
        let events = self.events.clone();
        let job_model = model.clone();
        self.runtime.spawn(async move {
            let result = run_pull(&executable, &job_model, cancellation, &jobs, &events).await;
            let terminal = match result {
                Ok(()) => ModelJob {
                    status: "succeeded".to_owned(),
                    detail: format!("{job_model} is installed and ready"),
                    error: None,
                },
                Err(error) => ModelJob {
                    status: "failed".to_owned(),
                    detail: format!("Failed to pull {job_model}"),
                    error: Some(error),
                },
            };
            lock(&jobs).insert(job_model.clone(), terminal.clone());
            lock(&cancellations).remove(&job_model);
            emit_job(&events, &job_model, &terminal);
        });
        Ok(job_view(&model, &initial))
    }

    fn ensure_service(&self) -> Result<(), String> {
        self.ensure_active()?;
        let executable = toolchains::resolve("ollama", &self.managed_toolchains)
            .ok_or_else(|| "Ollama Toolchain is not installed".to_owned())?;
        if api_models().is_ok() {
            return Ok(());
        }
        {
            let mut server = lock(&self.server);
            if let Some(child) = server.as_mut()
                && child.try_wait().ok().flatten().is_some()
            {
                *server = None;
            }
            if server.is_none() {
                let managed = executable.starts_with(self.managed_toolchains.join("installs"));
                let mut command = hidden_command(&executable);
                command.arg("serve");
                if managed {
                    let models = self.managed_toolchains.join("models/ollama");
                    std::fs::create_dir_all(&models).map_err(|error| {
                        format!("create private Ollama model directory: {error}")
                    })?;
                    command.env("OLLAMA_MODELS", models);
                }
                let child = command
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|error| format!("start Ollama service: {error}"))?;
                *server = Some(child);
                *lock(&self.owns_service) = true;
            }
        }
        let deadline = Instant::now() + SERVICE_START_TIMEOUT;
        while Instant::now() < deadline {
            if api_models().is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("Ollama was found but its local service did not become ready".to_owned())
    }
}

impl AttemptPrerequisites for OllamaHandle {
    fn prepare(&self, spec: &AttemptSpec) -> Result<(), String> {
        if spec.driver == "ovule" && spec.model_provider.as_deref() == Some("ollama") {
            self.ensure_service()?;
        }
        Ok(())
    }
}

async fn run_pull(
    executable: &Path,
    model: &str,
    cancellation: CancellationToken,
    jobs: &Mutex<HashMap<String, ModelJob>>,
    events: &EventEmitter,
) -> Result<(), String> {
    let mut run = Command::new(executable)
        .args(["pull", model])
        .create_no_window()
        .stdin(Stdin::empty())
        .cancel_on(cancellation)
        .timeout(PULL_TIMEOUT)
        .inactivity_timeout(PULL_INACTIVITY_TIMEOUT)
        .output_buffer(OutputBufferPolicy::bounded(500).with_max_bytes(256 * 1024))
        .start()
        .await
        .map_err(|error| format!("start Ollama model pull: {error}"))?;
    let mut stream = run
        .events()
        .map_err(|error| format!("observe Ollama model pull: {error}"))?;
    let render = async {
        while let Some(event) = stream.next().await {
            if let ProcessEvent::Stdout(line) | ProcessEvent::Stderr(line) = event {
                let detail = line.text().trim();
                if detail.is_empty() {
                    continue;
                }
                let job = ModelJob {
                    status: "pulling".to_owned(),
                    detail: detail.chars().take(240).collect(),
                    error: None,
                };
                lock(jobs).insert(model.to_owned(), job.clone());
                emit_job(events, model, &job);
            }
        }
    };
    let ((), finished) = tokio::join!(render, run.finish());
    let finished = finished.map_err(|error| format!("pull Ollama model: {error}"))?;
    if finished.outcome.code() == Some(0) {
        Ok(())
    } else {
        let diagnostic = finished
            .stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Ollama model pull failed");
        Err(format!("{diagnostic} ({})", finished.outcome.name()))
    }
}

fn validate_model_name(model: &str) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty()
        || model.len() > 160
        || !model
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
        || !model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/' | ':')
        })
        || model.split('/').any(|component| component == "..")
    {
        return Err("invalid Ollama model name".to_owned());
    }
    Ok(model.to_owned())
}

fn api_models() -> Result<Vec<String>, String> {
    let host = std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "127.0.0.1:11434".to_owned());
    let base = if host.starts_with("http://") || host.starts_with("https://") {
        host
    } else {
        format!("http://{host}")
    };
    let url = format!("{}/api/tags", base.trim_end_matches('/'));
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_millis(350)))
        .timeout_recv_response(Some(Duration::from_millis(500)))
        .timeout_recv_body(Some(Duration::from_secs(1)))
        .build()
        .into();
    let mut response = agent
        .get(&url)
        .call()
        .map_err(|error| format!("Ollama service is unavailable at {url}: {error}"))?;
    let source = response
        .body_mut()
        .with_config()
        .limit(1024 * 1024)
        .read_to_string()
        .map_err(|error| format!("read Ollama model catalog: {error}"))?;
    parse_model_catalog(&source)
}

fn parse_model_catalog(source: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(source)
        .map_err(|error| format!("parse Ollama model catalog: {error}"))?;
    Ok(value
        .get("models")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            model
                .get("name")
                .or_else(|| model.get("model"))
                .and_then(serde_json::Value::as_str)
        })
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect())
}

#[allow(unused_mut)] // The command is mutated only on Windows.
fn hidden_command(executable: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn emit_job(events: &EventEmitter, model: &str, job: &ModelJob) {
    let payload = serde_json::to_vec(&json!({
        "model": model,
        "status": job.status,
        "detail": job.detail,
        "error": job.error,
    }))
    .unwrap_or_default();
    if let Err(error) = events.emit(MODEL_EVENT, &payload) {
        tracing::warn!(%error, "broadcast Ollama model state");
    }
}

fn job_view(model: &str, job: &ModelJob) -> OllamaModelJobView {
    OllamaModelJobView {
        model: model.to_owned(),
        status: job.status.clone(),
        detail: job.detail.clone(),
        error: job.error.clone(),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Drop for OllamaRuntime {
    fn drop(&mut self) {
        self.shutdown(Duration::from_secs(5));
    }
}

impl crate::OllamaRuntime for OllamaRuntime {
    fn shutdown(&mut self, timeout: Duration) {
        Self::shutdown(self, timeout);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ollama_catalog_and_validates_model_references() {
        assert_eq!(
            parse_model_catalog(r#"{"models":[{"name":"qwen3:4b"}]}"#).unwrap(),
            ["qwen3:4b"]
        );
        assert_eq!(validate_model_name("qwen3:4b").unwrap(), "qwen3:4b");
        assert!(validate_model_name("--help").is_err());
        assert!(validate_model_name("../escape").is_err());
    }
}
