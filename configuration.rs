//! Typed runtime declarations installed by `Application::setup`.
use tuffite::configuration::{
    Action, Asset, Behavior, Configuration, Explorer, Grant, IsolatedWorld, Mode, Network, Rule,
    Scope, Window,
};

pub fn configuration(debug: bool) -> Configuration {
    let mut config = Configuration::new(["ovule"]);
    config.app.isolated_worlds.insert(
        "io.ovule.host".into(),
        IsolatedWorld {
            directory: "desktop/dist/resources/features/settings/dist".into(),
            entry: "ollama-ui.js".into(),
            origins: vec!["ovule://-".into()],
        },
    );
    config = config.window(Window {
        label: "main".into(),
        url: "ovule://-/main".into(),
        title: "Ovule".into(),
        decorations: Some(false),
        width: 992,
        height: 800,
        min_width: Some(576),
        min_height: Some(640),
        max_width: Some(3840),
        max_height: Some(2160),
        ..Window::default()
    });
    if debug {
        for window in &mut config.app.windows {
            window.title = "Ovule Debug".into();
        }
    }
    config = config.asset(Asset::file(
        ["ovule://-"],
        ["/main", "/thread", "/pane", "/explorer", "/", "/index.html"],
        "desktop/dist/client/index.html",
    ));
    config = config.asset(Asset::directory(
        [
            "ovule://-",
            "ovule://*.artifact",
            "ovule://*.preview",
            "ovule://*.local",
        ],
        ["/assets/*"],
        "desktop/dist/client/assets",
    ));
    config = config.asset(Asset::file(
        ["ovule://-", "ovule://*.local"],
        ["/shell_api.js"],
        "desktop/dist/client/shell_api.js",
    ));
    config = config.asset(Asset::directory(
        ["ovule://-", "ovule://*.artifact"],
        ["/extensions/*"],
        "desktop/dist/resources/web/extensions",
    ));
    config = config.asset(Asset::file(
        ["ovule://*.local"],
        [
            "/code",
            "/markdown",
            "/office",
            "/unsupported",
            "/pdf",
            "/preview.html",
            "/html",
        ],
        "desktop/dist/client/preview.html",
    ));
    config.app.network = Some(Network {
        disable_http2: Some(true),
        max_response_bytes: Some(1_048_576),
        timeout_seconds: Some(30),
    });
    config.browser.devtools = true;
    config = config.rule(Rule {
        origins: vec!["ovule://-".into()],
        identifier: Some("app-shell".into()),
        shell_api: vec![
            Grant::from("ovule.*"),
            Grant::from("tuffite.Storage.*"),
            Grant::from("tuffite.Log.*"),
            Grant::from("tuffite.Utility.*"),
            Grant {
                method: "tuffite.Fs.ReadFile".into(),
                allow: Some(vec![Scope::Path("resource/*".into())]),
                deny: vec![],
            },
            Grant {
                method: "tuffite.Fs.Exists".into(),
                allow: Some(vec![Scope::Path("resource/*".into())]),
                deny: vec![],
            },
            Grant {
                method: "tuffite.Fs.*".into(),
                allow: Some(vec![
                    Scope::Path("data/**".into()),
                    Scope::Path("cache/**".into()),
                    Scope::Path("temp/**".into()),
                ]),
                deny: vec![],
            },
            Grant::from("tuffite.Path.Directories"),
            Grant {
                method: "tuffite.Path.Resolve".into(),
                allow: Some(vec![
                    Scope::Path("resource/**".into()),
                    Scope::Path("data/**".into()),
                    Scope::Path("cache/**".into()),
                    Scope::Path("temp/**".into()),
                ]),
                deny: vec![],
            },
            Grant::from("tuffite.Dialog.OpenFile"),
            Grant::from("tuffite.Dialog.OpenDirectory"),
            Grant::from("tuffite.Dialog.SaveFile"),
            Grant::from("tuffite.Window.*"),
        ],
        explorer: Some(Explorer {
            create: Some(true),
            execute_javascript: Some(true),
            behavior: [
                (
                    Action::Navigation,
                    Behavior {
                        mode: Mode::Delegate,
                        timeout_ms: None,
                    },
                ),
                (
                    Action::Dialog,
                    Behavior {
                        mode: Mode::Delegate,
                        timeout_ms: None,
                    },
                ),
                (
                    Action::ExternalProtocol,
                    Behavior {
                        mode: Mode::Browser,
                        timeout_ms: None,
                    },
                ),
                (
                    Action::NewWindow,
                    Behavior {
                        mode: Mode::Delegate,
                        timeout_ms: None,
                    },
                ),
            ]
            .into_iter()
            .collect(),
        }),
        ..Rule::default()
    });
    config = config.rule(Rule {
        origins: vec!["ovule://*.artifact".into(), "ovule://*.preview".into()],
        identifier: Some("artifact-and-preview".into()),
        shell_api: vec![
            Grant::from("tuffite.Path.Directories"),
            Grant::from("tuffite.Storage.Get"),
        ],
        ..Rule::default()
    });
    config = config.rule(Rule {
        origins: vec!["ovule://*.local".into()],
        identifier: Some("document-preview".into()),
        shell_api: vec![
            Grant::from("ovule.Preview.Describe"),
            Grant::from("ovule.Preview.ReadText"),
            Grant::from("ovule.Preview.ReadFile"),
        ],
        ..Rule::default()
    });
    config = config.rule(Rule { origins: vec!["ovule://-".into(), "ovule://*.artifact".into(), "ovule://*.preview".into(), "ovule://*.local".into()], identifier: Some("document-csp".into()), csp: Some("default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'nonce-ovule-spa' 'sha256-X+PV4o5mNco/Pvq+pI48kE+2DEZFB7C85wagfp0G5Bc=' 'sha256-7Jd2j+/dVXRgQ8V+qmwGHURb1YpFcJvFTBg5hMsQGV8=' 'sha256-duhaxWNI+6QAukUMmlYrkl97X+e0pxobkwS+TpY5/CQ=' 'sha256-RBZNiG3Ztb26Xi/69+VRecU4BPhrfxcvspLXMRrrCNE='; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https: http:; frame-src 'self' https:; object-src 'none'; base-uri 'none'".into()), ..Rule::default() });
    config
}
