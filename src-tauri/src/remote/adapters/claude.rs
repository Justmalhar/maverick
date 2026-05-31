//! Rust port of Swift `ClaudeCodeAdapter` — the rich Claude Code normalizer.
//!
//! Stream-JSON (`claude --output-format stream-json`) folds to:
//! - `stream` → `token_delta` (incremental text deltas)
//! - `assistant` → `assistant_message` (a finished assistant block)
//! - `user` → `user_message`
//! - `result` → `turn_stop` (cost + token totals)
//!
//! Hook payloads (POSTed by Claude Code to our localhost hook server) cover the
//! full lifecycle: tool calls, permissions, sub-agents, tasks, compaction,
//! worktrees, session start/end, cwd changes, notifications, and stop failures.

use serde_json::Value;

use super::{effort_from, parse_object_line, summarize_input, tool_kind_from, Normalizer};
use crate::remote::{
    AgentEvent, AgentProvider, NotificationType, PermissionEvent, SessionEndReason, SessionSource,
    StopFailureReason, ToolCallEvent,
};

/// Claude Code normalizer. Stateless across lines (Claude's stream-json carries
/// no cross-line correlation that the adapter must hold).
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        ClaudeCodeAdapter
    }
}

impl Normalizer for ClaudeCodeAdapter {
    fn normalize_stream_line(&mut self, line: &[u8]) -> Vec<AgentEvent> {
        let Some(obj) = parse_object_line(line) else {
            return vec![];
        };
        let obj = Value::Object(obj);
        let Some(ty) = obj.get("type").and_then(Value::as_str) else {
            return vec![];
        };

        match ty {
            // { type:"stream", event:{ delta:{ type:"text_delta", text:"..." } } }
            "stream" => {
                let delta = obj.get("event").and_then(|e| e.get("delta"));
                let is_text = delta
                    .and_then(|d| d.get("type"))
                    .and_then(Value::as_str)
                    == Some("text_delta");
                let text = delta.and_then(|d| d.get("text")).and_then(Value::as_str);
                match (is_text, text) {
                    (true, Some(t)) => vec![AgentEvent::TokenDelta { text: t.to_string() }],
                    _ => vec![],
                }
            }
            // { type:"assistant", message:{ content:[ {type:"text", text:"..."} ] } }
            "assistant" => {
                let text = extract_text_blocks(&obj);
                if text.is_empty() {
                    vec![]
                } else {
                    vec![AgentEvent::AssistantMessage { text }]
                }
            }
            // { type:"result", total_cost_usd, total_input_tokens, total_output_tokens }
            "result" => {
                let cost = obj.get("total_cost_usd").and_then(Value::as_f64);
                let input_tokens = obj.get("total_input_tokens").and_then(Value::as_i64);
                let output_tokens = obj.get("total_output_tokens").and_then(Value::as_i64);
                vec![AgentEvent::TurnStop {
                    cost,
                    input_tokens,
                    output_tokens,
                    effort_level: None,
                }]
            }
            // { type:"user", message:{ content:[ {type:"text", text:"..."} ] } }
            "user" => {
                let text = extract_user_text(&obj);
                if text.is_empty() {
                    vec![]
                } else {
                    vec![AgentEvent::UserMessage { text }]
                }
            }
            _ => vec![],
        }
    }

