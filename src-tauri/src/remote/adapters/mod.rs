//! Per-provider event normalizers — the Rust port of the Swift
//! `AgentEventNormalizing` family (`ClaudeCodeAdapter`, `CodexAdapter`,
//! `OpenCodeAdapter`, `AntigravityAdapter`, `HermesAdapter`).
//!
//! A [`Normalizer`] turns a provider's wire format into canonical
//! [`AgentEvent`]s in two directions:
//! - `normalize_stream_line`: one line of the CLI's stdout (`--output-format
//!   stream-json`, `--json`, or heuristic plain text).
//! - `normalize_hook`: one decoded hook POST body (Claude Code only; everyone
//!   else returns `[]`).
//!
//! Both return `0..n` events — most lines produce exactly one, but Codex emits
//! `tool_call_start + status_badge` together and a Claude `assistant` block can
//! fold to a single message. Adapters carry per-session mutable state (Codex's
//! tool-id correlation map), so a fresh adapter is built per session, mirroring
//! Swift's `makeNormalizer(for:)`.

mod claude;
mod codex;
mod heuristic;

pub use claude::ClaudeCodeAdapter;
pub use codex::CodexAdapter;
pub use heuristic::HeuristicAdapter;

use serde_json::Value;

use crate::remote::{AgentEvent, AgentProvider, EffortLevel, ToolKind};

/// Translates provider-specific output into canonical [`AgentEvent`]s. Object
/// state may mutate across calls (tool-id correlation), so each session owns its
/// own boxed normalizer; calls are serialised by the owning host's line loop.
pub trait Normalizer: Send {
    /// Normalize one stdout line (newline already stripped). `0..n` events.
    fn normalize_stream_line(&mut self, line: &[u8]) -> Vec<AgentEvent>;

    /// Normalize one decoded hook POST body. `0..n` events. Non-Claude
    /// providers have no hook system and return `[]`.
    fn normalize_hook(&mut self, _payload: &Value) -> Vec<AgentEvent> {
        Vec::new()
    }
}

/// Build the normalizer for a provider, mirroring `SessionManager.makeNormalizer`.
pub fn make_normalizer(provider: AgentProvider) -> Box<dyn Normalizer> {
    match provider {
        AgentProvider::ClaudeCode => Box::new(ClaudeCodeAdapter::new()),
        AgentProvider::Codex => Box::new(CodexAdapter::new()),
        AgentProvider::Opencode => Box::new(HeuristicAdapter::open_code()),
        AgentProvider::Antigravity => Box::new(HeuristicAdapter::antigravity()),
        AgentProvider::Hermes => Box::new(HeuristicAdapter::hermes()),
    }
}

// ---- Shared helpers (used by more than one adapter) ----------------------

