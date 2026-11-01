use super::*;

#[test]
fn delegates_task_into_attempt_and_advances_goal() {
    let mut workspace = fixture();
    let task_id = workspace
        .workflow
        .nodes
        .iter()
        .find(|node| matches!(node.kind, NodeKind::Task { .. }))
        .unwrap()
        .id
        .clone();
    let attempt = workspace.prepare_attempt(&task_id).unwrap();
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .finish_attempt(&attempt.id, "succeeded", "done".to_owned())
        .unwrap();
    assert_eq!(workspace.conversation.attempts.len(), 1);
    assert_eq!(
        workspace.conversation.attempts[0].task_id.as_deref(),
        Some(task_id.as_str())
    );
    assert_eq!(workspace.conversation.attempts[0].status, "succeeded");
    assert_eq!(
        workspace.conversation.attempts[0]
            .events
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        [
            "attempt/created",
            "attempt/dispatched",
            "attempt/started",
            "attempt/succeeded",
        ]
    );
    assert!(workspace.workflow.goals[0].progress.starts_with("1/2"));
}

#[test]
fn gate_cannot_be_delegated_and_can_be_resolved() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let gate_id = workspace
        .workflow
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Gate)
        .unwrap()
        .id
        .clone();
    assert!(workspace.prepare_attempt(&gate_id).is_err());
    assert_eq!(
        workspace.resolve_gate(&gate_id, true).unwrap_err(),
        "Gate dependencies are not complete"
    );
    let task_id = workspace.first_pending_task(&thread_id).unwrap();
    let attempt = workspace.prepare_attempt(&task_id).unwrap();
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .finish_attempt(&attempt.id, "succeeded", "done".to_owned())
        .unwrap();
    assert!(workspace.ready_pending_tasks(&thread_id).is_empty());
    workspace.resolve_gate(&gate_id, true).unwrap();
    assert_eq!(workspace.workflow.goals[0].status, "succeeded");
}

#[test]
fn reset_workflows_removes_workflow_node_threads_but_keeps_conversation_threads() {
    let mut workspace = fixture();
    let task_id = workspace.workflow.nodes[0].id.clone();
    workspace.prepare_attempt(&task_id).unwrap();
    assert_eq!(workspace.conversation.threads.len(), 2);
    let conversation_id = workspace.workflow.goals[0].thread_id.clone();

    let snapshot = workspace.reset_workflows();

    assert!(snapshot.goals.is_empty());
    assert!(snapshot.nodes.is_empty());
    assert_eq!(snapshot.threads.len(), 1);
    assert_eq!(snapshot.threads[0].id, conversation_id);
}

#[test]
fn startup_reconciliation_removes_missing_extension_drivers_and_repairs_threads() {
    let mut workspace = crate::state::test_support::workspace();
    let root = std::env::current_dir().unwrap();
    workspace
        .create_thread("Legacy", &root.to_string_lossy())
        .unwrap();
    let mut serialized = serde_json::to_value(&workspace).unwrap();
    serialized["catalog"]["agents"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "claude",
            "label": "Claude",
            "driver": "claude",
            "model_id": null,
            "skill_ids": [],
            "tool_ids": [],
            "instructions": "",
            "enabled": true,
            "extension_id": "io.ovule.agent.claude"
        }));
    serialized["threads"][0]["agent"] = serde_json::json!("claude");
    serialized["default_agent_id"] = serde_json::json!("claude");
    let mut workspace: Workspace = serde_json::from_value(serialized).unwrap();
    crate::state::test_support::attach(&mut workspace);

    assert!(workspace.reconcile_extensions().unwrap());
    let snapshot = workspace.snapshot();
    assert!(!snapshot.agents.iter().any(|agent| agent.driver == "claude"));
    assert_ne!(snapshot.threads[0].agent, "claude");
}

#[test]
fn validates_agent_and_parent_identities() {
    let mut workspace = fixture();
    assert!(workspace.select_agent("missing", "codex").is_err());
    let thread_id = workspace.conversation.threads[0].id.clone();
    assert!(workspace.select_agent(&thread_id, "missing").is_err());
    assert!(workspace.select_agent(&thread_id, "ovule").is_err());
    assert!(workspace.add_task("missing", "Task", None).is_err());
}

#[test]
fn persists_thread_messages_and_assistant_result() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Explain the workspace")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "Workspace explained".to_owned())
        .unwrap();
    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.messages.len(), 2);
    assert_eq!(snapshot.messages[0].role, "user");
    assert_eq!(snapshot.messages[1].role, "assistant");
    assert_eq!(snapshot.messages[1].content, "Workspace explained");
    assert_eq!(snapshot.messages[1].status, "complete");
    assert_eq!(snapshot.messages[1].parts[0].kind, "markdown");
    assert_eq!(snapshot.attempts[0].thread_id, thread_id);
    assert!(snapshot.attempts[0].task_id.is_none());
    assert_eq!(snapshot.attempts[0].purpose, "conversation");
    assert_eq!(snapshot.attempts[0].driver.as_deref(), Some("test"));
    assert_eq!(
        snapshot.attempts[0].source_message_id.as_deref(),
        Some(snapshot.messages[0].id.as_str())
    );
    assert_eq!(
        snapshot.attempts[0].response_message_id.as_deref(),
        Some(snapshot.messages[1].id.as_str())
    );
}

#[test]
fn persists_local_image_parts_and_exposes_them_to_the_attempt() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let image = LocalImageAttachment {
        id: format!("{}.png", "a".repeat(64)),
        name: "clipboard.png".to_owned(),
        media_type: "image/png".to_owned(),
        size_bytes: 128,
        path: "C:\\data\\attachments\\clipboard.png".to_owned(),
    };
    let spec = workspace
        .prepare_message_attempt_with_attachments(&thread_id, "", vec![image.clone()])
        .unwrap();

    assert_eq!(spec.local_images, vec![image]);
    assert!(spec.prompt.contains("[attached image: clipboard.png]"));
    let message = workspace
        .conversation
        .messages
        .iter()
        .find(|message| message.id == spec.source_message_id.as_deref().unwrap())
        .unwrap();
    assert!(message.content.is_empty());
    assert_eq!(message.parts.len(), 1);
    assert_eq!(message.parts[0].kind, "image");
    assert!(
        message.parts[0]
            .url
            .as_deref()
            .unwrap()
            .starts_with("ovule-attachment:///")
    );
}

#[test]
fn persists_ordered_stream_output_into_the_pending_assistant_message() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Stream it")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .append_attempt_output(&spec.id, 0, "**hello")
        .unwrap();
    workspace
        .append_attempt_output(&spec.id, 1, " world**")
        .unwrap();
    assert!(workspace.append_attempt_output(&spec.id, 3, "gap").is_err());
    let snapshot = workspace.snapshot();
    let response = snapshot
        .messages
        .iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(response.content, "**hello world**");
    assert_eq!(response.status, "streaming");
    assert_eq!(response.stream_sequence, 2);
}

#[test]
fn extension_message_blocks_survive_attempt_completion() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Show the chart")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .append_attempt_output(&spec.id, 0, "Chart ready.")
        .unwrap();
    workspace
        .upsert_attempt_message_block(
            &spec.id,
            "chart-1",
            "echarts",
            r#"{"option":{"series":[{"data":[1,2]}]}}"#.to_owned(),
        )
        .unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "Chart ready.".to_owned())
        .unwrap();
    let response = workspace
        .snapshot()
        .messages
        .into_iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(response.parts.len(), 2);
    assert_eq!(response.parts[1].kind, "echarts");
    assert!(
        response.parts[1]
            .data_json
            .as_deref()
            .unwrap()
            .contains("series")
    );
}

#[test]
fn replacement_output_removes_control_envelopes_without_losing_blocks() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Render a chart")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .append_attempt_output(
            &spec.id,
            0,
            &format!("Chart ready.\n\n{}", &"```ovule-block"[..6]),
        )
        .unwrap();
    workspace
        .replace_attempt_output(&spec.id, "Chart ready.".to_owned())
        .unwrap();
    workspace
        .upsert_attempt_message_block(
            &spec.id,
            "chart-1",
            "echarts",
            r#"{"option":{"series":[{"data":[1,2]}]}}"#.to_owned(),
        )
        .unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "Chart ready.".to_owned())
        .unwrap();
    let snapshot = workspace.snapshot();
    let attempt = snapshot
        .attempts
        .iter()
        .find(|attempt| attempt.id == spec.id)
        .unwrap();
    let response = snapshot
        .messages
        .iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(attempt.output, "Chart ready.");
    assert_eq!(response.content, "Chart ready.");
    assert_eq!(response.parts.len(), 2);
    assert!(!response.content.contains("ovule-block"));
}

