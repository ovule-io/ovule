use ovule_extension_api::{ExtensionManifest, SpawnPlan};
fn manifest() -> ExtensionManifest {
    serde_json::from_value(serde_json::json!({
        "schemaVersion": 1, "apiVersion": 1, "id": "io.ovule.test", "version": "0.1.0", "private": true, "type": "module",
        "runtime": {"kind": "javascript", "entry": "extension.mjs"},
        "contributes": {"agents": [{"id": "test", "label": "Test", "executableCandidates": ["test-cli"]}]},
        "permissions": {"process": ["test-cli"], "workspace": true}
    })).unwrap()
}
#[test]
fn spawn_plan_cannot_exceed_the_manifest_or_agent_executables() {
    let mut manifest = manifest();
    manifest.validate().unwrap();
    let mut plan: SpawnPlan = serde_json::from_value(serde_json::json!({"executableCandidates": ["test-cli"], "args": [], "environment": [], "cwd": "workspace", "stdin": "jsonl-rpc"})).unwrap();
    plan.validate_for(&manifest, &manifest.contributes.agents[0])
        .unwrap();
    plan.executable_candidates = vec!["ungranted-cli".into()];
    assert!(
        plan.validate_for(&manifest, &manifest.contributes.agents[0])
            .is_err()
    );
    plan.executable_candidates = vec!["test-cli".into()];
    manifest.permissions.process.clear();
    assert!(
        plan.validate_for(&manifest, &manifest.contributes.agents[0])
            .is_err()
    );
}
#[test]
fn unknown_manifest_fields_and_unsupported_api_versions_fail_closed() {
    let mut manifest = manifest();
    manifest.api_version = 99;
    assert!(manifest.validate().is_err());
    assert!(
        serde_json::from_str::<ExtensionManifest>(r#"{"schemaVersion":1,"untrusted":true}"#)
            .is_err()
    );
}

#[test]
fn cloudflare_setup_is_declarative_and_cannot_redirect_management_credentials() {
    let manifest: ExtensionManifest = serde_json::from_str(include_str!(
        "../../../desktop/extensions/cloudflare-connectivity/extension.json"
    ))
    .unwrap();
    manifest.validate().unwrap();
    assert!(manifest.runtime.is_none());
    assert!(manifest.contributes.onboarding.is_empty());
    for mutation in 0..5 {
        let mut changed = manifest.clone();
        match mutation {
            0 => changed.permissions.network.clear(),
            1 => changed.permissions.secrets.clear(),
            2 => {
                changed.contributes.actions[0].target = "attacker".into();
            }
            3 => changed.permissions.process.clear(),
            _ => {
                changed.contributes.slash_commands[0].target = "attacker".into();
            }
        }
        assert!(changed.validate().is_err());
    }
}

#[test]
fn codex_authorization_is_declared_by_the_extension_and_protocol_is_required() {
    let source = include_str!("../../../desktop/extensions/agent-codex/extension.json");
    let manifest: ExtensionManifest = serde_json::from_str(source).unwrap();
    manifest.validate().unwrap();
    let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
    fn strip(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(fields) => {
                fields.remove("authorization");
                for child in fields.values_mut() {
                    strip(child);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    strip(item);
                }
            }
            _ => {}
        }
    }
    strip(&mut value);
    let missing: ExtensionManifest = serde_json::from_value(value).unwrap();
    assert!(missing.validate().is_err());
}
