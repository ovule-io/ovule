//! User-owned shell launch configuration. Workspace files never select executables.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub starting_directory: Option<PathBuf>,
}

impl ShellProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 128
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || self.name.trim().is_empty()
            || self.name.len() > 128
        {
            return Err("Invalid shell profile identity".into());
        }
        if !self.path.is_absolute()
            || !self.path.is_file()
            || self.args.len() > 64
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 8192 || arg.contains('\0'))
            || self.env.len() > 128
            || self.env.iter().any(|(key, value)| {
                key.is_empty()
                    || key.contains(['=', '\0'])
                    || value.contains('\0')
                    || value.len() > 32768
            })
        {
            return Err(
                "Shell profiles require an absolute executable and bounded arguments/environment"
                    .into(),
            );
        }
        if self
            .starting_directory
            .as_ref()
            .is_some_and(|path| !path.is_absolute() || !path.is_dir())
        {
            return Err("Shell starting directory must be an existing absolute directory".into());
        }
        Ok(())
    }
}

fn load(root: &Path) -> Result<Vec<ShellProfile>, String> {
    let path = root.join("terminal-profiles.json");
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 256 * 1024 {
                return Err("Shell profile configuration exceeds 256 KiB".into());
            }
            let profiles: Vec<ShellProfile> =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            validate(&profiles)?;
            Ok(profiles)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(detect()),
        Err(error) => Err(format!("Read shell profiles: {error}")),
    }
}

pub struct ShellProfiles {
    root: PathBuf,
    write: std::sync::Mutex<()>,
}
impl ShellProfiles {
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            write: std::sync::Mutex::new(()),
        }
    }
    pub fn list(&self) -> Result<Vec<ShellProfile>, String> {
        load(&self.root)
    }
    pub fn configure(&self, json: &str) -> Result<(), String> {
        if json.len() > 256 * 1024 {
            return Err("Shell profiles exceed 256 KiB".into());
        }
        let profiles: Vec<ShellProfile> = serde_json::from_str(json).map_err(|e| e.to_string())?;
        validate(&profiles)?;
        let _write = self
            .write
            .lock()
            .map_err(|_| "Shell profile store poisoned")?;
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let path = self.root.join("terminal-profiles.json");
        let temporary = self.root.join("terminal-profiles.json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec_pretty(&profiles).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        ovule_platform::files::replace(&temporary, &path).map_err(|e| e.to_string())
    }
}

pub(crate) fn validate(profiles: &[ShellProfile]) -> Result<(), String> {
    if profiles.is_empty() || profiles.len() > 32 {
        return Err("Configure between 1 and 32 shell profiles".into());
    }
    let mut ids = std::collections::HashSet::new();
    for profile in profiles {
        profile.validate()?;
        if !ids.insert(&profile.id) {
            return Err("Duplicate shell profile ID".into());
        }
    }
    Ok(())
}

fn detect() -> Vec<ShellProfile> {
    #[cfg(windows)]
    let candidates = [
        ("pwsh", "PowerShell", "pwsh.exe", vec!["-NoLogo"]),
        (
            "windows-powershell",
            "Windows PowerShell",
            "powershell.exe",
            vec!["-NoLogo"],
        ),
        ("cmd", "Command Prompt", "cmd.exe", vec![]),
        ("wsl", "WSL", "wsl.exe", vec![]),
    ];
    #[cfg(not(windows))]
    let candidates = [
        ("zsh", "Zsh", "zsh", vec!["-l"]),
        ("bash", "Bash", "bash", vec!["-l"]),
        ("fish", "Fish", "fish", vec!["-l"]),
        ("sh", "POSIX shell", "sh", vec![]),
    ];
    candidates
        .into_iter()
        .filter_map(|(id, name, executable, args)| {
            // Only absolute PATH entries are eligible for automatic discovery.
            let paths = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .filter(|path| path.is_absolute())
                .collect::<Vec<_>>();
            let path = which::which_in(executable, std::env::join_paths(paths).ok(), "/").ok()?;
            Some(ShellProfile {
                id: id.into(),
                name: name.into(),
                path,
                args: args.into_iter().map(str::to_owned).collect(),
                env: BTreeMap::new(),
                starting_directory: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_profile_file_fails_instead_of_silently_using_another_shell() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("terminal-profiles.json"), "[]").unwrap();
        assert!(load(root.path()).is_err());
        std::fs::write(root.path().join("terminal-profiles.json"), "not json").unwrap();
        assert!(load(root.path()).is_err());
    }
    #[test]
    fn detected_profiles_have_stable_unique_ids_and_absolute_paths() {
        let profiles = detect();
        validate(&profiles).unwrap();
        assert!(profiles.iter().all(|profile| profile.path.is_absolute()));
    }
}
