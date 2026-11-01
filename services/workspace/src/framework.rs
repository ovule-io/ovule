pub(crate) type Context = tuffite::ApplicationContext;
use std::sync::Arc;
use tuffite_ioc::Service;

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::WorkspaceEventSink>,
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

impl crate::WorkspaceEventSink for FrameworkEvents {
    fn revision_changed(&self, revision: i64) {
        if let Err(error) = self
            .events
            .emit("ovule:workspace-changed", &revision.to_le_bytes())
        {
            tracing::warn!(%error, revision, "broadcast workspace revision");
        }
    }
}
