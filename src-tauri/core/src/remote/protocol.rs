//! Rust serde port of `MaverickProtocol/{Messages,SessionInfo,DirectoryEntry,
//! ProjectIndex}.swift`.
//!
//! `ClientMessage` (18 cases) and `ServerMessage` (19 cases) are tagged unions
//! with a snake_case `type` discriminator and flat camelCase sibling keys —
//! `#[serde(tag = "type", rename_all = "snake_case")]` for the discriminator,
//! `#[serde(rename_all = "camelCase")]` per variant for the field names. UUIDs
//! serialise as standard hyphenated strings; the lone `Date`
//! (`SessionInfo.createdAt`) is ISO8601 via chrono. Optional struct fields are
//! omitted when nil, matching Swift's synthesised `encodeIfPresent` behaviour.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::agent_event::{AgentEvent, AgentProvider, SessionMode};

// MARK: - SessionInfo

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub name: String,
    pub shell: String,
    pub created_at: DateTime<Utc>,
    /// Non-nil for agent-backed sessions; nil for raw PTY sessions.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_provider: Option<AgentProvider>,
    /// Non-nil for agent-backed sessions; nil for raw PTY sessions.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub session_mode: Option<SessionMode>,
}

// MARK: - DirectoryEntry

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_hidden: bool,
}

// MARK: - ProjectIndex

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    /// Single-letter git porcelain code: M, A, D, R, C, U, ?.
    pub status: String,
    /// True if staged (in the index), false if in the working tree.
    pub staged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub branch: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<GitFileStatus>,
}

// MARK: - ClientMessage

