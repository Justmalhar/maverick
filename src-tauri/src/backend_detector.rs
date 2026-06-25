use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBackend {
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Trait so tests can inject a fake PATH lookup + version probe.
pub trait BackendProbe: Send + Sync {
    fn locate(&self, command: &str) -> Option<PathBuf>;
    fn version(&self, command: &str, path: &PathBuf) -> Option<String>;
}

pub struct SystemProbe;

/// Build the `<tool> --version` probe command for a located path.
///
/// On Windows the AI CLIs are usually npm shims (`claude.cmd` / `claude.ps1`)
/// and `CreateProcessW` can only execute real `.exe`s (it never consults a
/// shell), so a `.cmd`/`.bat` is run through `cmd.exe /C` and a `.ps1` through
/// `powershell -File` — otherwise `version` is always null for installed tools.
/// `CREATE_NO_WINDOW` keeps the console-subsystem child from flashing a window.
fn version_command(path: &std::path::Path) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let p = path.to_string_lossy().into_owned();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let mut cmd = match ext.as_deref() {
            Some("cmd") | Some("bat") => {
                let mut c = std::process::Command::new("cmd.exe");
                c.args(["/C", &p]);
                c
            }
            Some("ps1") => {
                let mut c = std::process::Command::new("powershell.exe");
                c.args(["-NoProfile", "-NonInteractive", "-File", &p]);
                c
            }
            _ => std::process::Command::new(path),
        };
        cmd.arg("--version");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = std::process::Command::new(path);
        cmd.arg("--version");
        cmd
    }
}

/// Common locations outside of $PATH where AI CLIs are known to install.
/// `which` searches PATH first; this is the fallback so we still find tools
/// that installers dropped into well-known dirs but never added to the
/// user's shell rc.
fn fallback_search_paths(command: &str, home: Option<&PathBuf>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(h) = home {
        roots.push(h.join(".local/bin"));
        roots.push(h.join(".npm-global/bin"));
        roots.push(h.join(".bun/bin"));
        roots.push(h.join(".cargo/bin"));
        // On Windows, npm global installs its CLI shims under %APPDATA%\npm
        // (claude.cmd / claude.ps1) — not ~/.npm-global. Without this, a
        // backend not on PATH is never found by the fallback.
        #[cfg(windows)]
        roots.push(h.join("AppData").join("Roaming").join("npm"));
        match command {
            "claude" => roots.push(h.join(".claude/local/claude")),
            "codex" => roots.push(h.join(".codex/bin/codex")),
            "agy" => roots.push(h.join(".antigravity/bin/agy")),
            _ => {}
        }
    }
    // Tools shipped as macOS apps but with a binary inside Resources/.
    if command == "ollama" {
        roots.push(PathBuf::from(
            "/Applications/Ollama.app/Contents/Resources/ollama",
        ));
    }
    roots
        .into_iter()
        .map(|p| {
            // If the path already ends in the binary name, use as-is; else join.
            if p.file_name().and_then(|s| s.to_str()) == Some(command) {
                p
            } else {
                p.join(command)
            }
        })
        .collect()
}

impl BackendProbe for SystemProbe {
    fn locate(&self, command: &str) -> Option<PathBuf> {
        if let Ok(p) = which::which(command) {
            return Some(p);
        }
        let home = dirs::home_dir();
        for candidate in fallback_search_paths(command, home.as_ref()) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    }

    fn version(&self, _command: &str, path: &PathBuf) -> Option<String> {
        let mut cmd = version_command(path);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().ok()?;
        // Poll for completion and KILL the child if it outlives its 2s budget, so
        // a hung `--version` can't leak the child process (the old thread+output()
        // approach left both the worker thread and the child running forever).
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => return None,
            }
        }
        let out = child.wait_with_output().ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Some(if s.is_empty() {
            String::from_utf8_lossy(&out.stderr).trim().to_string()
        } else {
            s
        })
    }
}

