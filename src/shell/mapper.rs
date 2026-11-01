use crate::shell_api;
use ovule_extensions as extensions;
use ovule_settings::catalog::{
    AgentView as DomainAgentView, ModelView as DomainModelView, SkillView as DomainSkillView,
    ToolView as DomainToolView,
};
use ovule_setup as setup;
use ovule_setup::ToolchainView as DomainToolchainView;
use ovule_workspace::state::capabilities::{
    CapabilityAgentExposureView as DomainCapabilityAgentExposure,
    CapabilityView as DomainCapability, LegacyDataIssueView as DomainLegacyDataIssue,
};
use ovule_workspace::state::{
    AppSnapshot as DomainSnapshot, AttemptEventView as DomainAttemptEvent,
    AttemptView as DomainAttempt, BrowserSuggestion as DomainBrowserSuggestion,
    GoalView as DomainGoal, HostView as DomainHost, MessagePartView as DomainMessagePart,
    NodeView as DomainNode, ProjectView as DomainProject,
    RemoteEndpointView as DomainRemoteEndpoint, TerminalRunView as DomainTerminalRun,
    ThreadMessageView as DomainMessage, ThreadView as DomainThread,
    WorkspaceBindingView as DomainWorkspaceBinding,
};

pub(super) fn snapshot(value: DomainSnapshot) -> shell_api::AppSnapshot {
    shell_api::AppSnapshot {
        revision: value.revision,
        agents: value.agents.into_iter().map(agent).collect(),
        skills: value.skills.into_iter().map(skill).collect(),
        tools: value.tools.into_iter().map(tool).collect(),
        capabilities: value.capabilities.into_iter().map(capability).collect(),
        legacy_data_issues: value
            .legacy_data_issues
            .into_iter()
            .map(legacy_data_issue)
            .collect(),
        models: value.models.into_iter().map(model).collect(),
        projects: value.projects.into_iter().map(project).collect(),
        hosts: value.hosts.into_iter().map(host).collect(),
        endpoints: value.endpoints.into_iter().map(remote_endpoint).collect(),
        bindings: value.bindings.into_iter().map(workspace_binding).collect(),
        threads: value.threads.into_iter().map(thread).collect(),
        messages: value.messages.into_iter().map(message).collect(),
        goals: value.goals.into_iter().map(goal).collect(),
        nodes: value.nodes.into_iter().map(node).collect(),
        attempts: value.attempts.into_iter().map(attempt).collect(),
        terminal_runs: value.terminal_runs.into_iter().map(terminal_run).collect(),
    }
}

fn capability(value: DomainCapability) -> shell_api::CapabilityView {
    shell_api::CapabilityView {
        id: value.id,
        label: value.label,
        kind: value.kind,
        provider: value.provider,
        backend: value.backend,
        operations: value.operations,
        scopes: value.scopes,
        permissions: value.permissions,
        health: value.health,
        detail: value.detail,
        projections: value.projections,
        agent_exposures: value
            .agent_exposures
            .into_iter()
            .map(capability_agent_exposure)
            .collect(),
        toolchain_id: value.toolchain_id,
        source: value.source,
    }
}

fn capability_agent_exposure(
    value: DomainCapabilityAgentExposure,
) -> shell_api::CapabilityAgentExposureView {
    shell_api::CapabilityAgentExposureView {
        agent_id: value.agent_id,
        projection: value.projection,
        available: value.available,
        detail: value.detail,
    }
}

fn legacy_data_issue(value: DomainLegacyDataIssue) -> shell_api::LegacyDataIssueView {
    shell_api::LegacyDataIssueView {
        id: value.id,
        title: value.title,
        detail: value.detail,
        affected_ids: value.affected_ids,
        cleanup_action: value.cleanup_action,
    }
}

pub(super) fn browser_suggestions(
    values: Vec<DomainBrowserSuggestion>,
) -> Vec<shell_api::BrowserSuggestion> {
    values.into_iter().map(browser_suggestion).collect()
}

pub(super) fn onboarding_input(value: shell_api::OnboardingInput) -> setup::OnboardingInput {
    setup::OnboardingInput {
        thread_id: value.thread_id,
        agents: value
            .agents
            .into_iter()
            .map(|agent| setup::OnboardingAgentInput {
                id: agent.id,
                label: agent.label,
                driver: agent.driver,
                model_id: agent.model_id,
            })
            .collect(),
        default_agent_id: value.default_agent_id,
    }
}

