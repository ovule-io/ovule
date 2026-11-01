use super::*;
use crate::channel_repository::{ChannelFeedInbound, ChannelInbound};
use rusqlite::Connection;
use std::path::Path;

#[test]
fn persists_workspace_and_event_atomically() {
    let mut store = Store::open(Path::new(":memory:")).unwrap();
    let mut workspace = crate::state::test_support::native_workspace();
    let root = std::env::current_dir().unwrap();
    workspace
        .create_thread("Persistent", &root.to_string_lossy())
        .unwrap();
    store
        .commit(
            &workspace,
            "thread/created",
            Some("thread-0001"),
            &serde_json::json!({"title": "Persistent"}),
        )
        .unwrap();

    let loaded = store.load().unwrap().unwrap();
    assert_eq!(loaded.snapshot().threads[0].title, "Persistent");
    let event_count = store.event_count().unwrap();
    assert_eq!(event_count, 1);
}

#[test]
fn persists_partial_assistant_stream_across_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("workspace.sqlite3");
    let root = std::env::current_dir().unwrap();
    let (attempt_id, thread_id);
    {
        let mut store = Store::open(&database).unwrap();
        let mut workspace = crate::state::test_support::native_workspace();
        workspace
            .upsert_agent(
                "test",
                "Test",
                "test",
                None,
                Vec::new(),
                Vec::new(),
                "",
                true,
            )
            .unwrap();
        workspace
            .create_thread("Streaming", &root.to_string_lossy())
            .unwrap();
        thread_id = workspace.snapshot().threads[0].id.clone();
        workspace.select_agent(&thread_id, "test").unwrap();
        let spec = workspace
            .prepare_message_attempt(&thread_id, "Stream it")
            .unwrap();
        attempt_id = spec.id.clone();
        workspace
            .append_attempt_output(&attempt_id, 0, "partial markdown")
            .unwrap();
        workspace
            .upsert_attempt_message_block(
                &attempt_id,
                "chart-1",
                "echarts",
                r#"{"option":{"series":[{"data":[1,2,3]}]}}"#.to_owned(),
            )
            .unwrap();
        store
            .commit(
                &workspace,
                "attempt/output",
                Some(&attempt_id),
                &serde_json::json!({"sequence": 0}),
            )
            .unwrap();
    }
    let store = Store::open(&database).unwrap();
    let loaded = store.load().unwrap().unwrap().snapshot();
    let response = loaded
        .messages
        .iter()
        .find(|message| message.thread_id == thread_id && message.role == "assistant")
        .unwrap();
    assert_eq!(response.content, "partial markdown");
    assert_eq!(response.stream_sequence, 1);
    let chart = response
        .parts
        .iter()
        .find(|part| part.kind == "echarts")
        .unwrap();
    assert!(chart.data_json.as_deref().unwrap().contains("series"));
}

#[test]
fn persists_partial_task_stream_across_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("workspace.sqlite3");
    let root = std::env::current_dir().unwrap();
    let attempt_id;
    {
        let mut store = Store::open(&database).unwrap();
        let mut workspace = crate::state::test_support::native_workspace();
        workspace
            .upsert_agent(
                "test",
                "Test",
                "test",
                None,
                Vec::new(),
                Vec::new(),
                "",
                true,
            )
            .unwrap();
        workspace
            .create_thread("Task stream", &root.to_string_lossy())
            .unwrap();
        let thread_id = workspace.snapshot().threads[0].id.clone();
        workspace.select_agent(&thread_id, "test").unwrap();
        workspace
            .create_goal(&thread_id, "Stream task", "Observe output")
            .unwrap();
        let goal_id = workspace.snapshot().goals[0].id.clone();
        workspace.add_task(&goal_id, "Inspect", None).unwrap();
        let task_id = workspace.snapshot().nodes[0].id.clone();
        let spec = workspace.prepare_attempt(&task_id).unwrap();
        attempt_id = spec.id.clone();
        workspace
            .append_attempt_output(&attempt_id, 0, "partial task markdown")
            .unwrap();
        store
            .commit(
                &workspace,
                "attempt/output",
                Some(&attempt_id),
                &serde_json::json!({"sequence": 0}),
            )
            .unwrap();
    }
    let store = Store::open(&database).unwrap();
    let loaded = store.load().unwrap().unwrap().snapshot();
    let attempt = loaded
        .attempts
        .iter()
        .find(|attempt| attempt.id == attempt_id)
        .unwrap();
    assert_eq!(attempt.output, "partial task markdown");
    assert_eq!(attempt.output_sequence, 1);
}

