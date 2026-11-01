//! Bounded display previews, separate from body-free execution diagnostics.
use super::ToolFailure;
use serde_json::{Map, Value};

const REDACTED: &str = "[redacted]";
const OMITTED: &str = "[omitted]";

pub(super) struct Details {
    secrets: Vec<String>,
    pub input: Value,
}
impl Details {
    pub fn new(arguments: &Value) -> Self {
        let mut secrets = Vec::new();
        collect_secrets(arguments, &mut secrets, 0);
        let mut details = Self {
            secrets,
            input: Value::Null,
        };
        details.input = details.preview(arguments);
        details
    }
    /// Bound and redact the settled result before updating a user-visible tool card.
    pub fn record_result<T>(
        &self,
        card: &mut Value,
        project: fn(&T) -> &Value,
        result: &Result<T, ToolFailure>,
    ) {
        match result {
            Ok(value) => card["output"] = self.preview(project(value)),
            Err(error) => {
                if let Ok(value) = serde_json::from_str::<Value>(&error.message)
                    && value.get("isError").and_then(Value::as_bool) == Some(true)
                {
                    card["output"] = self.preview(&value);
                }
                card["error"] = self.preview(&Value::String(error.to_string()));
                card["failureKind"] = Value::String(format!("{:?}", error.kind));
            }
        }
    }
    pub fn preview(&self, value: &Value) -> Value {
        project(value, &self.secrets, &mut 8192, 0)
    }
}
fn private_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace(['_', '-'], "");
    [
        "secret",
        "token",
        "password",
        "credential",
        "authorization",
        "apikey",
        "cookie",
    ]
    .iter()
    .any(|part| key.contains(part))
        || matches!(key.as_str(), "env" | "environment" | "credentialenv")
}
fn collect_secrets(value: &Value, secrets: &mut Vec<String>, depth: usize) {
    if depth > 8 || secrets.len() >= 64 {
        return;
    }
    match value {
        Value::Object(fields) => {
            for (key, value) in fields.iter().take(64) {
                if private_key(key) {
                    collect_strings(value, secrets, depth + 1);
                } else {
                    collect_secrets(value, secrets, depth + 1);
                }
            }
        }
        Value::Array(items) => {
            for value in items.iter().take(32) {
                collect_secrets(value, secrets, depth + 1);
            }
        }
        _ => {}
    }
}
fn collect_strings(value: &Value, secrets: &mut Vec<String>, depth: usize) {
    if depth > 8 || secrets.len() >= 64 {
        return;
    }
    match value {
        Value::String(text) if !text.is_empty() => secrets.push(text.clone()),
        Value::Object(fields) => {
            for value in fields.values().take(64) {
                collect_strings(value, secrets, depth + 1);
            }
        }
        Value::Array(items) => {
            for value in items.iter().take(32) {
                collect_strings(value, secrets, depth + 1);
            }
        }
        _ => {}
    }
}
fn project(value: &Value, secrets: &[String], remaining: &mut usize, depth: usize) -> Value {
    if depth > 8 || *remaining == 0 {
        return Value::String(OMITTED.into());
    }
    *remaining = remaining.saturating_sub(1);
    match value {
        Value::Object(fields) => {
            let mut result = Map::new();
            for (key, value) in fields.iter().take(64) {
                if *remaining == 0 {
                    result.insert("previewTruncated".into(), Value::Bool(true));
                    break;
                }
                let label: String = key.chars().take(128.min(*remaining)).collect();
                *remaining = remaining.saturating_sub(label.chars().count());
                let value = if private_key(key) {
                    Value::String(REDACTED.into())
                } else if matches!(
                    key.as_str(),
                    "data" | "data_base64" | "dataBase64" | "base64" | "clipboardData"
                ) {
                    Value::String(OMITTED.into())
                } else {
                    project(value, secrets, remaining, depth + 1)
                };
                result.insert(label, value);
            }
            if fields.len() > 64 {
                result.insert("previewTruncated".into(), Value::Bool(true));
            }
            Value::Object(result)
        }
        Value::Array(items) => {
            let mut result = Vec::new();
            for value in items.iter().take(32) {
                if *remaining == 0 {
                    break;
                }
                result.push(project(value, secrets, remaining, depth + 1));
            }
            if result.len() < items.len() {
                result.push(Value::String(OMITTED.into()));
            }
            Value::Array(result)
        }
        Value::String(text) => {
            // Redact known input credentials before truncating an echoed value.
            let mut clean = text.clone();
            for secret in secrets {
                clean = clean.replace(secret, REDACTED);
            }
            if clean.starts_with("data:") {
                return Value::String(OMITTED.into());
            }
            let limit = 2048.min(*remaining);
            let mut preview: String = clean.chars().take(limit).collect();
            *remaining = remaining.saturating_sub(preview.chars().count());
            if clean.chars().count() > limit {
                preview.push_str("… [truncated]");
            }
            Value::String(preview)
        }
        _ => value.clone(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn previews_redact_credentials_echoes_and_media_with_bounded_output() {
        let details = Details::new(
            &json!({"action":"type", "token":"private-key", "env":{"OTHER":"env-secret"}}),
        );
        assert_eq!(details.input["action"], "type");
        assert_eq!(details.input["token"], REDACTED);
        let output = details.preview(&json!({"error":"failed private-key env-secret", "content":[{"type":"image","data":"x".repeat(1_000_000)}],"stdout":"x".repeat(50_000)}));
        assert!(!output.to_string().contains("private-key"));
        assert!(!output.to_string().contains("env-secret"));
        assert_eq!(output["content"][0]["data"], OMITTED);
        assert!(output.to_string().len() < 16_000);
    }
}