pub(super) fn extension_setup_action_input(
    value: shell_api::ExtensionSetupActionInput,
) -> setup::ExtensionSetupActionInput {
    setup::ExtensionSetupActionInput {
        extension_id: value.extension_id,
        setup_id: value.setup_id,
        action_id: value.action_id,
        values: value
            .values
            .into_iter()
            .map(|item| setup::ExtensionSetupValue {
                id: item.id,
                value: item.value,
            })
            .collect(),
    }
}

pub(super) fn onboarding_status(value: setup::OnboardingStatus) -> shell_api::OnboardingStatus {
    shell_api::OnboardingStatus {
        authorization_url: value.authorization_url,
        agents: value.agents.into_iter().map(agent).collect(),
        models: value.models.into_iter().map(onboarding_model).collect(),
        toolchains: toolchains(value.toolchains),
        setups: value.setups.into_iter().map(extension_onboarding).collect(),
        default_agent_id: value.default_agent_id,
    }
}

pub(super) fn toolchains(values: Vec<DomainToolchainView>) -> Vec<shell_api::ToolchainView> {
    values.into_iter().map(toolchain).collect()
}

pub(super) fn ollama_jobs(
    values: Vec<ovule_setup::OllamaModelJobView>,
) -> Vec<shell_api::OllamaModelJobView> {
    values.into_iter().map(ollama_job).collect()
}

pub(super) fn ollama_catalog(value: setup::OllamaModelCatalog) -> shell_api::OllamaModelCatalog {
    shell_api::OllamaModelCatalog {
        models: value.models.into_iter().map(onboarding_model).collect(),
        jobs: ollama_jobs(value.jobs),
    }
}

fn extension_onboarding(
    value: setup::ExtensionOnboardingView,
) -> shell_api::ExtensionOnboardingView {
    shell_api::ExtensionOnboardingView {
        tag: value.tag,
        extension_id: value.extension_id,
        id: value.id,
        label: value.label,
        description: value.description,
        icon: value.icon,
        agent_ids: value.agent_ids,
        model_provider: value.model_provider,
        input_fields: value.input_fields,
        actions: value
            .actions
            .into_iter()
            .map(|action| shell_api::ExtensionOnboardingActionView {
                requires_authentication: action.requires_authentication,
                id: action.id,
                required_toolchains: action.required_toolchains,
            })
            .collect(),
        allowed_links: value.allowed_links,
        status: integration_status(value.status),
    }
}

fn extension_package(item: extensions::ExtensionPackageView) -> shell_api::ExtensionPackageView {
    shell_api::ExtensionPackageView {
        install_path: item.install_path,
        id: item.id,
        version: item.version,
        source: item.source,
        enabled: item.enabled,
        removable: item.removable,
    }
}

pub(super) fn extension_catalog(
    value: extensions::ExtensionCatalogView,
) -> shell_api::ExtensionCatalogView {
    shell_api::ExtensionCatalogView {
        extensions: value
            .extensions
            .into_iter()
            .map(extension_package)
            .collect(),
        agents: value
            .agents
            .into_iter()
            .map(|item| shell_api::AgentContributionView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                executable_candidates: item.executable_candidates,
                mcp_config: item.mcp_config,
                required_environment: item.required_environment,
            })
            .collect(),
        models: value
            .models
            .into_iter()
            .map(|item| shell_api::ModelContributionView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                provider: item.provider,
                remote_id: item.remote_id,
                agent_ids: item.agent_ids,
                recommended: item.recommended,
                description: item.description,
            })
            .collect(),
        capabilities: value
            .capabilities
            .into_iter()
            .map(|item| shell_api::ExtensionCapabilityView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                description: item.description,
            })
            .collect(),
        message_blocks: value
            .message_blocks
            .into_iter()
            .map(|item| shell_api::MessageBlockContributionView {
                ui_type: item.ui_type,
                extension_id: item.extension_id,
                kind: item.kind,
                tag: item.tag,
                module_url: item.module_url,
                style_url: item.style_url,
                host_renderer: item.host_renderer,
                capability: item.capability,
            })
            .collect(),
        slash_commands: value
            .slash_commands
            .into_iter()
            .map(|item| shell_api::SlashCommandContributionView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                description: item.description,
                skills: Some(item.skills),
            })
            .collect(),
        computer_use: value
            .computer_use
            .into_iter()
            .map(|item| shell_api::ComputerUseContributionView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                provider: item.provider,
                toolchain_id: item.toolchain_id,
                capabilities: item.capabilities,
            })
            .collect(),
        file_editors: value
            .file_editors
            .into_iter()
            .map(|item| shell_api::FileEditorContributionView {
                extension_id: item.extension_id,
                id: item.id,
                label: item.label,
                extensions: item.extensions,
                mode: item.mode,
                thread_presentation: item.thread_presentation,
                tag: item.tag,
                module_url: item.module_url,
                style_url: item.style_url,
            })
            .collect(),
    }
}

