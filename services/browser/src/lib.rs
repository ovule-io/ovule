//! Bounded, Attempt-owned Browser Use broker. Pixels and DOM stay in Explorer;
//! the trusted renderer adapter receives commands, never an arbitrary JS tool.
pub mod downloads;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;
pub trait BrowserEvents: Send + Sync {
    fn emit(&self, request: &Value) -> Result<(), String>;
}
pub struct BrowserBroker {
    events: Arc<dyn BrowserEvents>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    leases: Mutex<HashSet<String>>,
}
pub struct BrowserLease {
    broker: Arc<BrowserBroker>,
    attempt_id: String,
    thread_id: String,
}
impl BrowserBroker {
    #[must_use]
    pub fn new(events: Arc<dyn BrowserEvents>) -> Self {
        Self {
            events,
            pending: Mutex::new(HashMap::new()),
            leases: Mutex::new(HashSet::new()),
        }
    }
    pub fn lease(
        self: &Arc<Self>,
        attempt_id: &str,
        thread_id: &str,
    ) -> Result<Arc<BrowserLease>, String> {
        let mut leases = self
            .leases
            .lock()
            .map_err(|_| "browser lease lock poisoned")?;
        if leases.len() >= 4 || !leases.insert(attempt_id.into()) {
            return Err("Browser Use lease capacity exceeded or Attempt already registered".into());
        }
        Ok(Arc::new(BrowserLease {
            broker: self.clone(),
            attempt_id: attempt_id.into(),
            thread_id: thread_id.into(),
        }))
    }
    pub fn respond(&self, request_id: &str, result: &str) -> Result<bool, String> {
        if result.len() > 4 * 1024 * 1024 {
            return Err("Browser result exceeds 4 MiB".into());
        }
        let value: Value = serde_json::from_str(result).map_err(|e| e.to_string())?;
        let sender = self
            .pending
            .lock()
            .map_err(|_| "browser request lock poisoned")?
            .remove(request_id);
        let Some(sender) = sender else {
            return Ok(false);
        };
        let response = if let Some(error) = value.get("error").and_then(Value::as_str) {
            Err(error.chars().take(1024).collect())
        } else {
            Ok(value)
        };
        Ok(sender.send(response).is_ok())
    }
}
impl BrowserLease {
    pub async fn call(&self, args: &Value) -> Result<Value, String> {
        let action = args
            .get("action")
            .and_then(Value::as_str)
            .ok_or("Browser action is required")?;
        if ![
            "open",
            "navigate",
            "snapshot",
            "screenshot",
            "click",
            "type",
            "scroll",
            "close",
        ]
        .contains(&action)
        {
            return Err("unsupported Browser action".into());
        }
        if matches!(action, "open" | "navigate") {
            let url = url::Url::parse(
                args.get("url")
                    .and_then(Value::as_str)
                    .ok_or("Browser URL is required")?,
            )
            .map_err(|e| e.to_string())?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Browser Use requires an HTTP(S) URL without credentials".into());
            }
        }
        if args.to_string().len() > 65_536 {
            return Err("Browser arguments exceed limit".into());
        }
        let id = format!("{:032x}", rand::random::<u128>());
        let (sender, receiver) = oneshot::channel();
        self.broker
            .pending
            .lock()
            .map_err(|_| "browser request lock poisoned")?
            .insert(id.clone(), sender);
        let _pending = Pending {
            broker: self.broker.clone(),
            id: id.clone(),
        };
        self.broker
            .events
            .emit(&json!({"requestId":id,"attemptId":self.attempt_id,"threadId":self.thread_id,"arguments":args}))?;
        tokio::time::timeout(Duration::from_secs(20), receiver)
            .await
            .map_err(|_| "Browser Use renderer timed out or is unavailable")?
            .map_err(|_| "Browser response channel closed")?
    }
}
impl Drop for BrowserLease {
    fn drop(&mut self) {
        if let Ok(mut leases) = self.broker.leases.lock() {
            leases.remove(&self.attempt_id);
        }
        let _ = self.broker.events.emit(
            &json!({"requestId":"","attemptId":self.attempt_id,"arguments":{"action":"close"}}),
        );
    }
}
struct Pending {
    broker: Arc<BrowserBroker>,
    id: String,
}
impl Drop for Pending {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.broker.pending.lock() {
            pending.remove(&self.id);
        }
    }
}
struct Unavailable;
impl BrowserEvents for Unavailable {
    fn emit(&self, _: &Value) -> Result<(), String> {
        Err("native Browser Use renderer is unavailable".into())
    }
}
pub type BrowserRuntime = tuffite_ioc::Service<BrowserBroker>;
pub mod providers {
    pub fn register<C: Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        registrar.register(tuffite_ioc::factory::<super::BrowserRuntime, _, _>(
            |deps| {
                Ok(std::sync::Arc::new(super::BrowserBroker::new(
                    deps.depends_on::<tuffite_ioc::Service<dyn super::BrowserEvents>>()?,
                )))
            },
        ))?;
        Ok(())
    }
    #[must_use]
    pub fn unavailable() -> std::sync::Arc<super::BrowserBroker> {
        std::sync::Arc::new(super::BrowserBroker::new(std::sync::Arc::new(
            super::Unavailable,
        )))
    }
    #[cfg(feature = "framework")]
    pub fn register_framework<C: AsRef<crate::framework::Context> + Send + Sync + 'static>(
        registrar: &mut impl tuffite_ioc::Registrar<C>,
    ) -> tuffite_ioc::Result<()> {
        crate::framework::register(registrar)
    }
}

#[cfg(feature = "framework")]
mod framework;

pub mod capability;