    fn normalize_hook(&mut self, payload: &Value) -> Vec<AgentEvent> {
        let Some(name) = payload.get("hook_event_name").and_then(Value::as_str) else {
            return vec![];
        };

        match name {
            "PreToolUse" => vec![AgentEvent::ToolCallStart {
                event: tool_call_event(payload, ToolField::Start),
            }],
            "PostToolUse" => vec![AgentEvent::ToolCallComplete {
                event: tool_call_event(payload, ToolField::Complete),
            }],
            "PostToolUseFailure" => vec![AgentEvent::ToolCallFailed {
                event: tool_call_event(payload, ToolField::Failure),
            }],
            "PostToolBatch" => {
                let events = payload
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .map(|calls| {
                        calls
                            .iter()
                            .map(|c| tool_call_event(c, ToolField::Complete))
                            .collect()
                    })
                    .unwrap_or_default();
                vec![AgentEvent::ToolBatchComplete { events }]
            }
            "PermissionRequest" => {
                let request_id = string_or_uuid(payload, "request_id");
                let tool = string_field(payload, "tool_name");
                let input_summary = summarize_input(payload.get("tool_input"));
                let rule_matched = payload
                    .get("rule_matched")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                vec![AgentEvent::PermissionRequest {
                    permission_event: PermissionEvent {
                        request_id,
                        tool,
                        input_summary,
                        rule_matched,
                    },
                }]
            }
            "PermissionDenied" => vec![AgentEvent::PermissionDenied {
                tool: string_field(payload, "tool_name"),
                reason: string_field(payload, "denial_reason"),
            }],
            "Stop" => vec![AgentEvent::TurnStop {
                cost: None,
                input_tokens: None,
                output_tokens: None,
                effort_level: None,
            }],
            "SubagentStart" => vec![AgentEvent::SubagentStart {
                id: string_or_uuid(payload, "agent_id"),
                agent_type: string_field(payload, "agent_type"),
                parent_session_id: string_field(payload, "parent_session_id"),
            }],
            "SubagentStop" => vec![AgentEvent::SubagentStop {
                id: string_or_uuid(payload, "agent_id"),
                agent_type: string_field(payload, "agent_type"),
            }],
            "SessionStart" => {
                let source_raw = payload
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("startup");
                let source = serde_json::from_value(Value::String(source_raw.to_string()))
                    .unwrap_or(SessionSource::Startup);
                vec![AgentEvent::SessionStart {
                    id: string_or_uuid(payload, "session_id"),
                    provider: AgentProvider::ClaudeCode,
                    cwd: string_field(payload, "cwd"),
                    model: payload.get("model").and_then(Value::as_str).map(str::to_string),
                    source,
                }]
            }
            "SessionEnd" => {
                // Claude's `source` raw values align with SessionEndReason
                // (clear/resume/logout/promptExit); unknown → other.
                let reason_raw = payload.get("source").and_then(Value::as_str).unwrap_or("");
                let reason = serde_json::from_value(Value::String(reason_raw.to_string()))
                    .unwrap_or(SessionEndReason::Other);
                vec![AgentEvent::SessionEnd { reason }]
            }
            "WorktreeRemove" => vec![AgentEvent::WorktreeRemoved {
                path: string_field(payload, "worktree_path"),
            }],
            "Notification" => {
                let notif_raw = payload
                    .get("notification_type")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let notification_type =
                    serde_json::from_value(Value::String(notif_raw.to_string()))
                        .unwrap_or(NotificationType::PermissionPrompt);
                vec![AgentEvent::Notification {
                    notification_type,
                    message: string_field(payload, "message"),
                }]
            }
            "TaskCreated" => vec![AgentEvent::TaskCreated {
                id: string_or_uuid(payload, "task_id"),
                title: string_field(payload, "task_title"),
            }],
            "TaskCompleted" => vec![AgentEvent::TaskCompleted {
                id: string_or_uuid(payload, "task_id"),
            }],
            "PreCompact" => vec![AgentEvent::CompactionStarted],
            "PostCompact" => vec![AgentEvent::CompactionComplete],
            "WorktreeCreate" => vec![AgentEvent::WorktreeCreated {
                name: string_field(payload, "worktree_name"),
                branch: string_field(payload, "base_branch"),
            }],
            "CwdChanged" => vec![AgentEvent::CwdChanged {
                from: string_field(payload, "previous_cwd"),
                to: string_field(payload, "cwd"),
            }],
            "StopFailure" => vec![AgentEvent::SessionError {
                reason: map_failure_type(payload.get("failure_type").and_then(Value::as_str).unwrap_or("")),
            }],
            _ => vec![],
        }
    }
}

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

/// Which optional fields a `ToolCallEvent` should carry, per hook kind.
enum ToolField {
    Start,
    Complete,
    Failure,
}

/// Build a `ToolCallEvent` from a hook payload (or one element of a batch).
fn tool_call_event(payload: &Value, kind: ToolField) -> ToolCallEvent {
    let tool_name = string_field(payload, "tool_name");
    let id = string_or_uuid(payload, "tool_use_id");
    let input_summary = summarize_input(payload.get("tool_input"));
    let effort = effort_from(payload.get("effort"));
    match kind {
        ToolField::Start => ToolCallEvent {
            id,
            tool: tool_kind_from(&tool_name),
            input_summary,
            result: None,
            error: None,
            duration_ms: None,
            file_diffs: None,
            effort,
        },
        ToolField::Complete => ToolCallEvent {
            id,
            tool: tool_kind_from(&tool_name),
            input_summary,
            result: payload.get("tool_result").and_then(Value::as_str).map(str::to_string),
            error: None,
            duration_ms: payload.get("duration_ms").and_then(Value::as_i64),
            // Swift defers diff parsing (PostToolUse carries no embedded stats).
            file_diffs: None,
            effort,
        },
        ToolField::Failure => ToolCallEvent {
            id,
            tool: tool_kind_from(&tool_name),
            input_summary,
            result: None,
            error: payload.get("tool_error").and_then(Value::as_str).map(str::to_string),
            duration_ms: None,
            file_diffs: None,
            effort: None,
        },
    }
}

