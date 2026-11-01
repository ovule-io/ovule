//! Register validated, bundled UI snapshots before renderer windows open.
use tuffite::isolated::{Host, WorldDefinition};
use tuffite::{Error, Result};

pub(crate) async fn register(host: &Host) -> Result<()> {
    let packages =
        ovule_extensions::providers::load_extensions().map_err(|e| Error::new(e.to_string()))?;
    for package in packages {
        let Some(ui) = &package.manifest.ui else {
            continue;
        };
        package
            .validate_web_assets()
            .map_err(|e| Error::new(e.to_string()))?;
        let entry = std::path::Path::new(&ui.entry);
        let definition = WorldDefinition::from_directory(
            &package.manifest.id,
            package.root.join(entry.parent().unwrap()),
            entry.file_name().unwrap().to_string_lossy(),
        )?
        .allow_origin("ovule://-");
        let (send, receive) = tokio::sync::oneshot::channel();
        host.register(definition, move |result| {
            let _ = send.send(result);
        })
        .map_err(|e| Error::new(e.to_string()))?;
        receive
            .await
            .map_err(|e| Error::new(e.to_string()))?
            .map_err(|e| Error::new(e.to_string()))?;
    }
    Ok(())
}