pub(super) fn ollama_job(value: ovule_setup::OllamaModelJobView) -> shell_api::OllamaModelJobView {
    shell_api::OllamaModelJobView {
        model: value.model,
        status: value.status,
        detail: value.detail,
        error: value.error,
    }
}

fn onboarding_model(value: setup::OnboardingModelOption) -> shell_api::OnboardingModelOption {
    shell_api::OnboardingModelOption {
        id: value.id,
        label: value.label,
        provider: value.provider,
        remote_id: value.remote_id,
        available: value.available,
        recommended: value.recommended,
        detail: value.detail,
        agent_id: value.agent_id,
    }
}

fn integration_status(value: setup::IntegrationStatus) -> shell_api::IntegrationStatus {
    shell_api::IntegrationStatus {
        id: value.id,
        available: value.available,
        authenticated: value.authenticated,
        detail: value.detail,
    }
}

fn toolchain(value: DomainToolchainView) -> shell_api::ToolchainView {
    shell_api::ToolchainView {
        id: value.id,
        label: value.label,
        kind: value.kind,
        provider: value.provider,
        requested_version: value.requested_version,
        available: value.available,
        installable: value.installable,
        managed: value.managed,
        detail: value.detail,
        executable: value.executable,
        version: value.version,
        install_hint: value.install_hint,
        required_toolchain_ids: value.required_toolchain_ids,
        install_status: value.install_status,
        install_error: value.install_error,
    }
}

fn agent(value: DomainAgentView) -> shell_api::AgentView {
    shell_api::AgentView {
        id: value.id,
        label: value.label,
        driver: value.driver,
        available: value.available,
        enabled: value.enabled,
        detail: value.detail,
        model_id: value.model_id,
        skill_ids: value.skill_ids,
        tool_ids: value.tool_ids,
        instructions: value.instructions,
        extension_id: value.extension_id,
    }
}

fn skill(value: DomainSkillView) -> shell_api::SkillView {
    shell_api::SkillView {
        id: value.id,
        name: value.name,
        description: value.description,
        path: value.path,
        enabled: value.enabled,
    }
}

fn tool(value: DomainToolView) -> shell_api::ToolView {
    shell_api::ToolView {
        id: value.id,
        label: value.label,
        transport: value.transport,
        target: value.target,
        args: value.args,
        enabled: value.enabled,
        required: value.required,
        available: value.available,
        detail: value.detail,
        credential_env: value.credential_env,
        extension_id: value.extension_id,
        toolchain_id: value.toolchain_id,
        capabilities: value.capabilities,
    }
}

fn model(value: DomainModelView) -> shell_api::ModelView {
    shell_api::ModelView {
        id: value.id,
        label: value.label,
        provider: value.provider,
        remote_id: value.remote_id,
        enabled: value.enabled,
        agent_ids: value.agent_ids,
        extension_id: value.extension_id,
        recommended: value.recommended,
        description: value.description,
    }
}

fn thread(value: DomainThread) -> shell_api::ThreadView {
    shell_api::ThreadView {
        id: value.id,
        title: value.title,
        agent: value.agent,
        host_id: value.host_id,
        workspace_path: value.workspace_path,
        model_id: value.model_id,
        project_id: value.project_id,
        workspace_binding_ids: value.workspace_binding_ids,
    }
}

fn project(value: DomainProject) -> shell_api::ProjectView {
    shell_api::ProjectView {
        id: value.id,
        name: value.name,
        sort_order: f64::from(value.sort_order),
        created_at: timestamp(value.created_at_ms),
    }
}

fn host(value: DomainHost) -> shell_api::HostView {
    shell_api::HostView {
        id: value.id,
        display_name: value.display_name,
        kind: value.kind,
        connector: value.connector,
        status: value.status,
        agent_ids: value.agent_ids,
    }
}

