//! This device's durable preference and application-owned idle sleep request.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct HostPowerStatus {
    pub keep_awake: bool,
    pub active: bool,
    pub supported: bool,
    pub error: Option<String>,
}

pub trait HostPower: Send + Sync {
    fn status(&self) -> HostPowerStatus;
    fn set_keep_awake(&self, enabled: bool) -> Result<HostPowerStatus, String>;
    fn shutdown(&self);
}
pub type HostPowerService = tuffite_ioc::Service<dyn HostPower>;
pub struct HostPowerSettingsPath(pub PathBuf);

trait Lease: Send + Sync {}
impl Lease for ovule_platform::power::IdleSleepInhibitor {}
trait Backend: Send + Sync {
    fn supported(&self) -> bool;
    fn acquire(&self) -> Result<Box<dyn Lease>, String>;
}
struct NativeBackend;
impl Backend for NativeBackend {
    fn supported(&self) -> bool {
        ovule_platform::power::supported()
    }
    fn acquire(&self) -> Result<Box<dyn Lease>, String> {
        ovule_platform::power::IdleSleepInhibitor::acquire()
            .map(|guard| Box::new(guard) as Box<dyn Lease>)
    }
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct Preference {
    keep_awake: bool,
}
#[derive(Default)]
struct State {
    preference: Preference,
    lease: Option<Box<dyn Lease>>,
    error: Option<String>,
    stopped: bool,
}
pub(super) struct NativeHostPower {
    path: PathBuf,
    backend: Arc<dyn Backend>,
    state: Mutex<State>,
}
impl NativeHostPower {
    pub(super) fn new(path: PathBuf) -> Self {
        Self::with_backend(path, Arc::new(NativeBackend))
    }
    fn with_backend(path: PathBuf, backend: Arc<dyn Backend>) -> Self {
        let mut state = State::default();
        match read_preference(&path) {
            Ok(preference) => {
                state.preference = preference;
                if state.preference.keep_awake {
                    match backend.acquire() {
                        Ok(lease) => state.lease = Some(lease),
                        Err(error) => state.error = Some(error),
                    }
                }
            }
            Err(error) => state.error = Some(error),
        }
        Self {
            path,
            backend,
            state: Mutex::new(state),
        }
    }
    fn view(&self, state: &State) -> HostPowerStatus {
        HostPowerStatus {
            keep_awake: state.preference.keep_awake,
            active: state.lease.is_some(),
            supported: self.backend.supported(),
            error: state.error.clone(),
        }
    }
}
impl HostPower for NativeHostPower {
    fn status(&self) -> HostPowerStatus {
        self.view(
            &self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
    fn set_keep_awake(&self, enabled: bool) -> Result<HostPowerStatus, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Host power settings lock poisoned")?;
        if state.stopped {
            return Err("This Host is shutting down".into());
        }
        let changed = (|| {
            // Acquire before committing. Persistence failure drops this new
            // lease and leaves the previous setting/request intact.
            let lease = if enabled && state.lease.is_none() {
                Some(self.backend.acquire()?)
            } else {
                None
            };
            let preference = Preference {
                keep_awake: enabled,
            };
            write_preference(&self.path, &preference)?;
            if !enabled {
                state.lease = None;
            } else if let Some(lease) = lease {
                state.lease = Some(lease);
            }
            state.preference = preference;
            Ok::<(), String>(())
        })();
        state.error = changed.as_ref().err().cloned();
        changed?;
        Ok(self.view(&state))
    }
    fn shutdown(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.stopped = true;
        state.lease = None;
    }
}

fn read_preference(path: &Path) -> Result<Preference, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Read Host power settings: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preference::default()),
        Err(error) => Err(format!("Read Host power settings: {error}")),
    }
}
fn write_preference(path: &Path, preference: &Preference) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Host power settings path has no parent")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Save Host power settings: {error}"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Save Host power settings: {error}"))?;
    serde_json::to_writer(file.as_file_mut(), preference)
        .map_err(|error| format!("Save Host power settings: {error}"))?;
    file.as_file()
        .sync_all()
        .map_err(|error| format!("Save Host power settings: {error}"))?;
    file.persist(path)
        .map_err(|error| format!("Save Host power settings: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests;
