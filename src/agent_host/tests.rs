use super::*;
use ovule_channels::ChannelToolHost;

#[test]
fn external_local_agents_receive_authenticated_crd_http_mcp() {
    let tool = ToolRecord {
        id: "computer-use".to_owned(),
        label: "CRD Computer Use".to_owned(),
        transport: "native-crd".to_owned(),
        target: "tuffite.remoting".to_owned(),
        args: Vec::new(),
        enabled: true,
        required: false,
        credential_env: None,
        extension_id: Some("io.ovule.host".to_owned()),
        toolchain_id: None,
        capabilities: vec!["desktop.snapshot".to_owned()],
    };
    let endpoint = ovule_hosts::ComputerUseMcpEndpoint {
        url: "http://127.0.0.1:43123/mcp".to_owned(),
        bearer_token: "secret".to_owned(),
    };
    let servers = acp_mcp_servers(&[tool], true, true, Some(&endpoint)).unwrap();
    let json = serde_json::to_value(&servers[0]).unwrap();
    assert_eq!(json["url"], "http://127.0.0.1:43123/mcp");
    assert_eq!(json["headers"][0]["name"], "Authorization");
    assert_eq!(json["headers"][0]["value"], "Bearer secret");
}

#[test]
fn native_agent_keeps_crd_direct_and_omits_the_loopback_mcp_projection() {
    let tool = ToolRecord {
        id: "computer-use".to_owned(),
        label: "CRD Computer Use".to_owned(),
        transport: "native-crd".to_owned(),
        target: "tuffite.remoting".to_owned(),
        args: Vec::new(),
        enabled: true,
        required: false,
        credential_env: None,
        extension_id: Some("io.ovule.host".to_owned()),
        toolchain_id: None,
        capabilities: vec!["desktop.snapshot".to_owned()],
    };

    let servers = acp_mcp_servers(&[tool], true, false, None).unwrap();

    assert_eq!(servers.len(), 0);
}

#[test]
fn external_remote_agents_receive_the_host_local_crd_http_mcp() {
    let tool = ToolRecord {
        id: "computer-use".to_owned(),
        label: "CRD Computer Use".to_owned(),
        transport: "native-crd".to_owned(),
        target: "tuffite.remoting".to_owned(),
        args: Vec::new(),
        enabled: true,
        required: false,
        credential_env: None,
        extension_id: Some("io.ovule.host".to_owned()),
        toolchain_id: None,
        capabilities: vec!["desktop.snapshot".to_owned()],
    };
    let endpoint = ovule_hosts::ComputerUseMcpEndpoint {
        url: "http://127.0.0.1:43124/mcp".to_owned(),
        bearer_token: "host-secret".to_owned(),
    };

    let servers = acp_mcp_servers(&[tool], false, true, Some(&endpoint)).unwrap();
    let json = serde_json::to_value(&servers[0]).unwrap();
    assert_eq!(json["url"], "http://127.0.0.1:43124/mcp");
    assert_eq!(json["headers"][0]["value"], "Bearer host-secret");
}

#[test]
fn ovule_openai_projects_tools_to_its_codex_acp_executor() {
    let mut spec = fixture_spec("ovule");
    spec.model_provider = Some("openai".to_owned());
    assert!(projects_tools_over_acp(&spec));

    spec.model_provider = Some("ollama".to_owned());
    assert!(!projects_tools_over_acp(&spec));
    assert!(projects_tools_over_acp(&fixture_spec("codex")));
}

#[test]
fn local_extension_tools_resolve_managed_toolchain_executables() {
    let root = tempfile::tempdir().unwrap();
    let executable = root
        .path()
        .join("installs/codex/0.154.0/node_modules/.bin")
        .join(if cfg!(windows) { "codex.cmd" } else { "codex" });
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(&executable, b"example").unwrap();
    let tools = resolve_local_toolchains(
        &[ToolRecord {
            id: "example-tool".to_owned(),
            label: "Example Tool".to_owned(),
            transport: "stdio".to_owned(),
            target: "codex".to_owned(),
            args: vec!["serve".to_owned()],
            enabled: true,
            required: false,
            credential_env: None,
            extension_id: Some("io.example.tool".to_owned()),
            toolchain_id: Some("codex".to_owned()),
            capabilities: vec!["example.read".to_owned()],
        }],
        root.path(),
    )
    .unwrap();
    assert_eq!(PathBuf::from(&tools[0].target), executable);
}

