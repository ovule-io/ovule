pub(crate) type Context = tuffite::ApplicationContext;
use std::sync::Arc;
use tuffite_ioc::Service;

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::TerminalEventSink>,
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

impl crate::TerminalEventSink for FrameworkEvents {
    fn output(&self, output: &crate::TerminalOutput) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "runId": output.id,
            "ownerId": output.owner_id,
            "sequence": output.sequence,
            "stream": output.stream,
            "delta": output.delta,
        }))
        .map_err(|error| format!("encode Terminal output event: {error}"))?;
        self.events
            .emit("ovule:terminal-output", &payload)
            .map_err(|error| error.to_string())
    }
}
