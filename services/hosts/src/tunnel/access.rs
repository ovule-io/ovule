//! Local authorization storage. Its schema is independent of Link and desktop features.
use super::{TunnelDeviceAccess, TunnelPendingClient, random_pairing_token};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const ACCESS_SCHEMA: u16 = 1;

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct HostAccess {
    #[serde(default)]
    schema_version: u16,
    #[serde(default = "random_pairing_token")]
    pub pairing_token: String,
    pub shares: BTreeMap<String, (PathBuf, String)>,
    pub devices: BTreeMap<String, TunnelDeviceAccess>,
    #[serde(skip)]
    pub pending_clients: BTreeMap<String, TunnelPendingClient>,
    #[serde(skip)]
    repair_reason: Option<String>,
}

impl Default for HostAccess {
    fn default() -> Self {
        Self {
            schema_version: ACCESS_SCHEMA,
            pairing_token: random_pairing_token(),
            shares: BTreeMap::new(),
            devices: BTreeMap::new(),
            pending_clients: BTreeMap::new(),
            repair_reason: None,
        }
    }
}

impl HostAccess {
    pub(super) fn load(path: &Path) -> Self {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Self::default(),
            Err(error) => return Self::blocked(format!("read Host access data: {error}")),
        };
        let mut access: Self = match serde_json::from_slice(&bytes) {
            Ok(access) => access,
            Err(error) => return Self::blocked(format!("decode Host access data: {error}")),
        };
        if access.schema_version > ACCESS_SCHEMA {
            return Self::blocked(format!(
                "Host access schema {} requires a newer application",
                access.schema_version
            ));
        }
        if access.pairing_token.is_empty()
            || access
                .devices
                .iter()
                .any(|(id, device)| id != &device.client_id)
        {
            return Self::blocked(
                "Host access data contains inconsistent device identities".into(),
            );
        }
        // Historical protocol_major values described the network, not the file
        // format. Serde ignores that marker; all recognized grants stay intact.
        if access.schema_version == 0 {
            access.schema_version = ACCESS_SCHEMA;
            if let Err(error) = persist_access(path, &access) {
                access.repair_reason = Some(format!("migrate Host access data: {error}"));
            }
        }
        access
    }

    fn blocked(reason: String) -> Self {
        Self {
            repair_reason: Some(reason),
            ..Self::default()
        }
    }

    pub(super) fn requires_reset(&self) -> bool {
        self.repair_reason.is_some()
    }

    pub(super) fn ensure_ready(&self) -> Result<(), String> {
        self.repair_reason
            .as_ref()
            .map_or(Ok(()), |reason| Err(reason.clone()))
    }
}

pub(super) fn persist_access(path: &Path, access: &HostAccess) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(access)
        .map_err(|error| format!("encode Link access: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes).map_err(|error| format!("write Link access: {error}"))?;
    ovule_platform::files::replace(&temporary, path)
        .map_err(|error| format!("commit Link access: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_network_markers_do_not_invalidate_pairings_or_workspace_grants() {
        for marker in [None, Some(0), Some(5), Some(6), Some(99)] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("access.json");
            let mut record = serde_json::json!({
                "pairing_token": "existing-invitation", "shares": { "work": ["C:/workspace", "work"] },
                "devices": { "client": { "client_id": "client", "name": "Laptop", "workspace_ids": ["work"], "agent_ids": ["agent"] } }
            });
            if let Some(marker) = marker {
                record["protocol_major"] = marker.into();
            }
            std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
            let access = HostAccess::load(&path);
            assert!(!access.requires_reset());
            assert_eq!(access.pairing_token, "existing-invitation");
            assert_eq!(access.devices["client"].workspace_ids, ["work"]);
            assert_eq!(access.devices["client"].agent_ids, ["agent"]);
            assert_eq!(access.shares["work"].0, PathBuf::from("C:/workspace"));
            let saved: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["schema_version"], ACCESS_SCHEMA);
            assert!(saved.get("protocol_major").is_none());
            assert!(!HostAccess::load(&path).requires_reset());
        }
    }

    #[test]
    fn invalid_and_future_files_stay_unchanged_until_explicit_reset() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("access.json");
        for bytes in [
            b"invalid".to_vec(),
            br#"{"schema_version":2,"pairing_token":"token","shares":{},"devices":{}}"#.to_vec(),
        ] {
            std::fs::write(&path, &bytes).unwrap();
            let access = HostAccess::load(&path);
            assert!(access.requires_reset());
            assert!(access.ensure_ready().is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            persist_access(&path, &HostAccess::default()).unwrap();
            assert!(!HostAccess::load(&path).requires_reset());
        }
    }
}