#[test]
fn local_extension_tools_omit_uninstalled_optional_toolchains() {
    let root = tempfile::tempdir().unwrap();
    let tools = resolve_local_toolchains(
        &[ToolRecord {
            id: "example-tool".to_owned(),
            label: "Example Tool".to_owned(),
            transport: "stdio".to_owned(),
            target: "example-driver".to_owned(),
            args: vec!["serve".to_owned()],
            enabled: true,
            required: false,
            credential_env: None,
            extension_id: Some("io.example.tool".to_owned()),
            toolchain_id: Some("example-driver".to_owned()),
            capabilities: vec!["example.read".to_owned()],
        }],
        root.path(),
    )
    .unwrap();
    assert_eq!(tools.len(), 0);
}

#[test]
fn local_extension_tools_report_uninstalled_required_toolchains() {
    let root = tempfile::tempdir().unwrap();
    let error = resolve_local_toolchains(
        &[ToolRecord {
            id: "example-tool".to_owned(),
            label: "Example Tool".to_owned(),
            transport: "stdio".to_owned(),
            target: "example-driver".to_owned(),
            args: vec!["serve".to_owned()],
            enabled: true,
            required: true,
            credential_env: None,
            extension_id: Some("io.example.tool".to_owned()),
            toolchain_id: Some("example-driver".to_owned()),
            capabilities: vec!["example.read".to_owned()],
        }],
        root.path(),
    )
    .unwrap_err();
    assert!(error.contains("Manage > Toolchains"));
}

#[test]
fn output_summary_is_bounded_and_uses_last_line() {
    let output = format!("first\n{}", "x".repeat(3_000));
    let summary = summarize_output(&output, "", "empty");
    assert_eq!(summary.len(), 2_000);
    assert!(summary.chars().all(|character| character == 'x'));
}

#[test]
fn execution_prompt_includes_profile_and_skills() {
    let spec = fixture_spec("unknown");
    let blocks = available_message_blocks().unwrap();
    let editors = available_file_editors().unwrap();
    let prompt = execution_prompt(&spec, &blocks, &editors);
    assert!(prompt.contains("Agent profile instructions"));
    assert!(!prompt.contains("Applicable Skill"));
    assert!(prompt.contains("```ovule-block"));
    assert!(prompt.contains("`echarts`"));
    assert!(prompt.contains("[report.pdf]"));
    assert!(prompt.ends_with("hello"));
}

#[test]
fn deep_seek_test_api_base_requires_an_explicit_loopback_origin() {
    assert!(validate_deep_seek_api_base("http://127.0.0.1:11436").is_ok());
    assert!(validate_deep_seek_api_base("http://localhost:11436").is_ok());
    assert!(validate_deep_seek_api_base("https://example.com").is_err());
    assert!(validate_deep_seek_api_base("http://127.0.0.1/path").is_err());
}

#[test]
fn rig_tools_preserve_channel_names() {
    let names = channel_definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "ovule_channel_status",
            "ovule_channel_subscribe_current",
            "ovule_channel_list_subscriptions",
            "ovule_channel_read_feed",
            "ovule_channel_unsubscribe",
        ]
    );
    assert_eq!(snake_to_camel("subscribe_current"), "subscribeCurrent");
}

#[test]
fn rig_exposes_explicit_multi_workspace_tools() {
    let names = ovule_hosts::capability::workspace_definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "ovule_workspace_policy",
            "ovule_workspace_list",
            "ovule_workspace_read",
            "ovule_workspace_write",
            "ovule_workspace_exec",
        ]
    );
}

#[test]
fn exposes_host_owned_channel_subscription_tools() {
    let tools = channel_dynamic_tools();
    let names = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "status",
            "subscribeCurrent",
            "listSubscriptions",
            "readFeed",
            "unsubscribe"
        ]
    );
    assert!(tools.iter().all(|tool| {
        let namespace = tool.get("namespace").and_then(Value::as_str);
        namespace == Some("ovule_channel")
            && namespace.is_some_and(|value| {
                !value.is_empty()
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            })
    }));
}

#[test]
fn unsupported_driver_fails_before_spawning() {
    let result =
        ovule_extensions::providers::resolve_extension_agent(&fixture_spec("unknown").driver);
    assert!(matches!(result, Ok(None)));
}

#[test]
fn ollama_openai_base_normalizes_hosts() {
    assert_eq!(
        normalize_ollama_openai_api_base("http://127.0.0.1:11435/api").unwrap(),
        "http://127.0.0.1:11435/v1"
    );
}

