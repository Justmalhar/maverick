//! Rust serde port of `MaverickProtocol/AgentEvent.swift`.
//!
//! Wire-format invariants mirrored from the Swift authority:
//! - The simple string enums (`AgentProvider`, `SessionMode`, …) are declared in
//!   Swift as `enum … : String` *without explicit raw values*, so their raw
//!   string is the case name verbatim (camelCase, e.g. `claudeCode`,
//!   `promptExit`, `rateLimit`). They are NOT snake_case. We reproduce that with
//!   `#[serde(rename_all = "camelCase")]`.
//! - `AgentEvent` is a tagged union: a top-level snake_case `type` key with FLAT
//!   sibling keys, replicated via `#[serde(tag = "type", rename_all = "snake_case")]`.
//! - `ToolKind` serialises as a bare string (camelCase known names) with a
//!   `Custom(String)` catch-all for unknown tools — hand-written (de)serialise.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

// MARK: - Simple enums

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentProvider {
    ClaudeCode,
    Codex,
    Antigravity,
    Opencode,
    Hermes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    Terminal,
    Chat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionSource {
    Startup,
    Resume,
    Clear,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionEndReason {
    Clear,
    Resume,
    Logout,
    PromptExit,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopFailureReason {
    RateLimit,
    AuthFailed,
    Billing,
    ServerError,
    MaxTokens,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BadgeKind {
    Info,
    Warning,
    Error,
    Success,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationType {
    PermissionPrompt,
    IdlePrompt,
    AuthSuccess,
    Elicitation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

// MARK: - ToolKind

/// A tool identifier that serialises as a bare string. Known tools use their
/// camelCase Swift case names; anything unrecognised round-trips through
/// `Custom(String)`. This is deliberately NOT a serde-tagged enum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolKind {
    Read,
    Write,
    Edit,
    NotebookEdit,
    Glob,
    Grep,
    Lsp,
    Bash,
    PowerShell,
    Monitor,
    WebFetch,
    WebSearch,
    Agent,
    Skill,
    SendMessage,
    TaskCreate,
    TaskUpdate,
    TaskGet,
    TaskList,
    TaskStop,
    CronCreate,
    CronDelete,
    CronList,
    EnterPlanMode,
    ExitPlanMode,
    AskUserQuestion,
    EnterWorktree,
    ExitWorktree,
    ListMcpResources,
    ReadMcpResource,
    WaitForMcpServers,
    ToolSearch,
    PushNotification,
    ScheduleWakeup,
    RemoteTrigger,
    ShareOnboardingGuide,
    Custom(String),
}

impl ToolKind {
    fn raw_name(&self) -> &str {
        match self {
            ToolKind::Read => "read",
            ToolKind::Write => "write",
            ToolKind::Edit => "edit",
            ToolKind::NotebookEdit => "notebookEdit",
            ToolKind::Glob => "glob",
            ToolKind::Grep => "grep",
            ToolKind::Lsp => "lsp",
            ToolKind::Bash => "bash",
            ToolKind::PowerShell => "powerShell",
            ToolKind::Monitor => "monitor",
            ToolKind::WebFetch => "webFetch",
            ToolKind::WebSearch => "webSearch",
            ToolKind::Agent => "agent",
            ToolKind::Skill => "skill",
            ToolKind::SendMessage => "sendMessage",
            ToolKind::TaskCreate => "taskCreate",
            ToolKind::TaskUpdate => "taskUpdate",
            ToolKind::TaskGet => "taskGet",
            ToolKind::TaskList => "taskList",
            ToolKind::TaskStop => "taskStop",
            ToolKind::CronCreate => "cronCreate",
            ToolKind::CronDelete => "cronDelete",
            ToolKind::CronList => "cronList",
            ToolKind::EnterPlanMode => "enterPlanMode",
            ToolKind::ExitPlanMode => "exitPlanMode",
            ToolKind::AskUserQuestion => "askUserQuestion",
            ToolKind::EnterWorktree => "enterWorktree",
            ToolKind::ExitWorktree => "exitWorktree",
            ToolKind::ListMcpResources => "listMcpResources",
            ToolKind::ReadMcpResource => "readMcpResource",
            ToolKind::WaitForMcpServers => "waitForMcpServers",
            ToolKind::ToolSearch => "toolSearch",
            ToolKind::PushNotification => "pushNotification",
            ToolKind::ScheduleWakeup => "scheduleWakeup",
            ToolKind::RemoteTrigger => "remoteTrigger",
            ToolKind::ShareOnboardingGuide => "shareOnboardingGuide",
            ToolKind::Custom(name) => name,
        }
    }

    fn from_raw(raw: &str) -> ToolKind {
        match raw {
            "read" => ToolKind::Read,
            "write" => ToolKind::Write,
            "edit" => ToolKind::Edit,
            "notebookEdit" => ToolKind::NotebookEdit,
            "glob" => ToolKind::Glob,
            "grep" => ToolKind::Grep,
            "lsp" => ToolKind::Lsp,
            "bash" => ToolKind::Bash,
            "powerShell" => ToolKind::PowerShell,
            "monitor" => ToolKind::Monitor,
            "webFetch" => ToolKind::WebFetch,
            "webSearch" => ToolKind::WebSearch,
            "agent" => ToolKind::Agent,
            "skill" => ToolKind::Skill,
            "sendMessage" => ToolKind::SendMessage,
            "taskCreate" => ToolKind::TaskCreate,
            "taskUpdate" => ToolKind::TaskUpdate,
            "taskGet" => ToolKind::TaskGet,
            "taskList" => ToolKind::TaskList,
            "taskStop" => ToolKind::TaskStop,
            "cronCreate" => ToolKind::CronCreate,
            "cronDelete" => ToolKind::CronDelete,
            "cronList" => ToolKind::CronList,
            "enterPlanMode" => ToolKind::EnterPlanMode,
            "exitPlanMode" => ToolKind::ExitPlanMode,
            "askUserQuestion" => ToolKind::AskUserQuestion,
            "enterWorktree" => ToolKind::EnterWorktree,
            "exitWorktree" => ToolKind::ExitWorktree,
            "listMcpResources" => ToolKind::ListMcpResources,
            "readMcpResource" => ToolKind::ReadMcpResource,
            "waitForMcpServers" => ToolKind::WaitForMcpServers,
            "toolSearch" => ToolKind::ToolSearch,
            "pushNotification" => ToolKind::PushNotification,
            "scheduleWakeup" => ToolKind::ScheduleWakeup,
            "remoteTrigger" => ToolKind::RemoteTrigger,
            "shareOnboardingGuide" => ToolKind::ShareOnboardingGuide,
            other => ToolKind::Custom(other.to_string()),
        }
    }
}

impl Serialize for ToolKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.raw_name())
    }
}

impl<'de> Deserialize<'de> for ToolKind {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(ToolKind::from_raw(&raw))
    }
}

// MARK: - Supporting structs

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub added: i64,
    pub removed: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEvent {
    pub id: String,
    pub tool: ToolKind,
    pub input_summary: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub file_diffs: Option<Vec<FileDiff>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub effort: Option<EffortLevel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvent {
    pub request_id: String,
    pub tool: String,
    pub input_summary: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rule_matched: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationField {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub description: String,
    pub required: bool,
}

// MARK: - AgentEvent

/// Normalised agent lifecycle event. Tagged union keyed on a snake_case `type`
/// discriminator with flat sibling keys. Nesting matches Swift exactly:
/// `tool_call_*` carry their payload under `event`, `tool_batch_complete` under
/// `events`, `permission_request` under `permissionEvent`, `notification` under
/// `notificationType`. Unknown `type` values are rejected by serde (no untagged
/// fallthrough), matching the Swift decoder's `dataCorruptedError`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    // Session lifecycle
    #[serde(rename_all = "camelCase")]
    SessionStart {
        id: String,
        provider: AgentProvider,
        cwd: String,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        model: Option<String>,
        source: SessionSource,
    },
    SessionEnd {
        reason: SessionEndReason,
    },
    CwdChanged {
        from: String,
        to: String,
    },

    // User / assistant turns
    UserMessage {
        text: String,
    },
    TokenDelta {
        text: String,
    },
    AssistantMessage {
        text: String,
    },

    // Tool call lifecycle
    ToolCallStart {
        event: ToolCallEvent,
    },
    ToolCallComplete {
        event: ToolCallEvent,
    },
    ToolCallFailed {
        event: ToolCallEvent,
    },
    ToolBatchComplete {
        events: Vec<ToolCallEvent>,
    },

    // Permissions
    #[serde(rename_all = "camelCase")]
    PermissionRequest {
        permission_event: PermissionEvent,
    },
    PermissionDenied {
        tool: String,
        reason: String,
    },

    // Agent / subagent
    #[serde(rename_all = "camelCase")]
    SubagentStart {
        id: String,
        agent_type: String,
        parent_session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    SubagentStop {
        id: String,
        agent_type: String,
    },

    // Task tracking
    TaskCreated {
        id: String,
        title: String,
    },
    TaskCompleted {
        id: String,
    },

    // Compaction
    CompactionStarted,
    CompactionComplete,

    // Worktrees
    WorktreeCreated {
        name: String,
        branch: String,
    },
    WorktreeRemoved {
        path: String,
    },

    // Status / notifications
    #[serde(rename_all = "camelCase")]
    Notification {
        notification_type: NotificationType,
        message: String,
    },
    StatusBadge {
        text: String,
        kind: BadgeKind,
    },
    SessionError {
        reason: StopFailureReason,
    },

    // Turn complete (cost + token usage)
    #[serde(rename_all = "camelCase")]
    TurnStop {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        cost: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        input_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        output_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        effort_level: Option<EffortLevel>,
    },

    // MCP elicitation
    Elicitation {
        server: String,
        fields: Vec<ElicitationField>,
    },

    // Pass-through for terminal view; `data` is base64 over the wire.
    RawTerminalBytes {
        #[serde(with = "crate::remote::base64_bytes")]
        data: Vec<u8>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn roundtrip(event: &AgentEvent) -> Value {
        let json = serde_json::to_value(event).expect("serialize");
        let back: AgentEvent = serde_json::from_value(json.clone()).expect("deserialize");
        assert_eq!(&back, event, "round-trip must be lossless");
        json
    }

    // -- simple enum wire shapes (camelCase case names, NOT snake_case) --

    #[test]
    fn agent_provider_uses_camelcase_case_names() {
        assert_eq!(serde_json::to_value(AgentProvider::ClaudeCode).unwrap(), json!("claudeCode"));
        assert_eq!(serde_json::to_value(AgentProvider::Codex).unwrap(), json!("codex"));
        let back: AgentProvider = serde_json::from_value(json!("claudeCode")).unwrap();
        assert_eq!(back, AgentProvider::ClaudeCode);
    }

    #[test]
    fn enum_variants_match_swift_raw_names() {
        assert_eq!(serde_json::to_value(SessionMode::Chat).unwrap(), json!("chat"));
        assert_eq!(serde_json::to_value(SessionSource::Compact).unwrap(), json!("compact"));
        assert_eq!(serde_json::to_value(SessionEndReason::PromptExit).unwrap(), json!("promptExit"));
        assert_eq!(serde_json::to_value(StopFailureReason::RateLimit).unwrap(), json!("rateLimit"));
        assert_eq!(serde_json::to_value(StopFailureReason::AuthFailed).unwrap(), json!("authFailed"));
        assert_eq!(serde_json::to_value(BadgeKind::Success).unwrap(), json!("success"));
        assert_eq!(serde_json::to_value(NotificationType::PermissionPrompt).unwrap(), json!("permissionPrompt"));
        assert_eq!(serde_json::to_value(NotificationType::AuthSuccess).unwrap(), json!("authSuccess"));
        assert_eq!(serde_json::to_value(EffortLevel::Xhigh).unwrap(), json!("xhigh"));
        assert_eq!(serde_json::to_value(EffortLevel::Max).unwrap(), json!("max"));
    }

    // -- ToolKind: bare string, camelCase knowns, Custom catch-all --

    #[test]
    fn tool_kind_known_is_bare_camelcase_string() {
        assert_eq!(serde_json::to_value(ToolKind::NotebookEdit).unwrap(), json!("notebookEdit"));
        assert_eq!(serde_json::to_value(ToolKind::WebFetch).unwrap(), json!("webFetch"));
        assert_eq!(serde_json::to_value(ToolKind::PowerShell).unwrap(), json!("powerShell"));
        let back: ToolKind = serde_json::from_value(json!("toolSearch")).unwrap();
        assert_eq!(back, ToolKind::ToolSearch);
    }

    #[test]
    fn tool_kind_unknown_roundtrips_via_custom() {
        let raw = json!("someFutureTool");
        let parsed: ToolKind = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed, ToolKind::Custom("someFutureTool".to_string()));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), raw);
    }

    // -- AgentEvent tagged-union wire shapes --

    #[test]
    fn session_start_flat_keys_and_snake_type() {
        let event = AgentEvent::SessionStart {
            id: "s1".into(),
            provider: AgentProvider::ClaudeCode,
            cwd: "/repo".into(),
            model: Some("opus".into()),
            source: SessionSource::Startup,
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("session_start"));
        assert_eq!(json["id"], json!("s1"));
        assert_eq!(json["provider"], json!("claudeCode"));
        assert_eq!(json["cwd"], json!("/repo"));
        assert_eq!(json["model"], json!("opus"));
        assert_eq!(json["source"], json!("startup"));
    }

    #[test]
    fn session_start_omits_nil_model() {
        let event = AgentEvent::SessionStart {
            id: "s1".into(),
            provider: AgentProvider::Codex,
            cwd: "/repo".into(),
            model: None,
            source: SessionSource::Resume,
        };
        let json = roundtrip(&event);
        assert!(json.get("model").is_none(), "nil model must be omitted");
    }

    #[test]
    fn tool_call_start_nests_under_event() {
        let event = AgentEvent::ToolCallStart {
            event: ToolCallEvent {
                id: "tc1".into(),
                tool: ToolKind::Bash,
                input_summary: "ls".into(),
                result: None,
                error: None,
                duration_ms: Some(42),
                file_diffs: Some(vec![FileDiff { path: "a.rs".into(), added: 3, removed: 1 }]),
                effort: Some(EffortLevel::High),
            },
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("tool_call_start"));
        assert_eq!(json["event"]["id"], json!("tc1"));
        assert_eq!(json["event"]["tool"], json!("bash"));
        assert_eq!(json["event"]["inputSummary"], json!("ls"));
        assert_eq!(json["event"]["durationMs"], json!(42));
        assert_eq!(json["event"]["fileDiffs"][0]["path"], json!("a.rs"));
        assert_eq!(json["event"]["effort"], json!("high"));
    }

    #[test]
    fn tool_batch_complete_nests_under_events() {
        let event = AgentEvent::ToolBatchComplete {
            events: vec![ToolCallEvent {
                id: "tc1".into(),
                tool: ToolKind::Custom("mystery".into()),
                input_summary: "x".into(),
                result: Some("ok".into()),
                error: None,
                duration_ms: None,
                file_diffs: None,
                effort: None,
            }],
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("tool_batch_complete"));
        assert_eq!(json["events"][0]["tool"], json!("mystery"));
        assert_eq!(json["events"][0]["result"], json!("ok"));
    }

    #[test]
    fn permission_request_nests_under_permission_event() {
        let event = AgentEvent::PermissionRequest {
            permission_event: PermissionEvent {
                request_id: "r1".into(),
                tool: "bash".into(),
                input_summary: "rm -rf".into(),
                rule_matched: Some("deny-rm".into()),
            },
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("permission_request"));
        assert_eq!(json["permissionEvent"]["requestId"], json!("r1"));
        assert_eq!(json["permissionEvent"]["ruleMatched"], json!("deny-rm"));
    }

    #[test]
    fn notification_uses_notification_type_key() {
        let event = AgentEvent::Notification {
            notification_type: NotificationType::IdlePrompt,
            message: "still there?".into(),
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("notification"));
        assert_eq!(json["notificationType"], json!("idlePrompt"));
        assert_eq!(json["message"], json!("still there?"));
    }

    #[test]
    fn turn_stop_camelcase_token_keys_and_omits_nils() {
        let event = AgentEvent::TurnStop {
            cost: Some(0.42),
            input_tokens: Some(100),
            output_tokens: None,
            effort_level: Some(EffortLevel::Medium),
        };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("turn_stop"));
        assert_eq!(json["cost"], json!(0.42));
        assert_eq!(json["inputTokens"], json!(100));
        assert!(json.get("outputTokens").is_none());
        assert_eq!(json["effortLevel"], json!("medium"));
    }

    #[test]
    fn unit_variant_is_type_only() {
        let json = roundtrip(&AgentEvent::CompactionStarted);
        assert_eq!(json, json!({"type": "compaction_started"}));
    }

    #[test]
    fn session_error_carries_reason() {
        let json = roundtrip(&AgentEvent::SessionError { reason: StopFailureReason::Billing });
        assert_eq!(json, json!({"type": "session_error", "reason": "billing"}));
    }

    #[test]
    fn subagent_start_camelcase_keys() {
        let event = AgentEvent::SubagentStart {
            id: "a1".into(),
            agent_type: "reviewer".into(),
            parent_session_id: "s1".into(),
        };
        let json = roundtrip(&event);
        assert_eq!(json["agentType"], json!("reviewer"));
        assert_eq!(json["parentSessionId"], json!("s1"));
    }

    #[test]
    fn raw_terminal_bytes_is_base64() {
        let event = AgentEvent::RawTerminalBytes { data: vec![0x1b, 0x5b, 0x30, 0x6d] };
        let json = roundtrip(&event);
        assert_eq!(json["type"], json!("raw_terminal_bytes"));
        // base64 of [0x1b,0x5b,0x30,0x6d] == "G1swbQ=="
        assert_eq!(json["data"], json!("G1swbQ=="));
    }

    #[test]
    fn elicitation_field_type_key_is_type() {
        let event = AgentEvent::Elicitation {
            server: "srv".into(),
            fields: vec![ElicitationField {
                name: "token".into(),
                field_type: "string".into(),
                description: "API token".into(),
                required: true,
            }],
        };
        let json = roundtrip(&event);
        assert_eq!(json["fields"][0]["type"], json!("string"));
        assert_eq!(json["fields"][0]["required"], json!(true));
    }

    #[test]
    fn unknown_agent_event_type_is_rejected() {
        let raw = json!({"type": "not_a_real_event", "foo": 1});
        let result: Result<AgentEvent, _> = serde_json::from_value(raw);
        assert!(result.is_err(), "unknown type must error, matching Swift");
    }
}