/// Concatenate all `text`-type blocks in an assistant message's content array.
/// Tries `message.content` then a root-level `content` fallback, matching Swift.
fn extract_text_blocks(obj: &Value) -> String {
    if let Some(content) = obj.get("message").and_then(|m| m.get("content")).and_then(Value::as_array) {
        return join_text_blocks(content);
    }
    if let Some(content) = obj.get("content").and_then(Value::as_array) {
        return join_text_blocks(content);
    }
    String::new()
}

/// User text: content array of text blocks, or a plain string `message.content`.
fn extract_user_text(obj: &Value) -> String {
    let message = obj.get("message");
    if let Some(content) = message.and_then(|m| m.get("content")).and_then(Value::as_array) {
        return join_text_blocks(content);
    }
    if let Some(text) = message.and_then(|m| m.get("content")).and_then(Value::as_str) {
        return text.to_string();
    }
    String::new()
}

fn join_text_blocks(content: &[Value]) -> String {
    content
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect()
}

/// Read a string field, defaulting to `""` when absent (Swift `?? ""`).
fn string_field(payload: &Value, key: &str) -> String {
    payload.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Read a string field, synthesising a fresh UUID when absent (Swift
/// `?? UUID().uuidString`).
fn string_or_uuid(payload: &Value, key: &str) -> String {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

/// Map Claude Code's `failure_type` string to a `StopFailureReason`.
fn map_failure_type(failure_type: &str) -> StopFailureReason {
    match failure_type.to_lowercase().as_str() {
        "rate_limit" | "ratelimit" => StopFailureReason::RateLimit,
        "auth_failed" | "authfailed" | "unauthorized" => StopFailureReason::AuthFailed,
        "billing" => StopFailureReason::Billing,
        "server_error" | "servererror" => StopFailureReason::ServerError,
        "max_tokens" | "maxtokens" => StopFailureReason::MaxTokens,
        _ => StopFailureReason::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::{EffortLevel, ToolKind};
    use serde_json::json;

    fn ad() -> ClaudeCodeAdapter {
        ClaudeCodeAdapter::new()
    }

    fn one(line: Value) -> AgentEvent {
        let bytes = serde_json::to_vec(&line).unwrap();
        let mut events = ad().normalize_stream_line(&bytes);
        assert_eq!(events.len(), 1, "expected exactly one event for {line}");
        events.pop().unwrap()
    }

    fn hook_one(payload: Value) -> AgentEvent {
        let mut events = ad().normalize_hook(&payload);
        assert_eq!(events.len(), 1, "expected one event for {payload}");
        events.pop().unwrap()
    }

    // ---- stream-json ----

    #[test]
    fn stream_text_delta_to_token_delta() {
        let e = one(json!({ "type": "stream", "event": { "delta": { "type": "text_delta", "text": "Hel" } } }));
        assert_eq!(e, AgentEvent::TokenDelta { text: "Hel".into() });
    }

    #[test]
    fn stream_non_text_delta_is_dropped() {
        let bytes = serde_json::to_vec(&json!({
            "type": "stream", "event": { "delta": { "type": "input_json_delta", "partial": "{" } }
        }))
        .unwrap();
        assert!(ad().normalize_stream_line(&bytes).is_empty());
    }

    #[test]
    fn assistant_concatenates_text_blocks_and_skips_non_text() {
        let e = one(json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "text", "text": "Hello " },
                { "type": "tool_use", "name": "Bash" },
                { "type": "text", "text": "world" }
            ]}
        }));
        assert_eq!(e, AgentEvent::AssistantMessage { text: "Hello world".into() });
    }

    #[test]
    fn assistant_empty_text_is_dropped() {
        let bytes = serde_json::to_vec(&json!({
            "type": "assistant", "message": { "content": [ { "type": "tool_use", "name": "Bash" } ] }
        }))
        .unwrap();
        assert!(ad().normalize_stream_line(&bytes).is_empty());
    }

    #[test]
    fn result_to_turn_stop_with_cost_and_tokens() {
        let e = one(json!({
            "type": "result", "total_cost_usd": 0.0123, "total_input_tokens": 100, "total_output_tokens": 50
        }));
        assert_eq!(
            e,
            AgentEvent::TurnStop {
                cost: Some(0.0123),
                input_tokens: Some(100),
                output_tokens: Some(50),
                effort_level: None,
            }
        );
    }

    #[test]
    fn user_message_from_content_array() {
        let e = one(json!({
            "type": "user", "message": { "content": [ { "type": "text", "text": "do it" } ] }
        }));
        assert_eq!(e, AgentEvent::UserMessage { text: "do it".into() });
    }

    #[test]
    fn user_message_from_plain_string_content() {
        let e = one(json!({ "type": "user", "message": { "content": "plain" } }));
        assert_eq!(e, AgentEvent::UserMessage { text: "plain".into() });
    }

    #[test]
    fn unknown_stream_type_and_garbage_yield_nothing() {
        assert!(ad().normalize_stream_line(b"{\"type\":\"system\"}").is_empty());
        assert!(ad().normalize_stream_line(b"not json").is_empty());
        assert!(ad().normalize_stream_line(b"{\"no\":\"type\"}").is_empty());
    }

    // ---- hooks ----

    #[test]
    fn pre_tool_use_to_tool_call_start_with_effort() {
        let e = hook_one(json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_use_id": "tc1",
            "tool_input": { "command": "ls -la" },
            "effort": { "level": "high" }
        }));
        match e {
            AgentEvent::ToolCallStart { event } => {
                assert_eq!(event.id, "tc1");
                assert_eq!(event.tool, ToolKind::Bash);
                assert_eq!(event.input_summary, "ls -la");
                assert_eq!(event.effort, Some(EffortLevel::High));
                assert!(event.result.is_none() && event.error.is_none());
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn post_tool_use_carries_result_and_duration() {
        let e = hook_one(json!({
            "hook_event_name": "PostToolUse",
            "tool_name": "Read",
            "tool_use_id": "tc2",
            "tool_input": { "file_path": "/a.rs" },
            "tool_result": "contents",
            "duration_ms": 42
        }));
        match e {
            AgentEvent::ToolCallComplete { event } => {
                assert_eq!(event.tool, ToolKind::Read);
                assert_eq!(event.input_summary, "/a.rs");
                assert_eq!(event.result.as_deref(), Some("contents"));
                assert_eq!(event.duration_ms, Some(42));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn post_tool_use_failure_carries_error() {
        let e = hook_one(json!({
            "hook_event_name": "PostToolUseFailure",
            "tool_name": "Bash",
            "tool_use_id": "tc3",
            "tool_error": "boom"
        }));
        match e {
            AgentEvent::ToolCallFailed { event } => {
                assert_eq!(event.error.as_deref(), Some("boom"));
                assert!(event.result.is_none());
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn post_tool_batch_maps_each_call() {
        let e = hook_one(json!({
            "hook_event_name": "PostToolBatch",
            "tool_calls": [
                { "tool_name": "Read", "tool_use_id": "a", "tool_result": "x" },
                { "tool_name": "Grep", "tool_use_id": "b", "tool_input": { "query": "fn" } }
            ]
        }));
        match e {
            AgentEvent::ToolBatchComplete { events } => {
                assert_eq!(events.len(), 2);
                assert_eq!(events[0].tool, ToolKind::Read);
                assert_eq!(events[1].tool, ToolKind::Grep);
                assert_eq!(events[1].input_summary, "fn");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn post_tool_batch_without_calls_is_empty_batch() {
        let e = hook_one(json!({ "hook_event_name": "PostToolBatch" }));
        assert_eq!(e, AgentEvent::ToolBatchComplete { events: vec![] });
    }

    #[test]
    fn permission_request_full_shape() {
        let e = hook_one(json!({
            "hook_event_name": "PermissionRequest",
            "request_id": "r1",
            "tool_name": "Bash",
            "tool_input": { "command": "rm -rf /" },
            "rule_matched": "deny-rm"
        }));
        match e {
            AgentEvent::PermissionRequest { permission_event } => {
                assert_eq!(permission_event.request_id, "r1");
                assert_eq!(permission_event.tool, "Bash");
                assert_eq!(permission_event.input_summary, "rm -rf /");
                assert_eq!(permission_event.rule_matched.as_deref(), Some("deny-rm"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn permission_denied_and_stop_and_compaction() {
        assert_eq!(
            hook_one(json!({ "hook_event_name": "PermissionDenied", "tool_name": "Bash", "denial_reason": "policy" })),
            AgentEvent::PermissionDenied { tool: "Bash".into(), reason: "policy".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "Stop" })),
            AgentEvent::TurnStop { cost: None, input_tokens: None, output_tokens: None, effort_level: None }
        );
        assert_eq!(hook_one(json!({ "hook_event_name": "PreCompact" })), AgentEvent::CompactionStarted);
        assert_eq!(hook_one(json!({ "hook_event_name": "PostCompact" })), AgentEvent::CompactionComplete);
    }

    #[test]
    fn session_start_maps_provider_and_source() {
        let e = hook_one(json!({
            "hook_event_name": "SessionStart",
            "session_id": "claude-abc",
            "cwd": "/repo",
            "model": "opus",
            "source": "resume"
        }));
        assert_eq!(
            e,
            AgentEvent::SessionStart {
                id: "claude-abc".into(),
                provider: AgentProvider::ClaudeCode,
                cwd: "/repo".into(),
                model: Some("opus".into()),
                source: SessionSource::Resume,
            }
        );
    }

    #[test]
    fn session_start_defaults_source_to_startup_on_unknown() {
        let e = hook_one(json!({
            "hook_event_name": "SessionStart", "session_id": "s", "cwd": "/", "source": "weird"
        }));
        match e {
            AgentEvent::SessionStart { source, .. } => assert_eq!(source, SessionSource::Startup),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn session_end_maps_source_to_reason_and_falls_back_to_other() {
        assert_eq!(
            hook_one(json!({ "hook_event_name": "SessionEnd", "source": "logout" })),
            AgentEvent::SessionEnd { reason: SessionEndReason::Logout }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "SessionEnd", "source": "???" })),
            AgentEvent::SessionEnd { reason: SessionEndReason::Other }
        );
    }

    #[test]
    fn subagent_task_worktree_cwd_notification_failure() {
        assert!(matches!(
            hook_one(json!({ "hook_event_name": "SubagentStart", "agent_id": "a", "agent_type": "reviewer", "parent_session_id": "s" })),
            AgentEvent::SubagentStart { .. }
        ));
        assert!(matches!(
            hook_one(json!({ "hook_event_name": "SubagentStop", "agent_id": "a", "agent_type": "reviewer" })),
            AgentEvent::SubagentStop { .. }
        ));
        assert_eq!(
            hook_one(json!({ "hook_event_name": "TaskCreated", "task_id": "t1", "task_title": "Do" })),
            AgentEvent::TaskCreated { id: "t1".into(), title: "Do".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "TaskCompleted", "task_id": "t1" })),
            AgentEvent::TaskCompleted { id: "t1".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "WorktreeCreate", "worktree_name": "wt", "base_branch": "main" })),
            AgentEvent::WorktreeCreated { name: "wt".into(), branch: "main".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "WorktreeRemove", "worktree_path": "/wt" })),
            AgentEvent::WorktreeRemoved { path: "/wt".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "CwdChanged", "previous_cwd": "/a", "cwd": "/b" })),
            AgentEvent::CwdChanged { from: "/a".into(), to: "/b".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "Notification", "notification_type": "idlePrompt", "message": "hi" })),
            AgentEvent::Notification { notification_type: NotificationType::IdlePrompt, message: "hi".into() }
        );
        assert_eq!(
            hook_one(json!({ "hook_event_name": "StopFailure", "failure_type": "rate_limit" })),
            AgentEvent::SessionError { reason: StopFailureReason::RateLimit }
        );
    }

    #[test]
    fn failure_type_mapping_covers_all_branches() {
        let cases = [
            ("auth_failed", StopFailureReason::AuthFailed),
            ("unauthorized", StopFailureReason::AuthFailed),
            ("billing", StopFailureReason::Billing),
            ("server_error", StopFailureReason::ServerError),
            ("max_tokens", StopFailureReason::MaxTokens),
            ("something_else", StopFailureReason::Unknown),
        ];
        for (raw, expected) in cases {
            assert_eq!(
                hook_one(json!({ "hook_event_name": "StopFailure", "failure_type": raw })),
                AgentEvent::SessionError { reason: expected }
            );
        }
    }

    #[test]
    fn missing_tool_use_id_synthesises_uuid() {
        let e = hook_one(json!({ "hook_event_name": "PreToolUse", "tool_name": "Bash" }));
        match e {
            AgentEvent::ToolCallStart { event } => {
                assert!(uuid::Uuid::parse_str(&event.id).is_ok(), "synthesised a UUID");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn unknown_hook_and_missing_name_yield_nothing() {
        assert!(ad().normalize_hook(&json!({ "hook_event_name": "Mystery" })).is_empty());
        assert!(ad().normalize_hook(&json!({ "no": "name" })).is_empty());
    }
}