fn fixture_spec(driver: &str) -> AttemptSpec {
    AttemptSpec {
        project_id: None,
        id: "attempt-1".to_owned(),
        thread_id: "thread-1".to_owned(),
        task_id: Some("task-1".to_owned()),
        source_message_id: None,
        agent: "test-agent".to_owned(),
        host_id: "local".to_owned(),
        prompt: "hello".to_owned(),
        workspace_path: std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        workspace_binding_id: None,
        workspaces: Vec::new(),
        driver: driver.to_owned(),
        model_provider: None,
        model_remote_id: None,
        skill_paths: Vec::new(),
        tools: Vec::new(),
        instructions: "Be precise.".to_owned(),
        structured_goal: false,
        local_images: Vec::new(),
    }
}

#[test]
#[allow(clippy::too_many_lines)]
fn drive_acp_client_streams_agent_message_chunks_and_completes() {
    acp_completion_fixture(false);
}

#[test]
fn drive_acp_client_rejects_thinking_only_completion() {
    acp_completion_fixture(true);
}

#[allow(clippy::too_many_lines)] // Complete in-process ACP handshake fixture.
fn acp_completion_fixture(reasoning_only: bool) {
    use agent_client_protocol::schema::v1::{
        AgentCapabilities, ContentBlock as V1ContentBlock, ContentChunk, InitializeRequest,
        InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
        ReadTextFileRequest, SessionNotification, SessionUpdate, StopReason,
        TextContent as V1TextContent,
    };
    use agent_client_protocol::{Channel, on_receive_request};
    use processkit::CancellationToken;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("build test runtime");

    runtime.block_on(async {
        let workspace = tempfile::Builder::new()
            .prefix("ovule-acp-")
            .tempdir()
            .expect("workspace tempdir");
        let workspace_path = workspace.path().to_path_buf();
        let note_path = workspace.path().join("workspace-note.txt");
        std::fs::write(&note_path, "workspace context").unwrap();
        let note_for_agent = note_path.clone();
        let (client_transport, agent_transport) = Channel::duplex();

        let fake_agent = async move {
            agent_client_protocol::Agent
                .builder()
                .name("ovule-fake-agent")
                .on_receive_request(
                    async move |request: InitializeRequest, responder, _cx| {
                        responder.respond(
                            InitializeResponse::new(request.protocol_version)
                                .agent_capabilities(AgentCapabilities::new()),
                        )
                    },
                    on_receive_request!(),
                )
                .on_receive_request(
                    async move |_request: NewSessionRequest, responder, _cx| {
                        responder.respond(NewSessionResponse::new("session-under-test"))
                    },
                    on_receive_request!(),
                )
                .on_receive_request(
                    move |request: PromptRequest,
                          responder: agent_client_protocol::Responder<PromptResponse>,
                          connection: agent_client_protocol::ConnectionTo<
                        agent_client_protocol::Client,
                    >| {
                        let note_for_agent = note_for_agent.clone();
                        async move {
                            let worker = connection.clone();
                            connection.spawn(async move {
                                let note = worker
                                    .send_request(ReadTextFileRequest::new(
                                        request.session_id.clone(),
                                        note_for_agent,
                                    ))
                                    .block_task()
                                    .await?;
                                worker.send_notification(SessionNotification::new(
                                    request.session_id.clone(),
                                    if reasoning_only {
                                        SessionUpdate::AgentThoughtChunk(ContentChunk::new(
                                            V1ContentBlock::Text(V1TextContent::new("thinking ")),
                                        ))
                                    } else {
                                        SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                            V1ContentBlock::Text(V1TextContent::new("hello ")),
                                        ))
                                    },
                                ))?;
                                worker.send_notification(SessionNotification::new(
                                    request.session_id.clone(),
                                    if reasoning_only {
                                        SessionUpdate::AgentThoughtChunk(ContentChunk::new(
                                            V1ContentBlock::Text(V1TextContent::new(note.content)),
                                        ))
                                    } else {
                                        SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                            V1ContentBlock::Text(V1TextContent::new(note.content)),
                                        ))
                                    },
                                ))?;
                                responder.respond(PromptResponse::new(StopReason::EndTurn))
                            })?;
                            Ok(())
                        }
                    },
                    on_receive_request!(),
                )
                .connect_to(agent_transport)
                .await
                .expect("fake agent should run to completion");
        };

        let observed = Arc::new(Mutex::new(Vec::<WorkerEvent>::new()));
        let observed_writer = Arc::clone(&observed);
        let notify: Arc<dyn Fn(WorkerEvent) + Send + Sync> = Arc::new(move |event| {
            observed_writer
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(event);
        });
        let client_future = acp::drive_acp_client(
            "attempt-acp",
            client_transport,
            workspace_path.clone(),
            Vec::new(),
            vec![acp::AcpWorkspaceRoot {
                id: "workspace-under-test".to_owned(),
                root: workspace_path.clone(),
                transport: ovule_hosts::providers::local(workspace_path).unwrap(),
            }],
            Vec::new(),
            "ping".to_owned(),
            true,
            std::collections::BTreeSet::new(),
            CancellationToken::new(),
            notify,
        );

        let joined = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(client_future, fake_agent)
        })
        .await
        .expect("ACP session should complete within the test deadline");
        let (outcome, ()) = joined;

        if reasoning_only {
            assert_eq!(outcome.status, "failed");
            assert!(outcome.summary.contains("without an answer"));
            assert!(!outcome.summary.contains("ACP Agent completed"));
            return;
        }
        assert_eq!(outcome.status, "succeeded");
        assert_eq!(outcome.summary, "hello workspace context");

        let deltas: Vec<String> = observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::Output { delta, .. } => Some(delta.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(deltas.concat(), "hello workspace context");
        let sequences = observed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter_map(|event| match event {
                WorkerEvent::Output { sequence, .. } => Some(*sequence),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(sequences, [0, 1]);
    });
}

