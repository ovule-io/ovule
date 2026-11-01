use std::backtrace::Backtrace;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Once;

/// Write directly to disk: a second panic during unwinding can abort before
/// tracing's output or the development launcher's terminal is flushed.
pub(crate) fn install_panic_reporter() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        let Ok(directory) = ovule_platform::identity::data_directory() else {
            return;
        };
        let directory = directory.join("logs");
        if std::fs::create_dir_all(&directory).is_err() {
            return;
        }
        let path = directory.join("panic.log");
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
                let thread = std::thread::current();
                let _ = writeln!(
                    file,
                    "\n{:?} pid={} thread={}\n{info}\n{}",
                    std::time::SystemTime::now(),
                    std::process::id(),
                    thread.name().unwrap_or("unnamed"),
                    Backtrace::force_capture(),
                );
                let _ = file.sync_data();
            }
            previous(info);
        }));
    });
}
