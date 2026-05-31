//! Rust port of Swift `CodexAdapter` — normalizes `codex --json` stdout.
//!
//! Codex has no hook system, so tool permission is represented as a static
//! `status_badge("Auto-approved", info)` emitted alongside each `tool_call_start`
//! in the same return vec. Tool-call IDs are correlated across `tool`/`tool_result`
//! lines via `pending_tool_ids`: the UUID minted at start is reused at completion
//! so the client can pair them. The owning host serialises calls, so a plain
//! `HashMap` (no lock) suffices, mirroring the Swift adapter's outputQueue serialism.

use std::collections::HashMap;

use serde_json::Value;

use super::{parse_object_line, prefix_chars, Normalizer};
use crate::remote::{AgentEvent, BadgeKind, StopFailureReason, ToolCallEvent, ToolKind};

pub struct CodexAdapter {
    /// stable Codex tool key (`id` or name) → UUID minted at tool_call_start.
    pending_tool_ids: HashMap<String, String>,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self { pending_tool_ids: HashMap::new() }
    }
}

impl Normalizer for CodexAdapter {
    fn normalize_stream_line(&mut self, line: &[u8]) -> Vec<AgentEvent> {
        let Some(obj) = parse_object_line(line) else {
            return vec![];
        };
        let obj = Value::Object(obj);
        let Some(ty) = obj.get("type").and_then(Value::as_str) else {
            return vec![];
        };

        match ty {
            "output" => match obj.get("text").and_then(Value::as_str) {
                Some(t) if !t.is_empty() => vec![AgentEvent::TokenDelta { text: t.to_string() }],
                _ => vec![],
            },
            "message" => {
                let is_assistant = obj.get("role").and_then(Value::as_str) == Some("assistant");
                let content = obj.get("content").and_then(Value::as_str);
                match (is_assistant, content) {
                    (true, Some(c)) if !c.is_empty() => {
                        vec![AgentEvent::TokenDelta { text: c.to_string() }]
                    }
                    _ => vec![],
                }
            }
            "tool" => {
                let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
                let stable_key = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or(name)
                    .to_string();
                let id = uuid::Uuid::new_v4().to_string();
                self.pending_tool_ids.insert(stable_key, id.clone());
                let event = ToolCallEvent {
                    id,
                    tool: codex_tool_kind(name),
                    input_summary: summarize_input(name, obj.get("input")),
                    result: None,
                    error: None,
                    duration_ms: None,
                    file_diffs: None,
                    effort: None,
                };
                vec![
                    AgentEvent::ToolCallStart { event },
                    AgentEvent::StatusBadge { text: "Auto-approved".into(), kind: BadgeKind::Info },
                ]
            }
            "tool_result" => {
                let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
                let stable_key = obj.get("id").and_then(Value::as_str).unwrap_or(name);
                let id = self
                    .pending_tool_ids
                    .remove(stable_key)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let event = ToolCallEvent {
                    id,
                    tool: codex_tool_kind(name),
                    input_summary: String::new(),
                    result: obj.get("output").and_then(Value::as_str).map(str::to_string),
                    error: None,
                    duration_ms: obj.get("duration").and_then(Value::as_i64),
                    file_diffs: None,
                    effort: None,
                };
                vec![AgentEvent::ToolCallComplete { event }]
            }
            "done" => vec![AgentEvent::TurnStop {
                cost: obj.get("cost").and_then(Value::as_f64),
                input_tokens: None,
                output_tokens: None,
                effort_level: None,
            }],
            "error" => vec![AgentEvent::SessionError { reason: StopFailureReason::Unknown }],
            _ => vec![],
        }
    }
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
    }
}

fn codex_tool_kind(name: &str) -> ToolKind {
    match name.to_lowercase().as_str() {
        "bash" | "shell" | "run_command" => ToolKind::Bash,
        "read_file" | "read" => ToolKind::Read,
        "write_file" | "write" => ToolKind::Write,
        "list_directory" | "ls" => ToolKind::Glob,
        "search" | "grep" => ToolKind::Grep,
        "web_fetch" | "fetch" => ToolKind::WebFetch,
        "web_search" | "search_web" => ToolKind::WebSearch,
        _ => ToolKind::Custom(name.to_string()),
    }
}

