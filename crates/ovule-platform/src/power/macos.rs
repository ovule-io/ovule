use std::ffi::{CStr, c_char, c_void};
use std::ptr::NonNull;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        string: *const c_char,
        encoding: u32,
    ) -> *const c_void;
    fn CFRelease(value: *const c_void);
}
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        kind: *const c_void,
        level: u32,
        name: *const c_void,
        assertion: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion: u32) -> i32;
}

struct CfString(NonNull<c_void>);
impl CfString {
    fn new(value: &CStr) -> Result<Self, String> {
        // SAFETY: The input is NUL-terminated; CF copies it using UTF-8 with
        // its default allocator. This owner balances that retained reference.
        let string =
            unsafe { CFStringCreateWithCString(std::ptr::null(), value.as_ptr(), 0x0800_0100) };
        NonNull::new(string.cast_mut())
            .map(Self)
            .ok_or_else(|| "Cannot create Host power assertion description".into())
    }
}
impl Drop for CfString {
    fn drop(&mut self) {
        // SAFETY: This is the non-null retained CFString owned by this value.
        unsafe { CFRelease(self.0.as_ptr()) };
    }
}

/// `IOKit` releases this process-owned assertion even if the application crashes.
pub struct IdleSleepInhibitor(u32);
impl IdleSleepInhibitor {
    pub fn acquire() -> Result<Self, String> {
        let kind = CfString::new(c"PreventUserIdleSystemSleep")?;
        let reason = CfString::new(c"Ovule Remote Host")?;
        let mut assertion = 0;
        // SAFETY: Both CFStrings and the writable output ID outlive this call.
        // Level 1 is kIOPMAssertionLevelOn. IOKit owns the resulting assertion.
        let result = unsafe {
            IOPMAssertionCreateWithName(kind.0.as_ptr(), 1, reason.0.as_ptr(), &raw mut assertion)
        };
        if result != 0 {
            return Err(format!("Cannot keep this Host awake (IOKit {result:#x})"));
        }
        Ok(Self(assertion))
    }
}
impl Drop for IdleSleepInhibitor {
    fn drop(&mut self) {
        // SAFETY: This owner releases its successfully created assertion once.
        unsafe { IOPMAssertionRelease(self.0) };
    }
}
