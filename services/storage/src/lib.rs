//! `SQLite` checkpoints, events and durable channel inbox/outbox transactions.
pub mod channel_repository;
/// Revisioned documents, independent of Agent and memory semantics.
pub mod documents;
pub mod journal;

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest as _, Sha256};

/// Serialized checkpoint capability; domain models remain outside storage.
pub trait Checkpoint: serde::Serialize + serde::de::DeserializeOwned + Send {
    fn revision(&self) -> i64;
}

const SCHEMA_VERSION: i64 = 5;

use crate::channel_repository::{
    ChannelConfig, ChannelFeedInbound, ChannelFeedItem, ChannelInbound, ChannelReplyRoute,
    ChannelRepository, ChannelSubscription, PendingDelivery,
};

pub struct Store<S> {
    state: std::marker::PhantomData<S>,
    connection: Connection,
}

impl<S: Checkpoint> Store<S> {
    #[allow(clippy::too_many_lines)] // Schema initialization is kept in one atomic, versioned entrypoint.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create data directory {}: {error}", parent.display()))?;
        }
        let connection = Connection::open(path)
            .map_err(|error| format!("open Ovule database {}: {error}", path.display()))?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=FULL;
                 PRAGMA foreign_keys=ON;
                 PRAGMA busy_timeout=5000;
                 CREATE TABLE IF NOT EXISTS metadata (
                   key TEXT PRIMARY KEY NOT NULL,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS workspace_state (
                   singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                   revision INTEGER NOT NULL,
                   state_json TEXT NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS events (
                   sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                   revision INTEGER NOT NULL,
                   kind TEXT NOT NULL,
                   subject_id TEXT,
                   payload_json TEXT NOT NULL,
                   occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE INDEX IF NOT EXISTS events_revision_idx ON events(revision);",
            )
            .map_err(|error| format!("initialize Ovule database: {error}"))?;
        connection
            .execute(
                "INSERT INTO metadata(key, value) VALUES('schema_version', ?1)
                 ON CONFLICT(key) DO NOTHING",
                [SCHEMA_VERSION.to_string()],
            )
            .map_err(|error| format!("initialize schema version: {error}"))?;
        let actual: String = connection
            .query_row(
                "SELECT value FROM metadata WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("read schema version: {error}"))?;
        if actual != SCHEMA_VERSION.to_string() {
            return Err(format!(
                "unsupported Ovule database schema: {actual}; close Ovule and run `mise run reset-data` to reset local application data"
            ));
        }
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS channel_connections (
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   region TEXT NOT NULL,
                   enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
                   app_id_hint TEXT NOT NULL,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   PRIMARY KEY(channel_type, connection_id)
                 );
                 CREATE TABLE IF NOT EXISTS channel_thread_targets (
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   workspace_thread_id TEXT NOT NULL,
                   PRIMARY KEY(channel_type, connection_id)
                 );
                 CREATE TABLE IF NOT EXISTS channel_bindings (
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   conversation_key TEXT NOT NULL,
                   conversation_id TEXT NOT NULL,
                   conversation_type TEXT NOT NULL DEFAULT 'unknown',
                   platform_thread_id TEXT,
                   workspace_thread_id TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   PRIMARY KEY(channel_type, connection_id, conversation_key)
                 );
                 CREATE TABLE IF NOT EXISTS channel_inbox (
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   event_id TEXT NOT NULL,
                   conversation_key TEXT NOT NULL,
                   platform_message_id TEXT NOT NULL,
                   sender_id TEXT NOT NULL,
                   attempt_id TEXT NOT NULL UNIQUE,
                   status TEXT NOT NULL,
                   error TEXT,
                   received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   PRIMARY KEY(channel_type, connection_id, event_id)
                 );
                 CREATE TABLE IF NOT EXISTS channel_outbox (
                   delivery_id TEXT PRIMARY KEY NOT NULL,
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   attempt_id TEXT NOT NULL UNIQUE,
                   conversation_id TEXT NOT NULL,
                   platform_thread_id TEXT,
                   reply_to_message_id TEXT NOT NULL,
                   body TEXT NOT NULL,
                   status TEXT NOT NULL,
                   attempts INTEGER NOT NULL DEFAULT 0,
                   next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
                   platform_message_id TEXT,
                   error TEXT,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS channel_subscriptions (
                   subscription_id TEXT PRIMARY KEY NOT NULL,
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   conversation_key TEXT NOT NULL,
                   conversation_id TEXT NOT NULL,
                   platform_thread_id TEXT,
                   workspace_thread_id TEXT NOT NULL,
                   label TEXT NOT NULL,
                   active INTEGER NOT NULL CHECK(active IN (0, 1)),
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   UNIQUE(channel_type, connection_id, conversation_key)
                 );
                 CREATE TABLE IF NOT EXISTS channel_feed (
                   sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                   subscription_id TEXT NOT NULL,
                   channel_type TEXT NOT NULL,
                   connection_id TEXT NOT NULL,
                   event_id TEXT NOT NULL,
                   conversation_key TEXT NOT NULL,
                   conversation_id TEXT NOT NULL,
                   platform_thread_id TEXT,
                   platform_message_id TEXT NOT NULL,
                   sender_id TEXT NOT NULL,
                   sender_name TEXT,
                   content TEXT NOT NULL,
                   content_type TEXT NOT NULL,
                   platform_created_at TEXT,
                   received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   UNIQUE(channel_type, connection_id, event_id)
                 );
                 CREATE INDEX IF NOT EXISTS channel_inbox_attempt_idx
                   ON channel_inbox(attempt_id);
                 CREATE INDEX IF NOT EXISTS channel_outbox_pending_idx
                   ON channel_outbox(status, next_attempt_at_ms);
                 CREATE INDEX IF NOT EXISTS channel_feed_subscription_idx
                   ON channel_feed(subscription_id, sequence);",
            )
            .map_err(|error| format!("initialize channel schema: {error}"))?;
        Ok(Self {
            connection,
            state: std::marker::PhantomData,
        })
    }

    pub fn event_count(&self) -> Result<i64, String> {
        self.connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .map_err(|error| format!("count stored events: {error}"))
    }

    pub fn load(&self) -> Result<Option<S>, String> {
        let serialized: Option<String> = self
            .connection
            .query_row(
                "SELECT state_json FROM workspace_state WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("load Ovule state: {error}"))?;
        serialized
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| format!("decode Ovule state: {error}; run `mise run reset-data` to reset local application data"))
            })
            .transpose()
    }

    pub fn commit(
        &mut self,
        workspace: &S,
        kind: &str,
        subject_id: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<(), String> {
        let state_json = serde_json::to_string(workspace)
            .map_err(|error| format!("encode Ovule state: {error}"))?;
        let payload_json = serde_json::to_string(payload)
            .map_err(|error| format!("encode Ovule event: {error}"))?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("begin Ovule transaction: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workspace_state(singleton, revision, state_json)
                 VALUES(1, ?1, ?2)
                 ON CONFLICT(singleton) DO UPDATE SET
                   revision = excluded.revision,
                   state_json = excluded.state_json,
                   updated_at = CURRENT_TIMESTAMP",
                params![workspace.revision(), state_json],
            )
            .map_err(|error| format!("persist Ovule state: {error}"))?;
        transaction
            .execute(
                "INSERT INTO events(revision, kind, subject_id, payload_json)
                 VALUES(?1, ?2, ?3, ?4)",
                params![workspace.revision(), kind, subject_id, payload_json],
            )
            .map_err(|error| format!("append Ovule event: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit Ovule transaction: {error}"))
    }
}