/// Codex's tool-input summary falls back to the tool *name* (not empty) when no
/// recognised input key is present — distinct from the Claude summarizer.
fn summarize_input(name: &str, input: Option<&Value>) -> String {
    let Some(Value::Object(map)) = input else {
        return name.to_string();
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
    if let Some(q) = map.get("query").and_then(Value::as_str) {
        return q.to_string();
    }
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    for k in keys {
        if let Some(s) = map.get(k).and_then(Value::as_str) {
            return prefix_chars(s, 120);
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(adapter: &mut CodexAdapter, v: Value) -> Vec<AgentEvent> {
        adapter.normalize_stream_line(&serde_json::to_vec(&v).unwrap())
    }

    #[test]
    fn output_and_assistant_message_to_token_delta() {
        let mut a = CodexAdapter::new();
        assert_eq!(
            line(&mut a, json!({ "type": "output", "text": "hi" })),
            vec![AgentEvent::TokenDelta { text: "hi".into() }]
        );
        assert_eq!(
            line(&mut a, json!({ "type": "message", "role": "assistant", "content": "yo" })),
            vec![AgentEvent::TokenDelta { text: "yo".into() }]
        );
    }

    #[test]
    fn non_assistant_message_and_empty_output_dropped() {
        let mut a = CodexAdapter::new();
        assert!(line(&mut a, json!({ "type": "message", "role": "user", "content": "x" })).is_empty());
        assert!(line(&mut a, json!({ "type": "output", "text": "" })).is_empty());
    }

    #[test]
    fn tool_emits_start_plus_auto_approved_badge() {
        let mut a = CodexAdapter::new();
        let events = line(&mut a, json!({ "type": "tool", "id": "k1", "name": "bash", "input": { "command": "ls" } }));
        assert_eq!(events.len(), 2);
        match &events[0] {
            AgentEvent::ToolCallStart { event } => {
                assert_eq!(event.tool, ToolKind::Bash);
                assert_eq!(event.input_summary, "ls");
            }
            other => panic!("got {other:?}"),
        }
        assert_eq!(
            events[1],
            AgentEvent::StatusBadge { text: "Auto-approved".into(), kind: BadgeKind::Info }
        );
    }

    #[test]
    fn tool_result_reuses_started_id() {
        let mut a = CodexAdapter::new();
        let start = line(&mut a, json!({ "type": "tool", "id": "k1", "name": "read_file" }));
        let started_id = match &start[0] {
            AgentEvent::ToolCallStart { event } => event.id.clone(),
            other => panic!("got {other:?}"),
        };
        let done = line(&mut a, json!({ "type": "tool_result", "id": "k1", "name": "read_file", "output": "file body", "duration": 12 }));
        match &done[0] {
            AgentEvent::ToolCallComplete { event } => {
                assert_eq!(event.id, started_id, "completion correlates to the start UUID");
                assert_eq!(event.tool, ToolKind::Read);
                assert_eq!(event.result.as_deref(), Some("file body"));
                assert_eq!(event.duration_ms, Some(12));
            }
            other => panic!("got {other:?}"),
        }
        // The pending map was consumed.
        assert!(a.pending_tool_ids.is_empty());
    }

    #[test]
    fn tool_result_without_prior_start_mints_fresh_id() {
        let mut a = CodexAdapter::new();
        let done = line(&mut a, json!({ "type": "tool_result", "name": "grep", "output": "x" }));
        match &done[0] {
            AgentEvent::ToolCallComplete { event } => {
                assert!(uuid::Uuid::parse_str(&event.id).is_ok());
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn done_and_error_map_to_turn_stop_and_session_error() {
        let mut a = CodexAdapter::new();
        assert_eq!(
            line(&mut a, json!({ "type": "done", "cost": 0.5 })),
            vec![AgentEvent::TurnStop { cost: Some(0.5), input_tokens: None, output_tokens: None, effort_level: None }]
        );
        assert_eq!(
            line(&mut a, json!({ "type": "error", "message": "boom" })),
            vec![AgentEvent::SessionError { reason: StopFailureReason::Unknown }]
        );
    }

    #[test]
    fn codex_has_no_hooks() {
        let mut a = CodexAdapter::new();
        assert!(a.normalize_hook(&json!({ "hook_event_name": "PreToolUse" })).is_empty());
    }

    #[test]
    fn summarize_input_falls_back_to_tool_name() {
        let mut a = CodexAdapter::new();
        let events = line(&mut a, json!({ "type": "tool", "name": "custom_thing" }));
        match &events[0] {
            AgentEvent::ToolCallStart { event } => {
                assert_eq!(event.input_summary, "custom_thing");
                assert_eq!(event.tool, ToolKind::Custom("custom_thing".into()));
            }
            other => panic!("got {other:?}"),
        }
    }
}
