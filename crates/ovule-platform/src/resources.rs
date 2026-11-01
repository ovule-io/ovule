use std::path::{Path, PathBuf};

/// Resource roots for portable packages and macOS application bundles, in priority order.
#[must_use]
pub fn packaged_resource_roots(executable: &Path) -> Vec<PathBuf> {
    let Some(parent) = executable.parent() else {
        return Vec::new();
    };
    let contents = parent.parent().filter(|contents| {
        parent.file_name().is_some_and(|name| name == "MacOS")
            && contents.file_name().is_some_and(|name| name == "Contents")
    });
    let assets = contents.map_or_else(
        || parent.join("assets"),
        |contents| contents.join("Resources/assets"),
    );
    vec![assets.join("desktop/dist/resources"), assets]
}

pub fn bundled_skill_path(skill_id: &str) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("resolve Ovule executable: {error}"))?;
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../desktop")
        .join("skills")
        .join(skill_id)
        .join("SKILL.md");
    packaged_resource_roots(&executable)
        .into_iter()
        .map(|root| root.join("skills").join(skill_id).join("SKILL.md"))
        .chain([development])
        .find(|path| path.is_file())
        .ok_or_else(|| format!("bundled Skill is missing: {skill_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_resources_follow_macos_bundle_layout() {
        assert_eq!(
            packaged_resource_roots(Path::new("Ovule.app/Contents/MacOS/ovule")),
            vec![
                PathBuf::from("Ovule.app/Contents/Resources/assets/desktop/dist/resources"),
                PathBuf::from("Ovule.app/Contents/Resources/assets"),
            ]
        );
    }

    #[test]
    fn portable_resources_stay_beside_the_executable() {
        for executable in ["package/ovule", "package/ovule.exe", "package/MacOS/ovule"] {
            let assets = Path::new(executable).parent().unwrap().join("assets");
            assert_eq!(
                packaged_resource_roots(Path::new(executable)),
                vec![assets.join("desktop/dist/resources"), assets]
            );
        }
    }
}

pub fn ensure_default_workspace_path(data_root: &std::path::Path) -> Result<String, String> {
    let root = data_root.join("workspaces").join("default");
    std::fs::create_dir_all(&root).map_err(|error| format!("create default workspace: {error}"))?;
    Ok(root.to_string_lossy().into_owned())
}
