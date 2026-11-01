//! Bounded durable execution records. Payloads and provider credentials do not belong here.
use rusqlite::{Connection, params};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CallRecord {
    pub call_id: String,
    pub attempt_id: String,
    pub tool: String,
    pub state: String,
}
pub struct CallJournal(Connection);
impl CallJournal {
    pub fn open(path: &Path) -> Result<Self, String> {
        if path != Path::new(":memory:") {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut options = std::fs::OpenOptions::new();
            options.create(true).read(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(path).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())?;
            }
        }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS execution_calls(sequence INTEGER PRIMARY KEY AUTOINCREMENT,call_id TEXT NOT NULL UNIQUE,attempt_id TEXT NOT NULL,tool TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
            CREATE INDEX IF NOT EXISTS execution_calls_attempt ON execution_calls(attempt_id,sequence);").map_err(|e|e.to_string())?;
        Ok(Self(connection))
    }
    /// Commit before dispatch. Reusing a call ID is rejected, including after restart.
    pub fn begin(&mut self, call_id: &str, attempt_id: &str, tool: &str) -> Result<(), String> {
        if [call_id, attempt_id, tool]
            .iter()
            .any(|s| s.is_empty() || s.len() > 256)
        {
            return Err("invalid execution identity".into());
        }
        let tx = self.0.transaction().map_err(|e| e.to_string())?;
        let unsettled: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM execution_calls WHERE state='dispatched'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if unsettled >= 10000 {
            return Err(
                "execution journal has too many unsettled calls; inspect them before continuing"
                    .into(),
            );
        }
        tx.execute("INSERT INTO execution_calls(call_id,attempt_id,tool,state) VALUES(?1,?2,?3,'dispatched')",params![call_id,attempt_id,tool]).map_err(|e|e.to_string())?;
        // Retain unsettled calls; prune settled records by age and a fixed bound.
        tx.execute("DELETE FROM execution_calls WHERE state!='dispatched' AND (updated_at<unixepoch()-2592000 OR sequence<(SELECT COALESCE(MAX(sequence),0)-10000 FROM execution_calls))",[]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn finish(&self, call_id: &str, state: &str) -> Result<(), String> {
        if !["completed", "failed", "cancelled", "timed_out", "uncertain"].contains(&state) {
            return Err("invalid execution state".into());
        }
        let changed=self.0.execute("UPDATE execution_calls SET state=?2,updated_at=unixepoch() WHERE call_id=?1 AND state='dispatched'",params![call_id,state]).map_err(|e|e.to_string())?;
        if changed != 1 {
            return Err("execution call is absent or already settled".into());
        }
        Ok(())
    }
    pub fn recent(&self, attempt_id: &str, limit: usize) -> Result<Vec<CallRecord>, String> {
        let mut query=self.0.prepare("SELECT call_id,attempt_id,tool,state FROM execution_calls WHERE attempt_id=?1 ORDER BY sequence DESC LIMIT ?2").map_err(|e|e.to_string())?;
        query
            .query_map(params![attempt_id, limit.min(256)], |row| {
                Ok(CallRecord {
                    call_id: row.get(0)?,
                    attempt_id: row.get(1)?,
                    tool: row.get(2)?,
                    state: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_calls_remain_visible_and_cannot_be_replayed() {
        let path = std::env::temp_dir().join(format!(
            "ovule-journal-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let mut j = CallJournal::open(&path).unwrap();
            j.begin("call", "attempt", "write").unwrap();
        }
        {
            let mut j = CallJournal::open(&path).unwrap();
            assert!(j.begin("call", "attempt", "write").is_err());
            assert_eq!(j.recent("attempt", 1).unwrap()[0].state, "dispatched");
            j.finish("call", "uncertain").unwrap();
            assert!(j.finish("call", "completed").is_err());
            assert_eq!(j.recent("other", 100).unwrap().len(), 0);
        }
        std::fs::remove_file(path).unwrap();
    }
}