#[test]
#[allow(clippy::too_many_lines)] // One end-to-end durability test covers inbox, subscription feed, and outbox idempotency.
fn channel_inbox_is_idempotent_and_completion_queues_one_reply() {
    let data = tempfile::tempdir().unwrap();
    let database = data.path().join("ovule.sqlite3");
    let mut store = Store::open(&database).unwrap();
    let mut workspace = crate::state::test_support::native_workspace();
    let root = std::env::current_dir().unwrap();
    workspace
        .upsert_agent(
            "test",
            "Test",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace
        .create_thread("Channel", &root.to_string_lossy())
        .unwrap();
    let thread_id = workspace.snapshot().threads[0].id.clone();
    workspace.select_agent(&thread_id, "test").unwrap();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "hello from Channel")
        .unwrap();
    let inbound = ChannelInbound {
        channel_type: "channel",
        connection_id: "product-bot",
        event_id: "om_1",
        conversation_key: "oc_1",
        conversation_id: "oc_1",
        conversation_type: "group",
        platform_thread_id: None,
        platform_message_id: "om_1",
        sender_id: "ou_1",
        workspace_thread_id: &thread_id,
        attempt_id: &spec.id,
    };
    assert!(store.commit_channel_inbound(&workspace, &inbound).unwrap());
    drop(store);
    let mut store = Store::open(&database).unwrap();
    assert!(!store.commit_channel_inbound(&workspace, &inbound).unwrap());
    let route = store.channel_reply_route(&spec.id).unwrap().unwrap();
    assert_eq!(route.conversation_id, "oc_1");
    assert_eq!(route.connection_id, "product-bot");
    assert_eq!(route.conversation_type, "group");

    let subscription = store
        .subscribe_channel_for_attempt(&spec.id, "Product feedback")
        .unwrap();
    assert!(subscription.active);
    assert_eq!(subscription.workspace_thread_id, thread_id);
    let feed = ChannelFeedInbound {
        channel_type: "channel",
        connection_id: "product-bot",
        subscription_id: &subscription.subscription_id,
        event_id: "om_feedback",
        conversation_key: "oc_1",
        conversation_id: "oc_1",
        platform_thread_id: None,
        platform_message_id: "om_feedback",
        sender_id: "ou_customer",
        sender_name: Some("Customer"),
        content: "The export button is confusing",
        content_type: "text",
        platform_created_at: Some("1789526400000"),
    };
    assert!(store.append_channel_feed(&feed).unwrap());
    assert!(!store.append_channel_feed(&feed).unwrap());
    let messages = store
        .channel_feed(&thread_id, &subscription.subscription_id, 0, 10)
        .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, "The export button is confusing");
    assert_eq!(
        store
            .channel_feed(
                &thread_id,
                &subscription.subscription_id,
                messages[0].sequence,
                10
            )
            .unwrap(),
        []
    );
    assert!(
        !store
            .set_channel_subscription_active(&thread_id, &subscription.subscription_id, false,)
            .unwrap()
            .active
    );

    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "hello back".to_owned())
        .unwrap();
    store
        .commit_with_channel_reply(
            &workspace,
            "attempt/succeeded",
            &spec.id,
            &serde_json::json!({"status": "succeeded"}),
            &route,
            "hello back",
        )
        .unwrap();
    store
        .commit_with_channel_reply(
            &workspace,
            "attempt/succeeded",
            &spec.id,
            &serde_json::json!({"status": "succeeded"}),
            &route,
            "hello back",
        )
        .unwrap();
    let deliveries = store
        .pending_channel_deliveries("channel", "product-bot", 0, 10)
        .unwrap();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].body, "hello back");
    store
        .mark_channel_delivery_failed(&deliveries[0].delivery_id, "temporary", 500, false)
        .unwrap();
    assert!(
        store
            .pending_channel_deliveries("channel", "product-bot", 499, 10)
            .unwrap()
            .is_empty()
    );

    drop(store);
    let mut store = Store::open(&database).unwrap();
    let deliveries = store
        .pending_channel_deliveries("channel", "product-bot", 500, 10)
        .unwrap();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].attempts, 1);
    store
        .mark_channel_delivery_sent(&deliveries[0].delivery_id, "om_reply")
        .unwrap();
    drop(store);
    let store = Store::open(&database).unwrap();
    assert!(
        store
            .pending_channel_deliveries("channel", "product-bot", i64::MAX, 10)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn incompatible_schema_requires_an_explicit_data_reset() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite3");
    drop(Store::open(&path).unwrap());
    let connection = Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE metadata SET value = '4' WHERE key = 'schema_version'",
            [],
        )
        .unwrap();
    drop(connection);
    let error = Store::open(&path).err().unwrap();
    assert!(error.contains("mise run reset-data"));
    let connection = Connection::open(&path).unwrap();
    let version: String = connection
        .query_row(
            "SELECT value FROM metadata WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "4");
}