#[test]
fn conversation_stream_survives_completion_and_names_a_new_thread() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    workspace.configure_defaults("test", None, None).unwrap();
    let directory = tempfile::tempdir().unwrap();
    workspace
        .create_thread("New thread", &directory.path().to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Explain streaming Markdown")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .append_attempt_output(&spec.id, 0, "# Streaming Markdown\n\n")
        .unwrap();
    workspace
        .append_attempt_output(&spec.id, 1, "**Rendered incrementally.**")
        .unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "fallback summary".to_owned())
        .unwrap();

    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.threads[0].title, "Streaming Markdown");
    let response = snapshot
        .messages
        .iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(
        response.content,
        "# Streaming Markdown\n\n**Rendered incrementally.**"
    );
    assert_eq!(
        response.parts[0].text.as_deref(),
        Some(response.content.as_str())
    );
    assert_eq!(response.status, "complete");
    assert_eq!(response.stream_sequence, 2);
}

#[test]
fn new_threads_inherit_defaults_and_can_bind_a_workspace_later() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
        .upsert_agent(
            "preferred",
            "Preferred",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    workspace
        .configure_defaults("preferred", None, None)
        .unwrap();
    let initial = tempfile::tempdir().unwrap();
    let rebound = tempfile::tempdir().unwrap();
    workspace
        .create_thread("New thread", &initial.path().to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    assert_eq!(workspace.conversation.threads[0].agent, "preferred");
    assert_eq!(
        workspace.conversation.threads[0].workspace_path,
        external_path(&initial.path().canonicalize().unwrap())
    );

    workspace
        .set_thread_workspace(&thread_id, &rebound.path().to_string_lossy())
        .unwrap();
    assert_eq!(
        workspace.conversation.threads[0].workspace_path,
        external_path(&rebound.path().canonicalize().unwrap())
    );
}

#[cfg(windows)]
#[test]
fn external_workspace_paths_do_not_expose_windows_verbatim_prefixes() {
    assert_eq!(
        external_path(std::path::Path::new(r"\\?\C:\workspace")),
        r"C:\workspace"
    );
    assert_eq!(
        external_path(std::path::Path::new(r"\\?\UNC\server\share\workspace")),
        r"\\server\share\workspace"
    );
}

#[test]
fn browser_suggestions_cover_url_search_and_workspace_html() {
    let mut workspace = fixture();
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("report.html"), "<h1>Report</h1>").unwrap();
    std::fs::write(directory.path().join("notes.md"), "# Notes").unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    workspace
        .set_thread_workspace(&thread_id, &directory.path().to_string_lossy())
        .unwrap();

    let remote = workspace
        .browser_suggestions(Some(&thread_id), "example.com")
        .unwrap();
    assert!(
        remote
            .iter()
            .any(|item| item.kind == "url" && item.target == "https://example.com/")
    );
    assert!(
        remote
            .iter()
            .any(|item| item.kind == "search" && item.target == "example.com")
    );
    let local_url = workspace
        .browser_suggestions(Some(&thread_id), "file:///C:/preview.html")
        .unwrap();
    assert!(
        local_url
            .iter()
            .any(|item| item.kind == "url" && item.target == "file:///C:/preview.html")
    );
    let local = workspace
        .browser_suggestions(Some(&thread_id), "report")
        .unwrap();
    assert!(local.iter().any(|item| {
        item.kind == "file" && item.target == "report.html" && item.title == "report.html"
    }));
    assert!(!local.iter().any(|item| item.target == "notes.md"));
}

#[test]
fn automatic_task_selection_stops_at_a_gate() {
    let mut workspace = fixture();
    let goal_id = workspace.workflow.goals[0].id.clone();
    workspace
        .add_task(&goal_id, "Verify after approval", None)
        .unwrap();
    let first_task = workspace
        .first_pending_task(&workspace.conversation.threads[0].id)
        .unwrap();
    let attempt = workspace.prepare_attempt(&first_task).unwrap();
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .finish_attempt(&attempt.id, "succeeded", "done".to_owned())
        .unwrap();
    assert!(
        workspace
            .first_pending_task(&workspace.conversation.threads[0].id)
            .is_none()
    );

    let gate_id = workspace
        .workflow
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Gate)
        .unwrap()
        .id
        .clone();
    assert!(
        workspace
            .ready_pending_tasks(&workspace.conversation.threads[0].id.clone())
            .is_empty()
    );
    workspace.resolve_gate(&gate_id, true).unwrap();
    let next_task = workspace
        .first_pending_task(&workspace.conversation.threads[0].id)
        .unwrap();
    assert_eq!(
        workspace
            .workflow
            .nodes
            .iter()
            .find(|node| node.id == next_task)
            .unwrap()
            .title,
        "Verify after approval"
    );
}

#[test]
fn task_attempt_streams_into_its_workflow_node_thread() {
    let mut workspace = fixture();
    let task_id = workspace
        .first_pending_task(&workspace.conversation.threads[0].id)
        .unwrap();
    let attempt = workspace.prepare_attempt(&task_id).unwrap();
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .append_attempt_output(&attempt.id, 0, "## Inspecting\n\n")
        .unwrap();
    workspace
        .append_attempt_output(&attempt.id, 1, "Found the result.")
        .unwrap();
    workspace
        .finish_attempt(&attempt.id, "succeeded", "Found the result.".to_owned())
        .unwrap();

    let snapshot = workspace.snapshot();
    let streamed = snapshot
        .attempts
        .iter()
        .find(|item| item.id == attempt.id)
        .unwrap();
    assert_eq!(streamed.output, "## Inspecting\n\nFound the result.");
    assert_eq!(streamed.output_sequence, 2);
    assert_eq!(streamed.status, "succeeded");
    let node = snapshot
        .nodes
        .iter()
        .find(|node| node.id == task_id)
        .unwrap();
    let node_messages = snapshot
        .messages
        .iter()
        .filter(|message| message.thread_id == node.thread_id)
        .collect::<Vec<_>>();
    assert_eq!(node_messages.len(), 2);
    assert_eq!(node_messages[0].role, "user");
    assert_eq!(node_messages[1].role, "assistant");
    assert_eq!(
        node_messages[1].content,
        "## Inspecting\n\nFound the result."
    );
    assert_eq!(node_messages[1].status, "complete");
}

#[test]
fn explicit_skill_command_attaches_the_enabled_skill_to_one_attempt() {
    let mut workspace = fixture();
    let directory = tempfile::tempdir().unwrap();
    let skill = directory.path().join("release-check");
    std::fs::create_dir(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: release-check\ndescription: Verify a release.\n---\nCheck it.\n",
    )
    .unwrap();
    workspace
        .settings
        .catalog
        .import_skill(&skill.to_string_lossy(), true)
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();

    let selected = workspace
        .prepare_skill_attempt(
            &thread_id,
            "/release-check inspect the package",
            &["release-check".to_owned()],
        )
        .unwrap();
    assert_eq!(selected.skill_paths.len(), 1);
    let selected_path = std::path::Path::new(&selected.skill_paths[0]);
    assert_eq!(
        selected_path.file_name().and_then(|name| name.to_str()),
        Some("SKILL.md")
    );
    assert_eq!(
        selected_path
            .parent()
            .and_then(std::path::Path::file_name)
            .and_then(|name| name.to_str()),
        Some("release-check")
    );

    let ordinary = workspace
        .prepare_message_attempt(&thread_id, "inspect without a Skill")
        .unwrap();
    assert!(ordinary.skill_paths.is_empty());
}

#[test]
fn onboarding_configures_defaults_without_creating_a_thread() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    let snapshot = workspace.configure_defaults("test", None, None).unwrap();
    assert!(snapshot.threads.is_empty());
    assert!(snapshot.messages.is_empty());
    assert!(snapshot.attempts.is_empty());
    assert!(snapshot.goals.is_empty());
}

#[test]
fn onboarding_command_derives_goal_and_workflow_from_structured_agent_output() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    let root = crate::state::test_support::root();
    workspace
        .settings
        .catalog
        .import_skill(
            &root
                .join("skills")
                .join("onboarding")
                .join("SKILL.md")
                .to_string_lossy(),
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    workspace
        .create_thread("New thread", &root.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_onboarding_workflow(&thread_id, "prepare the local Agent environment")
        .unwrap();
    assert!(spec.structured_goal);
    assert!(spec.skill_paths.iter().any(
        |path| path.ends_with("onboarding\\SKILL.md") || path.ends_with("onboarding/SKILL.md")
    ));
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
            .finish_attempt(
                &spec.id,
                "succeeded",
                r#"{"title":"Ship release","intent":"Build and verify the release.","response":"I created the release workflow.","nodes":[{"kind":"task","title":"Build"},{"kind":"gate","title":"Approve"}]}"#.to_owned(),
            )
            .unwrap();
    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.threads.len(), 1);
    assert_eq!(snapshot.goals.len(), 1);
    assert_eq!(snapshot.goals[0].title, "Ship release");
    assert_eq!(snapshot.nodes.len(), 2);
    assert!(snapshot.nodes.iter().all(|node| node.thread_id.is_empty()));
    assert!(
        snapshot
            .nodes
            .iter()
            .any(|node| { node.kind == "gate" && node.title == "Approve" })
    );
    assert_eq!(
        snapshot.messages[1].content,
        "I created the release workflow."
    );
    assert_eq!(snapshot.attempts[0].status, "succeeded");
}

