use super::delivery::pairing_command_code;
use super::*;

#[test]
fn degraded_transport_remains_available_for_outbox_delivery() {
    assert!(health_state_can_deliver("connected"));
    assert!(health_state_can_deliver("degraded"));
    assert!(!health_state_can_deliver("reconnecting"));
    assert!(!health_state_can_deliver("error"));
}

#[test]
fn redacts_app_id_hint_and_derives_pairing_code() {
    assert_eq!(credential_hint("cli_1234567890"), "cli_12…7890");
    assert_eq!(pairing_code("cli_test", "secret").len(), 6);
    assert!(
        pairing_code("cli_test", "secret")
            .chars()
            .all(|value| value.is_ascii_digit())
    );
}

#[test]
fn pairing_commands_are_exact_and_bounded() {
    assert_eq!(pairing_command_code("/pair 012345"), Some("012345"));
    assert_eq!(pairing_command_code("  /pair   012345  "), Some("012345"));
    assert_eq!(pairing_command_code("/pair 12345"), None);
    assert_eq!(pairing_command_code("/pair 012345 extra"), None);
    assert_eq!(pairing_command_code("/pairing 012345"), None);
}

#[test]
fn paired_owner_messages_do_not_require_a_group_mention() {
    assert!(super::delivery::owner_can_start_attempt("owner", "owner"));
    assert!(!super::delivery::owner_can_start_attempt("owner", "other"));
}

#[test]
fn pairing_delivery_ids_are_stable_and_do_not_expose_platform_ids() {
    let id = pairing_delivery_id("product-bot", "om_sensitive");
    assert!(id.starts_with("pairing:"));
    assert!(!id.contains("product-bot"));
    assert!(!id.contains("om_sensitive"));
    assert_eq!(id, pairing_delivery_id("product-bot", "om_sensitive"));
    assert_ne!(id, pairing_delivery_id("support-bot", "om_sensitive"));
}

#[test]
fn channel_message_accepts_sdk_numeric_and_legacy_string_timestamps() {
    for create_time in [
        serde_json::json!(1_789_526_400_000_i64),
        serde_json::json!("1789526400000"),
    ] {
        let message = serde_json::from_value::<WorkerInboundMessage>(serde_json::json!({
            "messageId": "om_test",
            "chatId": "oc_test",
            "chatType": "p2p",
            "senderId": "ou_owner",
            "content": "/pair 012345",
            "rawContentType": "text",
            "createTime": create_time,
            "mentionedBot": false
        }))
        .expect("the Channel SDK timestamp shape should deserialize");
        assert_eq!(message.create_time.as_deref(), Some("1789526400000"));
    }
}

#[test]
fn network_operations_return_pending_without_waiting_for_worker_replies() {
    let data = tempfile::tempdir().unwrap();
    let state = Arc::new(ovule_workspace::WorkspaceSession::new(
        ovule_workspace::state::test_support::workspace(),
        ovule_workspace::providers::open(&data.path().join("workspace.sqlite3")).unwrap(),
    ));
    let configuration = crate::providers::workspace_configuration(state);
    let (commands, receiver) = mpsc::sync_channel(1);
    let handle = ChannelHandle {
        commands,
        statuses: Arc::default(),
        configuration: configuration.clone(),
        secrets: Arc::new(ovule_secrets::providers::open(&data.path().join("secrets")).unwrap()),
    };
    // There is deliberately no worker consuming this queue. Neither operation
    // may wait for its response or for capacity on the serial dispatch thread.
    let status = handle.start_registration("default", false).unwrap();
    assert_eq!(status.connections[0].state, "registering");
    handle.start_registration("default", false).unwrap();
    assert!(handle.start_registration("another", false).is_err());
    assert!(matches!(
        receiver.try_recv().unwrap(),
        RuntimeCommand::StartRegistration { .. }
    ));
    assert!(receiver.try_recv().is_err());
    lock(&handle.statuses).get_mut("default").unwrap().state =
        "waiting_for_authorization".to_owned();
    let status = handle.refresh("default").unwrap();
    assert_eq!(
        status
            .connections
            .iter()
            .find(|item| item.connection_id == "default")
            .unwrap()
            .state,
        "refreshing"
    );
    assert!(matches!(
        receiver.try_recv().unwrap(),
        RuntimeCommand::Refresh { .. }
    ));
    configuration
        .save("default", "feishu", true, "hint")
        .unwrap();
    lock(&handle.statuses).get_mut("default").unwrap().state = "connected".to_owned();
    let status = handle.refresh("default").unwrap();
    assert_eq!(
        status
            .connections
            .iter()
            .find(|item| item.connection_id == "default")
            .unwrap()
            .state,
        "refreshing"
    );
    assert!(matches!(
        receiver.try_recv().unwrap(),
        RuntimeCommand::Refresh { .. }
    ));
}
