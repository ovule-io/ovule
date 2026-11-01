pub(crate) type Context = tuffite::ApplicationContext;
mod ollama;
mod setup_adapters;
mod toolchain_jobs;

use ovule_toolchains::ToolchainRoot;
use std::sync::{Arc, Mutex};
use tuffite_ioc::Service;

#[allow(deprecated)] // SDK compatibility accessors stay inside framework adapters.
pub(crate) fn register<C: AsRef<Context> + Send + Sync + 'static>(
    registrar: &mut impl tuffite_ioc::Registrar<C>,
) -> tuffite_ioc::Result<()> {
    registrar.register(tuffite_ioc::factory::<
        Service<toolchain_jobs::ToolchainJobs>,
        _,
        _,
    >(|deps| {
        let context: &C = deps.context();
        let browser = context.as_ref();
        let root = deps.depends_on::<Service<ToolchainRoot>>()?;
        Ok(Arc::new(toolchain_jobs::ToolchainJobs::new(
            root.0.clone(),
            browser.executor(),
            browser.events(),
        )))
    }))?;
    registrar.register_eager(tuffite_ioc::factory::<
        Service<dyn crate::SetupToolchains>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<toolchain_jobs::ToolchainJobs>>()?)
    }))?;
    registrar.register(tuffite_ioc::factory::<
        Service<Mutex<ollama::OllamaRuntime>>,
        _,
        _,
    >(|deps| {
        let context: &C = deps.context();
        let browser = context.as_ref();
        let root = deps.depends_on::<Service<ToolchainRoot>>()?;
        Ok(Arc::new(Mutex::new(ollama::OllamaRuntime::new(
            root.0.clone(),
            browser.events(),
        )?)))
    }))?;
    registrar.register(tuffite_ioc::factory::<Service<ollama::OllamaHandle>, _, _>(
        |deps| {
            let owner = deps.depends_on::<Service<Mutex<ollama::OllamaRuntime>>>()?;
            let owner = owner.lock().map_err(|_| "Ollama lifecycle lock poisoned")?;
            Ok(Arc::new(owner.handle()))
        },
    ))?;
    registrar.register_eager(tuffite_ioc::factory::<crate::OllamaRuntimeService, _, _>(
        |deps| {
            Ok(Arc::new(Mutex::new(Box::new(RuntimeOwner {
                runtime: deps.depends_on::<Service<Mutex<ollama::OllamaRuntime>>>()?,
            }))))
        },
    ))?;
    registrar.register(
        tuffite_ioc::factory::<Service<dyn crate::SetupModels>, _, _>(|deps| {
            Ok(deps.depends_on::<Service<ollama::OllamaHandle>>()?)
        }),
    )?;
    registrar.register(tuffite_ioc::factory::<
        Service<dyn ovule_conversation::AttemptPrerequisites>,
        _,
        _,
    >(|deps| {
        Ok(deps.depends_on::<Service<ollama::OllamaHandle>>()?)
    }))?;

    Ok(())
}

struct RuntimeOwner {
    runtime: Arc<Mutex<ollama::OllamaRuntime>>,
}

impl crate::OllamaRuntime for RuntimeOwner {
    fn shutdown(&mut self, timeout: std::time::Duration) {
        self.runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .shutdown(timeout);
    }
}