#[test]
#[ignore = "requires an installed Sample ACP ACP server"]
fn live_sample_acp_initializes_over_local_workspace_transport() {
    use agent_client_protocol::Client;
    use agent_client_protocol::schema::ProtocolVersion;
    use agent_client_protocol::schema::v1::{Implementation, InitializeRequest};
    use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("build test runtime");
    runtime.block_on(async {
        let executable = which::which("sample").expect("Sample ACP CLI is installed");
        let workspace = tempfile::tempdir().unwrap();
        let transport = ovule_hosts::providers::local(workspace.path().to_path_buf())
            .expect("local workspace transport");
        let mut process = transport
            .spawn(
                &[
                    executable.to_string_lossy().into_owned(),
                    "acp".to_owned(),
                    "serve".to_owned(),
                ],
                &std::collections::BTreeMap::new(),
            )
            .await
            .expect("start Sample ACP ACP server");
        let stdin = std::mem::replace(&mut process.stdin, Box::pin(tokio::io::sink()));
        let stdout = std::mem::replace(&mut process.stdout, Box::pin(tokio::io::empty()));
        let response = tokio::time::timeout(
            Duration::from_secs(20),
            Client.builder().connect_with(
                agent_client_protocol::ByteStreams::new(stdin.compat_write(), stdout.compat()),
                async |connection| {
                    connection
                        .send_request(
                            InitializeRequest::new(ProtocolVersion::V1)
                                .client_info(Implementation::new("ovule-smoke", "0.1.0")),
                        )
                        .block_task()
                        .await
                },
            ),
        )
        .await
        .expect("Sample ACP ACP initialize timed out");
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let mut stderr = String::new();
                let _ = tokio::time::timeout(
                    Duration::from_secs(2),
                    tokio::io::AsyncReadExt::read_to_string(&mut process.stderr, &mut stderr),
                )
                .await;
                panic!("Sample ACP ACP initialize failed: {error}; stderr: {stderr}");
            }
        };
        assert_eq!(response.protocol_version, ProtocolVersion::V1);
        drop(process);
    });
}

#[test]
fn base_prompt_never_eagerly_reads_selected_skill_instructions() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("SKILL.md");
    std::fs::write(&path, "Inspect the live channel with ovule_channel.status.").unwrap();
    let mut spec = fixture_spec("unknown");
    spec.skill_paths = vec![path.to_string_lossy().into_owned()];
    assert!(!execution_prompt(&spec, &[], &[]).contains("Inspect the live channel"));
    spec.structured_goal = true;
    assert!(!execution_prompt(&spec, &[], &[]).contains("Inspect the live channel"));
}

struct NoChannelTools;
impl ChannelToolHost for NoChannelTools {
    fn invoke(&self, _: &str, _: &str, _: &Value) -> Result<Value, String> {
        Err("channel tools unavailable".into())
    }
}

