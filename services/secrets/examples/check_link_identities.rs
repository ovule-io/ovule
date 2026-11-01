//! Read-only recovery verification. Arguments: data directory, original public-ID JSON.
use ovule_secrets::SecretStore as _;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err("Usage: check_link_identities DATA_ROOT ORIGINAL_PUBLIC_IDS_JSON".into());
    }
    let store = ovule_secrets::providers::open(std::path::Path::new(&args[0]))?;
    let expected: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    for id in ["link-host", "link-client"] {
        let encoded = store
            .load_workspace_credential(&format!("workspace:{id}"))?
            .ok_or("existing Link identity is missing")?;
        let key: iroh::SecretKey = serde_json::from_str(&encoded)?;
        if expected[format!("workspace-{id}.dpapi")] != key.public().to_string() {
            return Err(format!("original {id} public identity does not match").into());
        }
        println!("{id}: original public identity verified");
    }
    Ok(())
}