#[test]
fn onboarding_command_keeps_request_when_goal_derivation_is_invalid() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    let root = crate::state::test_support::root();
    workspace
        .settings
        .catalog
        .import_skill(
            &root
                .join("skills")
                .join("onboarding")
                .join("SKILL.md")
                .to_string_lossy(),
            true,
        )
        .unwrap();
    workspace.configure_defaults("test", None, None).unwrap();
    workspace
        .create_thread("New thread", &root.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_onboarding_workflow(&thread_id, "Keep this request")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "not json".to_owned())
        .unwrap();
    let snapshot = workspace.snapshot();
    assert_eq!(
        snapshot.messages[0].content,
        "/onboarding Keep this request"
    );
    assert_eq!(snapshot.messages[1].status, "error");
    assert!(snapshot.goals.is_empty());
    assert_eq!(snapshot.attempts[0].status, "failed");
}

#[test]
fn goal_prompt_creates_an_agent_planned_workflow() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    workspace.configure_defaults("test", None, None).unwrap();
    let root = std::env::current_dir().unwrap();
    workspace
        .create_thread("Conversation", &root.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_goal_workflow(&thread_id, None, "Ship and verify the release")
        .unwrap();
    assert!(spec.structured_goal);
    assert_eq!(workspace.conversation.attempts[0].purpose, "goal_creation");
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .finish_attempt(
            &spec.id,
            "succeeded",
            r#"{"title":"Ship release","intent":"Ship a verified release.","response":"Workflow created.","nodes":[{"kind":"task","title":"Build"},{"kind":"gate","title":"Approve"}]}"#.to_owned(),
        )
        .unwrap();
    assert_eq!(workspace.workflow.goals.len(), 1);
    assert_eq!(workspace.workflow.nodes.len(), 2);
    assert!(
        workspace
            .workflow
            .nodes
            .iter()
            .all(|node| node.thread_id.is_empty())
    );
}

#[test]
fn dynamic_replan_supersedes_remaining_nodes_and_preserves_history() {
    let mut workspace = fixture();
    let goal_id = workspace.workflow.goals[0].id.clone();
    let task_id = workspace.workflow.nodes[0].id.clone();
    let attempt = workspace.prepare_attempt(&task_id).unwrap();
    let task_thread_id = workspace.workflow.nodes[0].thread_id.clone();
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .finish_attempt(&attempt.id, "succeeded", "Build completed".to_owned())
        .unwrap();
    let replan = workspace
        .prepare_workflow_replan(&task_id, "succeeded", "Build completed")
        .unwrap();
    assert!(replan.structured_goal);
    assert_eq!(replan.source_message_id, None);
    assert_eq!(workspace.goal(&goal_id).unwrap().status, "replanning");
    workspace.dispatch_attempt(&replan.id).unwrap();
    workspace.start_attempt(&replan.id).unwrap();
    workspace
        .finish_attempt(
            &replan.id,
            "succeeded",
            r#"{"title":"Ship","intent":"Ship safely","response":"Adjusted remaining work.","nodes":[{"kind":"task","title":"Verify artifacts"}]}"#.to_owned(),
        )
        .unwrap();
    assert_eq!(workspace.workflow.nodes[0].status, "succeeded");
    assert_eq!(workspace.workflow.nodes[0].thread_id, task_thread_id);
    assert_eq!(workspace.workflow.nodes[1].status, "superseded");
    assert_eq!(
        workspace.workflow.nodes.last().unwrap().title,
        "Verify artifacts"
    );
    assert_eq!(workspace.goal(&goal_id).unwrap().status, "active");
}

#[test]
#[allow(clippy::too_many_lines)]
fn extension_workflow_uses_extension_skills_and_requires_the_declared_outcome() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    let root = crate::state::test_support::root();
    let extension = root.join("plugins/channel-sample");
    for skill in ["channel-channel", "channel-cli"] {
        workspace
            .settings
            .catalog
            .import_skill(
                &extension
                    .join("skills")
                    .join(skill)
                    .join("SKILL.md")
                    .to_string_lossy(),
                true,
            )
            .unwrap();
    }
    workspace.configure_defaults("test", None, None).unwrap();
    workspace
        .create_thread("New thread", &root.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let skills = vec!["channel-channel".to_owned(), "channel-cli".to_owned()];
    let fallback = r#"{"title":"配置 Channel Bot","intent":"完成端到端配置。","response":"已创建稳定工作流。","nodes":[{"kind":"task","title":"检查现有连接"},{"kind":"gate","title":"完成授权"}]}"#;
    let spec = workspace
            .prepare_extension_workflow(
                &thread_id,
                "channel",
                "repair and verify the bot",
                &skills,
                "The owner must pair with /pair. A real inbound message and durable outbox reply are required.",
                fallback.to_owned(),
                "channel-setup",
                r#"{"state":"not_configured"}"#.to_owned(),
            )
            .unwrap();

    assert!(spec.structured_goal);
    assert_eq!(
        workspace.snapshot().messages[0].content,
        "/channel repair and verify the bot"
    );
    assert!(
        spec.skill_paths
            .iter()
            .any(|path| path.ends_with("channel-channel\\SKILL.md")
                || path.ends_with("channel-channel/SKILL.md"))
    );
    assert!(
        spec.skill_paths
            .iter()
            .any(|path| path.ends_with("channel-cli\\SKILL.md")
                || path.ends_with("channel-cli/SKILL.md"))
    );
    assert!(spec.prompt.contains("owner must pair with /pair"));
    assert!(spec.prompt.contains("real inbound message"));
    assert!(spec.prompt.contains("durable outbox reply"));
    assert!(
        workspace.snapshot().messages[1]
            .parts
            .iter()
            .any(|part| part.kind == "channel-setup")
    );
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    let snapshot = workspace
        .finish_attempt(
            &spec.id,
            "succeeded",
            "I can help configure the channel bot.".to_owned(),
        )
        .unwrap();
    assert_eq!(snapshot.attempts[0].status, "succeeded");
    assert_eq!(snapshot.attempts[0].summary, "已创建稳定工作流。");
    assert_eq!(snapshot.goals[0].title, "配置 Channel Bot");
    assert_eq!(snapshot.nodes.len(), 2);
    let reply = workspace
        .conversation
        .messages
        .iter()
        .find(|message| {
            message.attempt_id.as_deref() == Some(&spec.id) && message.role == "assistant"
        })
        .unwrap();
    assert!(reply.parts.iter().any(|part| part.kind == "workflow"));
    assert!(!reply.parts.iter().any(|part| part.kind == "channel-setup"));
    let task = workspace
        .workflow
        .nodes
        .iter()
        .find(|node| matches!(node.kind, NodeKind::Task { .. }))
        .unwrap()
        .id
        .clone();
    let attempt = workspace.prepare_attempt(&task).unwrap();
    let node_reply = workspace
        .conversation
        .messages
        .iter()
        .find(|message| {
            message.attempt_id.as_deref() == Some(&attempt.id) && message.role == "assistant"
        })
        .unwrap();
    assert!(
        node_reply
            .parts
            .iter()
            .any(|part| part.kind == "channel-setup")
    );
}

#[test]
fn goal_derivation_accepts_observed_single_quoted_output_and_unicode_titles() {
    let long_title = "人工辅助 Browser Use 登录：从 CLI/产品给出的真实 URL 由用户完成登录授权，再用 CLI 验证状态（标记为适合未来 CDP 录制，当前不声称自动化）";
    let source = format!(
        "{{'title': '初始化 Channel 机器人', 'intent': '完成 Channel channel 初始化并以真实状态验证。', 'response': '已创建可观测的初始化工作流。', 'nodes': [{{'kind': 'task', 'title': '{long_title}'}}, {{'kind': 'gate', 'title': '批准登录授权'}}]}}"
    );
    let goal = parse_goal_derivation(&source, true).unwrap();
    assert_eq!(goal.title, "初始化 Channel 机器人");
    assert_eq!(goal.nodes.len(), 2);
    assert_eq!(goal.nodes[0].title, long_title);
}

#[test]
fn goal_derivation_accepts_apostrophes_inside_single_quoted_values() {
    let goal = parse_goal_derivation(
            "{'title':'Channel setup','intent':'Configure the user's Channel bot.','response':'It's ready.','nodes':[{'kind':'task','title':'Inspect user's CLI'}]}",
            true,
        )
        .unwrap();
    assert_eq!(goal.intent, "Configure the user's Channel bot.");
    assert_eq!(goal.response, "It's ready.");
    assert_eq!(goal.nodes[0].title, "Inspect user's CLI");
}

