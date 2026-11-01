//! Scoped long-term knowledge, distinct from workflow checkpoints and instructions.
use ovule_storage::documents::{Document, DocumentStore};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Provenance {
    pub attempt_id: String,
    pub source: String,
    pub observed_at_ms: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Memory {
    pub scope: String,
    pub key: String,
    pub revision: i64,
    pub title: String,
    pub body: String,
    pub provenance: Provenance,
    pub expires_at_ms: Option<i64>,
}
#[derive(Clone, Debug)]
pub struct Access {
    pub readable: Vec<String>,
    pub writable: Vec<String>,
    pub attempt_id: String,
}
impl Access {
    #[must_use]
    pub fn thread(thread_id: &str, attempt_id: &str) -> Self {
        let scope = format!("thread:{thread_id}");
        Self {
            readable: vec![scope.clone()],
            writable: vec![scope],
            attempt_id: attempt_id.into(),
        }
    }
    fn authorize(&self, scope: &str, write: bool) -> Result<(), String> {
        let grants = if write {
            &self.writable
        } else {
            &self.readable
        };
        if !grants.iter().any(|grant| grant == scope) {
            return Err("memory scope is not granted to this Attempt".into());
        }
        Ok(())
    }
}
/// Consumer-owned repository port, replaceable by encrypted/remote implementations.
pub trait MemoryRepository: Send + Sync {
    fn revision(&self, scope: &str, key: &str) -> Result<i64, String>;
    fn get(&self, scope: &str, key: &str, now_ms: i64) -> Result<Option<Memory>, String>;
    fn search(
        &self,
        scope: &str,
        query: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<Memory>, String>;
    fn put(&self, memory: &Memory, expected: i64) -> Result<Memory, String>;
    fn delete(&self, scope: &str, key: &str, expected: i64) -> Result<(), String>;
}
pub struct MemoryService {
    repository: Arc<dyn MemoryRepository>,
}
impl MemoryService {
    #[must_use]
    pub fn new(repository: Arc<dyn MemoryRepository>) -> Self {
        Self { repository }
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        Ok(Self::new(Arc::new(SqliteRepository(Mutex::new(
            DocumentStore::open(path)?,
        )))))
    }
    pub fn get(
        &self,
        access: &Access,
        scope: &str,
        key: &str,
        now: i64,
    ) -> Result<Option<Memory>, String> {
        access.authorize(scope, false)?;
        self.repository.get(scope, key, now)
    }
    pub fn revision(&self, access: &Access, scope: &str, key: &str) -> Result<i64, String> {
        access.authorize(scope, false)?;
        self.repository.revision(scope, key)
    }
    pub fn search(
        &self,
        access: &Access,
        scope: &str,
        query: &str,
        now: i64,
        limit: usize,
    ) -> Result<Vec<Memory>, String> {
        access.authorize(scope, false)?;
        if query.len() > 4096 {
            return Err("memory query exceeds 4096 bytes".into());
        }
        self.repository
            .search(scope, query, now, limit.clamp(1, 20))
    }
    pub fn put(
        &self,
        access: &Access,
        memory: &Memory,
        expected: i64,
        now: i64,
    ) -> Result<Memory, String> {
        access.authorize(&memory.scope, true)?;
        if memory.key.is_empty()
            || memory.key.len() > 128
            || memory.title.trim().is_empty()
            || memory.title.len() > 512
            || memory.body.trim().is_empty()
            || memory.body.len() > 32_768
        {
            return Err("invalid or oversized memory document".into());
        }
        if memory.expires_at_ms.is_some_and(|expiry| expiry <= now) {
            return Err("memory expiry must be in the future".into());
        }
        if memory.provenance.attempt_id != access.attempt_id
            || memory.provenance.source.len() > 512
            || memory.provenance.source.trim().is_empty()
        {
            return Err("invalid memory provenance".into());
        }
        self.repository.put(memory, expected)
    }
    pub fn delete(
        &self,
        access: &Access,
        scope: &str,
        key: &str,
        expected: i64,
    ) -> Result<(), String> {
        access.authorize(scope, true)?;
        self.repository.delete(scope, key, expected)
    }
}
struct SqliteRepository(Mutex<DocumentStore>);
fn decode(document: Document) -> Result<Memory, String> {
    Ok(Memory {
        scope: document.namespace,
        key: document.key,
        revision: document.revision,
        title: document.title,
        body: document.body,
        provenance: serde_json::from_str(&document.metadata).map_err(|e| e.to_string())?,
        expires_at_ms: document.expires_at_ms,
    })
}
impl MemoryRepository for SqliteRepository {
    fn revision(&self, scope: &str, key: &str) -> Result<i64, String> {
        self.0
            .lock()
            .map_err(|_| "memory repository lock poisoned")?
            .revision(scope, key)
    }
    fn get(&self, scope: &str, key: &str, now: i64) -> Result<Option<Memory>, String> {
        self.0
            .lock()
            .map_err(|_| "memory repository lock poisoned")?
            .get(scope, key, now)?
            .map(decode)
            .transpose()
    }
    fn search(
        &self,
        scope: &str,
        query: &str,
        now: i64,
        limit: usize,
    ) -> Result<Vec<Memory>, String> {
        self.0
            .lock()
            .map_err(|_| "memory repository lock poisoned")?
            .search(scope, query, now, limit)?
            .into_iter()
            .map(decode)
            .collect()
    }
    fn put(&self, memory: &Memory, expected: i64) -> Result<Memory, String> {
        decode(
            self.0
                .lock()
                .map_err(|_| "memory repository lock poisoned")?
                .put(
                    &Document {
                        namespace: memory.scope.clone(),
                        key: memory.key.clone(),
                        revision: memory.revision,
                        title: memory.title.clone(),
                        body: memory.body.clone(),
                        metadata: serde_json::to_string(&memory.provenance)
                            .map_err(|e| e.to_string())?,
                        expires_at_ms: memory.expires_at_ms,
                    },
                    expected,
                )?,
        )
    }
    fn delete(&self, scope: &str, key: &str, expected: i64) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "memory repository lock poisoned")?
            .delete(scope, key, expected)
    }
}
pub struct MemoryRoot(pub std::path::PathBuf);
pub type MemoryRuntime = tuffite_ioc::Service<MemoryService>;
pub mod providers {
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<super::MemoryRuntime, _, _>(|deps| {
            let root = deps.depends_on::<tuffite_ioc::Service<super::MemoryRoot>>()?;
            Ok(std::sync::Arc::new(super::MemoryService::open(&root.0)?))
        }))?;
        Ok(())
    }
}

pub mod capability;
