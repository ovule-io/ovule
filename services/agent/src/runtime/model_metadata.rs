//! Optional remote model metadata and output-budget policy. This is not the Attempt tool registry.
//! Discovery is process-local, bounded and credential-isolated.
use serde_json::Value;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

/// Limits and options advertised by the remote model endpoint; never a tool grant.
#[derive(Clone, Debug, Default)]
pub(super) struct ModelMetadata {
    pub max_output_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub effort: Option<Value>,
}

#[derive(Clone)]
struct Cached {
    checked: Instant,
    metadata: Option<ModelMetadata>,
}
type Entry = Arc<tokio::sync::Mutex<Option<Cached>>>;
type CacheKey = (String, String, String, u64);
type Cache = Mutex<HashMap<CacheKey, Entry>>;
static CACHE: OnceLock<Cache> = OnceLock::new();

fn parse_models(value: &Value, model: &str) -> Option<ModelMetadata> {
    let entry = value
        .get("data")?
        .as_array()?
        .iter()
        .find(|entry| entry["id"].as_str() == Some(model))?;
    let positive = |name| entry.get(name).and_then(Value::as_u64).filter(|n| *n > 0);
    Some(ModelMetadata {
        max_output_tokens: positive("max_output_tokens"),
        context_window: positive("context_window"),
        effort: entry
            .get("effort")
            .filter(|value| value.is_object())
            .cloned(),
    })
}

async fn fetch(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    model: &str,
) -> Option<ModelMetadata> {
    let mut response = client
        .get(format!("{}/models", base.trim_end_matches('/')))
        .bearer_auth(key)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    // Do not buffer unbounded responses from compatible/custom endpoints.
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len().saturating_add(chunk.len()) > 1_048_576 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_models(&serde_json::from_slice::<Value>(&bytes).ok()?, model)
}

pub(super) async fn discover(
    client: &reqwest::Client,
    provider: &str,
    base: &str,
    key: &str,
    model: &str,
) -> (Option<ModelMetadata>, &'static str) {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    let cache_key = (
        provider.to_owned(),
        base.trim_end_matches('/').to_owned(),
        model.to_owned(),
        hasher.finish(),
    );
    let entry = {
        let mut cache = CACHE
            .get_or_init(Mutex::default)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cache.len() >= 128 && !cache.contains_key(&cache_key) {
            cache.retain(|_, entry| Arc::strong_count(entry) > 1);
            if cache.len() >= 128 {
                let victim = cache.keys().next().cloned().unwrap();
                cache.remove(&victim);
            }
        }
        cache
            .entry(cache_key)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(None)))
            .clone()
    };
    // One in-flight discovery per key; unrelated providers do not block each other.
    let mut slot = entry.lock().await;
    if let Some(cached) = slot.as_ref() {
        let ttl = if cached.metadata.is_some() {
            Duration::from_secs(3600)
        } else {
            Duration::from_secs(60)
        };
        if cached.checked.elapsed() < ttl {
            return (
                cached.metadata.clone(),
                if cached.metadata.is_some() {
                    "cache"
                } else {
                    "unavailable_cache"
                },
            );
        }
    }
    let metadata = tokio::time::timeout(Duration::from_secs(3), fetch(client, base, key, model))
        .await
        .ok()
        .flatten();
    *slot = Some(Cached {
        checked: Instant::now(),
        metadata: metadata.clone(),
    });
    let source = if metadata.is_some() {
        "discovery"
    } else {
        "unavailable"
    };
    (metadata, source)
}

pub(super) fn output_budget(
    provider: &str,
    metadata: Option<&ModelMetadata>,
    recovery: bool,
) -> Option<u64> {
    if recovery {
        return Some(
            metadata
                .and_then(|c| c.max_output_tokens)
                .unwrap_or(8192)
                .min(8192),
        );
    }
    if metadata.is_some() || provider == "deepseek" {
        // Server defaults include its thinking-mode policy, which max_output_tokens does not describe.
        None
    } else {
        // Preserve compatibility with older endpoints lacking model discovery.
        Some(8192)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_preserves_optional_metadata_and_server_defaults() {
        let value = serde_json::json!({"data":[{"id":"new-model","max_output_tokens":123_456,"context_window":999_999,"effort":{"supported_levels":["high"]}}]});
        let caps = parse_models(&value, "new-model").unwrap();
        assert_eq!(caps.max_output_tokens, Some(123_456));
        assert_eq!(caps.context_window, Some(999_999));
        assert!(caps.effort.is_some());
        assert_eq!(output_budget("custom", Some(&caps), false), None);
        assert_eq!(output_budget("deepseek", None, false), None);
        assert_eq!(output_budget("custom", None, false), Some(8192));
        assert!(parse_models(&value, "missing").is_none());
        let caps = parse_models(
            &serde_json::json!({"data":[{"id":"old","max_output_tokens":0,"context_window":-1}]}),
            "old",
        )
        .unwrap();
        assert!(caps.max_output_tokens.is_none());
        assert!(caps.context_window.is_none());
        assert_eq!(
            output_budget(
                "custom",
                Some(&ModelMetadata {
                    max_output_tokens: Some(1024),
                    ..Default::default()
                }),
                true
            ),
            Some(1024)
        );
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires isolated loopback HTTP"]
    async fn model_metadata_cache_isolates_credentials_and_caches_failures() {
        use std::io::{Read, Write};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}/v1/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("discovery fixture: {error}"),
                    }
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut headers = Vec::new();
                while !headers.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    headers.push(byte[0]);
                }
                assert!(String::from_utf8_lossy(&headers).starts_with("GET /v1/models "));
                let (status, body) = if index < 2 {
                    (
                        "200 OK",
                        r#"{"data":[{"id":"dynamic-model","max_output_tokens":2048}]}"#,
                    )
                } else {
                    ("503 Service Unavailable", "unavailable")
                };
                write!(
                    socket,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let (first, source) =
            discover(&client, "custom", &base, "account-a", "dynamic-model").await;
        assert_eq!(source, "discovery");
        assert_eq!(first.unwrap().max_output_tokens, Some(2048));
        // Concurrent callers reuse the result; changing credentials causes a new request.
        let (a, b) = tokio::join!(
            discover(&client, "custom", &base, "account-a", "dynamic-model"),
            discover(&client, "custom", &base, "account-a", "dynamic-model")
        );
        assert_eq!(a.1, "cache");
        assert_eq!(b.1, "cache");
        assert_eq!(
            discover(&client, "custom", &base, "account-b", "dynamic-model")
                .await
                .1,
            "discovery"
        );
        let failed = discover(&client, "custom", &base, "account-c", "dynamic-model").await;
        assert!(failed.0.is_none());
        assert_eq!(failed.1, "unavailable");
        assert_eq!(
            discover(&client, "custom", &base, "account-c", "dynamic-model")
                .await
                .1,
            "unavailable_cache"
        );
        server.join().unwrap();
    }
}