#[test]
fn goal_derivation_accepts_explicit_remote_host_agent_and_workspaces() {
    let goal = parse_goal_derivation(
        r#"{"title":"Remote build","intent":"Build remotely.","response":"Planned.","nodes":[{"kind":"task","title":"Build","agent":"codex-review","host":"host-42","workspaces":["workspace-a","workspace-b"]}]}"#,
        true,
    )
    .unwrap();
    assert_eq!(goal.nodes[0].agent.as_deref(), Some("codex-review"));
    assert_eq!(goal.nodes[0].host.as_deref(), Some("host-42"));
    assert_eq!(goal.nodes[0].workspaces, ["workspace-a", "workspace-b"]);
}

#[test]
fn goal_derivation_preserves_parallel_dependencies() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_goal_workflow(&thread_id, None, "Run independent checks")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    let snapshot = workspace
        .finish_attempt(
            &spec.id,
            "succeeded",
            r#"{"title":"Parallel checks","intent":"Run independent checks then verify.","response":"Parallel workflow created.","nodes":[{"id":"lint","kind":"task","title":"Lint","dependsOn":[]},{"id":"test","kind":"task","title":"Test","dependsOn":[]},{"id":"verify","kind":"gate","title":"Verify","dependsOn":["lint","test"]}]}"#.to_owned(),
        )
        .unwrap();
    let goal_id = snapshot
        .goals
        .iter()
        .find(|goal| goal.title == "Parallel checks")
        .unwrap()
        .id
        .clone();
    let nodes = snapshot
        .nodes
        .iter()
        .filter(|node| node.goal_id == goal_id)
        .collect::<Vec<_>>();
    assert_eq!(nodes.len(), 3);
    assert!(nodes[0].dependency_ids.is_empty());
    assert!(nodes[1].dependency_ids.is_empty());
    assert_eq!(
        nodes[2].dependency_ids,
        [nodes[0].id.clone(), nodes[1].id.clone()]
    );
    assert_eq!(nodes[2].status, "pending");
    let node_ids = nodes.iter().map(|node| node.id.clone()).collect::<Vec<_>>();
    drop(nodes);
    let ready = workspace.ready_pending_tasks(&thread_id);
    assert!(ready.contains(&node_ids[0]));
    assert!(ready.contains(&node_ids[1]));
    assert!(!ready.contains(&node_ids[2]));
}

#[test]
fn goal_derivation_keeps_schema_validation_after_json5_fallback() {
    assert!(
        parse_goal_derivation(
            "{'title':'x','intent':'y','response':'z','nodes':[{'kind':'tool','title':'bad'}]}",
            true,
        )
        .unwrap_err()
        .contains("Node kind")
    );
    assert!(
            parse_goal_derivation(
                "{'title':'x','intent':'y','response':'z','extra':true,'nodes':[{'kind':'task','title':'ok'}]}",
                true,
            )
            .unwrap_err()
            .contains("unknown field")
        );
    let wrapped = parse_goal_derivation(
        "I created the plan below.\n```json\n{\"title\":\"x\",\"intent\":\"y\",\"response\":\"z\",\"nodes\":[{\"kind\":\"task\",\"title\":\"ok\"}]}\n```\nReady to begin.",
        true,
    )
    .unwrap();
    assert_eq!(wrapped.title, "x");
    let final_object = parse_goal_derivation(
        "Example: {\"invalid\":true}\nFinal: {\"title\":\"final\",\"intent\":\"ship\",\"response\":\"ready\",\"nodes\":[{\"kind\":\"task\",\"title\":\"verify\"}]}",
        true,
    )
    .unwrap();
    assert_eq!(final_object.title, "final");
}

#[test]
fn tracks_terminal_run_lifecycle() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_terminal_run(
            &thread_id,
            "echo ok",
            Some("terminal-1".to_owned()),
            None,
            false,
        )
        .unwrap();
    assert_eq!(
        spec.workspace_path,
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .unwrap()
            .to_string_lossy()
    );
    assert_eq!(spec.workspace_binding_id, None);
    workspace.start_terminal_run(&spec.id).unwrap();
    workspace
        .finish_terminal_run(
            &spec.id,
            "succeeded",
            "ok\n".to_owned(),
            String::new(),
            Some(0),
        )
        .unwrap();
    let run = &workspace.snapshot().terminal_runs[0];
    assert_eq!(run.status, "succeeded");
    assert_eq!(run.owner_id.as_deref(), Some("terminal-1"));
    assert_eq!(run.stdout, "ok\n");
    assert_eq!(run.exit_code, Some(0.0));
}

#[test]
fn terminal_cwd_selection_is_explicit_and_thread_scoped() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let thread_workspace = workspace.conversation.threads[0].workspace_path.clone();
    let binding_root = tempfile::tempdir().unwrap();
    let binding_root = binding_root.path().to_string_lossy().into_owned();
    let snapshot = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Local,
            None,
            &binding_root,
            "attached",
        )
        .unwrap();
    let binding_id = snapshot.bindings[0].id.clone();

    let thread_spec = workspace
        .prepare_terminal_run(&thread_id, "pwd", None, None, true)
        .unwrap();
    assert_eq!(thread_spec.workspace_path, thread_workspace);
    assert_eq!(thread_spec.workspace_binding_id, None);

    let binding_spec = workspace
        .prepare_terminal_run(&thread_id, "pwd", None, Some(binding_id.clone()), false)
        .unwrap();
    assert_eq!(binding_spec.workspace_path, binding_root);
    assert_eq!(binding_spec.workspace_binding_id, Some(binding_id.clone()));

    assert!(
        workspace
            .prepare_terminal_run(&thread_id, "pwd", None, Some(binding_id), true)
            .unwrap_err()
            .contains("cannot select both")
    );
}

#[test]
fn office_files_are_confined_and_only_spreadsheets_are_editable() {
    let mut workspace = fixture();
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("report.xlsx"), b"xlsx").unwrap();
    std::fs::write(root.path().join("brief.docx"), b"docx").unwrap();
    std::fs::write(root.path().join("notes.md"), b"markdown").unwrap();
    let outside_file = outside.path().join("outside.xlsx");
    let outside_pdf = outside.path().join("outside.pdf");
    std::fs::write(&outside_file, b"outside").unwrap();
    std::fs::write(&outside_pdf, b"%PDF-1.7").unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    workspace
        .set_thread_workspace(&thread_id, &root.path().to_string_lossy())
        .unwrap();

    assert!(
        workspace
            .resolve_office_file(&thread_id, "report.xlsx", true)
            .unwrap()
            .ends_with("report.xlsx")
    );
    assert!(
        workspace
            .resolve_office_file(&thread_id, "brief.docx", true)
            .is_ok()
    );
    assert!(
        workspace
            .resolve_editable_office_file(&thread_id, "new.csv", false)
            .unwrap()
            .ends_with("new.csv")
    );
    assert!(
        workspace
            .resolve_editable_office_file(&thread_id, "brief.docx", true)
            .is_err()
    );
    assert!(
        workspace
            .resolve_office_file(&thread_id, "notes.md", true)
            .is_err()
    );
    assert!(
        workspace
            .resolve_office_file(&thread_id, &outside_file.to_string_lossy(), true)
            .is_ok()
    );
    assert!(
        workspace
            .resolve_editable_office_file(&thread_id, &outside_file.to_string_lossy(), true)
            .is_ok()
    );
    assert!(
        workspace
            .resolve_office_file(&thread_id, &outside_pdf.to_string_lossy(), true)
            .is_ok()
    );
    assert!(
        workspace
            .resolve_editable_office_file(&thread_id, &outside_pdf.to_string_lossy(), true)
            .is_err()
    );
}

#[test]
fn workspace_assets_allow_message_image_formats() {
    let mut workspace = fixture();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("reference.webp"), b"webp").unwrap();
    std::fs::write(root.path().join("notes.md"), b"markdown").unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    workspace
        .set_thread_workspace(&thread_id, &root.path().to_string_lossy())
        .unwrap();

    assert!(
        workspace
            .resolve_workspace_asset(&thread_id, "reference.webp", true)
            .unwrap()
            .ends_with("reference.webp")
    );
    assert!(
        workspace
            .resolve_workspace_asset(&thread_id, "notes.md", true)
            .is_err()
    );
}

fn fixture() -> Workspace {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
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
    let current = std::env::current_dir().unwrap();
    let current = current.to_string_lossy();
    workspace.create_thread("Test thread", &current).unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    workspace.select_agent(&thread_id, "test").unwrap();
    workspace
        .create_goal(&thread_id, "Test goal", "Exercise state transitions")
        .unwrap();
    let goal_id = workspace.workflow.goals[0].id.clone();
    workspace
        .add_task(&goal_id, "Inspect workspace", None)
        .unwrap();
    workspace.add_gate(&goal_id, "Approve result").unwrap();
    workspace
}

#[test]
fn new_thread_inherits_seeded_default_project() {
    let mut workspace = crate::state::test_support::workspace();
    let current = std::env::current_dir().unwrap();
    workspace
        .create_thread("First thread", &current.to_string_lossy())
        .unwrap();
    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.projects.len(), 1);
    assert_eq!(snapshot.projects[0].name, "Default project");
    assert_eq!(
        snapshot.threads[0].project_id.as_deref(),
        Some(snapshot.projects[0].id.as_str())
    );
}

