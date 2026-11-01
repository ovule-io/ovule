use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
use windows_sys::Win32::System::Power::{
    PowerClearRequest, PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest,
};
use windows_sys::Win32::System::Threading::{
    POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
};

/// A process-owned power request, independent of the calling thread's lifetime.
pub struct IdleSleepInhibitor(OwnedHandle);
impl IdleSleepInhibitor {
    pub fn acquire() -> Result<Self, String> {
        let mut reason: Vec<u16> = "Ovule Remote Host".encode_utf16().chain(Some(0)).collect();
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 {
                SimpleReasonString: reason.as_mut_ptr(),
            },
        };
        // SAFETY: The simple UTF-16 reason is NUL-terminated and lives through
        // this synchronous call. Windows copies the description into the request.
        let handle = unsafe { PowerCreateRequest(&raw const context) };
        if handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(format!(
                "Cannot create Host power request: {}",
                std::io::Error::last_os_error()
            ));
        }
        // SAFETY: PowerCreateRequest returned a newly owned, valid kernel handle.
        let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
        // SAFETY: The owned handle is a live power request. SystemRequired
        // prevents idle sleep without requesting that the display remain on.
        if unsafe { PowerSetRequest(handle.as_raw_handle(), PowerRequestSystemRequired) } == 0 {
            return Err(format!(
                "Cannot keep this Host awake: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(Self(handle))
    }
}
impl Drop for IdleSleepInhibitor {
    fn drop(&mut self) {
        // SAFETY: This live handle has exactly one SystemRequired request.
        // OwnedHandle closes it after clearing the request; process exit also closes it.
        unsafe { PowerClearRequest(self.0.as_raw_handle(), PowerRequestSystemRequired) };
    }
}
