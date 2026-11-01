//! Additive, revisioned document storage. Tombstones prevent revision ABA;
//! payload/index/event updates commit together. Business scopes live in consumers.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Document {
    pub namespace: String,
    pub key: String,
    pub revision: i64,
    pub title: String,
    pub body: String,
    pub metadata: String,
    pub expires_at_ms: Option<i64>,
}

pub struct DocumentStore {
    connection: Connection,
}
impl DocumentStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if path != Path::new(":memory:")
            && let Some(parent) = path.parent()
        {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS documents (
                namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
                title TEXT NOT NULL, body TEXT NOT NULL, metadata TEXT NOT NULL,
                expires_at_ms INTEGER, deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(namespace, key));
            CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(namespace UNINDEXED, key UNINDEXED, title, body);
            CREATE TABLE IF NOT EXISTS document_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
                key TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL);")
            .map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }
    pub fn get(&self, namespace: &str, key: &str, now_ms: i64) -> Result<Option<Document>, String> {
        self.connection.query_row("SELECT namespace,key,revision,title,body,metadata,expires_at_ms FROM documents WHERE namespace=?1 AND key=?2 AND deleted=0 AND (expires_at_ms IS NULL OR expires_at_ms>?3)", params![namespace,key,now_ms], row_document).optional().map_err(|e| e.to_string())
    }
    /// Includes tombstones/expired documents so callers can explicitly recreate a key.
    pub fn revision(&self, namespace: &str, key: &str) -> Result<i64, String> {
        self.connection
            .query_row(
                "SELECT revision FROM documents WHERE namespace=?1 AND key=?2",
                params![namespace, key],
                |row| row.get(0),
            )
            .optional()
            .map(|revision| revision.unwrap_or(0))
            .map_err(|e| e.to_string())
    }
    pub fn put(&mut self, document: &Document, expected: i64) -> Result<Document, String> {
        if expected < 0 || expected == i64::MAX {
            return Err("invalid expected revision".into());
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let revision: Option<i64> = tx
            .query_row(
                "SELECT revision FROM documents WHERE namespace=?1 AND key=?2",
                params![document.namespace, document.key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if revision.unwrap_or(0) != expected {
            return Err("document revision conflict".into());
        }
        let next = expected + 1;
        tx.execute("INSERT INTO documents(namespace,key,revision,title,body,metadata,expires_at_ms,deleted) VALUES(?1,?2,?3,?4,?5,?6,?7,0) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,title=excluded.title,body=excluded.body,metadata=excluded.metadata,expires_at_ms=excluded.expires_at_ms,deleted=0", params![document.namespace,document.key,next,document.title,document.body,document.metadata,document.expires_at_ms]).map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM document_search WHERE namespace=?1 AND key=?2",
            params![document.namespace, document.key],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO document_search(namespace,key,title,body) VALUES(?1,?2,?3,?4)",
            params![
                document.namespace,
                document.key,
                document.title,
                document.body
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO document_events(namespace,key,revision,kind) VALUES(?1,?2,?3,'put')",
            params![document.namespace, document.key, next],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Document {
            revision: next,
            ..document.clone()
        })
    }
    pub fn delete(&mut self, namespace: &str, key: &str, expected: i64) -> Result<(), String> {
        if expected <= 0 || expected == i64::MAX {
            return Err("invalid expected revision".into());
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let changed = tx.execute("UPDATE documents SET revision=revision+1,title='',body='',metadata='{}',deleted=1 WHERE namespace=?1 AND key=?2 AND revision=?3 AND deleted=0",params![namespace,key,expected]).map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("document revision conflict".into());
        }
        tx.execute(
            "DELETE FROM document_search WHERE namespace=?1 AND key=?2",
            params![namespace, key],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO document_events(namespace,key,revision,kind) VALUES(?1,?2,?3,'delete')",
            params![namespace, key, expected + 1],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    /// FTS terms are quoted before parsing. Namespace filters apply before LIMIT.
    pub fn search(
        &self,
        namespace: &str,
        query: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<Document>, String> {
        let limit = i64::try_from(limit.min(100)).map_err(|e| e.to_string())?;
        let terms = query
            .split_whitespace()
            .take(32)
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let parameters: Vec<&dyn rusqlite::ToSql>;
        let sql;
        if terms.is_empty() {
            sql = "SELECT namespace,key,revision,title,body,metadata,expires_at_ms FROM documents WHERE namespace=?1 AND deleted=0 AND (expires_at_ms IS NULL OR expires_at_ms>?2) ORDER BY key LIMIT ?3";
            parameters = vec![&namespace, &now_ms, &limit];
        } else {
            sql = "SELECT d.namespace,d.key,d.revision,d.title,d.body,d.metadata,d.expires_at_ms FROM document_search s JOIN documents d ON d.namespace=s.namespace AND d.key=s.key WHERE document_search MATCH ?4 AND d.namespace=?1 AND d.deleted=0 AND (d.expires_at_ms IS NULL OR d.expires_at_ms>?2) ORDER BY bm25(document_search),d.key LIMIT ?3";
            parameters = vec![&namespace, &now_ms, &limit, &terms];
        }
        self.connection
            .prepare(sql)
            .map_err(|e| e.to_string())?
            .query_map(parameters.as_slice(), row_document)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}
fn row_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        namespace: row.get(0)?,
        key: row.get(1)?,
        revision: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        metadata: row.get(5)?,
        expires_at_ms: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn document() -> Document {
        Document {
            namespace: "thread:a".into(),
            key: "fact".into(),
            revision: 0,
            title: "Build".into(),
            body: "cargo check".into(),
            metadata: "{}".into(),
            expires_at_ms: None,
        }
    }
    #[test]
    fn event_failure_rolls_back_document_and_search_index() {
        let mut store = DocumentStore::open(Path::new(":memory:")).unwrap();
        store.connection.execute_batch("CREATE TRIGGER deny_event BEFORE INSERT ON document_events BEGIN SELECT RAISE(ABORT, 'injected event failure'); END;").unwrap();
        assert!(store.put(&document(), 0).is_err());
        assert!(store.get("thread:a", "fact", 0).unwrap().is_none());
        assert_eq!(
            store.search("thread:a", "cargo", 0, 10).unwrap(),
            Vec::<Document>::new()
        );
        store
            .connection
            .execute_batch("DROP TRIGGER deny_event")
            .unwrap();
        assert_eq!(store.put(&document(), 0).unwrap().revision, 1);
    }
    #[test]
    fn tombstone_prevents_aba_and_can_be_intentionally_recreated() {
        let mut store = DocumentStore::open(Path::new(":memory:")).unwrap();
        store.put(&document(), 0).unwrap();
        store.delete("thread:a", "fact", 1).unwrap();
        assert!(store.put(&document(), 0).is_err());
        assert_eq!(store.put(&document(), 2).unwrap().revision, 3);
        assert!(store.delete("thread:a", "fact", i64::MAX).is_err());
    }
}
