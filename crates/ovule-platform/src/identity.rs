use std::path::PathBuf;

pub const APPLICATION_ID: &str = if cfg!(debug_assertions) {
    "io.ovule.desktop.debug"
} else {
    "io.ovule.desktop"
};

pub const DATA_NAME: &str = if cfg!(debug_assertions) {
    "Ovule Debug"
} else {
    "Ovule"
};

pub fn downloads_directory() -> Result<PathBuf, String> {
    directories::UserDirs::new()
        .map(|dirs| {
            dirs.download_dir()
                .map_or_else(|| dirs.home_dir().join("Downloads"), PathBuf::from)
        })
        .ok_or_else(|| "resolve Downloads directory".to_owned())
}

pub fn data_directory() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("OVULE_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    directories::ProjectDirs::from("io", "Ovule", DATA_NAME)
        .map(|dirs| dirs.data_local_dir().to_path_buf())
        .ok_or_else(|| "resolve Ovule data directory".to_owned())
}

/// Match the pinned Framework's `browser_main_parts/ManifestService` layout.
/// Path.Directories is a renderer-only RPC and cannot run during native startup.
/// `OVULE_DATA_DIR` isolates Ovule services, not the Framework browser profile.
pub fn browser_profile_directory() -> Result<PathBuf, String> {
    let base = directories::BaseDirs::new()
        .ok_or_else(|| "resolve browser application data directory".to_owned())?;
    Ok(browser_profile_from_args(
        std::env::args_os().skip(1),
        base.data_local_dir(),
        APPLICATION_ID,
    ))
}

fn browser_profile_from_args(
    args: impl IntoIterator<Item = std::ffi::OsString>,
    data: &std::path::Path,
    application: &str,
) -> PathBuf {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--user-data-dir" {
            if let Some(path) = args.next().filter(|path| !path.is_empty()) {
                return PathBuf::from(path);
            }
        } else if let Some(path) = arg
            .to_str()
            .and_then(|arg| arg.strip_prefix("--user-data-dir="))
            .filter(|path| !path.is_empty())
        {
            return PathBuf::from(path);
        }
    }
    data.join("Tuffite")
        .join(application)
        .join("data")
        .join("profile")
}

#[cfg(test)]
mod profile_tests {
    use super::*;
    #[test]
    fn profile_matches_framework_layout_and_honors_explicit_override() {
        let base = std::path::Path::new("/application-data");
        for application in ["io.ovule.desktop", "io.ovule.desktop.debug"] {
            assert_eq!(
                browser_profile_from_args([], base, application),
                base.join("Tuffite").join(application).join("data/profile")
            );
        }
        for args in [
            vec!["--user-data-dir=/isolated/profile"],
            vec!["--user-data-dir", "/isolated/profile"],
        ] {
            assert_eq!(
                browser_profile_from_args(args.into_iter().map(Into::into), base, APPLICATION_ID),
                PathBuf::from("/isolated/profile")
            );
        }
        assert_eq!(
            browser_profile_from_args(["--user-data-dir=".into()], base, APPLICATION_ID),
            base.join("Tuffite")
                .join(APPLICATION_ID)
                .join("data/profile")
        );
    }
}
