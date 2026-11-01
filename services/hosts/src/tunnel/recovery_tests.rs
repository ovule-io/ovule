use super::*;

async fn call(host: &NativeTunnelHost, token: &str, operation: TunnelOperation) -> TunnelResponse {
    serve(
        TunnelServeContext {
            access: &host.handle.access,
            access_path: &host.handle.access_path,
            managed_toolchains: &host.handle.managed_toolchains,
            remote_control: host.handle.remote_control.as_ref(),
            agent_runtime: host.handle.agent_runtime.as_deref(),
            control_sessions: host.handle.control_sessions.as_ref(),
            computer_use_mcp_endpoint: None,
            host_id: "receiving-host",
        },
        "client",
        TunnelRequest {
            share_id: token.into(),
            client_name: "Laptop".into(),
            operation,
        },
    )
    .await
}

#[tokio::test]
async fn repair_is_local_and_pairing_survives_receiver_restart() {
    let receiver_dir = tempfile::tempdir().unwrap();
    let receiver_secrets = Arc::new(ovule_secrets::providers::open(receiver_dir.path()).unwrap());
    let path = receiver_secrets.root().join("workspace-link-access.json");
    std::fs::write(&path, b"broken authorization file").unwrap();
    let receiver = NativeTunnelHost::new(receiver_secrets.clone());
    let client_dir = tempfile::tempdir().unwrap();
    let client = NativeTunnelHost::new(Arc::new(
        ovule_secrets::providers::open(client_dir.path()).unwrap(),
    ));
    client.handle.reset_access().unwrap();
    assert!(HostAccess::load(&path).requires_reset());
    let response = call(&receiver, "invitation", TunnelOperation::Hello).await;
    assert!(
        matches!(response, TunnelResponse::Error(message) if message.contains("receiving-host") && message.contains("resetting this Client cannot repair it"))
    );

    receiver.handle.repair_access().unwrap();
    drop(receiver);
    let receiver = NativeTunnelHost::new(receiver_secrets.clone());
    assert!(!lock(&receiver.handle.access).requires_reset());
    let token = lock(&receiver.handle.access).pairing_token.clone();
    assert!(matches!(
        call(&receiver, &token, TunnelOperation::Hello).await,
        TunnelResponse::Pending
    ));
    let code = lock(&receiver.handle.access).pending_clients["client"]
        .code
        .clone();
    assert!(matches!(
        call(&receiver, &token, TunnelOperation::Pair { code }).await,
        TunnelResponse::Ok(TunnelPayload::Empty)
    ));
    drop(receiver);
    let receiver = NativeTunnelHost::new(receiver_secrets);
    receiver.handle.repair_access().unwrap();
    assert_eq!(lock(&receiver.handle.access).pairing_token, token);
    assert!(lock(&receiver.handle.access).devices.contains_key("client"));
    assert!(matches!(
        call(&receiver, &token, TunnelOperation::Hello).await,
        TunnelResponse::Ok(TunnelPayload::Hello(_))
    ));
    assert!(
        matches!(call(&receiver, &token, TunnelOperation::Unsupported).await, TunnelResponse::Error(message) if message.contains("unsupported Link method"))
    );
    // An unknown future operation must not invalidate pairing or block known operations.
    assert!(matches!(
        call(&receiver, &token, TunnelOperation::Hello).await,
        TunnelResponse::Ok(TunnelPayload::Hello(_))
    ));
}
