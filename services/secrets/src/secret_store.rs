use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub(super) struct NativeSecretStore {
    root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ChannelCredentials {
    pub app_id: String,
    pub app_secret: String,
    pub owner_id: Option<String>,
    pub provisioned: bool,
}

impl NativeSecretStore {
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn new(data_root: &Path) -> Result<Self, String> {
        let root = data_root.join("secrets");
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("create Ovule secret directory: {error}"))?;
        Ok(Self { root })
    }

    pub fn save_channel(
        &self,
        connection_id: &str,
        app_id: &str,
        app_secret: &str,
        owner_id: Option<&str>,
        provisioned: bool,
    ) -> Result<(), String> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret,
            "owner_id": owner_id,
            "provisioned": provisioned,
        }))
        .map_err(|error| format!("encode Channel credentials: {error}"))?;
        let protected = protect(&payload)?;
        let file = channel_credential_file(connection_id)?;
        let path = self.root.join(&file);
        let temporary = self.root.join(format!("{file}.tmp"));
        std::fs::write(&temporary, protected)
            .map_err(|error| format!("write encrypted Channel credentials: {error}"))?;
        ovule_platform::files::replace(&temporary, &path)
            .map_err(|error| format!("commit encrypted Channel credentials: {error}"))
    }

    pub fn load_channel(&self, connection_id: &str) -> Result<Option<ChannelCredentials>, String> {
        let file = channel_credential_file(connection_id)?;
        let path = self.root.join(file);
        let protected = match std::fs::read(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("read encrypted Channel credentials: {error}")),
        };
        let payload = unprotect(&protected)?;
        let value: serde_json::Value = serde_json::from_slice(&payload)
            .map_err(|error| format!("decode Channel credentials: {error}"))?;
        let app_id = value
            .get("app_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "encrypted Channel App ID is missing".to_owned())?;
        let app_secret = value
            .get("app_secret")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "encrypted Channel App Secret is missing".to_owned())?;
        let owner_id = value
            .get("owner_id")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let provisioned = value
            .get("provisioned")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        Ok(Some(ChannelCredentials {
            app_id: app_id.to_owned(),
            app_secret: app_secret.to_owned(),
            owner_id,
            provisioned,
        }))
    }

    pub fn save_provider_credential(&self, name: &str, value: &str) -> Result<(), String> {
        let file = provider_credential_file(name)?;
        let protected = protect(value.as_bytes())?;
        let path = self.root.join(file);
        let temporary = path.with_extension("dpapi.tmp");
        std::fs::write(&temporary, protected)
            .map_err(|error| format!("write encrypted provider credential: {error}"))?;
        ovule_platform::files::replace(&temporary, &path)
            .map_err(|error| format!("commit encrypted provider credential: {error}"))
    }

    pub fn load_provider_credential(&self, name: &str) -> Result<Option<OsString>, String> {
        let path = self.root.join(provider_credential_file(name)?);
        let protected = match std::fs::read(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("read encrypted provider credential: {error}")),
        };
        let plain = unprotect(&protected)?;
        let value = String::from_utf8(plain)
            .map_err(|_| "encrypted provider credential is not valid UTF-8".to_owned())?;
        Ok(Some(OsString::from(value)))
    }

    pub fn has_provider_credential(&self, name: &str) -> Result<bool, String> {
        Ok(self.load_provider_credential(name)?.is_some())
    }

    pub fn save_workspace_credential(&self, id: &str, value: &str) -> Result<String, String> {
        let file = workspace_credential_file(id)?;
        let protected = protect(value.as_bytes())?;
        let path = self.root.join(&file);
        let temporary = path.with_extension("dpapi.tmp");
        std::fs::write(&temporary, protected)
            .map_err(|error| format!("write encrypted Workspace credential: {error}"))?;
        ovule_platform::files::replace(&temporary, &path)
            .map_err(|error| format!("commit encrypted Workspace credential: {error}"))?;
        Ok(format!("workspace:{id}"))
    }

    pub fn load_workspace_credential(&self, reference: &str) -> Result<Option<String>, String> {
        let id = reference
            .strip_prefix("workspace:")
            .ok_or_else(|| "invalid Workspace credential reference".to_owned())?;
        let path = self.root.join(workspace_credential_file(id)?);
        let protected = match std::fs::read(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("read encrypted Workspace credential: {error}")),
        };
        String::from_utf8(unprotect(&protected)?)
            .map(Some)
            .map_err(|_| "encrypted Workspace credential is not valid UTF-8".to_owned())
    }

    pub fn load_or_create_workspace_identity(&self, id: &str) -> Result<String, String> {
        let reference = format!("workspace:{id}");
        if let Some(value) = self.load_workspace_credential(&reference)? {
            return Ok(value);
        }
        let secret = iroh::SecretKey::generate();
        let value = serde_json::to_string(&secret)
            .map_err(|error| format!("encode Workspace identity: {error}"))?;
        self.save_workspace_credential(id, &value)?;
        Ok(value)
    }

    pub fn reset_workspace_identity(&self, id: &str) -> Result<(), String> {
        let secret = iroh::SecretKey::generate();
        let value = serde_json::to_string(&secret)
            .map_err(|error| format!("encode replacement Workspace identity: {error}"))?;
        self.save_workspace_credential(id, &value)?;
        Ok(())
    }
}

