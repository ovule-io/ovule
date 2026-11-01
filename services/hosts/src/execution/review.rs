use super::ExecutionPermissions;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Review recognized read-only diagnostics, including their read-only process grant.
/// Unknown commands, interpreters, writes and network access require manual consent.
#[must_use]
pub fn review_read_only(arguments: &Value) -> bool {
    review_in(
        arguments,
        &[
            Path::new("/Applications"),
            Path::new("/System/Applications"),
            Path::new("/System/Library/CoreServices"),
        ],
    )
}

fn review_in(arguments: &Value, roots: &[&Path]) -> bool {
    fn review(arguments: &Value, roots: &[&Path]) -> Option<()> {
        let permissions: ExecutionPermissions =
            serde_json::from_value(arguments.get("permissions")?.clone()).ok()?;
        if permissions.network
            || !permissions.write_paths.is_empty()
            || permissions.validate().is_err()
        {
            return None;
        }
        let argv = arguments
            .get("argv")?
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()?;
        let (program, operands) = argv.split_first()?;
        if *program == "/usr/bin/pgrep" {
            let (pattern, flags) = operands.split_last()?;
            return (permissions.process_info
                && permissions.read_paths.is_empty()
                && !pattern.is_empty()
                && pattern.len() <= 256
                && !pattern.starts_with('-')
                && flags
                    .iter()
                    .all(|flag| matches!(*flag, "-f" | "-l" | "-fl" | "-lf" | "-x" | "-i")))
            .then_some(());
        }
        if *program == "/bin/ps" {
            return (permissions.process_info
                && permissions.read_paths.is_empty()
                && (operands == ["-Ao", "pid,comm"]
                    || operands == ["-axo", "pid,comm"]
                    || operands == ["-Ao", "pid,ppid,comm"]))
            .then_some(());
        }
        let targets = diagnostic_targets(program, operands)?;
        let paths = targets.iter().map(PathBuf::from).collect::<Vec<_>>();
        if paths.is_empty() || paths.iter().any(|path| !canonical_read_target(path)) {
            return None;
        }
        // Listing the app directory itself is metadata-only, and cannot recursively
        // read bundle contents with the accepted ls flags.
        if *program == "/bin/ls" && paths.len() == 1 && roots.contains(&paths[0].as_path()) {
            return (permissions.read_paths == paths).then_some(());
        }
        let bundles = paths
            .iter()
            .map(|path| bundle_root(path, roots))
            .collect::<Option<Vec<_>>>()?;
        if permissions.read_paths.is_empty()
            || permissions
                .read_paths
                .iter()
                .any(|read| !bundles.iter().any(|bundle| read.starts_with(bundle)))
            || paths.iter().any(|path| {
                !permissions
                    .read_paths
                    .iter()
                    .any(|read| path.starts_with(read))
            })
        {
            return None;
        }
        Some(())
    }
    review(arguments, roots).is_some()
}

/// Missing leaves below an existing canonical grant can report absence without
/// another prompt. Existing or broken symlink aliases never gain automatic access.
fn canonical_read_target(path: &Path) -> bool {
    if !path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return false;
    }
    let mut existing = path;
    loop {
        match std::fs::symlink_metadata(existing) {
            Ok(_) => return std::fs::canonicalize(existing).ok().as_deref() == Some(existing),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(parent) = existing.parent() else {
                    return false;
                };
                existing = parent;
            }
            Err(_) => return false,
        }
    }
}

fn bundle_root(path: &Path, roots: &[&Path]) -> Option<PathBuf> {
    for root in roots {
        if let Ok(relative) = path.strip_prefix(root) {
            let app = relative.components().next()?.as_os_str();
            if Path::new(app)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
            {
                return Some(root.join(app));
            }
        }
    }
    None
}

