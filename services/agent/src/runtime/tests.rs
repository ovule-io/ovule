use super::*;
use crate::output::extract_message_blocks;
#[test]
fn extracts_declared_message_blocks_and_keeps_invalid_fences_visible() {
    let allowed = BTreeSet::from(["echarts".to_owned()]);
    let source = r#"Chart ready.

```ovule-block
{"id":"chart-1","kind":"echarts","data":{"option":{"series":[{"data":[1,2]}]}}}
```

Done."#;
    let (markdown, blocks) = extract_message_blocks(source, &allowed);
    assert_eq!(markdown, "Chart ready.\n\n\n\nDone.");
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].id, "chart-1");
    assert_eq!(blocks[0].kind, "echarts");
    let invalid = source.replace("\"echarts\"", "\"unknown\"");
    let (markdown, blocks) = extract_message_blocks(&invalid, &allowed);
    assert_eq!(blocks.len(), 0);
    assert!(markdown.contains("```ovule-block"));
}

#[test]
fn projects_large_interactive_html_before_bounding_visible_summary() {
    let data = serde_json::json!({ "html": "x".repeat(70_000) });
    let source = format!(
        "Ready.\n\n```ovule-block\n{}\n```",
        serde_json::json!({ "id": "config", "kind": "interactive-ui", "data": data })
    );
    let observed = Arc::new(Mutex::new(Vec::new()));
    let capture = Arc::clone(&observed);
    let notify: Arc<dyn Fn(WorkerEvent) + Send + Sync> = Arc::new(move |event| {
        capture.lock().unwrap().push(event);
    });
    let markdown = project_message_blocks(
        "attempt-1",
        &source,
        &BTreeSet::from(["interactive-ui".to_owned()]),
        &notify,
        true,
    );
    assert_eq!(bounded_message(&markdown, "empty"), "Ready.");
    assert!(observed.lock().unwrap().iter().any(|event| matches!(
        event,
        WorkerEvent::MessageBlock { kind, data_json, .. }
            if kind == "interactive-ui" && data_json.len() > 65_536
    )));
}

#[test]
fn message_block_fence_is_held_back_across_stream_chunks() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let capture = Arc::clone(&observed);
    let notify: Arc<dyn Fn(WorkerEvent) + Send + Sync> = Arc::new(move |event| {
        capture
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    });
    let accumulator = Arc::new(Mutex::new(OutputAccumulator {
        sequence: 0,
        pending: String::new(),
        last_emit: Instant::now().checked_sub(Duration::from_secs(1)).unwrap(),
        flush_scheduled: false,
    }));
    let stream = Arc::new(Mutex::new(MessageBlockStream::default()));
    let marker = "```ovule-block\n";
    let (prefix, suffix) = marker.split_at(marker.len() - 10);
    filter_and_queue_output(
        "attempt-1",
        &notify,
        &accumulator,
        &stream,
        &format!("Ready.\n\n{prefix}"),
    );
    filter_and_queue_output(
        "attempt-1",
        &notify,
        &accumulator,
        &stream,
        &format!("{suffix}{{\"id\":"),
    );
    flush_filtered_output("attempt-1", &notify, &accumulator, &stream);
    let events = observed
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let visible = events
        .iter()
        .filter_map(|event| match event {
            WorkerEvent::Output { delta, .. } => Some(delta.as_str()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(visible, "Ready.\n\n");
    assert!(!visible.contains("ovule-block"));
}
