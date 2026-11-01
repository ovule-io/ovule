use super::*;

#[test]
fn imports_standard_skill_frontmatter() {
    let directory = tempfile::tempdir().unwrap();
    let skill_directory = directory.path().join("release-check");
    std::fs::create_dir(&skill_directory).unwrap();
    let path = skill_directory.join("SKILL.md");
    std::fs::write(
        &path,
        "---\nname: release-check\ndescription: Verify a release.\n---\nRun checks.\n",
    )
    .unwrap();
    let mut catalog = crate::catalog::test_support::catalog();
    catalog.import_skill(&path.to_string_lossy(), true).unwrap();
    assert_eq!(catalog.skills[0].id, "release-check");
    assert!(catalog.skills[0].extension_id.is_none());
}

#[test]
fn removes_legacy_channel_skills_when_the_extension_is_not_installed() {
    let mut catalog = crate::catalog::test_support::catalog();
    let extension = std::env::current_dir()
        .unwrap()
        .join("plugins/channel-sample/skills");
    for id in ["channel-channel", "channel-cli"] {
        catalog.skills.push(SkillRecord {
            id: id.to_owned(),
            name: id.to_owned(),
            description: "legacy Extension Skill".to_owned(),
            path: extension
                .join(id)
                .join("SKILL.md")
                .to_string_lossy()
                .into_owned(),
            enabled: true,
            extension_id: Some("io.ovule.channel.sample".to_owned()),
        });
        catalog.agents[0].skill_ids.push(id.to_owned());
    }

    assert!(catalog.reconcile_extensions().unwrap());
    assert!(
        !catalog
            .skills
            .iter()
            .any(|skill| matches!(skill.id.as_str(), "channel-channel" | "channel-cli"))
    );
    assert!(catalog.agents[0].skill_ids.is_empty());
}

#[test]
fn validates_tool_transport_and_secret_reference() {
    let mut catalog = crate::catalog::test_support::catalog();
    assert!(
        catalog
            .upsert_tool(
                "docs",
                "Docs",
                "http",
                "https://example.com/mcp",
                Vec::new(),
                true,
                false,
                Some("DOCS_TOKEN".to_owned()),
            )
            .is_ok()
    );
    assert!(
        catalog
            .upsert_tool(
                "bad",
                "Bad",
                "http",
                "file:///secret",
                Vec::new(),
                true,
                false,
                None,
            )
            .is_err()
    );
}

#[test]
fn refuses_to_remove_referenced_entries() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog
        .upsert_model(
            "fast",
            "Fast",
            "openai",
            "gpt-fast",
            true,
            vec!["codex".to_owned()],
        )
        .unwrap();
    catalog
        .upsert_agent(
            "reviewer",
            "Reviewer",
            "codex",
            Some("fast".to_owned()),
            Vec::new(),
            Vec::new(),
            "Review changes",
            true,
        )
        .unwrap();
    assert!(catalog.remove_model("fast").is_err());
}

#[test]
fn disabled_agents_remain_discoverable_but_cannot_run() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog
        .upsert_agent(
            "test-disabled",
            "Disabled test Agent",
            "test",
            None,
            Vec::new(),
            Vec::new(),
            "",
            false,
        )
        .unwrap();

    let view = catalog
        .agent_views()
        .into_iter()
        .find(|agent| agent.id == "test-disabled")
        .unwrap();
    assert!(!view.enabled);
    assert!(view.available);
    assert!(catalog.resolve_agent("test-disabled").is_err());
}

#[test]
fn manual_onboarding_cleanup_removes_custom_profiles_with_missing_drivers() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog.agents.push(AgentProfile {
        id: "stale".to_owned(),
        label: "Stale".to_owned(),
        driver: "missing-driver".to_owned(),
        model_id: None,
        skill_ids: Vec::new(),
        tool_ids: Vec::new(),
        instructions: String::new(),
        enabled: true,
        extension_id: None,
    });
    let removed = catalog.clean_unavailable_extension_drivers().unwrap();
    assert!(removed.contains("stale"));
    assert!(!catalog.agents.iter().any(|agent| agent.id == "stale"));
}

