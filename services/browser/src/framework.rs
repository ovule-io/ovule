pub(crate) type Context = tuffite::ApplicationContext;
struct Events(tuffite::EventEmitter);
impl crate::BrowserEvents for Events {
    fn emit(&self, request: &serde_json::Value) -> Result<(), String> {
        self.0
            .emit(
                "ovule:browser-command",
                &serde_json::to_vec(request).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())
    }
}
pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        tuffite_ioc::Service<dyn crate::BrowserEvents>,
        _,
        _,
    >(|build| {
        let context: &C = build.context();
        Ok(std::sync::Arc::new(Events(context.as_ref().events())))
    }))?;
    Ok(())
}
