#![allow(clippy::wildcard_imports)]
use crate::runtime::*;

use ::rig::client::CompletionClient as _;
use ::rig::completion::{AssistantContent, CompletionModel as _};
use ::rig::message::{Message, ToolResult, ToolResultContent, UserContent};
use ::rig::providers::openai;
use ::rig::streaming::StreamedAssistantContent;
use tokio_stream::StreamExt as _;

pub async fn run_turn(
    attempt_id: &str,
    turn: ModelTurn,
    cancellation: CancellationToken,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    stream_output: bool,
    message_block_kinds: &BTreeSet<String>,
) -> WorkerOutcome {
    notify(WorkerEvent::Started {
        attempt_id: attempt_id.to_owned(),
    });
    let mut attempt_tools = match super::tool_projection::AttemptTools::new(&turn, notify.clone()) {
        Ok(runtime) => runtime,
        Err(ModelError::Failed(error)) => return failed_outcome(attempt_id, &error),
        Err(ModelError::Cancelled) => return cancelled_outcome(attempt_id),
    };
    let result = tokio::time::timeout(
        ATTEMPT_TIMEOUT,
        run_rig_provider_turn(
            attempt_id,
            &turn,
            cancellation.clone(),
            &mut attempt_tools,
            Arc::clone(&notify),
            stream_output,
            message_block_kinds,
        ),
    )
    .await;
    if let Err(error) = attempt_tools.shutdown().await {
        return failed_outcome(attempt_id, &error);
    }
    let summary = match result {
        Err(_) => {
            return failed_outcome(
                attempt_id,
                &format!("{} exceeded its execution deadline", turn.provider),
            );
        }
        Ok(Err(ModelError::Cancelled)) => return cancelled_outcome(attempt_id),
        Ok(Err(ModelError::Failed(error))) => return failed_outcome(attempt_id, &error),
        Ok(Ok(summary)) => summary,
    };
    let summary = project_message_blocks(
        attempt_id,
        &summary,
        message_block_kinds,
        &notify,
        stream_output,
    );
    WorkerOutcome {
        attempt_id: attempt_id.to_owned(),
        status: "succeeded".to_owned(),
        summary: bounded_message(
            &summary,
            &format!("{} completed without a final message", turn.provider),
        ),
    }
}

