//! Shared heuristic normalizer for the three providers without a structured
//! event stream or hook system: OpenCode, Antigravity, and Hermes.
//!
//! The Swift `OpenCodeAdapter`, `AntigravityAdapter`, and `HermesAdapter` are
//! byte-for-byte identical except that Hermes additionally drops lines whose
//! `role` is present and not `"assistant"`. This single adapter carries a
//! `filter_non_assistant_role` flag to capture that one difference, so the three
//! collapse to one implementation (per the task's "shared heuristic fallback is
//! acceptable — say so" allowance). The heuristic:
//!
//! - Try to parse the line as a JSON object; if it has `content`/`text`/`message`
//!   string → `token_delta`; `error` string → `session_error(unknown)`;
//!   `done:true` → `turn_stop`.
//! - Otherwise treat the whole line as plain assistant text → `token_delta`
//!   (with a trailing newline re-appended, matching Swift).

use serde_json::Value;

use super::{parse_object_line, Normalizer};
use crate::remote::{AgentEvent, StopFailureReason};

pub struct HeuristicAdapter {
    /// Hermes-only: skip lines whose `role` field is present and ≠ "assistant".
    filter_non_assistant_role: bool,
}

impl HeuristicAdapter {
    pub fn open_code() -> Self {
        Self { filter_non_assistant_role: false }
    }
    pub fn antigravity() -> Self {
        Self { filter_non_assistant_role: false }
    }
    pub fn hermes() -> Self {
        Self { filter_non_assistant_role: true }
    }
}

impl Normalizer for HeuristicAdapter {
    fn normalize_stream_line(&mut self, line: &[u8]) -> Vec<AgentEvent> {
        // Strip a single trailing CR (CRLF framing) before any plain-text path,
        // and reject an empty line, mirroring the Swift adapters.
        let stripped = line.strip_suffix(b"\r").unwrap_or(line);
        if stripped.is_empty() {
            return vec![];
        }

        if let Some(obj) = parse_object_line(line) {
            let obj = Value::Object(obj);

            if self.filter_non_assistant_role {
                if let Some(role) = obj.get("role").and_then(Value::as_str) {
                    if role != "assistant" {
                        return vec![];
                    }
                }
            }

            for key in ["content", "text", "message"] {
                if let Some(t) = obj.get(key).and_then(Value::as_str) {
                    if !t.is_empty() {
                        return vec![AgentEvent::TokenDelta { text: t.to_string() }];
                    }
                }
            }
            if obj.get("error").and_then(Value::as_str).is_some() {
                return vec![AgentEvent::SessionError { reason: StopFailureReason::Unknown }];
            }
            if obj.get("done").and_then(Value::as_bool) == Some(true) {
                return vec![AgentEvent::TurnStop {
                    cost: None,
                    input_tokens: None,
                    output_tokens: None,
                    effort_level: None,
                }];
            }
            // A JSON object with none of the recognised keys yields nothing
            // (it parsed, so we don't fall through to plain-text treatment).
            return vec![];
        }

        // Plain text line: emit as a token delta with the newline re-appended.
        match std::str::from_utf8(stripped) {
            Ok(text) if !text.trim().is_empty() => {
                vec![AgentEvent::TokenDelta { text: format!("{text}\n") }]
            }
            _ => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(a: &mut HeuristicAdapter, bytes: &[u8]) -> Vec<AgentEvent> {
        a.normalize_stream_line(bytes)
    }

    #[test]
    fn json_content_text_message_to_token_delta() {
        let mut a = HeuristicAdapter::open_code();
        assert_eq!(
            line(&mut a, b"{\"content\":\"a\"}"),
            vec![AgentEvent::TokenDelta { text: "a".into() }]
        );
        assert_eq!(
            line(&mut a, b"{\"text\":\"b\"}"),
            vec![AgentEvent::TokenDelta { text: "b".into() }]
        );
        assert_eq!(
            line(&mut a, b"{\"message\":\"c\"}"),
            vec![AgentEvent::TokenDelta { text: "c".into() }]
        );
    }

    #[test]
    fn json_error_and_done() {
        let mut a = HeuristicAdapter::antigravity();
        assert_eq!(
            line(&mut a, &serde_json::to_vec(&json!({ "error": "x" })).unwrap()),
            vec![AgentEvent::SessionError { reason: StopFailureReason::Unknown }]
        );
        assert_eq!(
            line(&mut a, &serde_json::to_vec(&json!({ "done": true })).unwrap()),
            vec![AgentEvent::TurnStop { cost: None, input_tokens: None, output_tokens: None, effort_level: None }]
        );
    }

    #[test]
    fn plain_text_line_becomes_token_delta_with_newline() {
        let mut a = HeuristicAdapter::open_code();
        assert_eq!(
            line(&mut a, b"hello world"),
            vec![AgentEvent::TokenDelta { text: "hello world\n".into() }]
        );
    }

    #[test]
    fn crlf_is_stripped_and_blank_lines_dropped() {
        let mut a = HeuristicAdapter::open_code();
        assert!(line(&mut a, b"\r").is_empty());
        assert!(line(&mut a, b"   ").is_empty());
        assert_eq!(
            line(&mut a, b"hi\r"),
            vec![AgentEvent::TokenDelta { text: "hi\n".into() }]
        );
    }

    #[test]
    fn hermes_filters_non_assistant_role() {
        let mut a = HeuristicAdapter::hermes();
        // user role dropped
        assert!(line(&mut a, b"{\"role\":\"user\",\"content\":\"x\"}").is_empty());
        // assistant role kept
        assert_eq!(
            line(&mut a, b"{\"role\":\"assistant\",\"content\":\"y\"}"),
            vec![AgentEvent::TokenDelta { text: "y".into() }]
        );
        // role absent → treated as assistant
        assert_eq!(
            line(&mut a, b"{\"content\":\"z\"}"),
            vec![AgentEvent::TokenDelta { text: "z".into() }]
        );
    }

    #[test]
    fn non_hermes_does_not_filter_role() {
        let mut a = HeuristicAdapter::open_code();
        // OpenCode keeps a user-role line if it has content (no role filtering).
        assert_eq!(
            line(&mut a, b"{\"role\":\"user\",\"content\":\"keep\"}"),
            vec![AgentEvent::TokenDelta { text: "keep".into() }]
        );
    }

    #[test]
    fn unrecognised_json_object_yields_nothing() {
        let mut a = HeuristicAdapter::open_code();
        assert!(line(&mut a, b"{\"foo\":1}").is_empty());
    }

    #[test]
    fn heuristic_has_no_hooks() {
        let mut a = HeuristicAdapter::hermes();
        assert!(a.normalize_hook(&json!({ "hook_event_name": "PreToolUse" })).is_empty());
    }
}
