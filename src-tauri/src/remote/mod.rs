//! Rust serde port of the Swift `MaverickProtocol` package — the authoritative
//! wire contract shared between the Maverick desktop app and the companion
//! mobile client.
//!
//! The Swift authority lives at
//! `maverick-app/shared/Sources/MaverickProtocol/*.swift`. This module mirrors
//! it byte-for-byte on the wire:
//!
//! - Tagged unions (`ClientMessage`, `ServerMessage`, `AgentEvent`) use a
//!   top-level snake_case `type` key with FLAT sibling keys.
//! - Struct fields are camelCase (`sessionId`, `requestId`, `inputTokens`).
//! - The simple string enums keep their Swift case names verbatim (camelCase,
//!   e.g. `claudeCode`), NOT snake_case.
//! - Dates are ISO8601 / RFC3339, binary payloads are base64 strings, UUIDs are
//!   standard hyphenated strings.
//! - `AgentEvent` rejects an unknown `type`; `ToolKind` absorbs unknowns via
//!   `Custom(String)`.

mod agent_event;
mod protocol;

pub use agent_event::{
    AgentEvent, AgentProvider, BadgeKind, EffortLevel, ElicitationField, FileDiff, NotificationType,
    PermissionEvent, SessionEndReason, SessionMode, SessionSource, StopFailureReason, ToolCallEvent,
    ToolKind,
};
pub use protocol::{
    ClientMessage, DirectoryEntry, GitFileStatus, GitStatus, IndexEntry, ServerMessage, SessionInfo,
};

/// Serde adapter that maps a `Vec<u8>` field to/from a base64 string, matching
/// the Swift `Data(base64Encoded:)` / `base64EncodedString()` wire shape.
pub(crate) mod base64_bytes {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let encoded = String::deserialize(deserializer)?;
        STANDARD.decode(encoded.as_bytes()).map_err(serde::de::Error::custom)
    }
}
