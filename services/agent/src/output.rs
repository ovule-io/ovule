//! Bounded message-block projection shared by model and external-driver adapters.
use ovule_agent_api::WorkerEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, sync::Arc};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageBlockEvent {
    pub id: String,
    pub kind: String,
    pub data: Value,
}
fn may_contain_message_block(output: &str) -> bool {
    output.contains("```ovule-block")
}

pub fn project_message_blocks(
    attempt_id: &str,
    summary: &str,
    allowed_kinds: &BTreeSet<String>,
    notify: &Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    replace_stream: bool,
) -> String {
    let (markdown, blocks) = extract_message_blocks(summary, allowed_kinds);
    if replace_stream && (!blocks.is_empty() || may_contain_message_block(summary)) {
        notify(WorkerEvent::ReplaceOutput {
            attempt_id: attempt_id.to_owned(),
            content: markdown.clone(),
        });
    }
    if blocks.is_empty() {
        return summary.to_owned();
    }
    for block in blocks {
        if let Ok(data_json) = serde_json::to_string(&block.data) {
            notify(WorkerEvent::MessageBlock {
                attempt_id: attempt_id.to_owned(),
                block_id: block.id,
                kind: block.kind,
                data_json,
            });
        }
    }
    markdown
}

pub(crate) fn extract_message_blocks(
    source: &str,
    allowed_kinds: &BTreeSet<String>,
) -> (String, Vec<MessageBlockEvent>) {
    const OPEN: &str = "```ovule-block";
    const CLOSE: &str = "```";
    const MAX_BLOCKS: usize = 32;
    let mut output = String::with_capacity(source.len());
    let mut blocks = Vec::new();
    let mut cursor = 0;
    while blocks.len() < MAX_BLOCKS {
        let Some(relative_start) = source[cursor..].find(OPEN) else {
            break;
        };
        let start = cursor + relative_start;
        let body_start = start + OPEN.len();
        let body_start = body_start
            + source[body_start..].strip_prefix("\r\n").map_or_else(
                || usize::from(source[body_start..].starts_with('\n')),
                |_| 2,
            );
        let Some(relative_end) = source[body_start..].find(CLOSE) else {
            break;
        };
        let end = body_start + relative_end;
        let body = source[body_start..end].trim();
        let parsed = (body.len() <= 256 * 1024)
            .then(|| serde_json::from_str::<MessageBlockEvent>(body))
            .transpose()
            .ok()
            .flatten()
            .filter(|block| {
                allowed_kinds.contains(&block.kind)
                    && valid_message_block_id(&block.id)
                    && serde_json::to_vec(&block.data)
                        .is_ok_and(|encoded| encoded.len() <= 256 * 1024)
            });
        if let Some(block) = parsed {
            output.push_str(&source[cursor..start]);
            blocks.push(block);
            cursor = end + CLOSE.len();
        } else {
            output.push_str(&source[cursor..end + CLOSE.len()]);
            cursor = end + CLOSE.len();
        }
    }
    output.push_str(&source[cursor..]);
    let markdown = output.trim().to_owned();
    (
        if markdown.is_empty() {
            "Interactive result ready.".to_owned()
        } else {
            markdown
        },
        blocks,
    )
}

fn valid_message_block_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}