#[test]
fn migration_backfills_project_for_legacy_workspace() {
    let mut workspace = crate::state::test_support::workspace();
    let current = std::env::current_dir().unwrap();
    workspace
        .create_thread("Legacy", &current.to_string_lossy())
        .unwrap();
    workspace.inventory.projects.clear();
    workspace.conversation.threads[0].project_id = None;

    let mutated = workspace.apply_projects_migration();
    assert!(mutated);
    assert_eq!(workspace.inventory.projects.len(), 1);
    assert!(workspace.conversation.threads[0].project_id.is_some());
    assert_eq!(
        workspace.conversation.threads[0].project_id.as_deref(),
        Some(workspace.inventory.projects[0].id.as_str())
    );
    assert!(!workspace.apply_projects_migration());
}

#[test]
fn create_project_is_case_insensitive_unique() {
    let mut workspace = crate::state::test_support::workspace();
    workspace.create_project("Backend").unwrap();
    let error = workspace.create_project("backend").unwrap_err();
    assert!(error.contains("already exists"));
    let snapshot = workspace.snapshot();
    assert_eq!(snapshot.projects.len(), 1);
    assert_eq!(snapshot.projects[0].sort_order, 0);
}

#[test]
fn move_thread_between_projects_updates_projection() {
    let mut workspace = crate::state::test_support::workspace();
    let current = std::env::current_dir().unwrap();
    workspace
        .create_thread("Thread", &current.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let created = workspace.create_project("Infrastructure").unwrap();
    let target_project_id = created
        .projects
        .iter()
        .find(|project| project.name == "Infrastructure")
        .unwrap()
        .id
        .clone();
    let snapshot = workspace
        .move_thread_to_project(&thread_id, &target_project_id)
        .unwrap();
    assert_eq!(
        snapshot.threads[0].project_id.as_deref(),
        Some(target_project_id.as_str())
    );
    assert!(
        workspace
            .move_thread_to_project(&thread_id, "project-missing")
            .is_err()
    );
}

#[test]
fn bind_and_unbind_workspace_track_thread_binding_ids() {
    let mut workspace = crate::state::test_support::workspace();
    let current = std::env::current_dir().unwrap();
    workspace
        .create_thread("Thread", &current.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let snapshot = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Local,
            None,
            &current.to_string_lossy(),
            "primary",
        )
        .unwrap();
    assert_eq!(snapshot.bindings.len(), 1);
    assert_eq!(snapshot.bindings[0].thread_id, thread_id);
    assert_eq!(snapshot.bindings[0].kind, "local");
    let binding_id = snapshot.bindings[0].id.clone();
    assert_eq!(
        snapshot.threads[0].workspace_binding_ids,
        vec![binding_id.clone()]
    );
    let snapshot = workspace.unbind_workspace(&binding_id).unwrap();
    assert!(snapshot.bindings.is_empty());
    assert!(snapshot.threads[0].workspace_binding_ids.is_empty());
}

#[test]
fn ssh_binding_requires_a_registered_endpoint() {
    let mut workspace = crate::state::test_support::workspace();
    let current = std::env::current_dir().unwrap();
    workspace
        .create_thread("Thread", &current.to_string_lossy())
        .unwrap();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let error = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Ssh,
            Some("endpoint-missing"),
            "/srv/project",
            "server",
        )
        .unwrap_err();
    assert!(error.contains("unknown Host"));

    let (endpoint_id, _snapshot) = workspace
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
    let snapshot = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Ssh,
            Some(&endpoint_id),
            "/srv/project",
            "server",
        )
        .unwrap();
    assert_eq!(snapshot.bindings[0].kind, "ssh");
    assert_eq!(
        snapshot.bindings[0].endpoint_id.as_deref(),
        Some(endpoint_id.as_str())
    );
    assert_eq!(snapshot.endpoints.len(), 1);
    assert_eq!(snapshot.endpoints[0].transport, "ssh");
}

#[test]
fn register_endpoint_rejects_local_transport() {
    let mut workspace = crate::state::test_support::workspace();
    let error = workspace
        .register_endpoint(
            "local-machine",
            WorkspaceKind::Local,
            None,
            None,
            None,
            None,
            None,
            None,
            Vec::new(),
        )
        .unwrap_err();
    assert!(error.contains("Local Workspace does not require"));
}

#[test]
fn workspace_binding_selection_is_ordered_and_thread_scoped() {
    let mut workspace = crate::state::test_support::workspace();
    let root = std::env::current_dir().unwrap();
    let snapshot = workspace
        .create_thread("Selection", root.to_str().unwrap())
        .unwrap();
    let thread_id = snapshot.threads[0].id.clone();
    let first = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Local,
            None,
            root.to_str().unwrap(),
            "primary",
        )
        .unwrap()
        .bindings[0]
        .id
        .clone();
    let snapshot = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Local,
            None,
            root.to_str().unwrap(),
            "attached",
        )
        .unwrap();
    let second = snapshot
        .bindings
        .iter()
        .find(|binding| binding.alias == "attached")
        .unwrap()
        .id
        .clone();
    let snapshot = workspace
        .set_thread_workspace_bindings(&thread_id, &[second.clone(), first.clone()])
        .unwrap();
    assert_eq!(
        snapshot.threads[0].workspace_binding_ids,
        vec![second, first]
    );
    let other = workspace
        .create_thread("Other", root.to_str().unwrap())
        .unwrap()
        .threads
        .last()
        .unwrap()
        .id
        .clone();
    let shared = snapshot.bindings[0].clone();
    let snapshot = workspace
        .set_thread_workspace_bindings(&other, std::slice::from_ref(&shared.id))
        .unwrap();
    let other_thread = snapshot
        .threads
        .iter()
        .find(|thread| thread.id == other)
        .unwrap();
    assert_eq!(other_thread.workspace_binding_ids.len(), 1);
    let cloned = snapshot
        .bindings
        .iter()
        .find(|binding| binding.id == other_thread.workspace_binding_ids[0])
        .unwrap();
    assert_eq!(cloned.thread_id, other);
    assert_eq!(cloned.root, shared.root);
    assert_eq!(cloned.alias, shared.alias);
}

#[test]
fn thread_host_selection_preserves_each_hosts_workspace_context() {
    let mut workspace = crate::state::test_support::workspace();
    let root = std::env::current_dir().unwrap();
    let snapshot = workspace
        .create_thread("Host context", root.to_str().unwrap())
        .unwrap();
    let thread_id = snapshot.threads[0].id.clone();
    let local_id = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Local,
            None,
            root.to_str().unwrap(),
            "local",
        )
        .unwrap()
        .bindings[0]
        .id
        .clone();
    let (host_id, _) = workspace
        .register_endpoint_inventory(
            "Cloud Host",
            WorkspaceKind::Tunnel,
            None,
            Some("{}".to_owned()),
            Some("cloud-host".to_owned()),
            None,
            Some("share".to_owned()),
            None,
            None,
            Vec::new(),
            vec![RemoteWorkspaceResource {
                id: "workspace-share".to_owned(),
                root: "/workspace".to_owned(),
                alias: "remote".to_owned(),
            }],
        )
        .unwrap();
    let snapshot = workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&host_id),
            Some("workspace-share"),
            "/workspace",
            "remote",
        )
        .unwrap();
    let remote_id = snapshot
        .bindings
        .iter()
        .find(|binding| binding.host_id == host_id)
        .unwrap()
        .id
        .clone();

    let snapshot = workspace.select_host(&thread_id, &host_id).unwrap();
    assert_eq!(snapshot.threads[0].host_id, host_id);
    workspace
        .set_thread_workspace_bindings(&thread_id, std::slice::from_ref(&remote_id))
        .unwrap();
    let snapshot = workspace.select_host(&thread_id, "local").unwrap();
    assert_eq!(snapshot.threads[0].host_id, "local");
    assert!(
        snapshot.threads[0]
            .workspace_binding_ids
            .contains(&local_id)
    );
    assert!(
        snapshot.threads[0]
            .workspace_binding_ids
            .contains(&remote_id)
    );
    assert_eq!(snapshot.hosts[0].display_name, "Local Host");
}

#[test]
fn remote_workspace_requires_an_absolute_host_root() {
    let mut workspace = crate::state::test_support::workspace();
    let root = std::env::current_dir().unwrap();
    let thread_id = workspace
        .create_thread("Remote root", root.to_str().unwrap())
        .unwrap()
        .threads[0]
        .id
        .clone();
    let (host_id, _) = workspace
        .register_endpoint(
            "Remote Host",
            WorkspaceKind::Tunnel,
            None,
            Some("{}".to_owned()),
            None,
            Some("share".to_owned()),
            None,
            None,
            Vec::new(),
        )
        .unwrap();
    let error = workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&host_id),
            ".",
            "remote",
        )
        .unwrap_err();
    assert!(error.contains("Remote Workspace root must be absolute"));
}

