use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=tuffite.json");
    let debug = std::env::var("PROFILE").expect("Cargo build profile") == "debug";
    {
        let mut config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("tuffite.json").expect("read application manifest"),
        )
        .expect("parse application manifest");
        config["productName"] = "Ovule Debug".into();
        config["app"]["identifier"] = "io.ovule.desktop.debug".into();
        config["bundle"]["executable"] = "ovule-debug".into();
        write_if_changed(
            ".tuffite-debug.json",
            &serde_json::to_string_pretty(&config).expect("serialize debug manifest"),
        );
    }
    let manifest = if debug {
        ".tuffite-debug.json"
    } else {
        "tuffite.json"
    };
    // Both profiles have stable, separate JS outputs. Cargo check/clippy in
    // debug must never replace the release client's application-scoped IDs.
    let generated = "desktop/packages/ovule-shell-api/generated";
    let other_manifest = if debug {
        "tuffite.json"
    } else {
        ".tuffite-debug.json"
    };
    let other_output = if debug {
        generated.to_owned()
    } else {
        format!("{generated}/debug")
    };
    tuffite::build::shell_api::Generator::new()
        .manifest(
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo project root"))
                .join(other_manifest),
        )
        .javascript(other_output, tuffite::build::shell_api::OutputMode::Write)
        .generate()
        .expect("generate other channel's ShellAPI bindings");
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    #[cfg(all(feature = "native-framework", target_os = "windows"))]
    let framework_target = "x86_64-pc-windows-msvc";
    #[cfg(all(feature = "native-framework", target_os = "macos"))]
    let framework_target = "x86_64-apple-darwin";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    compile_error!("unsupported platform");
    #[cfg(feature = "native-framework")]
    let framework = tuffite::build::framework::Resolver::from_env()
        .expect("read Tuffite Framework resolver environment")
        .progress(true)
        .target(framework_target);
    let shell_api = tuffite::build::shell_api::Generator::new()
        .manifest(
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo project root"))
                .join(manifest),
        )
        .rust(&out_dir, tuffite::build::shell_api::OutputMode::Write)
        .javascript(
            if debug {
                format!("{generated}/debug")
            } else {
                generated.to_owned()
            },
            tuffite::build::shell_api::OutputMode::Write,
        );
    #[cfg(feature = "native-framework")]
    tuffite::build::Builder::new()
        .add(framework)
        .add(shell_api)
        .build()
        .expect("prepare Tuffite application build");
    #[cfg(not(feature = "native-framework"))]
    {
        shell_api.generate().expect("generate ShellAPI bindings");
    }
}

fn write_if_changed(path: &str, value: &str) {
    if std::fs::read_to_string(path).ok().as_deref() != Some(value) {
        std::fs::write(path, value).expect("write build channel configuration");
    }
}