fn diagnostic_targets<'a>(program: &str, operands: &'a [&'a str]) -> Option<&'a [&'a str]> {
    if program == "/usr/bin/stat" {
        return stat_targets(operands);
    }
    let (_, flags) = operands.split_last()?;
    let allowed = match program {
        "/usr/bin/codesign" => codesign_flags(flags),
        "/usr/bin/xattr" => flags == ["-l"],
        "/usr/bin/plutil" => flags == ["-p"] || flags == ["-lint"],
        "/usr/libexec/PlistBuddy" => plist_prints(flags),
        "/usr/sbin/spctl" => {
            flags.iter().any(|flag| matches!(*flag, "-a" | "--assess"))
                && flags.iter().all(|flag| {
                    matches!(
                        *flag,
                        "-a" | "--assess"
                            | "-t"
                            | "--type"
                            | "exec"
                            | "execute"
                            | "-v"
                            | "-vv"
                            | "--verbose"
                            | "--verbose=1"
                            | "--verbose=2"
                            | "--verbose=3"
                            | "--verbose=4"
                    )
                })
        }
        "/bin/ls" => {
            flags.is_empty()
                || flags == ["-l"]
                || flags == ["-ld"]
                || flags == ["-la"]
                || flags == ["-1"]
        }
        _ => false,
    };
    allowed.then_some(&operands[operands.len() - 1..])
}

/// stat formatting arguments are inert strings. Reject links, write/output options
/// and unknown switches rather than accepting an arbitrary flag bag.
fn stat_targets<'a>(operands: &'a [&'a str]) -> Option<&'a [&'a str]> {
    let mut index = 0;
    while let Some(flag) = operands.get(index) {
        match *flag {
            "-x" => index += 1,
            "-f" | "-t" => {
                operands.get(index + 1)?;
                index += 2;
            }
            value if value.starts_with('/') || Path::new(value).is_absolute() => {
                return Some(&operands[index..]);
            }
            _ => return None,
        }
    }
    None
}

fn plist_prints(flags: &[&str]) -> bool {
    !flags.is_empty()
        && flags.len().is_multiple_of(2)
        && flags.chunks_exact(2).all(|pair| {
            if pair[0] != "-c" {
                return false;
            }
            let words = pair[1].split_whitespace().collect::<Vec<_>>();
            words == ["Print"]
                || (words.len() == 2
                    && words[0] == "Print"
                    && words[1].starts_with(':')
                    && words[1].chars().all(|ch| {
                        ch.is_ascii_alphanumeric() || matches!(ch, ':' | '_' | '-' | '.')
                    }))
        })
}

fn codesign_flags(flags: &[&str]) -> bool {
    flags.iter().any(|flag| {
        matches!(
            *flag,
            "-d" | "--display" | "-dv" | "-dvv" | "-dvvv" | "-dvvvv" | "--verify"
        )
    }) && flags.iter().all(|flag| {
        matches!(
            *flag,
            "-d" | "--display"
                | "-dv"
                | "-dvv"
                | "-dvvv"
                | "-dvvvv"
                | "--verify"
                | "--verbose"
                | "--verbose=1"
                | "--verbose=2"
                | "--verbose=3"
                | "--verbose=4"
                | "-r-"
                | "--strict"
                | "--deep"
                | "--entitlements"
                | ":-"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn review_at(arguments: &Value, applications: &Path) -> bool {
        review_in(arguments, &[applications])
    }
    #[test]
    fn metadata_flag_profiles_are_reviewable_without_accepting_mutations() {
        let dir = tempfile::tempdir().unwrap();
        let apps = dir.path().canonicalize().unwrap();
        let app = apps.join("Fixture.app");
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        for argv in [
            json!([
                "/usr/bin/stat",
                "-f",
                "%N size=%z modified=%Sm",
                "-t",
                "%Y-%m-%d %H:%M:%S",
                app
            ]),
            json!(["/usr/bin/codesign", "-d", "-r-", "--verbose=2", app]),
            json!(["/bin/ls", "-1", app.join("Contents")]),
            json!([
                "/usr/bin/codesign",
                "--verify",
                "--verbose=2",
                app.join("Contents/Missing.framework")
            ]),
        ] {
            assert!(review_in(
                &json!({"argv":argv,"permissions":{"readPaths":[app]}}),
                &[&apps]
            ));
        }
        assert!(review_in(
            &json!({"argv":["/bin/ps","-Ao","pid,comm"],"permissions":{"processInfo":true}}),
            &[&apps]
        ));
        assert!(!review_in(
            &json!({"argv":["/bin/ps","eww","-Ao","pid,args"],"permissions":{"processInfo":true}}),
            &[&apps]
        ));
        assert!(diagnostic_targets("/usr/bin/stat", &["-f"]).is_none());
        assert!(
            diagnostic_targets(
                "/usr/bin/codesign",
                &["--sign", "-", "/Applications/Fixture.app"]
            )
            .is_none()
        );
    }
    #[test]
    fn observed_diagnostic_sequence_is_reviewed_without_repeated_confirmations() {
        let dir = tempfile::tempdir().unwrap();
        let apps = dir.path().canonicalize().unwrap();
        let app = apps.join("Fixture.app");
        let system = apps.join("SystemApps");
        let calculator = system.join("Calculator.app");
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::create_dir_all(app.join("Contents/_CodeSignature")).unwrap();
        std::fs::create_dir_all(&calculator).unwrap();
        for path in [
            "Contents/Info.plist",
            "Contents/MacOS/Feishu",
            "Contents/_CodeSignature/CodeResources",
        ] {
            std::fs::write(app.join(path), "fixture").unwrap();
        }
        let app_read = json!({"readPaths":[app],"processInfo":true});
        for argv in [
            json!(["/usr/bin/codesign", "-dv", "--verbose=4", app]),
            json!([
                "/usr/bin/codesign",
                "--verify",
                "--strict",
                "--verbose=2",
                app
            ]),
            json!([
                "/usr/libexec/PlistBuddy",
                "-c",
                "Print :CFBundleIdentifier",
                "-c",
                "Print :CFBundleShortVersionString",
                "-c",
                "Print :NSMicrophoneUsageDescription",
                "-c",
                "Print :NSCameraUsageDescription",
                app.join("Contents/Info.plist")
            ]),
            json!([
                "/usr/sbin/spctl",
                "--assess",
                "--type",
                "execute",
                "--verbose=4",
                app
            ]),
            json!(["/usr/bin/xattr", "-l", app]),
            json!([
                "/usr/bin/codesign",
                "--verify",
                "--deep",
                "--strict",
                "--verbose=4",
                app
            ]),
            json!([
                "/usr/bin/stat",
                "-x",
                app,
                app.join("Contents/Info.plist"),
                app.join("Contents/MacOS/Feishu"),
                app.join("Contents/_CodeSignature/CodeResources")
            ]),
        ] {
            assert!(
                review_in(
                    &json!({"argv":argv,"permissions":app_read}),
                    &[&apps, &system]
                ),
                "{argv}"
            );
        }
        assert!(review_in(
            &json!({"argv":["/usr/bin/codesign","--verify","--strict","--verbose=2",calculator],"permissions":{"readPaths":[calculator],"processInfo":true}}),
            &[&apps, &system]
        ));
        assert!(review_in(
            &json!({"argv":["/usr/bin/pgrep","-fl","Feishu"],"permissions":{"processInfo":true}}),
            &[&apps]
        ));
    }
    #[test]
    fn expanded_review_rejects_mutations_and_hidden_command_sequences() {
        for flags in [
            vec!["-c", "Set :Name changed"],
            vec!["-c", "Print :Name; Delete :Name"],
            vec!["-c", "Print :Name\nSave"],
            vec!["-c", "Print :Name", "-c", "Delete :Name"],
        ] {
            assert!(!plist_prints(&flags));
        }
        assert!(
            diagnostic_targets(
                "/usr/sbin/spctl",
                &["--master-disable", "/Applications/Fixture.app"]
            )
            .is_none()
        );
        assert!(!review_read_only(
            &json!({"argv":["/usr/bin/pgrep","-fl","Feishu"],"permissions":{"processInfo":true,"network":true}})
        ));
        assert!(!review_read_only(
            &json!({"argv":["/usr/bin/pgrep","-fl","Feishu"],"permissions":{"processInfo":true,"writePaths":["/tmp"]}})
        ));
    }
    #[test]
    fn review_only_exact_read_diagnostics_and_never_interpreters_or_broad_grants() {
        let dir = tempfile::tempdir().unwrap();
        let applications = dir.path().canonicalize().unwrap();
        let app = applications.join("Fixture.app");
        std::fs::create_dir(&app).unwrap();
        let request = json!({"argv":["/usr/bin/codesign","-d","--entitlements",":-",app],
            "permissions":{"readPaths":[app]}});
        assert!(review_at(&request, &applications));
        let verify = json!({"argv":["/usr/bin/codesign","--verify","--verbose=2",app],"permissions":{"readPaths":[app]}});
        assert!(
            review_at(&verify, &applications),
            "common verbose levels must not fall back to manual review"
        );
        let mut attributes = request.clone();
        attributes["argv"] = json!(["/usr/bin/xattr", "-l", app]);
        assert!(review_at(&attributes, &applications));
        attributes["argv"] = json!(["/usr/bin/xattr", "-d", "com.apple.quarantine", app]);
        assert!(
            !review_at(&attributes, &applications),
            "xattr writes always require manual consent"
        );

        for (pointer, replacement) in [
            ("/argv/0", json!("codesign")),
            ("/argv/0", json!("/bin/sh")),
            ("/argv/1", json!("--sign")),
            ("/permissions/network", json!(true)),
            ("/permissions/readPaths", json!([applications])),
            ("/permissions/writePaths", json!([app])),
            ("/permissions/unknown", json!(true)),
        ] {
            let mut changed = request.clone();
            // Object fields may not exist in the initial minimal permission request.
            if let Some(field) = pointer.strip_prefix("/permissions/") {
                changed["permissions"][field] = replacement;
            } else {
                *changed.pointer_mut(pointer).unwrap() = replacement;
            }
            assert!(!review_at(&changed, &applications), "{pointer}");
        }
        #[cfg(unix)]
        {
            let alias = applications.join("Alias.app");
            std::os::unix::fs::symlink(&app, &alias).unwrap();
            let mut changed = request.clone();
            changed["argv"][4] = json!(alias);
            assert!(!review_at(&changed, &applications));
        }
    }
}