#[test]
#[allow(clippy::too_many_lines)]
fn remote_hosts_require_a_binding_and_keep_the_reported_agent_inventory() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
        .upsert_agent(
            "remote-codex-profile",
            "Remote Codex profile",
            "codex",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    let root = std::env::current_dir().unwrap();
    let thread_id = workspace
        .create_thread("Remote inventory", root.to_str().unwrap())
        .unwrap()
        .threads[0]
        .id
        .clone();
    let (endpoint_id, snapshot) = workspace
        .register_endpoint_inventory(
            "A very long Remote Host name",
            WorkspaceKind::Tunnel,
            None,
            Some("host-ticket".to_owned()),
            Some("remote-host".to_owned()),
            None,
            Some("host".to_owned()),
            None,
            None,
            vec!["codex".to_owned(), "sample".to_owned()],
            vec![RemoteWorkspaceResource {
                id: "workspace-share".to_owned(),
                root: root.to_str().unwrap().to_owned(),
                alias: "remote".to_owned(),
            }],
        )
        .unwrap();
    assert_eq!(snapshot.hosts.len(), 1, "unbound endpoints are not Hosts");

    let binding_id = workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&endpoint_id),
            Some("workspace-share"),
            root.to_str().unwrap(),
            "remote",
        )
        .unwrap()
        .bindings
        .into_iter()
        .find(|binding| binding.host_id == endpoint_id)
        .unwrap()
        .id;
    let remote = workspace
        .snapshot()
        .hosts
        .into_iter()
        .find(|host| host.id == endpoint_id)
        .unwrap();
    assert!(remote.agent_ids.iter().any(|id| id == "codex"));
    assert!(remote.agent_ids.iter().any(|id| id == "sample"));
    assert!(
        workspace
            .snapshot()
            .agents
            .iter()
            .any(|agent| agent.id == "sample" && agent.available)
    );
    assert!(
        remote
            .agent_ids
            .iter()
            .any(|id| id == "remote-codex-profile")
    );
    workspace.select_host(&thread_id, &endpoint_id).unwrap();
    workspace.select_agent(&thread_id, "sample").unwrap();
    assert_eq!(
        workspace
            .resolve_agent_for_thread(&thread_id, "sample")
            .unwrap()
            .driver,
        "sample"
    );
    workspace
        .select_agent(&thread_id, "remote-codex-profile")
        .unwrap();
    assert!(workspace.select_agent(&thread_id, "ovule").is_err());

    let snapshot = workspace.unbind_workspace(&binding_id).unwrap();
    assert_eq!(
        snapshot.hosts.len(),
        1,
        "unbound Host is removed from picker"
    );
    assert_eq!(snapshot.endpoints[0].workspaces[0].id, "workspace-share");
    let rebound = workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&endpoint_id),
            Some("workspace-share"),
            root.to_str().unwrap(),
            "remote",
        )
        .unwrap();
    assert_eq!(
        rebound.bindings[0].resource_id.as_deref(),
        Some("workspace-share")
    );
    let error = workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&endpoint_id),
            Some("wrong-share"),
            root.to_str().unwrap(),
            "remote",
        )
        .unwrap_err();
    assert!(error.contains("unknown Host Workspace resource"));
    let (_, refreshed) = workspace
        .register_endpoint_inventory(
            "A very long Remote Host name",
            WorkspaceKind::Tunnel,
            None,
            Some("new-route".to_owned()),
            Some("remote-host".to_owned()),
            None,
            Some("host".to_owned()),
            None,
            None,
            vec!["codex".to_owned()],
            Vec::new(),
        )
        .unwrap();
    assert!(refreshed.bindings.is_empty());
    assert!(refreshed.threads[0].workspace_binding_ids.is_empty());
    assert_eq!(refreshed.threads[0].agent, "remote-codex-profile");
    assert_eq!(refreshed.endpoints[0].host.as_deref(), Some("new-route"));
}

#[test]
#[allow(clippy::too_many_lines)]
fn workflow_node_thread_runs_with_its_remote_host_agent_and_workspace() {
    let mut workspace = crate::state::test_support::workspace();
    workspace
        .settings
        .catalog
        .upsert_agent(
            "remote-codex",
            "Remote Codex",
            "codex",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    let root = std::env::current_dir().unwrap();
    let parent_thread_id = workspace
        .create_thread("Conversation Thread", root.to_str().unwrap())
        .unwrap()
        .threads[0]
        .id
        .clone();
    let (host_id, _) = workspace
        .register_endpoint_inventory(
            "Remote Builder",
            WorkspaceKind::Tunnel,
            None,
            Some("route".to_owned()),
            Some("remote-builder-key".to_owned()),
            None,
            Some("pair-token".to_owned()),
            None,
            None,
            vec!["codex".to_owned()],
            vec![RemoteWorkspaceResource {
                id: "remote-workspace".to_owned(),
                root: "/work/remote".to_owned(),
                alias: "remote".to_owned(),
            }],
        )
        .unwrap();
    let planning_context = workspace.workflow_host_context();
    assert!(planning_context.contains(&host_id));
    assert!(planning_context.contains("remote-codex"));
    assert!(planning_context.contains("remote-workspace"));
    let goal_id = workspace
        .create_goal(
            &parent_thread_id,
            "Remote workflow",
            "Run one task on the remote Host",
        )
        .unwrap()
        .goals[0]
        .id
        .clone();
    let node_id = workspace
        .append_workflow_node(
            &goal_id,
            "Build remotely".to_owned(),
            NodeKind::Task {
                agent: "remote-codex".to_owned(),
            },
            super::workflow::WorkflowNodeOptions {
                requested_host_id: Some(&host_id),
                requested_workspace_ids: &["remote-workspace".to_owned()],
                dependency_ids: &[],
                created_at_ms: now_millis(),
            },
        )
        .unwrap();
    assert!(
        workspace
            .workflow
            .nodes
            .iter()
            .find(|node| node.id == node_id)
            .unwrap()
            .thread_id
            .is_empty()
    );
    let attempt = workspace.prepare_attempt(&node_id).unwrap();
    let node = workspace
        .workflow
        .nodes
        .iter()
        .find(|node| node.id == node_id)
        .unwrap()
        .clone();
    let node_thread = workspace
        .conversation
        .threads
        .iter()
        .find(|thread| thread.id == node.thread_id)
        .unwrap();
    assert_eq!(node_thread.host_id, host_id);
    assert_eq!(node_thread.agent, "remote-codex");
    let binding = workspace
        .inventory
        .bindings
        .iter()
        .find(|binding| binding.thread_id == node.thread_id)
        .unwrap();
    assert_eq!(binding.resource_id.as_deref(), Some("remote-workspace"));
    let binding_id = binding.id.clone();
    assert_eq!(attempt.thread_id, node.thread_id);
    assert_eq!(attempt.host_id, host_id);
    assert_eq!(attempt.driver, "codex");
    assert_eq!(
        attempt.workspace_binding_id.as_deref(),
        Some(binding_id.as_str())
    );
    assert_eq!(attempt.workspaces.len(), 1);
    workspace.dispatch_attempt(&attempt.id).unwrap();
    workspace.start_attempt(&attempt.id).unwrap();
    workspace
        .append_attempt_output(&attempt.id, 0, "Remote build complete")
        .unwrap();
    let snapshot = workspace
        .finish_attempt(&attempt.id, "succeeded", "Remote build complete".to_owned())
        .unwrap();
    let node_messages = snapshot
        .messages
        .iter()
        .filter(|message| message.thread_id == node.thread_id)
        .collect::<Vec<_>>();
    assert_eq!(node_messages.len(), 2);
    assert_eq!(node_messages[1].content, "Remote build complete");
}

#[test]
fn remote_host_unbind_remove_and_link_reset_clean_thread_references() {
    let mut workspace = crate::state::test_support::workspace();
    let root = std::env::current_dir().unwrap();
    let thread_id = workspace
        .create_thread("Remote lifecycle", root.to_str().unwrap())
        .unwrap()
        .threads[0]
        .id
        .clone();
    let (endpoint_id, _) = workspace
        .register_endpoint_inventory(
            "Remote lifecycle Host",
            WorkspaceKind::Tunnel,
            None,
            Some("route".to_owned()),
            Some("host-public-key".to_owned()),
            None,
            Some("pair-token".to_owned()),
            None,
            None,
            vec!["codex".to_owned()],
            vec![RemoteWorkspaceResource {
                id: "resource-1".to_owned(),
                root: "/workspace".to_owned(),
                alias: "workspace".to_owned(),
            }],
        )
        .unwrap();
    workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&endpoint_id),
            Some("resource-1"),
            "/workspace",
            "workspace",
        )
        .unwrap();
    workspace.select_host(&thread_id, &endpoint_id).unwrap();
    let unbound = workspace
        .unbind_remote_host(&thread_id, &endpoint_id)
        .unwrap();
    assert!(unbound.bindings.is_empty());
    assert_eq!(unbound.threads[0].host_id, "local");
    assert_eq!(unbound.endpoints.len(), 1);

    workspace
        .bind_workspace_resource(
            &thread_id,
            WorkspaceKind::Tunnel,
            Some(&endpoint_id),
            Some("resource-1"),
            "/workspace",
            "workspace",
        )
        .unwrap();
    let removed = workspace.remove_remote_host(&endpoint_id).unwrap();
    assert!(removed.endpoints.is_empty());
    assert!(removed.bindings.is_empty());

    let (endpoint_id, _) = workspace
        .register_endpoint_inventory(
            "Reset Host",
            WorkspaceKind::Tunnel,
            None,
            Some("route-2".to_owned()),
            Some("host-public-key-2".to_owned()),
            None,
            Some("pair-token".to_owned()),
            None,
            None,
            Vec::new(),
            Vec::new(),
        )
        .unwrap();
    assert!(!endpoint_id.is_empty());
    workspace
        .register_endpoint(
            "SSH Host",
            WorkspaceKind::Ssh,
            Some("credential".to_owned()),
            Some("example.invalid".to_owned()),
            Some(22),
            Some("developer".to_owned()),
            Some("password".to_owned()),
            Some("SHA256:test".to_owned()),
            Vec::new(),
        )
        .unwrap();
    let reset = workspace.reset_link_hosts();
    assert_eq!(reset.endpoints.len(), 1);
    assert_eq!(reset.endpoints[0].transport, "ssh");
}