/// Parse a JSON object line, returning `None` for empty/non-object/invalid input.
/// Strips a single trailing `\r` so CRLF stream framing doesn't break decoding.
pub(crate) fn parse_object_line(line: &[u8]) -> Option<serde_json::Map<String, Value>> {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    if line.is_empty() {
        return None;
    }
    match serde_json::from_slice::<Value>(line) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

/// Truncate a string to at most `n` chars (not bytes) so multi-byte UTF-8 is
/// never sliced mid-codepoint. Mirrors Swift's `String.prefix(n)`.
pub(crate) fn prefix_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Map an `effort` sub-object (`{ "level": "high" }`) to an [`EffortLevel`].
pub(crate) fn effort_from(effort: Option<&Value>) -> Option<EffortLevel> {
    let level = effort?.get("level")?.as_str()?;
    serde_json::from_value(Value::String(level.to_string())).ok()
}

/// Lower-cased single-line summary of a `tool_input` object, ordered by the
/// same key priority the Swift adapters use (`command` → `path` → `file_path`
/// → `query` → `url` → `prompt` → `content` → first string value).
pub(crate) fn summarize_input(input: Option<&Value>) -> String {
    let Some(Value::Object(map)) = input else {
        return String::new();
    };
    if let Some(cmd) = map.get("command").and_then(Value::as_str) {
        return prefix_chars(cmd.trim(), 120);
    }
    if let Some(path) = map.get("path").and_then(Value::as_str) {
        return path.to_string();
    }
    if let Some(file) = map.get("file_path").and_then(Value::as_str) {
        return file.to_string();
    }
    if let Some(query) = map.get("query").and_then(Value::as_str) {
        return query.to_string();
    }
    if let Some(url) = map.get("url").and_then(Value::as_str) {
        return url.to_string();
    }
    if let Some(prompt) = map.get("prompt").and_then(Value::as_str) {
        return prefix_chars(prompt, 120);
    }
    if let Some(content) = map.get("content").and_then(Value::as_str) {
        return prefix_chars(content, 80);
    }
    // Generic fallback: first string value, in deterministic key order so the
    // summary is stable across runs (serde_json::Map preserves no order unless
    // the `preserve_order` feature is on, so sort keys for determinism).
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    for k in keys {
        if let Some(s) = map.get(k).and_then(Value::as_str) {
            return prefix_chars(s, 120);
        }
    }
    String::new()
}

/// Map a Claude/Codex tool-name string to a [`ToolKind`]. Names are matched
/// case-insensitively; unknowns fall through to `Custom(original_name)` so the
/// client still sees the real label.
pub(crate) fn tool_kind_from(name: &str) -> ToolKind {
    match name.to_lowercase().as_str() {
        "read" => ToolKind::Read,
        "write" => ToolKind::Write,
        "edit" | "multiedit" => ToolKind::Edit,
        "notebookedit" => ToolKind::NotebookEdit,
        "glob" => ToolKind::Glob,
        "grep" => ToolKind::Grep,
        "lsp" => ToolKind::Lsp,
        "bash" => ToolKind::Bash,
        "powershell" => ToolKind::PowerShell,
        "monitor" => ToolKind::Monitor,
        "webfetch" => ToolKind::WebFetch,
        "websearch" => ToolKind::WebSearch,
        "agent" => ToolKind::Agent,
        "skill" => ToolKind::Skill,
        "sendmessage" => ToolKind::SendMessage,
        "taskcreate" => ToolKind::TaskCreate,
        "taskupdate" => ToolKind::TaskUpdate,
        "taskget" => ToolKind::TaskGet,
        "tasklist" => ToolKind::TaskList,
        "taskstop" => ToolKind::TaskStop,
        "croncreate" => ToolKind::CronCreate,
        "crondelete" => ToolKind::CronDelete,
        "cronlist" => ToolKind::CronList,
        "enterplanmode" => ToolKind::EnterPlanMode,
        "exitplanmode" => ToolKind::ExitPlanMode,
        "askuserquestion" => ToolKind::AskUserQuestion,
        "enterworktree" => ToolKind::EnterWorktree,
        "exitworktree" => ToolKind::ExitWorktree,
        "listmcpresources" => ToolKind::ListMcpResources,
        "readmcpresource" => ToolKind::ReadMcpResource,
        "waitformcpservers" => ToolKind::WaitForMcpServers,
        "toolsearch" => ToolKind::ToolSearch,
        "pushnotification" => ToolKind::PushNotification,
        "schedulewakeup" => ToolKind::ScheduleWakeup,
        "remotetrigger" => ToolKind::RemoteTrigger,
        "shareonboardingguide" => ToolKind::ShareOnboardingGuide,
        _ => ToolKind::Custom(name.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_object_line_strips_cr_and_rejects_non_objects() {
        assert!(parse_object_line(b"").is_none());
        assert!(parse_object_line(b"not json").is_none());
        assert!(parse_object_line(b"[1,2,3]").is_none(), "array is not an object");
        assert!(parse_object_line(b"{\"a\":1}\r").is_some(), "trailing CR tolerated");
    }

    #[test]
    fn prefix_chars_never_splits_a_codepoint() {
        // 3 multi-byte chars; prefix(2) must keep 2 whole chars, not byte-slice.
        assert_eq!(prefix_chars("héllo", 2), "hé");
        assert_eq!(prefix_chars("abc", 10), "abc");
    }

    #[test]
    fn effort_from_reads_level() {
        let v = serde_json::json!({ "level": "xhigh" });
        assert_eq!(effort_from(Some(&v)), Some(EffortLevel::Xhigh));
        assert_eq!(effort_from(None), None);
        assert_eq!(effort_from(Some(&serde_json::json!({}))), None);
    }

    #[test]
    fn summarize_input_priority_and_fallback() {
        let cmd = serde_json::json!({ "command": "  ls -la  ", "path": "/x" });
        assert_eq!(summarize_input(Some(&cmd)), "ls -la", "command wins and is trimmed");

        let path = serde_json::json!({ "path": "/repo/a.rs" });
        assert_eq!(summarize_input(Some(&path)), "/repo/a.rs");

        let fallback = serde_json::json!({ "zeta": "z", "alpha": "a" });
        assert_eq!(summarize_input(Some(&fallback)), "a", "first key alphabetically");

        assert_eq!(summarize_input(None), "");
        assert_eq!(summarize_input(Some(&serde_json::json!(42))), "");
    }

    #[test]
    fn tool_kind_known_and_custom() {
        assert_eq!(tool_kind_from("Bash"), ToolKind::Bash);
        assert_eq!(tool_kind_from("MultiEdit"), ToolKind::Edit);
        assert_eq!(tool_kind_from("WebFetch"), ToolKind::WebFetch);
        assert_eq!(tool_kind_from("MyTool"), ToolKind::Custom("MyTool".into()));
    }

    #[test]
    fn make_normalizer_covers_every_provider() {
        // Each provider yields a working normalizer (no panic, callable).
        for p in [
            AgentProvider::ClaudeCode,
            AgentProvider::Codex,
            AgentProvider::Opencode,
            AgentProvider::Antigravity,
            AgentProvider::Hermes,
        ] {
            let mut n = make_normalizer(p);
            // empty line yields nothing on every adapter
            assert!(n.normalize_stream_line(b"").is_empty());
        }
    }
}
