# Application agent prompts

This directory owns prompt text for product context, profiles, selected capabilities
and output protocols. Kernel loop prompts belong in `services/agent/prompts/`;
tool schemas and permission rules remain in typed code.

Static text uses `include_str!`. Templates with dynamic values use Rust's
`format!(include_str!(...), name = value)` or `write!` directly, without a runtime
template engine.

- Use named `{name}` placeholders and explicit bindings at the call site. Missing
  or misspelled placeholders cause compilation to fail.
- Escape literal JSON braces as `{{` and `}}`, as in `message-blocks.md`.
- Insert dynamic input once. Braces in profiles, JSON catalogs and user input are
  never expanded recursively.
- Keep credentials, real accounts and private runtime state out of these files.
  Dynamic catalogs and scopes come from the validated Attempt.
- `selected-context.md` still counts toward the Attempt context budget. Extracting
  Markdown does not bypass authorization or disclosure limits.

`workspace-context.md`, `profile-instructions.md`, `local-images.md` and
`reply-style.md` compose execution context. `context-discovery.md`,
`selected-context.md` and `remote-context.md` describe selected capabilities and
routing boundaries. `file-editors.md` and `message-blocks.md` describe product
output protocols.

After editing, run the application's `harness_assembly` tests and contract evaluation
through `examples/harness_evaluate.rs`. Use comparable model evaluations to assess
changes in actual task performance.