#[test]
fn selected_remote_host_defers_agent_executable_health_to_that_host() {
    let mut workspace = fixture();
    workspace
        .settings
        .catalog
        .upsert_tool(
            "host-only-mcp",
            "Host-only MCP",
            "stdio",
            "definitely-not-installed-on-the-client",
            Vec::new(),
            true,
            true,
            None,
        )
        .unwrap();
    workspace
        .settings
        .catalog
        .upsert_agent(
            "remote-test",
            "Remote test",
            "test",
            None,
            Vec::new(),
            vec!["host-only-mcp".to_owned()],
            "",
            true,
        )
        .unwrap();

    let root = std::env::current_dir().unwrap();
    let thread_id = workspace
        .create_thread("Remote health", root.to_str().unwrap())
        .unwrap()
        .threads
        .last()
        .unwrap()
        .id
        .clone();
    assert!(workspace.select_agent(&thread_id, "remote-test").is_err());

    let (endpoint_id, _) = workspace
        .register_endpoint(
            "Remote host",
            WorkspaceKind::Ssh,
            None,
            Some("example.invalid".to_owned()),
            Some(22),
            Some("user".to_owned()),
            Some("key".to_owned()),
            Some("SHA256:test".to_owned()),
            vec!["test".to_owned()],
        )
        .unwrap();
    workspace
        .bind_workspace(
            &thread_id,
            WorkspaceKind::Ssh,
            Some(&endpoint_id),
            "/workspace",
            "remote",
        )
        .unwrap();
    workspace.select_host(&thread_id, &endpoint_id).unwrap();

    workspace.select_agent(&thread_id, "remote-test").unwrap();
    let attempt = workspace
        .prepare_message_attempt(&thread_id, "Inspect the remote workspace")
        .unwrap();
    assert_eq!(attempt.driver, "test");
    assert_eq!(attempt.host_id, endpoint_id);
    assert_eq!(
        attempt.tools[0].target,
        "definitely-not-installed-on-the-client"
    );
}

#[test]
fn rename_project_preserves_id_and_rejects_duplicates() {
    let mut workspace = crate::state::test_support::workspace();
    let backend = workspace.create_project("Backend").unwrap();
    let backend_id = backend.projects[0].id.clone();
    workspace.create_project("Frontend").unwrap();
    workspace.rename_project(&backend_id, "Services").unwrap();
    assert_eq!(
        workspace
            .snapshot()
            .projects
            .iter()
            .find(|project| project.id == backend_id)
            .unwrap()
            .name,
        "Services"
    );
    assert!(workspace.rename_project(&backend_id, "frontend").is_err());
}

#[test]
fn pending_nodes_preserve_execution_context_without_creating_threads() {
    let workspace = fixture();
    let conversation_count = workspace.conversation.threads.len();
    assert!(
        !workspace
            .snapshot()
            .legacy_data_issues
            .iter()
            .any(|issue| issue.id == "workflow-missing-execution-context")
    );
    assert!(
        workspace
            .workflow
            .nodes
            .iter()
            .all(|node| node.thread_id.is_empty())
    );
    assert_eq!(conversation_count, 1);
    let task_id = workspace
        .first_pending_task(&workspace.conversation.threads[0].id)
        .unwrap();
    let encoded = serde_json::to_string(&workspace).unwrap();
    let mut restored: Workspace = serde_json::from_str(&encoded).unwrap();
    crate::state::test_support::attach(&mut restored);
    restored.prepare_attempt(&task_id).unwrap();
    assert_eq!(restored.conversation.threads.len(), conversation_count + 1);
    assert!(
        restored
            .workflow
            .nodes
            .iter()
            .filter(|node| node.id != task_id)
            .all(|node| node.thread_id.is_empty())
    );
}

#[test]
fn derived_workflows_accept_more_than_six_nodes_without_truncation() {
    let nodes = (0..8).map(|index| serde_json::json!({"id":format!("n{index}"),"kind":"task","title":format!("Step {index}")})).collect::<Vec<_>>();
    let response = serde_json::json!({"title":"Setup","intent":"Verify the channel","response":"Plan ready","nodes":nodes}).to_string();
    assert_eq!(
        parse_goal_derivation(&response, true).unwrap().nodes.len(),
        8
    );
}

#[test]
fn legacy_workflow_detection_requires_missing_task_context_not_missing_thread() {
    let mut workspace = fixture();
    let task = workspace
        .workflow
        .nodes
        .iter_mut()
        .find(|node| matches!(node.kind, NodeKind::Task { .. }))
        .unwrap();
    task.execution = None;
    let task_id = task.id.clone();
    let snapshot = workspace.snapshot();
    let issue = snapshot
        .legacy_data_issues
        .iter()
        .find(|issue| issue.id == "workflow-missing-execution-context")
        .unwrap();
    assert_eq!(issue.affected_ids, vec![task_id]);
    workspace.reset_workflows();
    assert!(
        !workspace
            .snapshot()
            .legacy_data_issues
            .iter()
            .any(|issue| issue.id == "workflow-missing-execution-context")
    );
}

#[test]
fn composed_state_preserves_flat_checkpoint_format() {
    let workspace = fixture();
    let checkpoint = serde_json::to_value(&workspace).unwrap();
    for key in [
        "catalog",
        "default_agent_id",
        "default_model_id",
        "projects",
        "endpoints",
        "bindings",
        "threads",
        "messages",
        "goals",
        "nodes",
        "attempts",
        "terminal_runs",
    ] {
        assert!(
            checkpoint.get(key).is_some(),
            "missing checkpoint key {key}"
        );
    }
    for key in ["conversation", "workflow", "terminal", "hosts", "workspace"] {
        assert!(
            checkpoint.get(key).is_none(),
            "changed checkpoint shape with {key}"
        );
    }
    let restored: Workspace = serde_json::from_value(checkpoint.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(), checkpoint);
}

#[test]
fn setup_card_does_not_create_an_agent_attempt_or_expose_credentials() {
    let mut workspace = fixture();
    let directory = tempfile::tempdir().unwrap();
    let snapshot = workspace
        .create_thread("Connection setup", &directory.path().to_string_lossy())
        .unwrap();
    let thread_id = snapshot.threads.last().unwrap().id.clone();
    let attempts = workspace.conversation.attempts.len();
    workspace
        .show_extension_setup(&thread_id, "/cloudflare", "cloudflare-connectivity")
        .unwrap();
    assert_eq!(workspace.conversation.attempts.len(), attempts);
    let message = workspace.conversation.messages.last().unwrap();
    assert_eq!(message.status, "complete");
    assert_eq!(message.parts[0].kind, "cloudflare-connectivity");
    assert_eq!(message.parts[0].data_json.as_deref(), Some("{}"));
}

