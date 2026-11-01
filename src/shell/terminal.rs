use tuffite::CommandError;

use crate::runtime::App;
use crate::shell_api::AppSnapshot;
use ovule_terminal::TerminalServiceError;

use super::mapper;

fn map_terminal_error(error: TerminalServiceError) -> CommandError {
    match error {
        TerminalServiceError::InvalidArgument(message) => CommandError::InvalidArgument(message),
        TerminalServiceError::Persistence(message) | TerminalServiceError::Runtime(message) => {
            CommandError::Failed(message)
        }
    }
}

impl crate::shell_api::Terminal for App {
    fn shell_profiles(&self) -> Result<String, CommandError> {
        serde_json::to_string(
            &self
                .service::<tuffite_ioc::Service<ovule_terminal::profiles::ShellProfiles>>()?
                .list()
                .map_err(CommandError::Failed)?,
        )
        .map_err(|e| CommandError::Failed(e.to_string()))
    }
    fn configure_shell_profiles(&self, configuration: String) -> Result<(), CommandError> {
        self.service::<tuffite_ioc::Service<ovule_terminal::profiles::ShellProfiles>>()?
            .configure(&configuration)
            .map_err(CommandError::InvalidArgument)
    }
    fn open_session(
        &self,
        owner: String,
        profile_id: String,
        directory: String,
        cols: u16,
        rows: u16,
    ) -> Result<String, CommandError> {
        let profiles = self
            .service::<tuffite_ioc::Service<ovule_terminal::profiles::ShellProfiles>>()?
            .list()
            .map_err(CommandError::Failed)?;
        let profile = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| CommandError::InvalidArgument("Unknown shell profile".into()))?;
        let info = self
            .service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
            .open(
                &owner,
                profile,
                std::path::Path::new(&directory),
                cols,
                rows,
            )
            .map_err(CommandError::Failed)?;
        serde_json::to_string(&info).map_err(|e| CommandError::Failed(e.to_string()))
    }
    fn read_session(&self, id: String, cursor: u64) -> Result<String, CommandError> {
        let read = self
            .service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
            .read(&id, cursor)
            .map_err(CommandError::Failed)?;
        serde_json::to_string(&read).map_err(|e| CommandError::Failed(e.to_string()))
    }
    fn write_session(&self, id: String, data: Vec<u8>) -> Result<(), CommandError> {
        self.service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
            .write(&id, &data)
            .map_err(CommandError::Failed)
    }
    fn resize_session(&self, id: String, cols: u16, rows: u16) -> Result<(), CommandError> {
        self.service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
            .resize(&id, cols, rows)
            .map_err(CommandError::Failed)
    }
    fn close_session(&self, id: String) -> Result<bool, CommandError> {
        Ok(self
            .service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
            .close(&id))
    }
    fn list_sessions(&self) -> Result<String, CommandError> {
        serde_json::to_string(
            &self
                .service::<tuffite_ioc::Service<ovule_terminal::pty::PtySessions>>()?
                .list(),
        )
        .map_err(|e| CommandError::Failed(e.to_string()))
    }
    fn start_terminal(
        &self,
        thread_id: String,
        command: String,
        owner_id: Option<String>,
        workspace_binding_id: Option<String>,
        use_thread_workspace: Option<bool>,
    ) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_terminal::TerminalService>()?
            .start(
                &thread_id,
                &command,
                owner_id,
                workspace_binding_id,
                use_thread_workspace.unwrap_or(false),
            )
            .map(mapper::snapshot)
            .map_err(map_terminal_error)
    }

    fn cancel_terminal(&self, run_id: String) -> Result<AppSnapshot, CommandError> {
        self.service::<ovule_terminal::TerminalService>()?
            .cancel(&run_id)
            .map(mapper::snapshot)
            .map_err(map_terminal_error)
    }
}
