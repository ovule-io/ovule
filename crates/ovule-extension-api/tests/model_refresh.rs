use ovule_extension_api::ExtensionManifest;

fn manifest() -> ExtensionManifest {
    serde_json::from_str(include_str!(
        "../../../desktop/extensions/agent-deepseek/extension.json"
    ))
    .unwrap()
}

#[test]
fn refresh_requires_declared_network_and_credential_permissions() {
    let value = manifest();
    value.validate().unwrap();
    let mut no_network = value.clone();
    no_network.permissions.network.clear();
    assert!(no_network.validate().is_err());
    let mut no_secret = value;
    no_secret.permissions.secrets.clear();
    assert!(no_secret.validate().is_err());
}

#[test]
fn refresh_uses_the_saved_credential_without_a_frontend_secret_field() {
    let mut value = manifest();
    let refresh = value.contributes.onboarding[0]
        .actions
        .iter_mut()
        .find(|action| action.id == "refresh")
        .unwrap();
    assert!(refresh.field.is_none());
    refresh.field = Some("apiKey".to_owned());
    assert!(value.validate().is_err());
}