mod channel;

fn channel_subscription_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChannelSubscription> {
    Ok(ChannelSubscription {
        subscription_id: row.get(0)?,
        channel_type: row.get(1)?,
        connection_id: row.get(2)?,
        conversation_key: row.get(3)?,
        conversation_id: row.get(4)?,
        platform_thread_id: row.get(5)?,
        workspace_thread_id: row.get(6)?,
        label: row.get(7)?,
        active: row.get::<_, i64>(8)? != 0,
        last_sequence: row.get(9)?,
    })
}

fn channel_subscription_id(
    channel_type: &str,
    connection_id: &str,
    conversation_key: &str,
) -> String {
    let mut hash = Sha256::new();
    hash.update(channel_type.as_bytes());
    hash.update([0]);
    hash.update(connection_id.as_bytes());
    hash.update([0]);
    hash.update(conversation_key.as_bytes());
    let digest = format!("{digest:x}", digest = hash.finalize());
    format!("{channel_type}-feedback-{}", &digest[..16])
}

fn persist_workspace_event<S: Checkpoint>(
    transaction: &rusqlite::Transaction<'_>,
    workspace: &S,
    state_json: &str,
    kind: &str,
    subject_id: Option<&str>,
    payload_json: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO workspace_state(singleton, revision, state_json)
             VALUES(1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE SET
               revision = excluded.revision, state_json = excluded.state_json,
               updated_at = CURRENT_TIMESTAMP",
            params![workspace.revision(), state_json],
        )
        .map_err(|error| format!("persist Ovule state: {error}"))?;
    transaction
        .execute(
            "INSERT INTO events(revision, kind, subject_id, payload_json)
             VALUES(?1, ?2, ?3, ?4)",
            params![workspace.revision(), kind, subject_id, payload_json],
        )
        .map_err(|error| format!("append Ovule event: {error}"))?;
    Ok(())
}

