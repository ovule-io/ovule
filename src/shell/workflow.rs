use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::AppSnapshot;
use ovule_workflow::WorkflowServiceError;

use super::mapper;

fn map_workflow_error(error: WorkflowServiceError) -> CommandError {
    match error {
        WorkflowServiceError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        WorkflowServiceError::Persistence(message) => CommandError::Failed(message),
    }
}

impl crate::shell_api::Workflow for App {
    fn advance_workflow(&self, thread_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .advance(&thread_id)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn create_goal(
        &self,
        thread_id: String,
        title: String,
        intent: String,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .create_goal(&thread_id, &title, &intent)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn add_task(
        &self,
        goal_id: String,
        title: String,
        agent: Option<String>,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .add_task(&goal_id, &title, agent)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn add_gate(&self, goal_id: String, title: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .add_gate(&goal_id, &title)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn delegate_task(&self, task_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .dispatch(&task_id)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn resolve_gate(&self, node_id: String, approved: bool) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .resolve_gate(&node_id, approved)
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }

    fn reset_workflows(&self) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_workflow::WorkflowService>()?
            .reset_workflows()
            .map(mapper::snapshot)
            .map_err(map_workflow_error)
    }
}