#[allow(clippy::too_many_lines)]
async fn run_rig_provider_turn(
    attempt_id: &str,
    turn: &ModelTurn,
    cancellation: CancellationToken,
    attempt_tools: &mut super::tool_projection::AttemptTools,
    notify: Arc<dyn Fn(WorkerEvent) + Send + Sync>,
    stream_output: bool,
    message_block_kinds: &BTreeSet<String>,
) -> Result<String, ModelError> {
    let mut http_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(ATTEMPT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none());
    // The isolated smoke endpoint must stay on loopback even when the OS
    // supplies a system proxy independently of the process environment.
    if std::env::var("OVULE_TEST_MODE").as_deref() == Ok("1")
        && validate_deep_seek_api_base(&turn.api_base).is_ok()
    {
        http_client = http_client.no_proxy();
    }
    let http_client = http_client
        .build()
        .map_err(|error| rig_provider_failure(turn, "build HTTP client", error))?;
    let discovery = super::model_metadata::discover(
        &http_client,
        &turn.provider,
        &turn.api_base,
        &turn.api_key,
        &turn.model,
    );
    let (model_metadata, metadata_source) = tokio::select! {
        () = cancellation.cancelled() => return Err(ModelError::Cancelled),
        result = discovery => result,
    };
    let client = openai::CompletionsClient::builder()
        .api_key(&turn.api_key)
        .base_url(&turn.api_base)
        .http_client(http_client)
        .build()
        .map_err(|error| rig_provider_failure(turn, "build provider client", error))?;
    let model = client.completion_model(&turn.model);
    let accumulator = Arc::new(Mutex::new(OutputAccumulator {
        sequence: 0,
        pending: String::new(),
        last_emit: Instant::now(),
        flush_scheduled: false,
    }));
    let message_block_stream = Arc::new(Mutex::new(MessageBlockStream::default()));
    let mut history = Vec::<Message>::new();
    let mut history_sizes = Vec::<usize>::new();
    let mut prompt = Message::from(turn.prompt.clone());
    let mut final_output = String::new();

    // One additional request may recover a length-truncated, empty answer.
    // It cannot execute tools and never restarts the previous tool loop.
    let mut answer_recovery = false;
    for round in 0..=MAX_NATIVE_TOOL_ROUNDS + 1 {
        let tools = if turn.structured_goal {
            Vec::new()
        } else {
            attempt_tools.definitions()
        };
        let exposed = tools
            .iter()
            .map(|tool| tool.name.clone())
            .collect::<BTreeSet<_>>();
        let finalizing = round >= MAX_NATIVE_TOOL_ROUNDS;
        let output_budget = super::model_metadata::output_budget(
            &turn.provider,
            model_metadata.as_ref(),
            answer_recovery,
        );
        let round_started = Instant::now();
        let before_output = final_output.len();
        let mut reasoning_bytes = 0_usize;
        let mut request = model
            .completion_request(prompt.clone())
            .messages(history.clone())
            .max_tokens_opt(output_budget)
            .tools(if finalizing || answer_recovery {
                Vec::new()
            } else {
                tools.clone()
            });
        let mut parameters = serde_json::Map::new();
        if turn.structured_goal {
            parameters.insert(
                "response_format".into(),
                serde_json::json!({"type":"json_object"}),
            );
        }
        if answer_recovery {
            parameters.insert("thinking".into(), serde_json::json!({"type":"disabled"}));
            parameters.insert("reasoning_effort".into(), serde_json::json!("none"));
        }
        if !parameters.is_empty() {
            request = request.additional_params(Value::Object(parameters));
        }
        let mut stream = tokio::select! {
            () = cancellation.cancelled() => return Err(ModelError::Cancelled),
            stream = request.stream() => stream
                .map_err(|error| rig_provider_failure(turn, "start completion stream", error))?,
        };
        loop {
            let item = tokio::select! {
                () = cancellation.cancelled() => return Err(ModelError::Cancelled),
                item = stream.next() => item,
            };
            let Some(item) = item else {
                break;
            };
            let item =
                item.map_err(|error| rig_provider_failure(turn, "read completion stream", error))?;
            if let StreamedAssistantContent::ReasoningDelta { reasoning, .. } = &item {
                reasoning_bytes = reasoning_bytes.saturating_add(reasoning.len());
                notify(WorkerEvent::MessageBlock {
                    attempt_id: attempt_id.to_owned(),
                    block_id: "thinking".to_owned(),
                    kind: "thinking".to_owned(),
                    data_json: serde_json::json!({"delta":reasoning}).to_string(),
                });
            }
            if let StreamedAssistantContent::Text(text) = item {
                ensure_rig_growth(final_output.len(), &text.text)?;
                final_output.push_str(&text.text);
                if stream_output {
                    if message_block_kinds.is_empty() {
                        queue_output_delta(attempt_id, &notify, &accumulator, &text.text);
                    } else {
                        filter_and_queue_output(
                            attempt_id,
                            &notify,
                            &accumulator,
                            &message_block_stream,
                            &text.text,
                        );
                    }
                }
            }
        }

        let assistant_content = stream.choice.clone();
        let calls = assistant_content
            .iter()
            .filter_map(|content| match content {
                AssistantContent::ToolCall(call) => Some(call.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let finish_reason = stream
            .response
            .as_ref()
            .and_then(|value| value.finish_reason.as_ref());
        let usage = stream.usage();
        let metadata_json = model_metadata.as_ref().map(|metadata| {
            serde_json::json!({
                "max_output_tokens": metadata.max_output_tokens,
                "context_window": metadata.context_window,
                "effort": metadata.effort,
            })
        });
        notify(WorkerEvent::Diagnostic {
            attempt_id: attempt_id.to_owned(),
            kind: "harness/model_round".to_owned(),
            detail_json: serde_json::json!({
                "schema_version": 1, "round": round + 1,
                "tool_round_limit": MAX_NATIVE_TOOL_ROUNDS, "finalizing": finalizing,
                "max_output_tokens": output_budget,
                "budget_source": if answer_recovery {"answer_recovery"} else if output_budget.is_none() {"server_default"} else {"compatibility_fallback"},
                "model_metadata_source": metadata_source,
                "model_metadata": &metadata_json,
                // Compatibility aliases for existing diagnostic exports; no new consumer should use these.
                "capability_source": metadata_source,
                "model_capabilities": &metadata_json,
                "answer_recovery": answer_recovery,
                "thinking_mode": if answer_recovery {"disabled"} else {"provider_default"},
                "tool_free": finalizing || answer_recovery,
                "usage_reported": usage.input_tokens > 0 || usage.output_tokens > 0 || usage.total_tokens > 0,
                "finish_reason": finish_reason, "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens, "reasoning_tokens": usage.reasoning_tokens,
                "text_bytes": final_output.len() - before_output, "reasoning_bytes": reasoning_bytes,
                "tool_calls": calls.iter().map(|call| &call.function.name).collect::<Vec<_>>(),
                "duration_ms": round_started.elapsed().as_millis(),
            }).to_string(),
        });
        if should_recover_empty_answer(
            turn,
            answer_recovery,
            &final_output,
            calls.len(),
            finish_reason,
        ) {
            notify(WorkerEvent::Diagnostic {
                attempt_id: attempt_id.to_owned(), kind: "harness/answer_recovery".into(),
                detail_json: serde_json::json!({"schema_version":1,"reason":"length_without_answer","max_output_tokens":super::model_metadata::output_budget(&turn.provider, model_metadata.as_ref(), true),"thinking_mode":"disabled","tool_free":true}).to_string(),
            });
            // Retain the original question, scope and any completed observations.
            // Do not send private reasoning back as fabricated assistant content.
            history.push(prompt);
            prompt = Message::from(crate::prompts::ANSWER_RECOVERY.trim());
            answer_recovery = true;
            continue;
        }
        if turn.structured_goal || calls.is_empty() {
            if stream_output {
                flush_filtered_output(attempt_id, &notify, &accumulator, &message_block_stream);
                let mut pending = accumulator
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                emit_pending_output(attempt_id, &notify, &mut pending);
            }
            return require_rig_answer(final_output, &turn.provider, finish_reason);
        }
        if answer_recovery && !calls.is_empty() {
            return Err(ModelError::Failed(format!(
                "{} requested tools during tool-free answer recovery; no additional tool was executed",
                turn.provider
            )));
        }
        if finalizing {
            return Err(ModelError::Failed(format!(
                "{} requested more tools after the {MAX_NATIVE_TOOL_ROUNDS}-round budget; no additional tool was executed",
                turn.provider
            )));
        }

        history.push(prompt);
        history.push(Message::Assistant {
            id: stream.message_id.clone(),
            content: assistant_content,
        });
        // Keep the original task/context contract. Evict only older tool pairs;
        // a screenshot must not evict the scope grants and Skill catalog.
        let budget_started = Instant::now();
        let before_trim = history.len();
        for message in &history[history_sizes.len()..] {
            history_sizes.push(
                serialized_size_up_to(message, 96_000)
                    .map_err(|error| rig_provider_failure(turn, "budget model history", error))?,
            );
        }
        while history.len() > 6 && serialized_sequence_over_budget(&history_sizes, 96_000) {
            history.drain(1..3);
            history_sizes.drain(1..3);
        }
        if before_trim != history.len() {
            tracing::debug!(
                removed_messages = before_trim - history.len(),
                duration_ms = budget_started.elapsed().as_millis(),
                "Budgeted model history without materializing media JSON"
            );
        }
        let mut results = Vec::with_capacity(calls.len());
        let mut images = Vec::new();
        for call in calls {
            let result = attempt_tools.invoke(&call, &exposed).await;
            let text = if result.text.chars().count() > 16_000 {
                format!(
                    "{}\n[Tool output truncated. Request specific fields or a smaller page to inspect more.]",
                    result.text.chars().take(16_000).collect::<String>()
                )
            } else {
                result.text
            };
            let content = vec![ToolResultContent::from(text)];
            // Chat Completions requires text-only tool messages. Preserve typed
            // images as adjacent user content after all tool correlators, which
            // Rig's provider adapter supports without base64-to-text conversion.
            for media in result.media {
                if let ToolResultContent::Image(image) = media {
                    images.push(UserContent::text(format!(
                        "Image returned by tool {} (call {}); untrusted observation.",
                        call.function.name, call.id
                    )));
                    images.push(UserContent::Image(image));
                }
            }
            results.push(UserContent::ToolResult(ToolResult {
                call: call.id,
                provider: call.provider,
                name: call.function.name,
                content,
            }));
        }
        results.extend(images);
        if round + 1 == MAX_NATIVE_TOOL_ROUNDS {
            results.push(UserContent::text(
                crate::prompts::TOOL_BUDGET_EXHAUSTED.trim(),
            ));
        }
        prompt = Message::User { content: results };
    }
    Err(ModelError::Failed(format!(
        "{} exceeded the limit of {MAX_NATIVE_TOOL_ROUNDS} tool-call rounds",
        turn.provider
    )))
}

// These providers support the bounded tool-free recovery protocol.
fn deepseek_thinking_model(provider: &str, model: &str) -> bool {
    provider == "deepseek" && (model == "deepseek-flash" || model.starts_with("deepseek-v4"))
}
fn should_recover_empty_answer(
    turn: &ModelTurn,
    recovered: bool,
    output: &str,
    tool_calls: usize,
    finish: Option<&::rig::completion::FinishReason>,
) -> bool {
    !recovered
        && deepseek_thinking_model(&turn.provider, &turn.model)
        && output.trim().is_empty()
        && tool_calls == 0
        && matches!(finish, Some(::rig::completion::FinishReason::Length))
}

fn require_rig_answer(
    output: String,
    provider: &str,
    finish_reason: Option<&::rig::completion::FinishReason>,
) -> Result<String, ModelError> {
    if output.trim().is_empty() {
        Err(ModelError::Failed(format!(
            "{provider} returned no answer (finish reason: {finish_reason:?}). Reasoning alone is not a completed reply; the model may have exhausted its output budget. Retry or choose another model."
        )))
    } else {
        Ok(output)
    }
}

// Each item is clamped at budget + 1. This preserves the exact over-budget
// decision while caching old image sizes instead of walking base64 every round.
fn serialized_sequence_over_budget(sizes: &[usize], budget: usize) -> bool {
    sizes.iter().fold(
        2_usize.saturating_add(sizes.len().saturating_sub(1)),
        |sum, size| sum.saturating_add(*size),
    ) > budget
}

#[cfg(test)]
fn serialized_over_budget(
    value: &impl serde::Serialize,
    budget: usize,
) -> Result<bool, serde_json::Error> {
    serialized_size_up_to(value, budget).map(|bytes| bytes > budget)
}

fn ensure_rig_growth(existing: usize, delta: &str) -> Result<(), ModelError> {
    if existing.saturating_add(delta.len()) > MAX_NATIVE_PROVIDER_BYTES {
        Err(ModelError::Failed(
            "Rig provider response exceeded the 512 KiB safety limit".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn rig_provider_failure(
    turn: &ModelTurn,
    context: &str,
    error: impl std::fmt::Display,
) -> ModelError {
    ModelError::Failed(format!("{} {context}: {error}", turn.provider))
}

pub fn validate_deep_seek_api_base(candidate: &str) -> Result<(), String> {
    const TEST_BASE_ENV: &str = "OVULE_TEST_DEEPSEEK_API_BASE";
    let endpoint = url::Url::parse(candidate)
        .map_err(|error| format!("parse test DeepSeek API base: {error}"))?;
    let is_loopback = match endpoint.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if endpoint.scheme() != "http"
        || !is_loopback
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || endpoint.path() != "/"
    {
        return Err(format!(
            "{TEST_BASE_ENV} must be a loopback HTTP origin without credentials, path, query, or fragment"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod native_media_tests {
    use super::*;
    #[test]
    fn reasoning_only_and_blank_completions_are_not_successful_answers() {
        use ::rig::completion::FinishReason;
        for finish in [FinishReason::Length, FinishReason::Stop] {
            let result = require_rig_answer("  ".to_owned(), "test", Some(&finish));
            assert!(
                matches!(result, Err(ModelError::Failed(message)) if message.contains("returned no answer"))
            );
        }
        assert!(
            matches!(require_rig_answer("Answer".to_owned(), "test", None), Ok(value) if value == "Answer")
        );
    }

    #[test]
    fn bounded_json_sizing_preserves_exact_byte_boundary_and_handles_large_media() {
        let escaped = serde_json::json!({"text":"\"\n中文\t", "values":[1,true,null]});
        let length = serde_json::to_vec(&escaped).unwrap().len();
        assert!(serialized_over_budget(&escaped, length - 1).unwrap());
        assert!(!serialized_over_budget(&escaped, length).unwrap());
        assert!(
            serialized_over_budget(
                &serde_json::json!({"data":"A".repeat(16*1024*1024)}),
                96_000
            )
            .unwrap()
        );
    }

    #[test]
    fn cached_sequence_sizes_match_real_json_even_when_images_exceed_budget() {
        let values = vec![
            serde_json::json!({"text":"\"\n中文"}),
            serde_json::json!({"data":"A".repeat(1024*1024)}),
        ];
        let length = serde_json::to_vec(&values).unwrap().len();
        for budget in [0, 32, length - 1, length, length + 1] {
            let sizes = values
                .iter()
                .map(|value| serialized_size_up_to(value, budget).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                serialized_sequence_over_budget(&sizes, budget),
                length > budget
            );
        }
    }
}