#[test]
fn round_trips_projects_endpoints_and_bindings() {
    use crate::state::WorkspaceKind;

    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("projects.sqlite3");
    let root = std::env::current_dir().unwrap();
    let (project_id, binding_id, endpoint_id);
    {
        let mut store = Store::open(&database).unwrap();
        let mut workspace = crate::state::test_support::native_workspace();
        workspace
            .create_thread("Thread", &root.to_string_lossy())
            .unwrap();
        let thread_id = workspace.snapshot().threads[0].id.clone();
        let created = workspace.create_project("Backend").unwrap();
        project_id = created
            .projects
            .iter()
            .find(|project| project.name == "Backend")
            .unwrap()
            .id
            .clone();
        workspace
            .move_thread_to_project(&thread_id, &project_id)
            .unwrap();
        let (id, _) = workspace
            .register_endpoint(
                "build-server",
                WorkspaceKind::Ssh,
                None,
                None,
                None,
                None,
                None,
                None,
                Vec::new(),
            )
            .unwrap();
        endpoint_id = id;
        let snapshot = workspace
            .bind_workspace(
                &thread_id,
                WorkspaceKind::Ssh,
                Some(&endpoint_id),
                "/srv/project",
                "server",
            )
            .unwrap();
        binding_id = snapshot.bindings[0].id.clone();
        store
            .commit(
                &workspace,
                "runtime/state-saved",
                None,
                &serde_json::json!({}),
            )
            .unwrap();
    }

    let store = Store::open(&database).unwrap();
    let loaded = store.load().unwrap().unwrap().snapshot();
    let backend = loaded
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .expect("Backend project persisted");
    assert_eq!(backend.name, "Backend");
    assert_eq!(
        loaded.threads[0].project_id.as_deref(),
        Some(project_id.as_str())
    );
    assert_eq!(
        loaded.threads[0].workspace_binding_ids,
        vec![binding_id.clone()]
    );
    assert_eq!(loaded.endpoints[0].id, endpoint_id);
    assert_eq!(loaded.endpoints[0].transport, "ssh");
    assert_eq!(loaded.bindings[0].id, binding_id);
    assert_eq!(loaded.bindings[0].kind, "ssh");
    assert_eq!(loaded.bindings[0].root, "/srv/project");
}