struct NoExtensions;
impl ovule_extensions::runtime::ExtensionAgentRuntime for NoExtensions {
    fn prepare_agent(
        &self,
        _: &ovule_extensions::protocol::ValidatedExtensionPackage,
        _: &ovule_extensions::protocol::AgentContribution,
        _: Value,
    ) -> Result<ovule_extensions::protocol::SpawnPlan, String> {
        Err("extension runtime unavailable".into())
    }
    fn prepare_model_provider(
        &self,
        _: &ovule_extensions::protocol::ValidatedExtensionPackage,
        _: &str,
        _: Value,
    ) -> Result<ovule_extensions::runtime::ModelProviderPlan, String> {
        Err("extension runtime unavailable".into())
    }
}

struct NoTransports;
impl ovule_hosts::WorkspaceTransportResolver for NoTransports {
    fn resolve(
        &self,
        _: Option<&str>,
        _: &str,
    ) -> Result<Arc<dyn ovule_hosts::WorkspaceTransport>, ovule_hosts::TransportError> {
        Err(ovule_hosts::TransportError::Protocol(
            "transport unavailable".into(),
        ))
    }
}

fn isolated_driver(root: &Path) -> DriverHost {
    DriverHost::new(
        root.to_path_buf(),
        Arc::new(ovule_memory::MemoryService::open(&root.join("memory.sqlite")).unwrap()),
        ovule_browser::providers::unavailable(),
        Arc::new(ovule_secrets::providers::open(&root.join("secrets.db")).unwrap()),
        Arc::new(capabilities::ProviderAssembly::new(
            Arc::new(NoChannelTools),
            ovule_browser::providers::unavailable(),
        )),
        Arc::new(ovule_agent::AgentKernel),
        Arc::new(NoTransports),
        Arc::new(NoExtensions),
        ovule_remoting::providers::unavailable_computer_use(),
    )
    .unwrap()
}

#[test]
fn stopped_runtime_rejects_cloned_session_before_registration() {
    let root = tempfile::tempdir().unwrap();
    let mut host = isolated_driver(root.path());
    let session = host.handle();
    assert!(host.computer_use_mcp_endpoint().is_none());
    host.shutdown(Duration::from_secs(1));
    let registered = AtomicBool::new(false);
    let error = session
        .spawn(
            &fixture_spec("ovule"),
            || {
                registered.store(true, Ordering::Relaxed);
                Ok(())
            },
            |_| {},
        )
        .unwrap_err();
    assert!(error.contains("shutting down"));
    assert!(!registered.load(Ordering::Relaxed));
    assert!(
        session
            .probe_executable(Path::new("unused"), &[])
            .unwrap_err()
            .contains("shutting down")
    );
}

#[test]
fn duplicate_session_preserves_original_cancellation_token() {
    let root = tempfile::tempdir().unwrap();
    let mut host = isolated_driver(root.path());
    let session = host.handle();
    let original = CancellationToken::new();
    lock_workers(&session.workers).insert("attempt-1".into(), original.clone());
    assert!(
        session
            .spawn(&fixture_spec("ovule"), || Ok(()), |_| {})
            .unwrap_err()
            .contains("already has")
    );
    session.cancel("attempt-1", || Ok(())).unwrap();
    assert!(original.is_cancelled());
    lock_workers(&session.workers).clear();
    host.shutdown(Duration::from_secs(1));
}

#[test]
fn dropping_runtime_deactivates_outstanding_sessions() {
    let root = tempfile::tempdir().unwrap();
    let host = isolated_driver(root.path());
    let session = host.handle();
    drop(host);
    assert!(
        session
            .spawn(&fixture_spec("ovule"), || Ok(()), |_| {})
            .unwrap_err()
            .contains("shutting down")
    );
}

#[test]
fn host_handoff_stays_in_attempt_context_without_an_essentials_package() {
    let blocks = available_message_blocks().unwrap();
    let handoff = blocks
        .iter()
        .filter(|block| block.kind == "human-handoff")
        .collect::<Vec<_>>();
    assert_eq!(handoff.len(), 1);
    assert!(handoff[0].module.is_none());
    assert!(message_block_prompt(&blocks).contains("human-handoff"));
}

