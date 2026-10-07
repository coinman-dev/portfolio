//! Diagnostic log for debug mode.
//!
//! Lines go to `Logs/coinman-YYYY-MM-DD.log` next to the executable, one file
//! per local day, appended across restarts. Nothing is written while debug mode
//! is off (Settings → Debug mode, or `--debug` for a single session); the
//! switch is `log::max_level()`, so disabled log calls cost one comparison.
//!
//! Every line starts with time and a fixed-width level, so errors can be pulled
//! out with e.g. `findstr " ERROR " coinman-2026-09-27.log`.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use log::{Level, LevelFilter, Log, Metadata, Record};
use tauri::{AppHandle, Runtime};

/// Target for lines forwarded from the frontend by the `debug_log` command.
pub const UI_TARGET: &str = "ui";

const OWN_CRATE: &str = "coinman_portfolio";

/// Crate root as a target, shown as `[app]` in the file.
const APP_TARGET: &str = env!("CARGO_CRATE_NAME");

static LOGGER: OnceLock<DailyFileLogger> = OnceLock::new();

/// Installs the logger (disabled) and a panic hook that records panics.
/// Safe to call more than once; only the first call has any effect.
pub fn init(dir: PathBuf) {
    if LOGGER.set(DailyFileLogger::new(dir)).is_err() {
        return;
    }
    let logger = LOGGER.get().expect("logger was just set");
    if log::set_logger(logger).is_err() {
        return;
    }
    log::set_max_level(LevelFilter::Off);

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("PANIC: {info}");
        default_hook(info);
    }));
}

pub fn is_enabled() -> bool {
    log::max_level() != LevelFilter::Off
}

pub fn set_enabled(enabled: bool) {
    log::set_max_level(if enabled {
        LevelFilter::Debug
    } else {
        LevelFilter::Off
    });
}

pub fn dir() -> Option<&'static Path> {
    LOGGER.get().map(|l| l.dir.as_path())
}

/// Writes the block that opens every debug session: versions, platform and
/// paths, i.e. what is needed to read the rest of the log.
pub fn write_session_header<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    let info = app.package_info();
    log::info!(
        target: APP_TARGET,
        "===== {} v{} — debug log on ({reason}) =====",
        info.name,
        info.version
    );
    log::info!(
        target: APP_TARGET,
        "OS: {} {} | Tauri {} | WebView {} | pid {}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        tauri::VERSION,
        tauri::webview_version().unwrap_or_else(|e| format!("unknown ({e})")),
        std::process::id()
    );
    if let Ok(exe) = std::env::current_exe() {
        log::info!(target: APP_TARGET, "Executable: {}", exe.display());
    }
    if let Some(dir) = dir() {
        log::info!(target: APP_TARGET, "Logs: {}", dir.display());
    }
}

struct DailyFileLogger {
    dir: PathBuf,
    /// The file for the day it was opened on; reopened when the date changes.
    current: Mutex<Option<(String, File)>>,
}

impl DailyFileLogger {
    fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            current: Mutex::new(None),
        }
    }

    fn write_line(&self, date: &str, line: &str) {
        let mut current = self.current.lock().unwrap_or_else(|p| p.into_inner());
        if current.as_ref().is_none_or(|(d, _)| d != date) {
            *current = open_day_file(&self.dir, date).map(|f| (date.to_string(), f));
        }
        if let Some((_, file)) = current.as_mut() {
            // Unbuffered on purpose: the lines before a crash are the useful ones.
            let _ = file.write_all(line.as_bytes());
        }
    }
}

impl Log for DailyFileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= max_level_for(metadata.target())
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let now = chrono::Local::now();
        let line = format_line(
            &now.format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
            record.level(),
            record.target(),
            &record.args().to_string(),
        );
        self.write_line(&now.format("%Y-%m-%d").to_string(), &line);
    }

    fn flush(&self) {}
}

/// Our own code and the frontend log everything; dependencies (tauri, wry,
/// reqwest…) only warnings and errors, or they drown the log.
fn max_level_for(target: &str) -> Level {
    if target == UI_TARGET || target.starts_with(OWN_CRATE) {
        Level::Debug
    } else {
        Level::Warn
    }
}

fn open_day_file(dir: &Path, date: &str) -> Option<File> {
    fs::create_dir_all(dir).ok()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(format!("coinman-{date}.log")))
        .ok()
}

/// `2026-09-27 19:11:43.123 ERROR [storage] message`; continuation lines of a
/// multi-line message (stack traces) are indented so each entry still starts
/// with a timestamp.
fn format_line(time: &str, level: Level, target: &str, message: &str) -> String {
    let source = match target.strip_prefix(OWN_CRATE) {
        Some(rest) => rest
            .trim_start_matches("_lib")
            .trim_start_matches("::")
            .split("::")
            .last()
            .filter(|s| !s.is_empty())
            .unwrap_or("app"),
        None => target,
    };
    let message = message
        .trim_end()
        .replace("\r\n", "\n")
        .replace('\n', "\n    ");
    format!("{time} {level:<5} [{source}] {message}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_level_source_and_continuation_lines() {
        assert_eq!(
            format_line(
                "2026-09-27 19:11:43.123",
                Level::Warn,
                "coinman_portfolio_lib::storage",
                "Cannot write\nat line 2\n"
            ),
            "2026-09-27 19:11:43.123 WARN  [storage] Cannot write\n    at line 2\n"
        );
        assert_eq!(
            format_line("t", Level::Info, "coinman_portfolio_lib", "started"),
            "t INFO  [app] started\n"
        );
        assert_eq!(
            format_line("t", Level::Error, UI_TARGET, "boom"),
            "t ERROR [ui] boom\n"
        );
    }

    #[test]
    fn keeps_dependency_noise_out() {
        assert_eq!(
            max_level_for("coinman_portfolio_lib::settings"),
            Level::Debug
        );
        assert_eq!(max_level_for(UI_TARGET), Level::Debug);
        assert_eq!(max_level_for("reqwest::connect"), Level::Warn);
    }

    /// One file per day, appended to rather than overwritten.
    #[test]
    fn writes_one_file_per_day() {
        let dir = std::env::temp_dir().join(format!("coinman-logs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let logger = DailyFileLogger::new(dir.clone());
        logger.write_line("2026-09-27", "a\n");
        logger.write_line("2026-09-27", "b\n");
        logger.write_line("2026-09-28", "c\n");
        drop(logger);
        DailyFileLogger::new(dir.clone()).write_line("2026-09-28", "d\n");

        assert_eq!(
            fs::read_to_string(dir.join("coinman-2026-09-27.log")).unwrap(),
            "a\nb\n"
        );
        assert_eq!(
            fs::read_to_string(dir.join("coinman-2026-09-28.log")).unwrap(),
            "c\nd\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