/// Messages sent by the companion client to the Maverick host. Tagged union
/// keyed on a snake_case `type` with flat camelCase sibling keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    ListSessions,
    #[serde(rename_all = "camelCase")]
    CreateSession {
        name: String,
        shell: String,
        /// Absolute path on the Mac to start the shell in; defaults to home.
        #[serde(skip_serializing_if = "Option::is_none", default)]
        cwd: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    AttachSession {
        session_id: Uuid,
    },
    #[serde(rename_all = "camelCase")]
    Input {
        session_id: Uuid,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Resize {
        session_id: Uuid,
        cols: i64,
        rows: i64,
    },
    #[serde(rename_all = "camelCase")]
    CloseSession {
        session_id: Uuid,
    },
    /// Upload a file to the Mac's local /tmp. `data` is base64-encoded bytes.
    #[serde(rename_all = "camelCase")]
    UploadFile {
        upload_id: Uuid,
        filename: String,
        #[serde(with = "super::base64_bytes")]
        data: Vec<u8>,
    },
    #[serde(rename_all = "camelCase")]
    ListDirectory {
        request_id: Uuid,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    IndexProject {
        request_id: Uuid,
        path: String,
        refresh: bool,
    },
    #[serde(rename_all = "camelCase")]
    GitStatus {
        request_id: Uuid,
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    GitDiff {
        request_id: Uuid,
        path: String,
        file: String,
        staged: bool,
    },
    #[serde(rename_all = "camelCase")]
    CreateAgentSession {
        name: String,
        provider: AgentProvider,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        cwd: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SwitchSessionMode {
        session_id: Uuid,
        mode: SessionMode,
    },
    #[serde(rename_all = "camelCase")]
    AgentInput {
        session_id: Uuid,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    PermissionResponse {
        session_id: Uuid,
        request_id: Uuid,
        allowed: bool,
    },
}

// MARK: - ServerMessage

/// Messages sent by the Maverick host to the companion client. Tagged union
/// keyed on a snake_case `type` with flat camelCase sibling keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    SessionList {
        sessions: Vec<SessionInfo>,
    },
    SessionCreated {
        session: SessionInfo,
    },
    #[serde(rename_all = "camelCase")]
    Output {
        session_id: Uuid,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Scrollback {
        session_id: Uuid,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    SessionClosed {
        session_id: Uuid,
    },
    Error {
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    FileUploaded {
        upload_id: Uuid,
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    FileUploadFailed {
        upload_id: Uuid,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    DirectoryListing {
        request_id: Uuid,
        path: String,
        entries: Vec<DirectoryEntry>,
    },
    #[serde(rename_all = "camelCase")]
    DirectoryListingFailed {
        request_id: Uuid,
        message: String,
    },
    /// Streamed chunk of project index entries; `complete=true` on the final one.
    #[serde(rename_all = "camelCase")]
    IndexChunk {
        request_id: Uuid,
        root: String,
        entries: Vec<IndexEntry>,
        complete: bool,
    },
    #[serde(rename_all = "camelCase")]
    IndexFailed {
        request_id: Uuid,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    GitStatusResult {
        request_id: Uuid,
        status: GitStatus,
    },
    #[serde(rename_all = "camelCase")]
    GitStatusFailed {
        request_id: Uuid,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    GitDiffResult {
        request_id: Uuid,
        file: String,
        diff: String,
        truncated: bool,
    },
    #[serde(rename_all = "camelCase")]
    GitDiffFailed {
        request_id: Uuid,
        message: String,
    },
    /// A normalised agent lifecycle event from the coding-agent backend.
    #[serde(rename_all = "camelCase")]
    AgentEvent {
        session_id: Uuid,
        event: AgentEvent,
    },
    AgentSessionCreated {
        session: SessionInfo,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::agent_event::AgentEvent;
    use chrono::TimeZone;
    use serde_json::{json, Value};

    fn rt_client(msg: &ClientMessage) -> Value {
        let json = serde_json::to_value(msg).expect("serialize");
        let back: ClientMessage = serde_json::from_value(json.clone()).expect("deserialize");
        assert_eq!(&back, msg, "ClientMessage round-trip must be lossless");
        json
    }

    fn rt_server(msg: &ServerMessage) -> Value {
        let json = serde_json::to_value(msg).expect("serialize");
        let back: ServerMessage = serde_json::from_value(json.clone()).expect("deserialize");
        assert_eq!(&back, msg, "ServerMessage round-trip must be lossless");
        json
    }

    fn sample_session() -> SessionInfo {
        SessionInfo {
            id: Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap(),
            name: "main".into(),
            shell: "/bin/zsh".into(),
            created_at: Utc.with_ymd_and_hms(2026, 5, 31, 12, 0, 0).unwrap(),
            agent_provider: Some(AgentProvider::ClaudeCode),
            session_mode: Some(SessionMode::Chat),
        }
    }

    // -- SessionInfo: uuid string, ISO8601 date, omitted nil optionals --

    #[test]
    fn session_info_uuid_string_and_iso8601_date() {
        let session = sample_session();
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(json["id"], json!("11111111-2222-3333-4444-555555555555"));
        assert_eq!(json["createdAt"], json!("2026-05-31T12:00:00Z"));
        assert_eq!(json["agentProvider"], json!("claudeCode"));
        assert_eq!(json["sessionMode"], json!("chat"));
        let back: SessionInfo = serde_json::from_value(json).unwrap();
        assert_eq!(back, session);
    }

    #[test]
    fn session_info_omits_nil_agent_fields() {
        let session = SessionInfo {
            id: Uuid::nil(),
            name: "raw".into(),
            shell: "/bin/sh".into(),
            created_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            agent_provider: None,
            session_mode: None,
        };
        let json = serde_json::to_value(&session).unwrap();
        assert!(json.get("agentProvider").is_none());
        assert!(json.get("sessionMode").is_none());
        let back: SessionInfo = serde_json::from_value(json).unwrap();
        assert_eq!(back, session);
    }

    // -- Project index structs --

    #[test]
    fn index_entry_camelcase_and_optional_size() {
        let with_size = IndexEntry { path: "src/a.rs".into(), is_directory: false, size: Some(128) };
        let json = serde_json::to_value(&with_size).unwrap();
        assert_eq!(json, json!({"path": "src/a.rs", "isDirectory": false, "size": 128}));
        assert_eq!(serde_json::from_value::<IndexEntry>(json).unwrap(), with_size);

        let dir = IndexEntry { path: "node_modules".into(), is_directory: true, size: None };
        let json = serde_json::to_value(&dir).unwrap();
        assert!(json.get("size").is_none());
    }

    #[test]
    fn git_status_camelcase_and_optional_branch() {
        let status = GitStatus {
            is_repo: true,
            branch: Some("main".into()),
            ahead: 2,
            behind: 0,
            files: vec![GitFileStatus { path: "x.rs".into(), status: "M".into(), staged: true }],
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["isRepo"], json!(true));
        assert_eq!(json["branch"], json!("main"));
        assert_eq!(json["files"][0]["staged"], json!(true));
        assert_eq!(serde_json::from_value::<GitStatus>(json).unwrap(), status);

        let detached = GitStatus { is_repo: false, branch: None, ahead: 0, behind: 0, files: vec![] };
        assert!(serde_json::to_value(&detached).unwrap().get("branch").is_none());
    }

    #[test]
    fn directory_entry_camelcase() {
        let entry = DirectoryEntry { name: ".git".into(), is_directory: true, is_hidden: true };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json, json!({"name": ".git", "isDirectory": true, "isHidden": true}));
        assert_eq!(serde_json::from_value::<DirectoryEntry>(json).unwrap(), entry);
    }

    // -- ClientMessage tagged-union wire shapes --

    #[test]
    fn client_list_sessions_is_type_only() {
        let json = rt_client(&ClientMessage::ListSessions);
        assert_eq!(json, json!({"type": "list_sessions"}));
    }

    #[test]
    fn client_create_session_flat_camelcase_and_omits_nil_cwd() {
        let msg = ClientMessage::CreateSession { name: "s".into(), shell: "/bin/zsh".into(), cwd: None };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("create_session"));
        assert_eq!(json["name"], json!("s"));
        assert_eq!(json["shell"], json!("/bin/zsh"));
        assert!(json.get("cwd").is_none());
    }

    #[test]
    fn client_input_session_id_is_uuid_string() {
        let id = Uuid::parse_str("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap();
        let msg = ClientMessage::Input { session_id: id, data: "ls\n".into() };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("input"));
        assert_eq!(json["sessionId"], json!("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
        assert_eq!(json["data"], json!("ls\n"));
    }

    #[test]
    fn client_upload_file_data_is_base64() {
        let msg = ClientMessage::UploadFile {
            upload_id: Uuid::nil(),
            filename: "x.bin".into(),
            data: vec![0xde, 0xad, 0xbe, 0xef],
        };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("upload_file"));
        assert_eq!(json["uploadId"], json!("00000000-0000-0000-0000-000000000000"));
        // base64 of [0xde,0xad,0xbe,0xef] == "3q2+7w=="
        assert_eq!(json["data"], json!("3q2+7w=="));
    }

    #[test]
    fn client_permission_response_two_uuids() {
        let msg = ClientMessage::PermissionResponse {
            session_id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
            request_id: Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
            allowed: false,
        };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("permission_response"));
        assert_eq!(json["sessionId"], json!("11111111-1111-1111-1111-111111111111"));
        assert_eq!(json["requestId"], json!("22222222-2222-2222-2222-222222222222"));
        assert_eq!(json["allowed"], json!(false));
    }

    #[test]
    fn client_create_agent_session_provider_camelcase() {
        let msg = ClientMessage::CreateAgentSession {
            name: "agent".into(),
            provider: AgentProvider::Codex,
            cwd: Some("/repo".into()),
        };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("create_agent_session"));
        assert_eq!(json["provider"], json!("codex"));
        assert_eq!(json["cwd"], json!("/repo"));
    }

    #[test]
    fn client_git_diff_round_trips() {
        let msg = ClientMessage::GitDiff {
            request_id: Uuid::nil(),
            path: "/repo".into(),
            file: "a.rs".into(),
            staged: true,
        };
        let json = rt_client(&msg);
        assert_eq!(json["type"], json!("git_diff"));
        assert_eq!(json["staged"], json!(true));
    }

    // -- ServerMessage tagged-union wire shapes --

    #[test]
    fn server_session_list_nests_sessions() {
        let msg = ServerMessage::SessionList { sessions: vec![sample_session()] };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("session_list"));
        assert_eq!(json["sessions"][0]["name"], json!("main"));
    }

    #[test]
    fn server_output_camelcase_session_id() {
        let msg = ServerMessage::Output { session_id: Uuid::nil(), data: "hi".into() };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("output"));
        assert_eq!(json["sessionId"], json!("00000000-0000-0000-0000-000000000000"));
    }

    #[test]
    fn server_index_chunk_camelcase() {
        let msg = ServerMessage::IndexChunk {
            request_id: Uuid::nil(),
            root: "/repo".into(),
            entries: vec![IndexEntry { path: "a".into(), is_directory: false, size: Some(1) }],
            complete: true,
        };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("index_chunk"));
        assert_eq!(json["requestId"], json!("00000000-0000-0000-0000-000000000000"));
        assert_eq!(json["complete"], json!(true));
    }

    #[test]
    fn server_git_status_result_nests_status() {
        let msg = ServerMessage::GitStatusResult {
            request_id: Uuid::nil(),
            status: GitStatus { is_repo: true, branch: Some("dev".into()), ahead: 0, behind: 1, files: vec![] },
        };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("git_status_result"));
        assert_eq!(json["status"]["branch"], json!("dev"));
        assert_eq!(json["status"]["behind"], json!(1));
    }

    #[test]
    fn server_agent_event_wraps_inner_event() {
        let msg = ServerMessage::AgentEvent {
            session_id: Uuid::nil(),
            event: AgentEvent::CompactionComplete,
        };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("agent_event"));
        assert_eq!(json["sessionId"], json!("00000000-0000-0000-0000-000000000000"));
        assert_eq!(json["event"], json!({"type": "compaction_complete"}));
    }

    #[test]
    fn server_git_diff_result_flat_keys() {
        let msg = ServerMessage::GitDiffResult {
            request_id: Uuid::nil(),
            file: "a.rs".into(),
            diff: "@@".into(),
            truncated: false,
        };
        let json = rt_server(&msg);
        assert_eq!(json["type"], json!("git_diff_result"));
        assert_eq!(json["file"], json!("a.rs"));
        assert_eq!(json["truncated"], json!(false));
    }

    #[test]
    fn server_error_carries_message() {
        let json = rt_server(&ServerMessage::Error { message: "boom".into() });
        assert_eq!(json, json!({"type": "error", "message": "boom"}));
    }
}
