pub(crate) type ApplicationContext = tuffite::ApplicationContext;
use crate::shell::preview::{OfficePreviewWorld, PreviewGrants};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tuffite::Result;

pub(crate) struct App {
    services: Option<Arc<tuffite_ioc::Registry<ApplicationContext>>>,
}

// Context state must not retain the application's service owners after shutdown.
struct SharedServices(std::sync::Weak<tuffite_ioc::Registry<ApplicationContext>>);

impl tuffite::Application for App {
    fn setup(builder: tuffite::app::Builder<Self>) -> Result<tuffite::app::Builder<Self>> {
        Ok(crate::configure_application(builder))
    }

    fn new(context: ApplicationContext) -> Result<Self> {
        let services = Arc::new(crate::bootstrap::build(context.clone())?);
        context.set_state(Arc::new(SharedServices(Arc::downgrade(&services))));
        Ok(Self {
            services: Some(services),
        })
    }

    async fn shutdown(&mut self, _context: tuffite::ShutdownContext) -> Result<()> {
        drop(self.services.take());
        Ok(())
    }
}

pub(crate) struct Profile {
    pub(crate) preview_worlds: Mutex<HashMap<String, OfficePreviewWorld>>,
    pub(crate) preview_grants: PreviewGrants,
    services: tuffite_ioc::Registry<tuffite::BrowserContext>,
    pub(crate) isolated: tuffite::isolated::Host,
}

impl tuffite::Browser for Profile {
    fn setup(builder: tuffite::browser::Builder<Self>) -> Result<tuffite::browser::Builder<Self>> {
        Ok(builder.interfaces(|registry| {
            registry
                .register::<crate::shell_api::interfaces::Browser>()
                .register::<crate::shell_api::interfaces::Preview>()
        }))
    }

    fn new(context: tuffite::BrowserContext) -> Result<Self> {
        let services = context
            .application()
            .and_then(|application| application.state::<SharedServices>())
            .and_then(|shared| shared.0.upgrade())
            .ok_or_else(|| tuffite::Error::new("Application services are unavailable"))?;
        let isolated = context.isolated();
        let mut services = services.scope(context);
        services
            .register(tuffite_ioc::factory::<
                ovule_browser::downloads::DownloadsRuntime,
                _,
                _,
            >(|build| {
                let context: &tuffite::BrowserContext = build.context();
                let id = context
                    .profile_id()
                    .ok_or("Missing browser profile ID")?
                    .as_str();
                let mut root = ovule_platform::identity::data_directory()?;
                let mut profile = ovule_platform::identity::browser_profile_directory()?;
                if id != "default" {
                    root = root.join("profiles").join(id);
                    profile = profile.join("profiles").join(format!("profile-{id}"));
                }
                let downloads = ovule_browser::downloads::Downloads::open(&root)?;
                downloads.set_profile(profile)?;
                Ok(Arc::new(downloads))
            }))
            .map_err(tuffite::Error::new)?;
        services.freeze();
        services.initialize().map_err(tuffite::Error::new)?;
        Ok(Self {
            preview_grants: PreviewGrants::default(),
            preview_worlds: Mutex::new(HashMap::new()),
            isolated,
            services,
        })
    }
    async fn initialize(&mut self) -> Result<()> {
        crate::isolated_ui::register(&self.isolated).await
    }
}

impl App {
    pub(crate) fn service<F: tuffite_ioc::KeyedService>(
        &self,
    ) -> Result<Arc<F::Value>, tuffite::CommandError> {
        self.services
            .as_ref()
            .ok_or_else(|| tuffite::CommandError::Failed("Application is shutting down".into()))?
            .get::<F>()
            .map_err(tuffite::CommandError::Failed)
    }
}

impl Profile {
    pub(crate) fn service<F: tuffite_ioc::KeyedService>(
        &self,
    ) -> Result<Arc<F::Value>, tuffite::CommandError> {
        self.services
            .get::<F>()
            .map_err(tuffite::CommandError::Failed)
    }
}