// Real HTTP/SSE fixtures for the production Rig request/stream path. They never
// contact a provider and are run explicitly where loopback listeners are allowed.
#[allow(clippy::too_many_lines)] // Bounded local HTTP/SSE fixture and resource setup.
async fn rig_answer_fixture(
    finishes: &[&str],
    recovery_tool_call: bool,
    injected: Vec<Arc<dyn crate::agent_host::context::CapabilityProvider>>,
) -> (WorkerOutcome, Vec<Value>, Vec<WorkerEvent>) {
    use std::io::{Read, Write};
    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let finishes = finishes
        .iter()
        .map(|finish| (*finish).to_owned())
        .collect::<Vec<_>>();
    let server = std::thread::spawn(move || {
        let mut bodies = Vec::new();
        // Discovery precedes completion; the endpoint advertises a limit, not a default.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut discovery = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("waiting for model discovery: {error}"),
            }
        };
        // macOS may inherit the listener's nonblocking mode on accepted sockets.
        discovery.set_nonblocking(false).unwrap();
        discovery
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut headers = Vec::new();
        loop {
            let mut byte = [0];
            discovery.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
            if headers.ends_with(b"\r\n\r\n") {
                break;
            }
        }
        assert!(String::from_utf8_lossy(&headers).starts_with("GET /models "));
        let metadata = r#"{"data":[{"id":"deepseek-flash","max_output_tokens":123456,"context_window":999999}]}"#;
        write!(discovery, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", metadata.len(), metadata).unwrap();
        drop(discovery);
        for (index, finish) in finishes.into_iter().enumerate() {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && std::time::Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("waiting for fixture request: {error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 8192];
            let header_end = loop {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
            let length: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            while bytes.len() < header_end + length {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
            }
            bodies.push(
                serde_json::from_slice::<Value>(&bytes[header_end..header_end + length]).unwrap(),
            );
            let tool_call = |index: usize, name: &str, arguments: Value| serde_json::json!({"index":index,"id":format!("fixture-{index}-{name}"),"type":"function","function":{"name":name,"arguments":arguments.to_string()}});
            let delta = if finish == "acquire_mcp" {
                serde_json::json!({"role":"assistant","tool_calls":[tool_call(0,"ovule_capabilities",serde_json::json!({"action":"acquire","provider":"mcp:loop-fixture"}))]})
            } else if finish == "empty" {
                serde_json::json!({"role":"assistant","content":""})
            } else if finish == "discover" {
                serde_json::json!({"role":"assistant","tool_calls":[tool_call(0,"ovule_capabilities",serde_json::json!({"action":"search","query":"memory"}))]})
            } else if finish == "load_and_speculate" {
                serde_json::json!({"role":"assistant","tool_calls":[
                    tool_call(0,"ovule_capabilities",serde_json::json!({"action":"load","names":["ovule_memory"]})),
                    tool_call(1,"ovule_memory",serde_json::json!({"action":"search","query":"test"}))
                ]})
            } else if finish == "memory" {
                serde_json::json!({"role":"assistant","tool_calls":[tool_call(0,"ovule_memory",serde_json::json!({"action":"search","query":"test"}))]})
            } else if index == 0 || finish == "length" {
                serde_json::json!({"role":"assistant","reasoning_content":"fixture private reasoning must not become an answer"})
            } else if recovery_tool_call {
                serde_json::json!({"role":"assistant","tool_calls":[{"index":0,"id":"unwanted-tool","type":"function","function":{"name":"ovule_browser","arguments":"{\"action\":\"click\"}"}}]})
            } else {
                serde_json::json!({"role":"assistant","content":"Recovered final answer."})
            };
            let chunk = |delta: Value, reason: Option<&str>| {
                serde_json::json!({"id":"fixture-completion","object":"chat.completion.chunk","created":0,"model":"deepseek-flash","choices":[{"index":0,"delta":delta,"finish_reason":reason}]}).to_string()
            };
            let body = format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                chunk(delta, None),
                chunk(
                    serde_json::json!({}),
                    Some(
                        if matches!(
                            finish.as_str(),
                            "discover" | "load_and_speculate" | "memory" | "acquire_mcp"
                        ) {
                            "tool_calls"
                        } else if finish == "empty" {
                            "stop"
                        } else {
                            &finish
                        }
                    )
                )
            );
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
        bodies
    });
    let memory =
        Arc::new(ovule_memory::MemoryService::open(std::path::Path::new(":memory:")).unwrap());
    let assembled = crate::agent_host::context::AssembledAttempt::assemble(
        crate::agent_host::context::AssemblyInput {
            attempt_id: "answer-fixture",
            thread_id: "fixture-thread",
            project_id: None,
            host_id: "local",
            driver: "ovule",
            provider: Some("deepseek"),
            local_transport: true,
            planning: false,
            skill_paths: &[],
            base_prompt: "Original user question".into(),
            context_budget_chars: 16000,
        },
        memory,
        None,
    )
    .unwrap();
    let captured = Arc::new(Mutex::new(Vec::<WorkerEvent>::new()));
    let capture = captured.clone();
    let notify: WorkerEventCallback = Arc::new(move |event| capture.lock().unwrap().push(event));
    let cancellation = CancellationToken::new();
    let turn = ModelTurn {
        execution: Arc::new(ovule_agent::execution::ToolExecutor::new(
            "answer-fixture".into(),
            cancellation.clone(),
            ovule_agent::execution::approval::ApprovalBroker::unavailable(),
            notify.clone(),
        )),
        provider: "deepseek".into(),
        api_key: "local-fixture-not-a-key".into(),
        api_base: origin,
        model: "deepseek-flash".into(),
        prompt: "Original user question".into(),
        structured_goal: false,
        capability_providers: {
            let mut providers = assembled.context.providers();
            providers.extend(injected);
            providers
        },
    };
    let result = ovule_agent::run_turn(
        "answer-fixture",
        turn,
        cancellation,
        notify,
        true,
        &BTreeSet::new(),
    )
    .await;
    let bodies = server.join().unwrap();
    let captured = captured.lock().unwrap().clone();
    (result, bodies, captured)
}

#[tokio::test]
#[ignore = "requires loopback HTTP; run with OVULE_TEST_MODE=1"]
async fn rig_answer_recovers_reasoning_length_once_without_repeating_tools() {
    let (result, requests, events) =
        rig_answer_fixture(&["length", "stop"], false, Vec::new()).await;
    assert_eq!(result.status, "succeeded", "{}", result.summary);
    assert_eq!(result.summary, "Recovered final answer.");
    assert_eq!(requests.len(), 2);
    assert!(requests[0].get("max_tokens").is_none_or(Value::is_null));
    assert_eq!(requests[1]["max_tokens"], 8_192);
    assert_eq!(requests[1]["thinking"]["type"], "disabled");
    assert_eq!(requests[1]["reasoning_effort"], "none");
    assert!(
        requests[1]
            .get("tools")
            .is_none_or(|value| value.is_null() || value.as_array().is_some_and(Vec::is_empty))
    );
    assert!(
        requests[1]["messages"]
            .to_string()
            .contains("Original user question")
    );
    assert!(
        !requests[1]
            .to_string()
            .contains("fixture private reasoning")
    );
    assert_eq!(events.iter().filter(|event| matches!(event, WorkerEvent::Diagnostic {kind, ..} if kind == "harness/answer_recovery")).count(), 1);
}
#[tokio::test]
#[ignore = "requires loopback HTTP; run with OVULE_TEST_MODE=1"]
async fn rig_answer_recovery_stops_after_second_empty_response() {
    let (result, requests, _) = rig_answer_fixture(&["length", "length"], false, Vec::new()).await;
    assert_eq!(requests.len(), 2);
    assert_eq!(result.status, "failed");
    assert!(result.summary.contains("returned no answer"));
}
#[tokio::test]
#[ignore = "requires loopback HTTP; run with OVULE_TEST_MODE=1"]
async fn rig_answer_recovery_does_not_retry_unrelated_empty_stop() {
    let (result, requests, _) = rig_answer_fixture(&["stop"], false, Vec::new()).await;
    assert_eq!(requests.len(), 1);
    assert_eq!(result.status, "failed");
}
#[tokio::test]
#[ignore = "requires loopback HTTP; run with OVULE_TEST_MODE=1"]
async fn rig_answer_recovery_rejects_new_tool_requests() {
    let (result, requests, _) =
        rig_answer_fixture(&["length", "tool_calls"], true, Vec::new()).await;
    assert_eq!(requests.len(), 2);
    assert_eq!(result.status, "failed");
    assert!(
        result.summary.contains("tool-free answer recovery"),
        "{}",
        result.summary
    );
}

#[tokio::test]
#[ignore = "requires loopback HTTP; run with OVULE_TEST_MODE=1"]
async fn rig_discovery_loads_on_next_request_and_blocks_same_batch_speculation() {
    let (result, requests, events) = rig_answer_fixture(
        &["discover", "load_and_speculate", "memory", "stop"],
        false,
        Vec::new(),
    )
    .await;
    assert_eq!(result.status, "succeeded", "{}", result.summary);
    assert_eq!(requests.len(), 4);
    let names = |request: &Value| {
        request["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&requests[0]), ["ovule_capabilities"]);
    assert_eq!(names(&requests[1]), ["ovule_capabilities"]);
    assert_eq!(names(&requests[2]), ["ovule_capabilities", "ovule_memory"]);
    assert!(
        requests[2]["messages"]
            .to_string()
            .contains("not exposed in this model request")
    );
    assert_eq!(events.iter().filter(|event| matches!(event, WorkerEvent::Diagnostic { kind, detail_json, .. } if kind == "harness/execution" && {
        let detail: Value = serde_json::from_str(detail_json).unwrap();
        detail["tool"] == "ovule_memory" && detail["status"] == "requested"
    })).count(), 1, "only the call from the next request may reach the executor");
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires local HTTP model fixture"]
async fn rig_closes_injected_mcp_leases_after_model_success_and_failure() {
    for finish in ["stop", "empty"] {
        let root = tempfile::tempdir().unwrap();
        let record = ToolRecord {
            id: "loop-fixture".into(),
            label: "loop fixture".into(),
            transport: "stdio".into(),
            target: which::which("python3").unwrap().to_string_lossy().into(),
            args: vec![
                format!(
                    "{}/services/hosts/tests/fixtures/mcp_provider.py",
                    env!("CARGO_MANIFEST_DIR")
                ),
                "healthy".into(),
                root.path().join("pid").to_string_lossy().into(),
                root.path().join("events").to_string_lossy().into(),
            ],
            enabled: true,
            required: false,
            credential_env: None,
            extension_id: None,
            toolchain_id: None,
            capabilities: vec![],
        };
        let injected = ovule_hosts::mcp::providers(
            &[ovule_hosts::mcp::McpProviderSpec {
                id: record.id,
                label: record.label,
                transport: record.transport,
                target: record.target,
                args: record.args,
                credential_env: record.credential_env,
            }],
            root.path(),
        );
        let (outcome, _, events) =
            rig_answer_fixture(&["acquire_mcp", finish], false, injected).await;
        assert_eq!(
            outcome.status,
            if finish == "stop" {
                "succeeded"
            } else {
                "failed"
            },
            "{}",
            outcome.summary
        );
        let pid = std::fs::read_to_string(root.path().join("pid")).unwrap();
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        assert!(events.iter().any(|event|matches!(event,WorkerEvent::Diagnostic {kind,detail_json,..} if kind=="harness/provider" && detail_json.contains("closed"))));
    }
}

#[tokio::test]
#[ignore = "requires local HTTP model fixture"]
async fn rig_reports_cleanup_failure_even_after_a_successful_model_answer() {
    use crate::agent_host::context::{
        CapabilityDefinition, CapabilityLease, CapabilityProvider, ProviderDescriptor,
        ProviderError,
    };
    struct FailedCleanup;
    #[async_trait::async_trait]
    impl CapabilityProvider for FailedCleanup {
        fn descriptor(&self) -> ProviderDescriptor {
            ProviderDescriptor {
                id: "mcp:loop-fixture".into(),
                description: "Fixture".into(),
            }
        }
        async fn acquire(
            &self,
            _cancel: CancellationToken,
        ) -> Result<Box<dyn CapabilityLease>, String> {
            Ok(Box::new(Self))
        }
    }
    #[async_trait::async_trait]
    impl CapabilityLease for FailedCleanup {
        fn definitions(&self) -> Vec<CapabilityDefinition> {
            vec![]
        }
        async fn invoke(
            &mut self,
            _name: &str,
            _args: &Value,
            _cancel: CancellationToken,
        ) -> Result<Value, ProviderError> {
            Err(ProviderError::Tool("No tools".into()))
        }
        async fn close(&mut self) -> Result<(), String> {
            Err("fixture cleanup failed".into())
        }
    }
    let (outcome, _, events) = rig_answer_fixture(
        &["acquire_mcp", "stop"],
        false,
        vec![Arc::new(FailedCleanup)],
    )
    .await;
    assert_eq!(outcome.status, "failed");
    assert!(outcome.summary.contains("cleanup incomplete"));
    assert!(events.iter().any(|event|matches!(event,WorkerEvent::Diagnostic {kind,detail_json,..} if kind=="harness/provider" && detail_json.contains("close_failed"))));
}
