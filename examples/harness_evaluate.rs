//! Deterministic task/trajectory graders exercising production context tools.
use ovule::agent_host::context::{AssembledAttempt, AssemblyInput};
use ovule_memory::MemoryService;
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Instant,
};

fn assemble(
    memory: Arc<MemoryService>,
    paths: &[String],
    planning: bool,
    remote: bool,
    budget: usize,
    trace: Option<ovule::agent_host::context::TraceSink>,
) -> Result<AssembledAttempt, String> {
    AssembledAttempt::assemble(
        AssemblyInput {
            attempt_id: "eval-attempt",
            thread_id: "eval-thread",
            project_id: Some("eval-project"),
            host_id: "local",
            driver: if remote { "codex" } else { "ovule" },
            provider: Some("ollama"),
            local_transport: !remote,
            planning,
            skill_paths: paths,
            base_prompt: "Inspect the verified build convention.".into(),
            context_budget_chars: budget,
        },
        memory,
        trace,
    )
}
fn grade(id: &str, action: impl FnOnce() -> Result<Value, String>) -> Value {
    let started = Instant::now();
    match action() {
        Ok(metrics) => {
            json!({"id":id,"status":"pass","duration_ms":started.elapsed().as_secs_f64()*1000.0,"metrics":metrics})
        }
        Err(reason) => {
            json!({"id":id,"status":"fail","duration_ms":started.elapsed().as_secs_f64()*1000.0,"reason":reason})
        }
    }
}
fn require(condition: bool, detail: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(detail.into())
    }
}
fn main() -> Result<(), String> {
    let root = tempfile::tempdir().map_err(|e| e.to_string())?;
    let skill = root.path().join("SKILL.md");
    std::fs::write(&skill,"---\nname: build-guide\ndescription: Find verified build conventions.\n---\nPRIVATE_INSTRUCTIONS: Read references.txt before choosing the build command.").map_err(|e|e.to_string())?;
    std::fs::write(
        root.path().join("references.txt"),
        "BUILD_COMMAND=cargo check",
    )
    .map_err(|e| e.to_string())?;
    let paths = vec![skill.to_string_lossy().into_owned()];
    let db = root.path().join("memory.sqlite");
    let memory = Arc::new(MemoryService::open(&db)?);
    let traces = Arc::new(Mutex::new(Vec::new()));
    let sink = traces.clone();
    let assembled = assemble(
        memory,
        &paths,
        false,
        false,
        20000,
        Some(Arc::new(move |trace| {
            sink.lock().unwrap().push(trace.clone());
        })),
    )?;
    let call = |name: &str, args: Value| assembled.context.call(name, &args);
    let mut cases = vec![];
    cases.push(grade("skills.progressive",||{
        require(!assembled.prompt.contains("PRIVATE_INSTRUCTIONS"),"Skill body leaked into initial context")?;
        let id=&assembled.manifest.skills[0].id;
        require(call("ovule_skills",json!({"action":"read","id":id}))?["content"].as_str().is_some_and(|s|s.contains("PRIVATE_INSTRUCTIONS")),"Activation lost body")?;
        require(call("ovule_skills",json!({"action":"resource","id":id,"path":"references.txt"}))?["content"]=="BUILD_COMMAND=cargo check","Resource lookup failed")?;
        require(call("ovule_skills",json!({"action":"resource","id":id,"path":"../outside"})).is_err(),"Resource traversal allowed")?;
        Ok(json!({"initial_context_chars":assembled.manifest.context_used_chars,"eager_body_chars_avoided":std::fs::read_to_string(&skill).unwrap().chars().count(),"tool_calls":3}))
    }));
    cases.push(grade("memory.durable",||{
        call("ovule_memory",json!({"action":"put","key":"build","title":"Build command","body":"PRIVATE_FACT cargo check","source":"references.txt verified by eval","expectedRevision":0}))?;
        let reopened=assemble(Arc::new(MemoryService::open(&db)?),&[],false,false,20000,None)?;
        let found=reopened.context.call("ovule_memory",&json!({"action":"search","query":"cargo"}))?;
        require(found["hits"].as_array().is_some_and(|hits|hits.len()==1),"Restart search missed document")?;
        let fact=reopened.context.call("ovule_memory",&json!({"action":"get","key":"build"}))?;
        require(fact["memory"]["revision"]==1 && fact["memory"]["provenance"]["attempt_id"]=="eval-attempt","Revision/provenance lost")?;
        Ok(json!({"reopened":true,"revision":1}))
    }));
    cases.push(grade("memory.isolation",||{
        for args in [json!({"action":"get","scope":"thread:other","key":"build"}),json!({"action":"put","key":"build","title":"Build","body":"stale","source":"eval","expectedRevision":0}),json!({"action":"put","scope":"project:local:eval-project","key":"x","title":"x","body":"x","source":"eval","expectedRevision":0}),json!({"action":"search","scope":false})] {
            require(call("ovule_memory",args).is_err(),"Invalid scope, argument or stale revision accepted")?;
        }
        Ok(json!({"rejections":4}))
    }));
    cases.push(grade("assembly.routes", || {
        let memory = Arc::new(MemoryService::open(Path::new(":memory:"))?);
        let planning = assemble(memory.clone(), &paths, true, false, 20000, None)?;
        require(
            planning.manifest.skills.is_empty()
                && planning
                    .context
                    .call("ovule_memory", &json!({"action":"search"}))
                    .is_err(),
            "Planning exposed execution context",
        )?;
        let remote = assemble(memory, &[], false, true, 20000, None)?;
        require(
            remote
                .manifest
                .bindings
                .iter()
                .all(|binding| !binding.available),
            "Remote route implicitly used host tools",
        )?;
        Ok(json!({"planning_grants":0,"remote_context_grants":0}))
    }));
    cases.push(grade("assembly.budget", || {
        require(
            assemble(
                Arc::new(MemoryService::open(Path::new(":memory:"))?),
                &paths,
                false,
                false,
                10,
                None,
            )
            .is_err(),
            "Budget failed open",
        )?;
        Ok(json!({"rejected_before_dispatch":true}))
    }));
    cases.push(grade("telemetry.privacy", || {
        let traces = traces.lock().unwrap();
        let serialized = serde_json::to_string(&*traces).map_err(|e| e.to_string())?;
        require(
            !serialized.contains("PRIVATE_FACT") && !serialized.contains("PRIVATE_INSTRUCTIONS"),
            "Diagnostic leaked body",
        )?;
        require(
            traces.iter().any(|t| t.status == "failed")
                && traces.iter().any(|t| t.status == "succeeded"),
            "Trace missing success/failure",
        )?;
        Ok(json!({"tool_calls":traces.len(),"payloads_recorded":false}))
    }));
    write_report(&cases)
}
fn write_report(cases: &[Value]) -> Result<(), String> {
    let failed = cases.iter().any(|case| case["status"] != "pass");
    let output=serde_json::to_string_pretty(&json!({"schema_version":1,"harness_version":ovule::agent_host::context::VERSION,"kind":"deterministic","cases":cases})).map_err(|e|e.to_string())?;
    if let Some(path) = std::env::var_os("OVULE_EVAL_OUTPUT") {
        std::fs::write(path, &output).map_err(|e| e.to_string())?;
    } else {
        println!("{output}");
    }
    if failed {
        Err("harness evaluation failed".into())
    } else {
        Ok(())
    }
}
