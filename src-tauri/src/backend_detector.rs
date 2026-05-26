use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

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

impl BackendProbe for SystemProbe {
    fn locate(&self, command: &str) -> Option<PathBuf> {
        which::which(command).ok()
    }

    fn version(&self, _command: &str, path: &PathBuf) -> Option<String> {
        // 2s timeout via std::process::Command + thread spawn.
        let path_clone = path.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let out = std::process::Command::new(&path_clone)
                .arg("--version")
                .output();
            let _ = tx.send(out);
        });
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(out)) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Some(if s.is_empty() {
                    String::from_utf8_lossy(&out.stderr).trim().to_string()
                } else {
                    s
                })
            }
            _ => None,
        }
    }
}

const BACKENDS: &[(&str, &str)] = &[
    ("claude-code", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("aider", "aider"),
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
    fn detect_with_returns_all_five_backends() {
        let probe = FakeProbe { installed: HashMap::new() };
        let detected = detect_with(&probe);
        assert_eq!(detected.len(), 5);
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
}