#[test]
fn user_models_bind_to_multiple_available_agents() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog
        .upsert_model(
            "shared-model",
            "Shared model",
            "openai-compatible",
            "provider/model-v1",
            true,
            vec!["codex".to_owned(), "ovule".to_owned()],
        )
        .unwrap();
    let model = catalog
        .model_views()
        .into_iter()
        .find(|model| model.id == "shared-model")
        .unwrap();
    assert_eq!(model.agent_ids, ["codex", "ovule"]);
    assert!(model.extension_id.is_none());
    assert!(
        catalog
            .upsert_model(
                "invalid-model",
                "Invalid model",
                "custom",
                "custom-v1",
                true,
                vec!["missing-driver".to_owned()],
            )
            .is_err()
    );
}

#[test]
fn extension_models_keep_owned_metadata_but_can_be_disabled() {
    let mut catalog = crate::catalog::test_support::catalog();
    let model = catalog
        .models
        .iter()
        .find(|model| model.id == "deepseek-flash")
        .cloned()
        .unwrap();
    assert_eq!(
        model.extension_id.as_deref(),
        Some("io.ovule.provider.deepseek")
    );
    catalog
        .upsert_model(
            &model.id,
            &model.label,
            &model.provider,
            &model.remote_id,
            false,
            model.agent_ids.clone(),
        )
        .unwrap();
    assert!(catalog.enabled_model(&model.id).is_err());
    assert!(catalog.remove_model(&model.id).is_err());
    assert!(
        catalog
            .upsert_model(
                &model.id,
                "Renamed by user",
                &model.provider,
                &model.remote_id,
                true,
                model.agent_ids,
            )
            .is_err()
    );
}

#[test]
fn reconciles_legacy_deepseek_agent_models_into_the_provider() {
    let mut catalog = crate::catalog::test_support::catalog();
    for model in &mut catalog.models {
        if model.provider == "deepseek" {
            model.extension_id = Some("io.ovule.agent.deepseek".to_owned());
            model.agent_ids = vec!["deepseek".to_owned()];
        }
    }
    catalog.agents.push(AgentProfile {
        id: "deepseek".to_owned(),
        label: "DeepSeek".to_owned(),
        driver: "deepseek".to_owned(),
        model_id: None,
        skill_ids: Vec::new(),
        tool_ids: Vec::new(),
        instructions: String::new(),
        enabled: false,
        extension_id: Some("io.ovule.agent.deepseek".to_owned()),
    });

    assert!(catalog.reconcile_extensions().unwrap());
    assert!(!catalog.agents.iter().any(|agent| agent.id == "deepseek"));
    for model in catalog
        .models
        .iter()
        .filter(|model| model.provider == "deepseek")
    {
        assert_eq!(
            model.extension_id.as_deref(),
            Some("io.ovule.provider.deepseek")
        );
        assert_eq!(model.agent_ids, ["ovule"]);
    }
}

#[test]
fn reconciles_retired_deepseek_aliases_to_current_bootstrap_models() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog.models.push(ModelRecord {
        id: "deepseek-chat".to_owned(),
        label: "DeepSeek Chat".to_owned(),
        provider: "deepseek".to_owned(),
        remote_id: "deepseek-chat".to_owned(),
        enabled: true,
        agent_ids: vec!["ovule".to_owned()],
        extension_id: Some("io.ovule.provider.deepseek".to_owned()),
        recommended: true,
        description: String::new(),
    });
    catalog
        .agents
        .iter_mut()
        .find(|agent| agent.id == "ovule")
        .unwrap()
        .model_id = Some("deepseek-chat".to_owned());

    assert!(catalog.reconcile_extensions().unwrap());
    assert!(
        !catalog
            .models
            .iter()
            .any(|model| model.id == "deepseek-chat")
    );
    assert_eq!(
        catalog
            .agents
            .iter()
            .find(|agent| agent.id == "ovule")
            .unwrap()
            .model_id
            .as_deref(),
        Some("deepseek-flash")
    );
}

