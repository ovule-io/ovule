use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tuffite::{ChromiumExecutor, EventEmitter, TaskPriority};

use ovule_toolchains::{self as toolchains, ToolchainView};

const TOOLCHAIN_EVENT: &str = "ovule:toolchain-changed";

#[derive(Clone, Default)]
struct InstallJob {
    status: String,
    error: Option<String>,
    detail: Option<String>,
}

pub struct ToolchainJobs {
    root: PathBuf,
    executor: ChromiumExecutor,
    events: EventEmitter,
    jobs: Arc<Mutex<HashMap<String, InstallJob>>>,
}

impl ToolchainJobs {
    pub fn new(root: PathBuf, executor: ChromiumExecutor, events: EventEmitter) -> Self {
        Self {
            root,
            executor,
            events,
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn status(&self) -> Result<Vec<ToolchainView>, String> {
        let views = toolchains::status(&self.root)?;
        Ok(apply_jobs(views, &self.jobs))
    }

    pub fn onboarding_status(&self) -> Result<Vec<ToolchainView>, String> {
        let views = toolchains::onboarding_status(&self.root)?;
        Ok(apply_jobs(views, &self.jobs))
    }

    pub fn start_install(&self, id: &str) -> Result<Vec<ToolchainView>, String> {
        let current = self.status()?;
        let requested = current
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("unknown managed Toolchain: {id}"))?;
        if requested.available {
            return Ok(current);
        }
        if !requested.installable {
            return Err(format!(
                "{} cannot be installed: {}",
                requested.label, requested.detail
            ));
        }
        {
            let mut jobs = lock_jobs(&self.jobs);
            if jobs.get(id).is_some_and(|job| job.status == "installing") {
                return Ok(current);
            }
            jobs.insert(
                id.to_owned(),
                InstallJob {
                    status: "installing".to_owned(),
                    error: None,
                    detail: Some(format!("Installing {}…", requested.label)),
                },
            );
        }
        emit_job(&self.events, id, "installing", None);

        let root = self.root.clone();
        let job_id = id.to_owned();
        let jobs = Arc::clone(&self.jobs);
        let events = self.events.clone();
        if let Err(error) = self
            .executor
            .post(TaskPriority::UserVisible, true, move || {
                let outcome = toolchains::install_with_progress(&job_id, &root, |detail| {
                    if let Some(job) = lock_jobs(&jobs).get_mut(&job_id) {
                        job.detail = Some(detail.to_owned());
                    }
                })
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.id == job_id && item.available)
                        .map(|_| ())
                        .ok_or_else(|| {
                            "installation completed but the readiness probe failed".to_owned()
                        })
                });
                let (status, error) = match outcome {
                    Ok(()) => ("succeeded", None),
                    Err(error) => ("failed", Some(error)),
                };
                lock_jobs(&jobs).insert(
                    job_id.clone(),
                    InstallJob {
                        status: status.to_owned(),
                        error: error.clone(),
                        detail: None,
                    },
                );
                emit_job(&events, &job_id, status, error.as_deref());
            })
        {
            let message = error.to_string();
            lock_jobs(&self.jobs).insert(
                id.to_owned(),
                InstallJob {
                    status: "failed".to_owned(),
                    error: Some(message.clone()),
                    detail: None,
                },
            );
            return Err(message);
        }
        self.status()
    }
}

fn emit_job(events: &EventEmitter, id: &str, status: &str, error: Option<&str>) {
    let payload = serde_json::to_vec(&json!({"id": id, "status": status, "error": error}))
        .unwrap_or_default();
    if let Err(error) = events.emit(TOOLCHAIN_EVENT, &payload) {
        tracing::warn!(%error, "broadcast Toolchain installation state");
    }
}

fn apply_jobs(
    mut views: Vec<ToolchainView>,
    jobs: &Mutex<HashMap<String, InstallJob>>,
) -> Vec<ToolchainView> {
    let jobs = lock_jobs(jobs);
    for view in &mut views {
        if view.available {
            "succeeded".clone_into(&mut view.install_status);
            view.install_error = None;
            continue;
        }
        if let Some(job) = jobs.get(&view.id) {
            view.install_status.clone_from(&job.status);
            view.install_error.clone_from(&job.error);
            if let Some(detail) = &job.detail {
                view.detail.clone_from(detail);
            }
        }
    }
    views
}

fn lock_jobs(
    jobs: &Mutex<HashMap<String, InstallJob>>,
) -> std::sync::MutexGuard<'_, HashMap<String, InstallJob>> {
    jobs.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
