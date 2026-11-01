use ovule_toolchains::ToolchainView;

use super::{NativeSetupService, SetupError};

pub(crate) fn get_toolchain_status(
    service: &NativeSetupService,
) -> Result<Vec<ToolchainView>, SetupError> {
    service.toolchains.status().map_err(SetupError::Persistence)
}

pub(crate) fn install_toolchain(
    service: &NativeSetupService,
    toolchain_id: &str,
) -> Result<Vec<ToolchainView>, SetupError> {
    service
        .toolchains
        .start_install(toolchain_id)
        .map_err(SetupError::Persistence)
}