#[test]
fn computer_use_is_a_host_owned_optional_tool() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog
        .upsert_agent(
            "custom-codex",
            "Custom Codex",
            "codex",
            None,
            Vec::new(),
            Vec::new(),
            "",
            true,
        )
        .unwrap();
    assert!(catalog.reconcile_extensions().unwrap());
    let tool = catalog
        .tools
        .iter()
        .find(|tool| tool.id == "computer-use")
        .unwrap();
    assert_eq!(tool.extension_id.as_deref(), Some("io.ovule.host"));
    assert_eq!(tool.toolchain_id, None);
    assert_eq!(tool.transport, "native-crd");
    assert_eq!(tool.target, "tuffite.remoting");
    assert!(tool.args.is_empty());
    assert_eq!(
        tool.capabilities,
        ["desktop.snapshot", "desktop.input", "clipboard.write"]
    );
    assert!(!tool.required);
    let tool_id = tool.id.clone();
    let tool_view = catalog
        .tool_views()
        .into_iter()
        .find(|tool| tool.id == tool_id)
        .unwrap();
    assert!(tool_view.available);
    assert_eq!(tool_view.detail, "Native CRD Computer Use");
    assert!(!catalog.agents.iter().any(|agent| agent.id == "claude"));
    assert!(
        catalog
            .agents
            .iter()
            .find(|agent| agent.id == "ovule")
            .unwrap()
            .tool_ids
            .contains(&tool_id)
    );
    catalog
        .upsert_agent(
            "native-crd-test",
            "Native CRD test",
            "test",
            None,
            Vec::new(),
            vec![tool_id.clone()],
            "",
            true,
        )
        .unwrap();
    assert!(
        catalog
            .resolve_agent("native-crd-test")
            .unwrap()
            .tools
            .iter()
            .any(|tool| tool.id == tool_id)
    );
    assert!(
        catalog
            .agents
            .iter()
            .find(|agent| agent.id == "codex")
            .unwrap()
            .tool_ids
            .contains(&tool_id)
    );
    assert!(
        catalog
            .agents
            .iter()
            .find(|agent| agent.id == "custom-codex")
            .unwrap()
            .tool_ids
            .contains(&tool_id),
        "built-in capabilities follow the Agent driver, not only the profile ID"
    );
    assert!(catalog.remove_tool(&tool_id).is_err());
}

#[test]
fn migrates_builtin_crd_ownership_to_host_without_enabling_a_disabled_tool() {
    for owner in ["io.ovule.computer-use.crd", "io.ovule.essentials"] {
        let mut catalog = crate::catalog::test_support::catalog();
        catalog.reconcile_extensions().unwrap();
        let tool = catalog
            .tools
            .iter_mut()
            .find(|tool| tool.id == "computer-use")
            .unwrap();
        tool.extension_id = Some(owner.to_owned());
        tool.enabled = false;
        assert!(catalog.reconcile_extensions().unwrap());
        let tools: Vec<_> = catalog
            .tools
            .iter()
            .filter(|tool| tool.id == "computer-use")
            .collect();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].extension_id.as_deref(), Some("io.ovule.host"));
        assert!(!tools[0].enabled);
        catalog
            .tools
            .iter_mut()
            .find(|tool| tool.id == "computer-use")
            .unwrap()
            .extension_id = Some("third.party".to_owned());
        assert!(catalog.reconcile_extensions().is_err());
    }
}

#[test]
fn quarantines_retired_trycua_until_explicit_cleanup() {
    let mut catalog = crate::catalog::test_support::catalog();
    catalog.tools.push(ToolRecord {
        id: "computer-use".to_owned(),
        label: "Computer Use".to_owned(),
        transport: "stdio".to_owned(),
        target: "cua-driver".to_owned(),
        args: vec!["mcp".to_owned()],
        enabled: false,
        required: false,
        credential_env: None,
        extension_id: Some("io.ovule.computer-use.trycua".to_owned()),
        toolchain_id: Some("cua-driver".to_owned()),
        capabilities: vec!["session.isolation".to_owned()],
    });

    catalog.reconcile_extensions().unwrap();
    let tool = catalog
        .tools
        .iter()
        .find(|tool| tool.id == "computer-use")
        .unwrap();
    assert_eq!(
        tool.extension_id.as_deref(),
        Some("io.ovule.computer-use.trycua")
    );
    assert_eq!(tool.transport, "stdio");
    assert_eq!(tool.target, "cua-driver");
    assert!(!tool.enabled);

    assert!(catalog.clean_legacy_data());
    assert!(catalog.reconcile_extensions().unwrap());
    let tool = catalog
        .tools
        .iter()
        .find(|tool| tool.id == "computer-use")
        .unwrap();
    assert_eq!(tool.extension_id.as_deref(), Some("io.ovule.host"));
    assert_eq!(tool.transport, "native-crd");
    assert_eq!(tool.target, "tuffite.remoting");
}
