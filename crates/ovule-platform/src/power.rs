//! Process-owned requests to prevent idle system sleep; displays may still sleep.
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::IdleSleepInhibitor;
#[cfg(windows)]
pub use windows::IdleSleepInhibitor;

#[must_use]
pub const fn supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

#[cfg(not(any(target_os = "macos", windows)))]
pub struct IdleSleepInhibitor;
#[cfg(not(any(target_os = "macos", windows)))]
impl IdleSleepInhibitor {
    pub fn acquire() -> Result<Self, String> {
        Err("Keeping the Host awake is not supported on this platform".into())
    }
}
