# Agent kernel prompts

This directory owns prompt text for the model loop and discovery protocol. Prompts
are embedded with `include_str!`; rebuild after editing. The runtime does not read
workspace copies or expose a hot reload or override mechanism.

| File | Call site | Purpose |
| --- | --- | --- |
| `answer-recovery.md` | `src/runtime/model.rs` | One recovery request without tools when output length is exhausted without an answer |
| `tool-budget-exhausted.md` | `src/runtime/model.rs` | Final answer guidance after the tool turn budget is exhausted |
| `capability-discovery.md` | `src/harness/capabilities.rs` | Model instructions for the initial discovery entry point |

Code enforces authorization, turn limits, cancellation, deadlines and execution
state. Prompt text cannot change these constraints. Product and domain context
belongs in the application or owning service; keep project, account and domain
dependencies out of kernel prompts.

After editing, run `cargo test -p ovule-agent --offline` and compare model behavior
using the same model, tasks and budgets. Passing contract tests does not establish
an improvement in model task success rates.
