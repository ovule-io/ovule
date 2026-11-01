//! Choose test providers before registration; frozen bindings are never replaced.
use std::any::TypeId;
use tuffite_ioc::Registry;
use tuffite_ioc::{Factory, Registrar, Result};

pub struct SelectedProviders<'a, C> {
    registry: &'a mut Registry<C>,
    omitted: Vec<TypeId>,
}
impl<'a, C> SelectedProviders<'a, C> {
    pub fn new(registry: &'a mut Registry<C>, omitted: Vec<TypeId>) -> Self {
        Self { registry, omitted }
    }
}
impl<C: Send + Sync + 'static> Registrar<C> for SelectedProviders<'_, C> {
    fn register<F: Factory<C>>(&mut self, factory: F) -> Result<&mut Self> {
        if !self.omitted.contains(&TypeId::of::<F::Target>()) {
            self.registry.register(factory)?;
        }
        Ok(self)
    }
}