/// (id, primary command). The id is the kebab-case identifier sent over IPC
/// and used by the React layer to look up the right brand icon.
const BACKENDS: &[(&str, &str)] = &[
    ("claude-code", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("aider", "aider"),
    ("opencode", "opencode"),
    ("antigravity", "agy"),
    ("ollama", "ollama"),
];

pub fn detect_with(probe: &dyn BackendProbe) -> Vec<DetectedBackend> {
    BACKENDS
        .iter()
        .map(|(name, command)| match probe.locate(command) {
            Some(p) => {
                let version = probe.version(command, &p);
                DetectedBackend {
                    name: name.to_string(),
                    command: command.to_string(),
                    installed: true,
                    path: Some(p.to_string_lossy().into_owned()),
                    version,
                }
            }
            None => DetectedBackend {
                name: name.to_string(),
                command: command.to_string(),
                installed: false,
                path: None,
                version: None,
            },
        })
        .collect()
}

pub fn detect_all() -> Vec<DetectedBackend> {
    detect_with(&SystemProbe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeProbe {
        installed: HashMap<String, (PathBuf, Option<String>)>,
    }

    impl BackendProbe for FakeProbe {
        fn locate(&self, command: &str) -> Option<PathBuf> {
            self.installed.get(command).map(|(p, _)| p.clone())
        }
        fn version(&self, command: &str, _path: &PathBuf) -> Option<String> {
            self.installed.get(command).and_then(|(_, v)| v.clone())
        }
    }

    #[test]
    fn detect_with_returns_all_known_backends() {
        let probe = FakeProbe { installed: HashMap::new() };
        let detected = detect_with(&probe);
        assert_eq!(detected.len(), BACKENDS.len());
        assert!(detected.iter().all(|d| !d.installed));
    }

    #[test]
    fn detect_with_finds_one_when_present() {
        let mut installed = HashMap::new();
        installed.insert(
            "claude".to_string(),
            (PathBuf::from("/usr/local/bin/claude"), Some("claude 1.2.3".to_string())),
        );
        let probe = FakeProbe { installed };
        let detected = detect_with(&probe);
        let claude = detected.iter().find(|d| d.name == "claude-code").unwrap();
        assert!(claude.installed);
        assert_eq!(claude.path.as_deref(), Some("/usr/local/bin/claude"));
        assert_eq!(claude.version.as_deref(), Some("claude 1.2.3"));
        let codex = detected.iter().find(|d| d.name == "codex").unwrap();
        assert!(!codex.installed);
        assert!(codex.path.is_none());
    }

    #[test]
    fn detect_with_handles_version_unavailable() {
        let mut installed = HashMap::new();
        installed.insert(
            "ollama".to_string(),
            (PathBuf::from("/opt/ollama"), None),
        );
        let probe = FakeProbe { installed };
        let detected = detect_with(&probe);
        let ollama = detected.iter().find(|d| d.name == "ollama").unwrap();
        assert!(ollama.installed);
        assert!(ollama.version.is_none());
    }

    #[test]
    fn detect_returns_backends_in_expected_order() {
        let probe = FakeProbe { installed: HashMap::new() };
        let names: Vec<_> = detect_with(&probe).into_iter().map(|d| d.name).collect();
        assert_eq!(
            names,
            vec![
                "claude-code",
                "codex",
                "gemini",
                "aider",
                "opencode",
                "antigravity",
                "ollama",
            ]
        );
    }

    #[test]
    fn fallback_search_includes_home_subdirs() {
        let home = PathBuf::from("/h");
        let paths = fallback_search_paths("claude", Some(&home));
        assert!(paths.contains(&PathBuf::from("/h/.local/bin/claude")));
        assert!(paths.contains(&PathBuf::from("/h/.claude/local/claude")));
    }

    #[test]
    fn fallback_search_includes_ollama_app_bundle() {
        let paths = fallback_search_paths("ollama", None);
        assert!(paths.iter().any(|p| p.to_string_lossy().contains("Ollama.app")));
    }

    #[test]
    fn version_command_runs_a_plain_path_directly() {
        let cmd = version_command(std::path::Path::new("/usr/local/bin/claude"));
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"--version".to_string()));
    }

    #[cfg(windows)]
    #[test]
    fn version_command_wraps_a_cmd_shim_through_cmd_exe() {
        let cmd = version_command(std::path::Path::new(r"C:\npm\claude.cmd"));
        assert_eq!(cmd.get_program(), "cmd.exe");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"/C".to_string()));
        assert!(args.iter().any(|a| a.contains("claude.cmd")));
        assert!(args.contains(&"--version".to_string()));
    }

    #[cfg(windows)]
    #[test]
    fn version_command_wraps_a_ps1_shim_through_powershell() {
        let cmd = version_command(std::path::Path::new(r"C:\npm\claude.ps1"));
        assert_eq!(cmd.get_program(), "powershell.exe");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"-File".to_string()));
        assert!(args.iter().any(|a| a.contains("claude.ps1")));
    }
}
