//! Application assembly connects domain review policy to the generic approval broker.
pub(super) struct HostReviewer;
impl ovule_agent::execution::approval::ApprovalReviewer for HostReviewer {
    fn approve(&self, tool: &str, arguments: &serde_json::Value) -> bool {
        tool == "ovule_workspace_exec" && ovule_hosts::execution::review_read_only(arguments)
    }
}