#[test]
fn harness_diagnostics_are_bounded_and_late_events_are_ignored() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread, "trace harness")
        .unwrap();
    workspace
        .record_attempt_diagnostic(
            &spec.id,
            "harness/assembled",
            r#"{"schema_version":1,"harness_version":"test"}"#,
        )
        .unwrap();
    for index in 0..300 {
        workspace
            .record_attempt_diagnostic(
                &spec.id,
                ["harness/tool", "harness/execution", "harness/approval"][index % 3],
                &format!(r#"{{"schema_version":1,"call_id":{index}}}"#),
            )
            .unwrap();
    }
    let snapshot = workspace.snapshot();
    let attempt = snapshot
        .attempts
        .iter()
        .find(|attempt| attempt.id == spec.id)
        .unwrap();
    assert_eq!(
        attempt
            .events
            .iter()
            .filter(|event| event.kind.starts_with("harness/"))
            .count(),
        256
    );
    assert!(
        attempt
            .events
            .iter()
            .any(|event| event.kind == "harness/assembled")
    );
    assert!(
        workspace
            .record_attempt_diagnostic(&spec.id, "harness/tool", "invalid")
            .is_err()
    );
    workspace.request_cancel(&spec.id).unwrap();
    let before = workspace.snapshot().revision;
    workspace
        .record_attempt_diagnostic(&spec.id, "harness/tool", r#"{"schema_version":1}"#)
        .unwrap();
    assert_eq!(workspace.snapshot().revision, before);
}

#[test]
fn fork_snapshots_history_and_prompt_restart_rewinds_the_current_thread() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let first = workspace
        .prepare_message_attempt(&thread, "original prompt")
        .unwrap();
    workspace.dispatch_attempt(&first.id).unwrap();
    workspace.start_attempt(&first.id).unwrap();
    workspace
        .finish_attempt(&first.id, "succeeded", "original answer".into())
        .unwrap();
    let later = workspace
        .prepare_message_attempt(&thread, "later prompt")
        .unwrap();
    let source = workspace.conversation.messages.clone();
    let branch = workspace
        .fork_message(
            &thread,
            workspace.conversation.attempts[0]
                .response_message_id
                .clone()
                .unwrap()
                .as_str(),
        )
        .unwrap();
    let copied = workspace
        .conversation
        .messages
        .iter()
        .filter(|m| m.thread_id == branch)
        .collect::<Vec<_>>();
    assert_eq!(copied.len(), 2);
    assert!(
        copied
            .iter()
            .all(|m| m.attempt_id.is_none() && !source.iter().any(|old| old.id == m.id))
    );
    assert!(
        !workspace
            .conversation
            .attempts
            .iter()
            .any(|attempt| attempt.thread_id == branch)
    );
    let edited = workspace
        .restart_message(
            &thread,
            first.source_message_id.as_deref().unwrap(),
            "edited prompt",
            vec![],
        )
        .unwrap();
    assert!(edited.prompt.contains("edited prompt"));
    assert!(!edited.prompt.contains("original answer"));
    assert!(!edited.prompt.contains("later prompt"));
    assert_eq!(edited.thread_id, thread);
    assert_eq!(edited.source_message_id, first.source_message_id);
    let replacement = workspace
        .conversation
        .messages
        .iter()
        .filter(|message| message.thread_id == thread)
        .collect::<Vec<_>>();
    assert_eq!(
        replacement.len(),
        2,
        "old replies and later turns are removed"
    );
    assert_eq!(replacement[0].content, "edited prompt");
    assert_eq!(
        workspace.conversation.threads.len(),
        2,
        "restart does not create another fork"
    );
    let revision_before_late_output = workspace.revision();
    workspace
        .append_attempt_output(&later.id, 0, "late source output")
        .unwrap();
    workspace
        .upsert_attempt_message_block(&later.id, "late-tool", "tool", "{}".into())
        .unwrap();
    assert_eq!(workspace.revision(), revision_before_late_output);
    assert!(!workspace.conversation.messages.iter().any(
        |message| message.thread_id == thread && message.content.contains("late source output")
    ));
    let revision = workspace.revision();
    assert!(
        workspace
            .fork_message(&branch, first.source_message_id.as_deref().unwrap())
            .is_err()
    );
    assert_eq!(
        workspace.revision(),
        revision,
        "cross-thread message IDs never create branches"
    );
}

#[test]
fn edited_prompt_keeps_attachments_and_rejects_assistant_targets_without_mutation() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let image = LocalImageAttachment {
        id: format!("{}.png", "a".repeat(64)),
        name: "fixture.png".into(),
        media_type: "image/png".into(),
        size_bytes: 128,
        path: "/tmp/fixture.png".into(),
    };
    let first = workspace
        .prepare_message_attempt_with_attachments(&thread, "image prompt", vec![image.clone()])
        .unwrap();
    let edited = workspace
        .restart_message(
            &thread,
            first.source_message_id.as_deref().unwrap(),
            "inspect image",
            vec![image.clone()],
        )
        .unwrap();
    assert_eq!(edited.local_images, vec![image]);
    let reply = workspace
        .conversation
        .attempts
        .iter()
        .find(|attempt| attempt.id == edited.id)
        .unwrap()
        .response_message_id
        .clone()
        .unwrap();
    let revision = workspace.revision();
    assert!(
        workspace
            .restart_message(&edited.thread_id, &reply, "cannot edit assistant", vec![])
            .is_err()
    );
    assert_eq!(workspace.revision(), revision);
}

#[test]
fn forks_keep_completed_trace_snapshots_but_not_live_tools() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread, "inspect traces")
        .unwrap();
    let response = workspace
        .conversation
        .messages
        .iter_mut()
        .find(|message| message.role == "assistant")
        .unwrap();
    for state in ["completed", "running"] {
        response.parts.push(MessagePart {
            id: format!("trace-{state}"), kind: "tool".into(), text: None, url: None,
            name: None, media_type: None, size_bytes: None,
            data_json: Some(serde_json::json!({"name":"fixture.tool","state":state,"output":"immutable evidence"}).to_string()),
        });
    }
    let reply = workspace
        .conversation
        .attempts
        .iter()
        .find(|attempt| attempt.id == spec.id)
        .unwrap()
        .response_message_id
        .clone()
        .unwrap();
    let branch = workspace.fork_message(&thread, &reply).unwrap();
    let copied = workspace
        .conversation
        .messages
        .iter()
        .filter(|message| message.thread_id == branch)
        .collect::<Vec<_>>();
    let traces = copied
        .iter()
        .flat_map(|message| &message.parts)
        .filter(|part| part.kind == "tool")
        .collect::<Vec<_>>();
    assert_eq!(
        traces.len(),
        1,
        "completed evidence survives without copying active tools"
    );
    assert!(
        traces[0]
            .data_json
            .as_deref()
            .unwrap()
            .contains("completed")
    );
}

#[test]
fn stopping_preserves_streamed_reply_and_adds_a_small_status_notice() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread, "run diagnostic")
        .unwrap();
    workspace.dispatch_attempt(&spec.id).unwrap();
    workspace.start_attempt(&spec.id).unwrap();
    workspace
        .append_attempt_output(&spec.id, 0, "Already checked the bundle.")
        .unwrap();
    workspace
        .finish_attempt(&spec.id, "cancelled", "Generation stopped".into())
        .unwrap();
    let response = workspace
        .snapshot()
        .messages
        .into_iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(response.status, "cancelled");
    assert_eq!(response.content, "Already checked the bundle.");
    assert_eq!(
        response
            .parts
            .iter()
            .find(|part| part.kind == "markdown")
            .unwrap()
            .text
            .as_deref(),
        Some("Already checked the bundle.")
    );
    assert_eq!(
        response
            .parts
            .iter()
            .filter(|part| part.kind == "notice")
            .count(),
        1
    );
}

#[test]
fn cancelling_before_output_uses_a_stage_neutral_notice_without_a_large_error_reply() {
    let mut workspace = fixture();
    let thread = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread, "inspect")
        .unwrap();
    workspace
        .finish_attempt(
            &spec.id,
            "cancelled",
            "Cancelled before Worker dispatch".into(),
        )
        .unwrap();
    let response = workspace
        .snapshot()
        .messages
        .into_iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(response.status, "cancelled");
    assert_eq!(response.content, "Generation stopped");
    assert_eq!(
        response
            .parts
            .iter()
            .find(|part| part.kind == "notice")
            .unwrap()
            .text
            .as_deref(),
        Some("Generation stopped")
    );
}

#[test]
fn assistant_image_reference_survives_completion_and_has_attachment_metadata() {
    let mut workspace = fixture();
    let thread_id = workspace.conversation.threads[0].id.clone();
    let spec = workspace
        .prepare_message_attempt(&thread_id, "Screenshot")
        .unwrap();
    let url = format!("ovule-attachment:///{}.png", "a".repeat(64));
    let block = serde_json::json!({"url":url,"mediaType":"image/png","sizeBytes":1234,"name":"Screenshot.png"}).to_string();
    workspace
        .upsert_attempt_message_block(&spec.id, "screenshot", "image", block)
        .unwrap();
    workspace
        .finish_attempt(&spec.id, "succeeded", "Done".into())
        .unwrap();
    let snapshot = workspace.snapshot();
    let part = snapshot
        .messages
        .iter()
        .flat_map(|message| &message.parts)
        .find(|part| part.kind == "image")
        .unwrap();
    assert_eq!(part.url.as_deref(), Some(url.as_str()));
    assert_eq!(part.media_type.as_deref(), Some("image/png"));
    assert_eq!(part.name.as_deref(), Some("Screenshot.png"));
    assert_eq!(part.size_bytes, Some(1234));
}
