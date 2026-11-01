//! Install an explicitly selected extension using the same validator as Manage.
fn main() -> Result<(), String> {
    let source = std::env::args_os()
        .nth(1)
        .ok_or("Usage: install-extension <package-directory>")?;
    let installed =
        ovule_extensions::providers::install_extension_package(std::path::Path::new(&source))
            .map_err(|error| error.to_string())?;
    println!("Installed extension: {}", installed.display());
    Ok(())
}