fn workspace_credential_file(id: &str) -> Result<String, String> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("invalid Workspace credential ID".to_owned());
    }
    Ok(format!("workspace-{id}.dpapi"))
}

fn channel_credential_file(connection_id: &str) -> Result<String, String> {
    if connection_id.is_empty()
        || connection_id.len() > 64
        || !connection_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("invalid Channel connection ID".to_owned());
    }
    Ok(format!("channel-{connection_id}.dpapi"))
}

fn provider_credential_file(name: &str) -> Result<&'static str, String> {
    match name {
        "DEEPSEEK_API_KEY" => Ok("provider-deepseek-api-key.dpapi"),
        "OVULE_CLOUDFLARE_TURN" => Ok("provider-cloudflare-turn.dpapi"),
        _ => Err(format!("unsupported provider credential: {name}")),
    }
}

#[cfg(windows)]
fn protect(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData,
    };

    let length = u32::try_from(value.len()).map_err(|_| "secret is too large".to_owned())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: value.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: DPAPI reads the input slice during this call and allocates the
    // output buffer, which is copied before being released with LocalFree.
    let result = unsafe {
        CryptProtectData(
            &raw const input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &raw mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "protect credentials with DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: CryptProtectData returned a valid buffer of cbData bytes.
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    // SAFETY: DPAPI allocates the buffer with LocalAlloc.
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(protected)
}

#[cfg(windows)]
fn unprotect(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
    };

    let length =
        u32::try_from(value.len()).map_err(|_| "encrypted secret is too large".to_owned())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: value.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: DPAPI reads the input slice during this call and allocates the
    // output buffer, which is copied before being released with LocalFree.
    let result = unsafe {
        CryptUnprotectData(
            &raw const input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &raw mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "decrypt credentials with DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: CryptUnprotectData returned a valid buffer of cbData bytes.
    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    // SAFETY: DPAPI allocates the buffer with LocalAlloc.
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(plain)
}

#[cfg(target_os = "macos")]
fn protect(value: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    const HEADER: &[u8] = b"ovule-keychain-v1\0";
    let key = macos_encryption_key(true)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "initialize macOS credential encryption".to_owned())?;
    let mut nonce = [0_u8; 12];
    security_framework::random::SecRandom::default()
        .copy_bytes(&mut nonce)
        .map_err(|error| format!("generate macOS credential nonce: {error}"))?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), value)
        .map_err(|_| "encrypt credentials with macOS Keychain key".to_owned())?;
    let mut protected = Vec::with_capacity(HEADER.len() + nonce.len() + encrypted.len());
    protected.extend_from_slice(HEADER);
    protected.extend_from_slice(&nonce);
    protected.extend_from_slice(&encrypted);
    Ok(protected)
}

