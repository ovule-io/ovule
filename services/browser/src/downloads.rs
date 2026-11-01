//! Explorer download history. Native Chromium cache files stay in place for
//! readDownload/PDF; user-visible copies never overwrite an existing file.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Download {
    pub id: String,
    pub source: String,
    pub path: String,
    pub filename: String,
    pub url: String,
    pub bytes: u64,
    pub created_at: u64,
    #[serde(default)]
    pub removed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(root: &Path, guid: &str) -> PathBuf {
        let directory = root.join("Downloads").join(guid);
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("report.pdf");
        fs::write(&file, guid.as_bytes()).unwrap();
        file
    }
    #[test]
    fn completed_downloads_are_published_without_overwrites_and_survive_restart() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("profile");
        let destination = temp.path().join("chosen");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("report.pdf"), "existing user file").unwrap();
        let store = Downloads::open(&temp.path().join("state")).unwrap();
        store.set_directory(destination.to_str().unwrap()).unwrap();
        let first = source(&profile, "a");
        let second = source(&profile, "b");
        let one = store
            .publish(&first, &profile, "https://example.test/a")
            .unwrap();
        let two = store
            .publish(&second, &profile, "https://example.test/b")
            .unwrap();
        assert_eq!(one.filename, "report (1).pdf");
        assert_eq!(two.filename, "report (2).pdf");
        assert_eq!(
            fs::read_to_string(destination.join("report.pdf")).unwrap(),
            "existing user file"
        );
        assert_eq!(fs::read_to_string(&one.path).unwrap(), "a");
        assert!(
            first.exists(),
            "the Chromium PDF cache must remain readable"
        );
        assert_eq!(store.publish(&first, &profile, "").unwrap().id, one.id);
        drop(store);
        assert_eq!(
            Downloads::open(&temp.path().join("state"))
                .unwrap()
                .list()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn delete_removes_the_published_file_and_tombstones_replayed_downloads() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("profile");
        let file = source(&profile, "a");
        let destination = temp.path().join("chosen");
        fs::create_dir(&destination).unwrap();
        let store = Downloads::open(&temp.path().join("state")).unwrap();
        store.set_directory(destination.to_str().unwrap()).unwrap();
        let item = store.publish(&file, &profile, "").unwrap();
        assert!(store.remove(&item.id).unwrap());
        assert!(!Path::new(&item.path).exists());
        assert!(
            file.exists(),
            "the internal browser cache remains owned by Chromium"
        );
        assert!(store.list().unwrap().is_empty());
        assert!(store.publish(&file, &profile, "").unwrap().removed);
        assert!(store.path(&item.id).is_err());
        let reopened = Downloads::open(&temp.path().join("state")).unwrap();
        assert!(reopened.list().unwrap().is_empty());
    }
    #[test]
    fn deletion_failure_keeps_history_and_missing_files_can_be_removed() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("profile");
        let destination = temp.path().join("chosen");
        fs::create_dir(&destination).unwrap();
        let store = Downloads::open(&temp.path().join("state")).unwrap();
        store.set_directory(destination.to_str().unwrap()).unwrap();
        let item = store.publish(&source(&profile, "a"), &profile, "").unwrap();
        fs::remove_file(&item.path).unwrap();
        fs::create_dir(&item.path).unwrap();
        assert!(store.remove(&item.id).is_err());
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(
            !store
                .publish(&source(&profile, "a"), &profile, "")
                .unwrap()
                .removed
        );
        fs::remove_dir(&item.path).unwrap();
        assert!(store.remove(&item.id).unwrap());
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn rejects_arbitrary_files_and_symlink_escapes() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let outside = temp.path().join("outside");
        fs::write(&outside, "private").unwrap();
        let store = Downloads::open(&temp.path().join("state")).unwrap();
        assert!(store.publish(&outside, &profile, "").is_err());
        #[cfg(unix)]
        {
            let link = profile.join("Downloads").join("link");
            fs::create_dir_all(link.parent().unwrap()).unwrap();
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(store.publish(&link, &profile, "").is_err());
        }
        assert!(store.set_directory("relative/path").is_err());
    }
}
#[derive(Default, Serialize, Deserialize)]
struct State {
    directory: Option<PathBuf>,
    next_id: u64,
    downloads: Vec<Download>,
}
pub struct Downloads {
    path: PathBuf,
    state: Mutex<State>,
    profile: Mutex<Option<PathBuf>>,
}
pub type DownloadsRuntime = tuffite_ioc::Service<Downloads>;
impl Downloads {
    pub fn open(root: &Path) -> Result<Self, String> {
        let path = root.join("downloads.json");
        let state = match fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("read download history: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            path,
            state: Mutex::new(state),
            profile: Mutex::new(None),
        })
    }
    pub fn set_profile(&self, profile: PathBuf) -> Result<(), String> {
        *self
            .profile
            .lock()
            .map_err(|_| "download profile lock poisoned")? = Some(profile);
        Ok(())
    }
    pub fn publish_owned(&self, source: &Path, url: &str) -> Result<Download, String> {
        let profile = self
            .profile
            .lock()
            .map_err(|_| "download profile lock poisoned")?
            .clone()
            .ok_or("Browser download profile unavailable")?;
        self.publish(source, &profile, url)
    }
    fn save(&self, state: &State) -> Result<(), String> {
        fs::create_dir_all(self.path.parent().ok_or("download history has no parent")?)
            .map_err(|e| e.to_string())?;
        let temp = self.path.with_extension("json.tmp");
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(state).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        ovule_platform::files::replace(&temp, &self.path).map_err(|e| e.to_string())
    }
    pub fn directory(&self) -> Result<PathBuf, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "download history lock poisoned")?;
        state
            .directory
            .clone()
            .map_or_else(ovule_platform::identity::downloads_directory, Ok)
    }
    pub fn set_directory(&self, path: &str) -> Result<PathBuf, String> {
        let directory = if path.is_empty() {
            ovule_platform::identity::downloads_directory()?
        } else {
            PathBuf::from(path)
        };
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("Choose an existing absolute download directory".into());
        }
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "download history lock poisoned")?;
        let previous = state.directory.replace(directory.clone());
        if let Err(error) = self.save(&state) {
            state.directory = previous;
            return Err(error);
        }
        Ok(directory)
    }
    pub fn list(&self) -> Result<Vec<Download>, String> {
        Ok(self
            .state
            .lock()
            .map_err(|_| "download history lock poisoned")?
            .downloads
            .iter()
            .filter(|item| !item.removed)
            .cloned()
            .collect())
    }
    pub fn publish(&self, source: &Path, profile: &Path, url: &str) -> Result<Download, String> {
        let source = source.canonicalize().map_err(|e| e.to_string())?;
        let root = profile.canonicalize().map_err(|e| e.to_string())?;
        let relative = source
            .strip_prefix(&root)
            .map_err(|_| "Source is outside this application's browser profile")?;
        if !relative
            .components()
            .any(|part| part.as_os_str() == "Downloads")
            || !source.is_file()
        {
            return Err("Source is not an owned browser download".into());
        }
        let directory = self.directory()?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "download history lock poisoned")?;
        let source_name = source.to_string_lossy().into_owned();
        if let Some(item) = state
            .downloads
            .iter()
            .find(|item| item.source == source_name)
        {
            return Ok(item.clone());
        }
        let name = source
            .file_name()
            .ok_or("download has no filename")?
            .to_string_lossy()
            .into_owned();
        let stem = source
            .file_stem()
            .ok_or("download has no name")?
            .to_string_lossy();
        let extension = source
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy()))
            .unwrap_or_default();
        let mut input = fs::File::open(&source).map_err(|error| error.to_string())?;
        let (target, mut output) = (0..10_000)
            .find_map(|index| {
                let target = directory.join(if index == 0 {
                    name.clone()
                } else {
                    format!("{stem} ({index}){extension}")
                });
                match fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                {
                    Ok(file) => Some(Ok((target, file))),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => None,
                    Err(e) => Some(Err(e.to_string())),
                }
            })
            .ok_or("Too many downloads with the same filename")??;
        let copied = std::io::copy(&mut input, &mut output);
        let bytes = match copied {
            Ok(bytes) => bytes,
            Err(e) => {
                let _ = fs::remove_file(&target);
                return Err(e.to_string());
            }
        };
        if let Err(error) = output.sync_all() {
            let _ = fs::remove_file(&target);
            return Err(error.to_string());
        }
        state.next_id += 1;
        let item = Download {
            id: format!("download-{}", state.next_id),
            source: source_name,
            path: target.to_string_lossy().into_owned(),
            filename: target
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            url: url.chars().take(8192).collect(),
            bytes,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            removed: false,
        };
        state.downloads.push(item.clone());
        if let Err(error) = self.save(&state) {
            state.downloads.pop();
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        Ok(item)
    }
    pub fn path(&self, id: &str) -> Result<PathBuf, String> {
        self.state
            .lock()
            .map_err(|_| "download history lock poisoned")?
            .downloads
            .iter()
            .find(|item| item.id == id && !item.removed)
            .map(|item| PathBuf::from(&item.path))
            .ok_or_else(|| "Download record not found".into())
    }
    pub fn remove(&self, id: &str) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "download history lock poisoned")?;
        let Some(item) = state
            .downloads
            .iter_mut()
            .find(|item| item.id == id && !item.removed)
        else {
            return Ok(false);
        };
        // Only remove the exact native-owned published path, never a renderer-supplied path.
        // Missing files can still have their stale history removed. Other failures leave
        // the record available for retry and for revealing the original location.
        match fs::remove_file(&item.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not delete downloaded file: {error}")),
        }
        item.removed = true;
        if let Err(error) = self.save(&state) {
            if let Some(item) = state.downloads.iter_mut().find(|item| item.id == id) {
                item.removed = false;
            }
            return Err(error);
        }
        Ok(true)
    }
}
