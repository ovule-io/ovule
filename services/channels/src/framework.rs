pub(crate) type Context = tuffite::ApplicationContext;
use std::sync::Arc;
use tuffite_ioc::Service;

pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        Service<dyn crate::ChannelEvents>,
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

impl crate::ChannelEvents for FrameworkEvents {
    fn status_changed(&self, payload: &[u8]) -> Result<(), String> {
        self.events
            .emit("ovule:channel-channel-changed", payload)
            .map_err(|error| error.to_string())
    }
}
