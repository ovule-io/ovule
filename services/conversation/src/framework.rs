pub(crate) type Context = tuffite::ApplicationContext;
use std::sync::Arc;
use tuffite_ioc::Service;

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::ConversationEventSink>,
        _,
        _,
    >(|build| {
        let context: &C = build.context();
        let browser = context.as_ref();
        Ok(Arc::new(FrameworkEvents {
            events: browser.events(),
        }))
    }))?;

    Ok(())
}

struct FrameworkEvents {
    events: tuffite::EventEmitter,
}

impl crate::ConversationEventSink for FrameworkEvents {
    fn agent_output(
        &self,
        attempt_id: &str,
        sequence: u64,
        delta: &str,
        revision: i64,
    ) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "attemptId": attempt_id,
            "sequence": sequence,
            "delta": delta,
            "revision": revision,
        }))
        .map_err(|error| format!("encode Agent output event: {error}"))?;
        self.events
            .emit("ovule:agent-output", &payload)
            .map_err(|error| error.to_string())
    }
}
