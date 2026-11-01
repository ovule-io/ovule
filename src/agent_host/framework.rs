pub(crate) type Context = tuffite::ApplicationContext;
struct Events(tuffite::EventEmitter);
impl ovule_agent::execution::approval::ApprovalEvents for Events {
    fn emit(&self, value: &serde_json::Value) -> Result<(), String> {
        self.0
            .emit(
                "ovule:agent-approval",
                &serde_json::to_vec(value).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        tracing::debug!(
            kind = value
                .get("kind")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown"),
            "Approval event submitted to Framework"
        );
        Ok(())
    }
}
pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    r: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    r.register(tuffite_ioc::factory::<
        tuffite_ioc::Service<dyn ovule_agent::execution::approval::ApprovalEvents>,
        _,
        _,
    >(|b| {
        let c: &C = b.context();
        Ok(std::sync::Arc::new(Events(c.as_ref().events())))
    }))?;
    Ok(())
}
