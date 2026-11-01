//! Compile-time prompt assets. Runtime budgets and policy remain typed code.
pub(crate) const ANSWER_RECOVERY: &str = include_str!("../prompts/answer-recovery.md");
pub(crate) const TOOL_BUDGET_EXHAUSTED: &str = include_str!("../prompts/tool-budget-exhausted.md");
pub(crate) const CAPABILITY_DISCOVERY: &str = include_str!("../prompts/capability-discovery.md");