impl<S: Checkpoint> ChannelRepository<S> for Store<S> {
    fn channel_connections(&self, channel_type: &str) -> Result<Vec<ChannelConfig>, String> {
        Self::channel_connections(self, channel_type)
    }
    fn channel_config(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<ChannelConfig>, String> {
        Self::channel_config(self, channel_type, connection_id)
    }
    fn save_channel_config(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        region: &str,
        enabled: bool,
        app_id_hint: &str,
    ) -> Result<(), String> {
        Self::save_channel_config(
            self,
            channel_type,
            connection_id,
            region,
            enabled,
            app_id_hint,
        )
    }
    fn channel_event_seen(
        &self,
        channel_type: &str,
        connection_id: &str,
        event_id: &str,
    ) -> Result<bool, String> {
        Self::channel_event_seen(self, channel_type, connection_id, event_id)
    }
    fn channel_thread_target(
        &self,
        channel_type: &str,
        connection_id: &str,
    ) -> Result<Option<String>, String> {
        Self::channel_thread_target(self, channel_type, connection_id)
    }
    fn set_channel_thread_target(
        &mut self,
        channel_type: &str,
        connection_id: &str,
        thread_id: Option<&str>,
    ) -> Result<(), String> {
        Self::set_channel_thread_target(self, channel_type, connection_id, thread_id)
    }
    fn channel_thread_id(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<String>, String> {
        Self::channel_thread_id(self, channel_type, connection_id, conversation_key)
    }
    fn commit_channel_inbound(
        &mut self,
        workspace: &S,
        inbound: &ChannelInbound<'_>,
    ) -> Result<bool, String> {
        Self::commit_channel_inbound(self, workspace, inbound)
    }
    fn channel_reply_route(&self, attempt_id: &str) -> Result<Option<ChannelReplyRoute>, String> {
        Self::channel_reply_route(self, attempt_id)
    }
    fn channel_subscription(
        &self,
        channel_type: &str,
        connection_id: &str,
        conversation_key: &str,
    ) -> Result<Option<ChannelSubscription>, String> {
        Self::channel_subscription(self, channel_type, connection_id, conversation_key)
    }
    fn subscribe_channel_for_attempt(
        &mut self,
        attempt_id: &str,
        label: &str,
    ) -> Result<ChannelSubscription, String> {
        Self::subscribe_channel_for_attempt(self, attempt_id, label)
    }
    fn channel_subscriptions(
        &self,
        workspace_thread_id: &str,
    ) -> Result<Vec<ChannelSubscription>, String> {
        Self::channel_subscriptions(self, workspace_thread_id)
    }
    fn set_channel_subscription_active(
        &mut self,
        workspace_thread_id: &str,
        subscription_id: &str,
        active: bool,
    ) -> Result<ChannelSubscription, String> {
        Self::set_channel_subscription_active(self, workspace_thread_id, subscription_id, active)
    }
    fn append_channel_feed(&mut self, inbound: &ChannelFeedInbound<'_>) -> Result<bool, String> {
        Self::append_channel_feed(self, inbound)
    }
    fn channel_feed(
        &self,
        workspace_thread_id: &str,
        subscription_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<ChannelFeedItem>, String> {
        Self::channel_feed(
            self,
            workspace_thread_id,
            subscription_id,
            after_sequence,
            limit,
        )
    }
    fn commit_with_channel_reply(
        &mut self,
        workspace: &S,
        kind: &str,
        attempt_id: &str,
        payload: &serde_json::Value,
        route: &ChannelReplyRoute,
        body: &str,
    ) -> Result<(), String> {
        Self::commit_with_channel_reply(self, workspace, kind, attempt_id, payload, route, body)
    }
    fn pending_channel_deliveries(
        &self,
        channel_type: &str,
        connection_id: &str,
        now_ms: i64,
        limit: usize,
    ) -> Result<Vec<PendingDelivery>, String> {
        Self::pending_channel_deliveries(self, channel_type, connection_id, now_ms, limit)
    }
    fn mark_channel_delivery_sent(
        &mut self,
        delivery_id: &str,
        platform_message_id: &str,
    ) -> Result<(), String> {
        Self::mark_channel_delivery_sent(self, delivery_id, platform_message_id)
    }
    fn mark_channel_delivery_failed(
        &mut self,
        delivery_id: &str,
        error: &str,
        next_attempt_at_ms: i64,
        terminal: bool,
    ) -> Result<(), String> {
        Self::mark_channel_delivery_failed(self, delivery_id, error, next_attempt_at_ms, terminal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Example {
        revision: i64,
        value: String,
    }
    impl Checkpoint for Example {
        fn revision(&self) -> i64 {
            self.revision
        }
    }
    #[test]
    fn failed_event_insertion_rolls_back_checkpoint() {
        let mut store = Store::<Example>::open(Path::new(":memory:")).unwrap();
        let initial = Example {
            revision: 1,
            value: "committed".into(),
        };
        store
            .commit(&initial, "saved", None, &serde_json::json!({}))
            .unwrap();
        store.connection.execute_batch("CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        let candidate = Example {
            revision: 2,
            value: "uncommitted".into(),
        };
        assert!(
            store
                .commit(&candidate, "failed", None, &serde_json::json!({}))
                .is_err()
        );
        assert_eq!(store.load().unwrap(), Some(initial));
        assert_eq!(store.event_count().unwrap(), 1);
    }
}