#[cfg(target_os = "macos")]
fn unprotect(value: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    const HEADER: &[u8] = b"ovule-keychain-v1\0";
    let encrypted = value
        .strip_prefix(HEADER)
        .ok_or_else(|| "unsupported macOS credential format".to_owned())?;
    let (nonce, ciphertext) = encrypted
        .split_at_checked(12)
        .ok_or_else(|| "invalid macOS credential payload".to_owned())?;
    let key = macos_encryption_key(false)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "initialize macOS credential decryption".to_owned())?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "decrypt credentials with macOS Keychain key".to_owned())
}

#[cfg(target_os = "macos")]
fn macos_encryption_key(create: bool) -> Result<Vec<u8>, String> {
    macos_encryption_key_for_service(ovule_platform::identity::APPLICATION_ID, create)
}

#[cfg(target_os = "macos")]
fn macos_encryption_key_for_service(service: &str, create: bool) -> Result<Vec<u8>, String> {
    use security_framework::os::macos::keychain::SecKeychain;

    const ACCOUNT: &str = "credential-encryption-key-v1";
    let keychain =
        SecKeychain::default().map_err(|error| format!("open default macOS Keychain: {error}"))?;
    match keychain.find_generic_password(service, ACCOUNT) {
        Ok((key, _)) if key.len() == 32 => return Ok(key.to_vec()),
        Ok(_) => return Err("macOS Keychain contains an invalid Ovule key".to_owned()),
        Err(error) if error.code() != -25_300 => {
            return Err(format!("read Ovule key from macOS Keychain: {error}"));
        }
        Err(_) => {}
    }
    if !create {
        return Err(
            "Ovule encryption key is missing from macOS Keychain; restore the original key to recover existing credentials without resetting Link identities"
                .to_owned(),
        );
    }
    let mut key = vec![0_u8; 32];
    security_framework::random::SecRandom::default()
        .copy_bytes(&mut key)
        .map_err(|error| format!("generate macOS credential key: {error}"))?;
    match keychain.add_generic_password(service, ACCOUNT, &key) {
        Ok(()) => Ok(key),
        // First launch may initialize credentials in multiple callers at once.
        // Always use the winning key instead of encrypting with the losing candidate.
        Err(error) if error.code() == -25_299 => {
            let (existing, _) = keychain
                .find_generic_password(service, ACCOUNT)
                .map_err(|error| format!("read Ovule key from macOS Keychain: {error}"))?;
            if existing.len() != 32 {
                return Err("macOS Keychain contains an invalid Ovule key".to_owned());
            }
            Ok(existing.to_vec())
        }
        Err(error) => Err(format!("save Ovule key in macOS Keychain: {error}")),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn protect(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure channel credential storage is not implemented on this platform".to_owned())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn unprotect(_value: &[u8]) -> Result<Vec<u8>, String> {
    Err("secure channel credential storage is not implemented on this platform".to_owned())
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::{protect, unprotect};

    #[test]
    fn keychain_backed_credentials_round_trip() {
        let plain = b"Ovule credential test";
        let protected = protect(plain).expect("protect credential");
        assert_ne!(protected, plain);
        assert_eq!(unprotect(&protected).expect("unprotect credential"), plain);
    }

    #[test]
    fn reading_a_missing_key_does_not_create_a_replacement() {
        let service = format!(
            "io.ovule.test.missing-key.{}.{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        );
        let error = super::macos_encryption_key_for_service(&service, false).unwrap_err();
        assert!(error.contains("restore the original key"));
        let keychain = security_framework::os::macos::keychain::SecKeychain::default().unwrap();
        let error = keychain
            .find_generic_password(&service, "credential-encryption-key-v1")
            .err()
            .expect("read-only lookup must not create a key");
        assert_eq!(error.code(), -25_300);
    }
}

#[cfg(all(test, any(windows, target_os = "macos")))]
mod identity_tests {
    use super::NativeSecretStore;

    #[test]
    fn resetting_workspace_identity_replaces_the_private_key() {
        let directory = tempfile::tempdir().unwrap();
        let store = NativeSecretStore::new(directory.path()).unwrap();
        let first = store
            .load_or_create_workspace_identity("link-host")
            .unwrap();
        store.reset_workspace_identity("link-host").unwrap();
        let second = store
            .load_or_create_workspace_identity("link-host")
            .unwrap();
        assert_ne!(first, second);
    }
}

pub trait SecretStore: Send + Sync {
    fn root(&self) -> &Path;
    fn save_channel(
        &self,
        connection_id: &str,
        app_id: &str,
        app_secret: &str,
        owner_id: Option<&str>,
        provisioned: bool,
    ) -> Result<(), String>;
    fn load_channel(&self, connection_id: &str) -> Result<Option<ChannelCredentials>, String>;
    fn save_provider_credential(&self, name: &str, value: &str) -> Result<(), String>;
    fn load_provider_credential(&self, name: &str) -> Result<Option<OsString>, String>;
    fn has_provider_credential(&self, name: &str) -> Result<bool, String>;
    fn save_workspace_credential(&self, id: &str, value: &str) -> Result<String, String>;
    fn load_workspace_credential(&self, reference: &str) -> Result<Option<String>, String>;
    fn load_or_create_workspace_identity(&self, id: &str) -> Result<String, String>;
    fn reset_workspace_identity(&self, id: &str) -> Result<(), String>;
}
impl SecretStore for NativeSecretStore {
    fn root(&self) -> &Path {
        NativeSecretStore::root(self)
    }
    fn save_channel(
        &self,
        connection_id: &str,
        app_id: &str,
        app_secret: &str,
        owner_id: Option<&str>,
        provisioned: bool,
    ) -> Result<(), String> {
        NativeSecretStore::save_channel(
            self,
            connection_id,
            app_id,
            app_secret,
            owner_id,
            provisioned,
        )
    }
    fn load_channel(&self, connection_id: &str) -> Result<Option<ChannelCredentials>, String> {
        NativeSecretStore::load_channel(self, connection_id)
    }
    fn save_provider_credential(&self, name: &str, value: &str) -> Result<(), String> {
        NativeSecretStore::save_provider_credential(self, name, value)
    }
    fn load_provider_credential(&self, name: &str) -> Result<Option<OsString>, String> {
        NativeSecretStore::load_provider_credential(self, name)
    }
    fn has_provider_credential(&self, name: &str) -> Result<bool, String> {
        NativeSecretStore::has_provider_credential(self, name)
    }
    fn save_workspace_credential(&self, id: &str, value: &str) -> Result<String, String> {
        NativeSecretStore::save_workspace_credential(self, id, value)
    }
    fn load_workspace_credential(&self, reference: &str) -> Result<Option<String>, String> {
        NativeSecretStore::load_workspace_credential(self, reference)
    }
    fn load_or_create_workspace_identity(&self, id: &str) -> Result<String, String> {
        NativeSecretStore::load_or_create_workspace_identity(self, id)
    }
    fn reset_workspace_identity(&self, id: &str) -> Result<(), String> {
        NativeSecretStore::reset_workspace_identity(self, id)
    }
}

#[cfg(test)]
mod provider_reference_tests {
    #[test]
    fn connection_configuration_has_a_fixed_secret_path() {
        assert_eq!(
            super::provider_credential_file("OVULE_CLOUDFLARE_TURN").unwrap(),
            "provider-cloudflare-turn.dpapi"
        );
        assert!(super::provider_credential_file("../OVULE_CLOUDFLARE_TURN").is_err());
    }
}
