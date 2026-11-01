use crate::runtime::App;
impl crate::shell_api::Agent for App {
    fn approval_mode(&self) -> Result<String, tuffite::CommandError> {
        self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?
            .review_enabled()
            .map(|enabled| if enabled { "review" } else { "ask" }.into())
            .map_err(tuffite::CommandError::Failed)
    }
    fn set_approval_mode(&self, mode: String) -> Result<bool, tuffite::CommandError> {
        let enabled = match mode.as_str() {
            "ask" => false,
            "review" => true,
            _ => {
                return Err(tuffite::CommandError::InvalidArgument(
                    "Unknown approval mode".into(),
                ));
            }
        };
        self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?
            .set_review_enabled(enabled)
            .map(|()| true)
            .map_err(tuffite::CommandError::Failed)
    }

    fn pending_approvals(
        &self,
        attempt_id: String,
    ) -> Result<Vec<crate::shell_api::PendingApprovalView>, tuffite::CommandError> {
        if attempt_id.is_empty() || attempt_id.len() > 256 {
            return Err(tuffite::CommandError::InvalidArgument(
                "Invalid Attempt ID".into(),
            ));
        }
        let approvals = self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?;
        let review_fallback = approvals
            .review_enabled()
            .map_err(tuffite::CommandError::Failed)?;
        approvals
            .pending_for(&attempt_id)
            .map(|pending| {
                pending
                    .into_iter()
                    .map(|request| crate::shell_api::PendingApprovalView {
                        request_id: request.request_id,
                        attempt_id: request.attempt_id,
                        tool: request.tool,
                        arguments_json: request.arguments.to_string(),
                        automatic_allowed: request.automatic_allowed,
                        review_fallback,
                        expires_at_ms: request.expires_at_ms,
                    })
                    .collect()
            })
            .map_err(tuffite::CommandError::Failed)
    }
    fn mark_approval_presented(&self, request_id: String) -> Result<bool, tuffite::CommandError> {
        self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?
            .mark_presented(&request_id)
            .map_err(tuffite::CommandError::Failed)
    }

    fn respond_approval_with_scope(
        &self,
        request_id: String,
        allow: bool,
        automatic: bool,
    ) -> Result<bool, tuffite::CommandError> {
        self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?
            .resolve_scoped(&request_id, allow, automatic)
            .map_err(tuffite::CommandError::Failed)
    }
    fn respond_approval(
        &self,
        request_id: String,
        allow: bool,
    ) -> Result<bool, tuffite::CommandError> {
        self.service::<ovule_agent::execution::approval::ApprovalRuntime>()?
            .resolve(&request_id, allow)
            .map_err(tuffite::CommandError::Failed)
    }
    fn execution_calls(
        &self,
        attempt_id: String,
    ) -> Result<Vec<crate::shell_api::ExecutionCallView>, tuffite::CommandError> {
        if attempt_id.is_empty() || attempt_id.len() > 256 {
            return Err(tuffite::CommandError::InvalidArgument(
                "Invalid Attempt ID".into(),
            ));
        }
        self.service::<crate::agent_host::ExecutionJournalRuntime>()?
            .lock()
            .map_err(|_| tuffite::CommandError::Failed("Execution journal lock poisoned".into()))?
            .recent(&attempt_id, 64)
            .map(|records| {
                records
                    .into_iter()
                    .map(|record| crate::shell_api::ExecutionCallView {
                        call_id: record.call_id,
                        attempt_id: record.attempt_id,
                        tool: record.tool,
                        state: record.state,
                    })
                    .collect()
            })
            .map_err(tuffite::CommandError::Failed)
    }
}