fn remote_endpoint(value: DomainRemoteEndpoint) -> shell_api::RemoteEndpointView {
    shell_api::RemoteEndpointView {
        id: value.id,
        display_name: value.display_name,
        transport: value.transport,
        host: value.host,
        remote_id: value.remote_id,
        port: value.port.map(f64::from),
        user: value.user,
        auth_kind: value.auth_kind,
        host_fingerprint: value.host_fingerprint,
        spice_websocket_url: value.spice_websocket_url,
        last_seen_at: value.last_seen_ms.map(timestamp),
        agent_ids: value.agent_ids,
        workspaces: value
            .workspaces
            .into_iter()
            .map(|workspace| shell_api::HostWorkspaceResource {
                share_id: workspace.id,
                root: workspace.root,
                alias: workspace.alias,
            })
            .collect(),
    }
}

fn workspace_binding(value: DomainWorkspaceBinding) -> shell_api::WorkspaceBindingView {
    shell_api::WorkspaceBindingView {
        id: value.id,
        thread_id: value.thread_id,
        host_id: value.host_id,
        kind: value.kind,
        endpoint_id: value.endpoint_id,
        resource_id: value.resource_id,
        root: value.root,
        alias: value.alias,
        sort_order: f64::from(value.sort_order),
        trust: value.trust,
    }
}

fn message(value: DomainMessage) -> shell_api::ThreadMessageView {
    shell_api::ThreadMessageView {
        id: value.id,
        thread_id: value.thread_id,
        role: value.role,
        content: value.content,
        parts: value.parts.into_iter().map(message_part).collect(),
        status: value.status,
        stream_sequence: value.stream_sequence,
        created_at: timestamp(value.created_at_ms),
        attempt_id: value.attempt_id,
    }
}

fn message_part(value: DomainMessagePart) -> shell_api::MessagePartView {
    shell_api::MessagePartView {
        id: value.id,
        kind: value.kind,
        text: value.text,
        url: value.url,
        name: value.name,
        media_type: value.media_type,
        size_bytes: value.size_bytes,
        data_json: value.data_json,
    }
}

fn goal(value: DomainGoal) -> shell_api::GoalView {
    shell_api::GoalView {
        id: value.id,
        thread_id: value.thread_id,
        title: value.title,
        intent: value.intent,
        status: value.status,
        progress: value.progress,
        created_at: timestamp(value.created_at_ms),
    }
}

fn node(value: DomainNode) -> shell_api::NodeView {
    shell_api::NodeView {
        id: value.id,
        goal_id: value.goal_id,
        thread_id: value.thread_id,
        kind: value.kind,
        title: value.title,
        status: value.status,
        agent: value.agent,
        dependency_ids: value.dependency_ids,
        host_id: value.host_id,
        workspace_binding_ids: value.workspace_binding_ids,
        created_at: timestamp(value.created_at_ms),
    }
}

fn attempt(value: DomainAttempt) -> shell_api::AttemptView {
    shell_api::AttemptView {
        id: value.id,
        thread_id: value.thread_id,
        task_id: value.task_id,
        source_message_id: value.source_message_id,
        response_message_id: value.response_message_id,
        purpose: value.purpose,
        agent: value.agent,
        host_id: value.host_id,
        driver: value.driver,
        model_provider: value.model_provider,
        model_remote_id: value.model_remote_id,
        status: value.status,
        summary: value.summary,
        output: value.output,
        output_sequence: value.output_sequence,
        created_at: timestamp(value.created_at_ms),
        started_at: value.started_at_ms.map(timestamp),
        finished_at: value.finished_at_ms.map(timestamp),
        duration_ms: value.duration_ms,
        events: value.events.into_iter().map(attempt_event).collect(),
    }
}

fn attempt_event(value: DomainAttemptEvent) -> shell_api::AttemptEventView {
    shell_api::AttemptEventView {
        kind: value.kind,
        occurred_at: timestamp(value.occurred_at_ms),
        detail: value.detail,
    }
}

fn terminal_run(value: DomainTerminalRun) -> shell_api::TerminalRunView {
    shell_api::TerminalRunView {
        id: value.id,
        thread_id: value.thread_id,
        owner_id: value.owner_id,
        command: value.command,
        status: value.status,
        stdout: value.stdout,
        stderr: value.stderr,
        exit_code: value.exit_code,
    }
}

fn browser_suggestion(value: DomainBrowserSuggestion) -> shell_api::BrowserSuggestion {
    shell_api::BrowserSuggestion {
        id: value.id,
        kind: value.kind,
        title: value.title,
        detail: value.detail,
        target: value.target,
    }
}

// Millisecond timestamps are exposed as JavaScript numbers (the Date range).
#[allow(clippy::cast_precision_loss)]
fn timestamp(value: i64) -> f64 {
    value as f64
}
