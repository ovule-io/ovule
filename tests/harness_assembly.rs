use ovule::agent_host::context::{AssembledAttempt, AssemblyInput, DriverRoute};
use ovule_memory::MemoryService;
use serde_json::json;
use std::sync::{Arc, Mutex};
fn input(paths: &[String]) -> AssemblyInput<'_> {
    AssemblyInput {
        attempt_id: "attempt",
        thread_id: "thread",
        project_id: Some("project"),
        host_id: "local",
        driver: "ovule",
        provider: Some("ollama"),
        local_transport: true,
        planning: false,
        skill_paths: paths,
        base_prompt: "Find project preference".into(),
        context_budget_chars: 16000,
    }
}
#[test]
fn metadata_only_then_read_and_memory_tools_emit_body_free_trace() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("SKILL.md");
    std::fs::write(
        &path,
        "---\nname: audit\ndescription: Audit projects.\n---\nHIDDEN_SKILL_BODY",
    )
    .unwrap();
    let paths = vec![path.to_string_lossy().into_owned()];
    let trace = Arc::new(Mutex::new(Vec::new()));
    let sink = trace.clone();
    let memory = Arc::new(MemoryService::open(&root.path().join("memory.sqlite")).unwrap());
    let assembled = AssembledAttempt::assemble(
        input(&paths),
        memory,
        Some(Arc::new(move |event| {
            sink.lock().unwrap().push(event.clone());
        })),
    )
    .unwrap();
    assert_eq!(assembled.manifest.route, DriverRoute::Rig);
    assert!(!assembled.prompt.contains("HIDDEN_SKILL_BODY"));
    let id = &assembled.manifest.skills[0].id;
    assert!(
        assembled
            .context
            .call("ovule_skills", &json!({"action":"read","id":id}))
            .unwrap()["content"]
            .as_str()
            .unwrap()
            .contains("HIDDEN_SKILL_BODY")
    );
    let saved=assembled.context.call("ovule_memory",&json!({"action":"put","key":"fact","title":"Build","body":"HIDDEN_MEMORY_BODY","source":"verified test","expectedRevision":0})).unwrap();
    assert_eq!(saved["revision"], 1);
    assert!(
        assembled
            .context
            .call(
                "ovule_memory",
                &json!({"action":"search","scope":"thread:elsewhere","query":"anything"})
            )
            .is_err()
    );
    assert!(assembled.context.call("ovule_memory",&json!({"action":"put","scope":"project:local:project","key":"fact","title":"x","body":"y","source":"test","expectedRevision":0})).is_err());
    assert!(
        assembled
            .context
            .call(
                "ovule_memory",
                &json!({"action":"PRIVATE_INVALID_ARGUMENT"})
            )
            .is_err()
    );
    let serialized = serde_json::to_string(&*trace.lock().unwrap()).unwrap();
    assert!(!serialized.contains("PRIVATE_INVALID_ARGUMENT"));
    assert!(!serialized.contains("HIDDEN_MEMORY_BODY"));
    assert!(!serialized.contains("HIDDEN_SKILL_BODY"));
    assert!(serialized.contains("failed"));
}
#[test]
fn planning_has_no_memory_or_skill_side_effects_and_budget_fails_closed() {
    let memory = Arc::new(MemoryService::open(std::path::Path::new(":memory:")).unwrap());
    let paths = vec!["missing/SKILL.md".into()];
    let mut spec = input(&paths);
    spec.planning = true;
    let assembled = AssembledAttempt::assemble(spec, memory.clone(), None).unwrap();
    assert_eq!(assembled.manifest.skills.len(), 0);
    assert!(
        assembled
            .context
            .call("ovule_memory", &json!({"action":"search"}))
            .is_err()
    );
    let mut spec = input(&[]);
    spec.context_budget_chars = 10;
    assert!(AssembledAttempt::assemble(spec, memory, None).is_err());
}
#[test]
fn projections_are_explicit_and_remote_context_does_not_fall_back_to_local() {
    assert_eq!(
        DriverRoute::resolve("ovule", Some("openai"), true),
        DriverRoute::LocalAcp
    );
    assert_eq!(
        DriverRoute::resolve("codex", None, false),
        DriverRoute::RemoteAcp
    );
    let memory = Arc::new(MemoryService::open(std::path::Path::new(":memory:")).unwrap());
    let mut spec = input(&[]);
    spec.driver = "codex";
    spec.local_transport = false;
    spec.host_id = "remote";
    let assembled = AssembledAttempt::assemble(spec, memory, None).unwrap();
    assert_eq!(
        assembled
            .manifest
            .bindings
            .iter()
            .filter(|b| b.available)
            .count(),
        0
    );
    assert!(
        assembled
            .context
            .call("ovule_memory", &json!({"action":"search"}))
            .is_err()
    );
}

#[test]
fn disclosure_rejects_oversized_encoded_json_and_accepts_a_smaller_page() {
    let memory = Arc::new(MemoryService::open(std::path::Path::new(":memory:")).unwrap());
    let assembled = AssembledAttempt::assemble(input(&[]), memory, None).unwrap();
    assembled.context.call("ovule_memory",&json!({"action":"put","key":"escaped","title":"Escaped fixture","body":"\0".repeat(3000),"source":"fixture","expectedRevision":0})).unwrap();
    assert!(
        assembled
            .context
            .call("ovule_memory", &json!({"action":"get","key":"escaped"}))
            .is_err()
    );
    let page = assembled
        .context
        .call(
            "ovule_memory",
            &json!({"action":"get","key":"escaped","limit":1000}),
        )
        .unwrap();
    assert_eq!(page["nextOffset"], 1000);
    assert_eq!(
        page["memory"]["body"].as_str().unwrap().chars().count(),
        1000
    );
    assert!(
        assembled
            .context
            .call("ovule_memory", &json!({"action":"search","scope":false}))
            .is_err()
    );
    assert!(
        assembled
            .context
            .call(
                "ovule_memory",
                &json!({"action":"search","unknown":"extra"})
            )
            .is_err()
    );
}
