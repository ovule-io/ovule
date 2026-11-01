//! Diagnose an existing Host; desktop startup/capture checks require an explicit flag.
use ovule_secrets::SecretStore as _;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() < 2
        || args.len() > 3
        || (args.len() == 3 && args[2] != "--desktop-start" && args[2] != "--capture-check")
    {
        return Err(
            "Usage: probe_link_host DATA_ROOT ENDPOINT_JSON [--desktop-start|--capture-check] (use matching Release/Debug profile)"
                .into(),
        );
    }
    let endpoint: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let store = ovule_secrets::providers::open(std::path::Path::new(&args[0]))?;
    let reference = endpoint["credential_ref"]
        .as_str()
        .ok_or("missing identity reference")?;
    let client_secret = store
        .load_workspace_credential(reference)?
        .ok_or("identity missing")?;
    let host = ovule_hosts::providers::tunnel(ovule_hosts::TunnelClientConfig {
        endpoint_addr: serde_json::from_str(
            endpoint["host"].as_str().ok_or("missing Host route")?,
        )?,
        share_id: String::new(),
        client_secret,
    });
    let started = std::time::Instant::now();
    match tokio::time::timeout(std::time::Duration::from_secs(30), host.hello()).await {
        Ok(Ok(hello)) => println!(
            "{}",
            serde_json::json!({
                "authenticated": true,
                "elapsed_ms": started.elapsed().as_millis(),
                "platform": hello.platform,
                "desktop_control": hello.capabilities.iter().any(|value| value == "desktop.control"),
            })
        ),
        Ok(Err(error)) => {
            return Err(format!(
                "Link handshake failed after {} ms: {error}",
                started.elapsed().as_millis()
            )
            .into());
        }
        Err(_) => return Err("Link handshake did not complete within 30 seconds".into()),
    }
    if args.len() == 3 && args[2] == "--capture-check" {
        let started_at = std::time::Instant::now();
        let snapshot = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            host.computer_use_snapshot(None),
        )
        .await??;
        println!(
            "{}",
            serde_json::json!({
                "host_capture_succeeded": true,
                "elapsed_ms": started_at.elapsed().as_millis(),
                "width": snapshot.width,
                "height": snapshot.height,
                "image_present": !snapshot.data_base64.is_empty(),
            })
        );
    }
    if args.len() == 3 && args[2] == "--desktop-start" {
        let started_at = std::time::Instant::now();
        let request = ovule_remoting::model::StartRequest {
            auth_key: format!(
                "{:032x}{:032x}",
                rand::random::<u128>(),
                rand::random::<u128>()
            ),
            max_bitrate_kbps: None,
            target_framerate: None,
            screen_id: None,
        };
        let session = host.start(request).await?;
        println!(
            "{}",
            serde_json::json!({
                "desktop_started": true,
                "elapsed_ms": started_at.elapsed().as_millis(),
                "turn_servers_present": session.ice_servers.iter().any(|server| server.urls.iter().any(|url| url.starts_with("turn:") || url.starts_with("turns:"))),
                "connectivity_warning_present": session.connectivity_warning.is_some(),
            })
        );
        host.stop(session.id).await?;
        println!("diagnostic_desktop_session_stopped=true");
    }
    Ok(())
}
