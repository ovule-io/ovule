//! Consumer-owned capability ports. Providers are trusted host code; discovery is not a grant.
use super::{CapabilityCatalog, CapabilityDefinition, DISCOVERY_TOOL};
use ovule_agent_api::CancellationToken;
use ovule_agent_api::{WorkerEvent, WorkerEventCallback};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};

pub use ovule_agent_api::{CapabilityLease, CapabilityProvider, ProviderDescriptor, ProviderError};
#[derive(Clone, Copy)]
pub struct ProviderLimits {
    pub acquire: Duration,
    pub close: Duration,
}
impl Default for ProviderLimits {
    fn default() -> Self {
        Self {
            acquire: Duration::from_secs(20),
            close: Duration::from_secs(4),
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum State {
    Dormant,
    Ready,
    Failed,
    Closed,
}
struct Slot {
    descriptor: ProviderDescriptor,
    provider: Arc<dyn CapabilityProvider>,
    state: State,
    lease: Option<Box<dyn CapabilityLease>>,
    static_names: BTreeSet<String>,
}
/// One Attempt owns this registry and all acquired leases. No protocol or domain dispatch.
pub struct CapabilityRegistry {
    catalog: CapabilityCatalog,
    slots: BTreeMap<String, Slot>,
    owners: BTreeMap<String, String>,
    execution: Arc<crate::execution::ToolExecutor>,
    notify: WorkerEventCallback,
    limits: ProviderLimits,
    closed: bool,
    cleanup_incomplete: bool,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum ProviderRequest {
    Acquire {
        provider: String,
    },
    Providers {
        #[serde(default)]
        query: String,
        #[serde(default)]
        offset: usize,
    },
}
impl CapabilityRegistry {
    pub fn new(
        providers: Vec<Arc<dyn CapabilityProvider>>,
        execution: Arc<crate::execution::ToolExecutor>,
        notify: WorkerEventCallback,
        limits: ProviderLimits,
    ) -> Result<Self, String> {
        if providers.len() > 128 {
            return Err("Attempt exceeds 128 capability providers".into());
        }
        let mut slots = BTreeMap::new();
        let mut owners = BTreeMap::new();
        let mut definitions = Vec::new();
        for provider in providers {
            let descriptor = provider.descriptor();
            if descriptor.id.is_empty()
                || descriptor.id.len() > 128
                || slots.contains_key(&descriptor.id)
            {
                return Err("Invalid or duplicate capability provider identity".into());
            }
            let declared = provider.definitions();
            let static_names = declared.iter().map(|d| d.name.clone()).collect();
            for definition in declared {
                if owners
                    .insert(definition.name.clone(), descriptor.id.clone())
                    .is_some()
                {
                    return Err("Duplicate capability tool ownership".into());
                }
                definitions.push(definition);
            }
            slots.insert(
                descriptor.id.clone(),
                Slot {
                    descriptor,
                    provider,
                    state: State::Dormant,
                    lease: None,
                    static_names,
                },
            );
        }
        Ok(Self {
            catalog: CapabilityCatalog::new(definitions)?,
            slots,
            owners,
            execution,
            notify,
            limits,
            closed: false,
            cleanup_incomplete: false,
        })
    }
    #[must_use]
    pub fn exposed(&self) -> Vec<CapabilityDefinition> {
        self.catalog.exposed()
    }
    fn event(&self, provider: &str, state: &str) {
        (self.notify)(WorkerEvent::Diagnostic {
            attempt_id: self.execution.attempt_id.clone(),
            kind: "harness/provider".into(),
            detail_json: json!({"schema_version":1,"provider":provider,"state":state}).to_string(),
        });
    }
    fn providers(&self, query: &str, offset: usize) -> Result<Value, String> {
        if query.chars().count() > 256 {
            return Err("Provider query exceeds 256 characters".into());
        }
        let query = query.to_lowercase();
        let slots = self
            .slots
            .values()
            .filter(|s| {
                s.descriptor.id.to_lowercase().contains(&query)
                    || s.descriptor.description.to_lowercase().contains(&query)
            })
            .collect::<Vec<_>>();
        if offset > slots.len() {
            return Err("Provider offset exceeds catalog length".into());
        }
        let entries=slots.iter().skip(offset).take(8).map(|s|json!({"id":s.descriptor.id,"description":s.descriptor.description.chars().take(240).collect::<String>(),"state":s.state})).collect::<Vec<_>>();
        let end = offset + entries.len();
        Ok(
            json!({"providers":entries,"nextOffset":(end<slots.len()).then_some(end),"total":slots.len()}),
        )
    }
    async fn acquire(&mut self, id: &str, cancellation: CancellationToken) -> Result<(), String> {
        let slot = self
            .slots
            .get(id)
            .ok_or("Provider is not selected for this Attempt")?;
        match slot.state {
            State::Ready => return Ok(()),
            State::Failed | State::Closed => {
                return Err(
                    "Provider is unavailable for this Attempt; no automatic reconnect".into(),
                );
            }
            State::Dormant => {}
        }
        let provider = slot.provider.clone();
        self.event(id, "acquiring");
        let child = cancellation.child_token();
        let acquired = tokio::select! { biased;
            ()=cancellation.cancelled()=>Err("Provider acquisition cancelled".into()),
            result=tokio::time::timeout(self.limits.acquire,provider.acquire(child.clone()))=>result.unwrap_or_else(|_|Err("Provider acquisition deadline exceeded".into())),
        };
        let Ok(lease) = acquired else {
            child.cancel();
            self.slots.get_mut(id).ok_or("Provider disappeared")?.state = State::Failed;
            self.event(id, "failed");
            return Err("Provider acquisition failed; other providers remain available".into());
        };
        let definitions = lease.definitions();
        let static_names = &self
            .slots
            .get(id)
            .ok_or("Provider disappeared")?
            .static_names;
        // Static names are pinned at injection. Lazy providers add a new disjoint set atomically.
        let names = definitions
            .iter()
            .map(|d| d.name.clone())
            .collect::<BTreeSet<_>>();
        let registration = if cancellation.is_cancelled() {
            Err("Provider acquisition cancelled".into())
        } else if !static_names.is_empty() {
            if names == *static_names {
                Ok(())
            } else {
                Err("Provider changed its static tool identities".into())
            }
        } else {
            self.catalog.register(definitions)
        };
        if registration.is_err() || cancellation.is_cancelled() {
            child.cancel();
            self.close_lease(id, lease).await;
            self.slots.get_mut(id).ok_or("Provider disappeared")?.state = State::Failed;
            self.event(id, "failed");
            return Err("Provider definitions rejected or acquisition cancelled".into());
        }
        for name in names {
            self.owners.insert(name, id.into());
        }
        let slot = self.slots.get_mut(id).ok_or("Provider disappeared")?;
        slot.lease = Some(lease);
        slot.state = State::Ready;
        self.event(id, "ready");
        Ok(())
    }
    async fn dispatch(
        &mut self,
        name: &str,
        args: &Value,
        cancellation: CancellationToken,
    ) -> Result<Value, String> {
        if name == DISCOVERY_TOOL {
            match args.get("action").and_then(Value::as_str) {
                Some("acquire" | "providers") => {
                    match serde_json::from_value::<ProviderRequest>(args.clone())
                        .map_err(|e| e.to_string())?
                    {
                        ProviderRequest::Acquire { provider } => {
                            self.acquire(&provider, cancellation).await?;
                            Ok(
                                json!({"provider":provider,"state":"ready","next":"search and load tool names"}),
                            )
                        }
                        ProviderRequest::Providers { query, offset } => {
                            self.providers(&query, offset)
                        }
                    }
                }
                Some("search") => {
                    let mut result = self.catalog.call(args)?;
                    let providers =
                        self.providers(args.get("query").and_then(Value::as_str).unwrap_or(""), 0)?;
                    if let Some(tools) = result["tools"].as_array_mut() {
                        for tool in tools {
                            if let Some(owner) =
                                tool["name"].as_str().and_then(|name| self.owners.get(name))
                            {
                                tool["provider"] = json!(owner);
                                tool["providerState"] =
                                    json!(self.slots.get(owner).map(|slot| slot.state));
                            }
                        }
                    }
                    result["providers"] = providers["providers"].clone();
                    result["nextProviderOffset"] = providers["nextOffset"].clone();
                    Ok(result)
                }
                _ => self.catalog.call(args),
            }
        } else {
            let owner = self
                .owners
                .get(name)
                .cloned()
                .ok_or("Tool has no Attempt provider")?;
            self.acquire(&owner, cancellation.clone()).await?;
            let slot = self.slots.get_mut(&owner).ok_or("Provider disappeared")?;
            let result = slot
                .lease
                .as_mut()
                .ok_or("Provider has no lease")?
                .invoke(name, args, cancellation)
                .await;
            match result {
                Ok(value) => Ok(value),
                Err(ProviderError::Tool(message)) => Err(message),
                Err(ProviderError::Unavailable(_)) => {
                    slot.state = State::Failed;
                    if let Some(lease) = slot.lease.take() {
                        self.close_lease(&owner, lease).await;
                    }
                    self.event(&owner, "failed");
                    Err("Provider connection failed; side effects may be uncertain. No tool was retried".into())
                }
            }
        }
    }
    pub async fn invoke(
        &mut self,
        name: &str,
        args: &Value,
        exposed: &BTreeSet<String>,
    ) -> Result<Value, String> {
        if self.closed {
            return Err("Attempt capability registry is closed".into());
        }
        if !exposed.contains(name) {
            return Err(
                "Tool was not exposed in this model request; discover and load it first".into(),
            );
        }
        let preflight = self
            .owners
            .get(name)
            .and_then(|owner| self.slots.get(owner))
            .map_or(Ok(()), |slot| slot.provider.preflight(name, args));
        let effect = if name == DISCOVERY_TOOL || preflight.is_err() {
            ovule_agent_api::ToolEffect::Workspace
        } else {
            self.owners
                .get(name)
                .and_then(|owner| self.slots.get(owner))
                .map_or(ovule_agent_api::ToolEffect::External, |slot| {
                    slot.provider.effect(name, args)
                })
        };
        let execution = self.execution.clone();
        execution.run_value(name, args, effect,
                Duration::from_mins(5),
                |cancel| async {
                    if let Err(error) = preflight {
                        return Err(json!({"isError":true,"failureKind":"invalid_request","error":error}).to_string());
                    }
                    let value = self.dispatch(name, args, cancel).await?;
                    if name==DISCOVERY_TOOL && serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>12_000 {
                        return Err("Capability discovery response exceeds 12,000 bytes; narrow the query or use provider pagination".into());
                    }
                    if value.get("isError").and_then(Value::as_bool) == Some(true) {
                        return Err(value.to_string());
                    }
                    Ok(value)
                },
            )
            .await
            .map_err(|e| e.to_string())
    }
    async fn close_lease(&mut self, id: &str, mut lease: Box<dyn CapabilityLease>) {
        let previous = self.cleanup_incomplete;
        self.cleanup_incomplete = true;
        self.event(id, "closing");
        let state = match tokio::time::timeout(self.limits.close, lease.close()).await {
            Ok(Ok(())) => "closed",
            Ok(Err(_)) => "close_failed",
            Err(_) => "close_timeout",
        };
        if state == "closed" {
            self.cleanup_incomplete = previous;
        }
        self.event(id, state);
    }
    /// Close acquired leases concurrently. Failures remain visible on repeated shutdown calls.
    pub async fn shutdown(&mut self) -> Result<(), String> {
        self.closed = true;
        let mut closing = tokio::task::JoinSet::new();
        for (id, slot) in &mut self.slots {
            slot.state = State::Closed;
            if let Some(mut lease) = slot.lease.take() {
                let id = id.clone();
                let limit = self.limits.close;
                closing.spawn(async move {
                    let state = match tokio::time::timeout(limit, lease.close()).await {
                        Ok(Ok(())) => "closed",
                        Ok(Err(_)) => "close_failed",
                        Err(_) => "close_timeout",
                    };
                    (id, state)
                });
            }
        }
        while let Some(result) = closing.join_next().await {
            if let Ok((id, state)) = result {
                if state != "closed" {
                    self.cleanup_incomplete = true;
                }
                self.event(&id, state);
            } else {
                self.cleanup_incomplete = true;
            }
        }
        if self.cleanup_incomplete {
            Err("Attempt capability cleanup incomplete; inspect provider diagnostics before retrying".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
