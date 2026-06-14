//! Per-connection authentication + capability gating for the companion server.
//!
//! ## Auth gate
//!
//! Once the server is exposed beyond loopback (Companion-5), a WS connection is
//! only admitted if it completes the Noise_XX pairing handshake and authenticates
//! to a paired device token. A connection that fails the handshake is rejected
//! with WebSocket close code **4401** (application "Unauthorized") and never
//! reaches the [`crate::remote::bridge::RemoteBridge`].
//!
//! Loopback connections (the local webview / dev tooling on `127.0.0.1`) are
//! trusted without pairing — they already have full Tauri-command access, so
//! requiring a handshake there would be theatre. The gate's `requires_auth`
//! decision is therefore *peer-scoped*: enforced for non-loopback peers only.
//!
//! ## Capability allowlist
//!
//! The wire is a closed `ClientMessage` enum, so a remote can never name an
//! arbitrary internal method — but we still classify every verb into a
//! [`Capability`] and enforce that a paired remote may only exercise the
//! MaverickProtocol surface, with **mutating** verbs (PTY write/resize/create,
//! agent input, mode switch, permission response, upload) requiring an
//! authenticated paired session. Read-only verbs (list/status/diff/index) are
//! allowed for any admitted connection.

use crate::remote::ClientMessage;

/// WebSocket close code returned when a connection fails the auth gate. 4xxx is
/// the application-private range (RFC 6455 §7.4.2); 4401 echoes HTTP 401.
pub const CLOSE_UNAUTHORIZED: u16 = 4401;

/// The capability a single `ClientMessage` exercises. Drives the allowlist: a
/// remote connection's session must satisfy the verb's requirement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    /// Read-only surface (no host mutation): listing, status, diff, index.
    ReadOnly,
    /// Mutates host state (spawn/kill sessions, agent lifecycle, uploads).
    Mutate,
    /// Writes raw bytes into a live PTY — the highest-trust verb. Stays behind a
    /// valid paired session even among mutating verbs.
    PtyWrite,
}

/// Classify a `ClientMessage` into the capability it requires. Centralized so the
/// gate and tests agree on exactly which verbs mutate vs. only read.
pub fn capability_of(msg: &ClientMessage) -> Capability {
    match msg {
        // Pure reads — safe for any admitted connection.
        ClientMessage::ListSessions
        | ClientMessage::ListDirectory { .. }
        | ClientMessage::GitStatus { .. }
        | ClientMessage::GitDiff { .. }
        | ClientMessage::IndexProject { .. } => Capability::ReadOnly,

        // Raw PTY input is the most sensitive verb (arbitrary shell bytes).
        ClientMessage::Input { .. } => Capability::PtyWrite,

        // Everything else mutates host state and requires a paired session.
        ClientMessage::CreateSession { .. }
        | ClientMessage::AttachSession { .. }
        | ClientMessage::Resize { .. }
        | ClientMessage::CloseSession { .. }
        | ClientMessage::UploadFile { .. }
        | ClientMessage::CreateAgentSession { .. }
        | ClientMessage::SwitchSessionMode { .. }
        | ClientMessage::AgentInput { .. }
        | ClientMessage::PermissionResponse { .. } => Capability::Mutate,
    }
}

/// Per-connection trust level, set when the connection is established.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionTrust {
    /// Loopback peer (local webview / dev tools): full access, no pairing needed.
    Loopback,
    /// A remote peer that completed pairing and is bound to a paired device id.
    PairedRemote { device_id: String },
}

/// Decision returned by the gate for an inbound verb.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateDecision {
    /// The verb is permitted on this connection.
    Allow,
    /// The verb is denied; reply with a protocol `Error`, keep the socket open.
    Deny,
}

/// The capability gate for one connection. Wraps the connection's trust level and
/// answers `allows(verb)` for every inbound message.
pub struct CapabilityGate {
    trust: ConnectionTrust,
}

impl CapabilityGate {
    pub fn new(trust: ConnectionTrust) -> Self {
        Self { trust }
    }

    /// A loopback connection (trusted local webview).
    pub fn loopback() -> Self {
        Self::new(ConnectionTrust::Loopback)
    }

    /// A paired remote connection bound to `device_id`.
    pub fn paired(device_id: String) -> Self {
        Self::new(ConnectionTrust::PairedRemote { device_id })
    }

    /// The device id this connection is bound to, if it is a paired remote.
    pub fn device_id(&self) -> Option<&str> {
        match &self.trust {
            ConnectionTrust::PairedRemote { device_id } => Some(device_id),
            ConnectionTrust::Loopback => None,
        }
    }

    /// Whether this connection may exercise `msg`. Loopback may do anything;
    /// a paired remote may exercise the full MaverickProtocol surface (read,
    /// mutate, and PTY write — it authenticated to a paired device). The gate is
    /// the choke point where a *future* lower-trust tier (e.g. read-only guest
    /// pairing) would be denied mutating/PTY verbs.
    pub fn allows(&self, msg: &ClientMessage) -> GateDecision {
        match self.trust {
            ConnectionTrust::Loopback | ConnectionTrust::PairedRemote { .. } => {
                // Both admitted tiers currently get the full surface; the
                // capability is still computed so the boundary is explicit and a
                // restricted tier slots in here without touching call sites.
                let _ = capability_of(msg);
                GateDecision::Allow
            }
        }
    }
}

/// Whether a peer at this address must complete pairing before it is admitted.
/// Loopback peers are trusted (they already have Tauri-command access); any other
/// address must authenticate via the Noise handshake.
pub fn requires_auth(peer: &std::net::SocketAddr) -> bool {
    !peer.ip().is_loopback()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn read_only_verbs_classified() {
        assert_eq!(capability_of(&ClientMessage::ListSessions), Capability::ReadOnly);
        assert_eq!(
            capability_of(&ClientMessage::ListDirectory { request_id: Uuid::nil(), path: None }),
            Capability::ReadOnly
        );
        assert_eq!(
            capability_of(&ClientMessage::GitStatus { request_id: Uuid::nil(), path: "/".into() }),
            Capability::ReadOnly
        );
        assert_eq!(
            capability_of(&ClientMessage::GitDiff {
                request_id: Uuid::nil(),
                path: "/".into(),
                file: "a".into(),
                staged: false,
            }),
            Capability::ReadOnly
        );
        assert_eq!(
            capability_of(&ClientMessage::IndexProject {
                request_id: Uuid::nil(),
                path: "/".into(),
                refresh: false,
            }),
            Capability::ReadOnly
        );
    }

    #[test]
    fn input_is_pty_write_capability() {
        assert_eq!(
            capability_of(&ClientMessage::Input { session_id: Uuid::nil(), data: "x".into() }),
            Capability::PtyWrite
        );
    }

    #[test]
    fn mutating_verbs_classified() {
        let mutating = [
            ClientMessage::CreateSession { name: "n".into(), shell: "sh".into(), cwd: None },
            ClientMessage::AttachSession { session_id: Uuid::nil() },
            ClientMessage::Resize { session_id: Uuid::nil(), cols: 80, rows: 24 },
            ClientMessage::CloseSession { session_id: Uuid::nil() },
            ClientMessage::AgentInput { session_id: Uuid::nil(), text: "hi".into() },
        ];
        for m in &mutating {
            assert_eq!(capability_of(m), Capability::Mutate, "{m:?}");
        }
    }

    #[test]
    fn loopback_allows_everything_including_pty_write() {
        let gate = CapabilityGate::loopback();
        assert_eq!(
            gate.allows(&ClientMessage::Input { session_id: Uuid::nil(), data: "ls\n".into() }),
            GateDecision::Allow
        );
        assert!(gate.device_id().is_none());
    }

    #[test]
    fn paired_remote_allows_full_surface_and_carries_device_id() {
        let gate = CapabilityGate::paired("dev-1".into());
        assert_eq!(gate.device_id(), Some("dev-1"));
        assert_eq!(gate.allows(&ClientMessage::ListSessions), GateDecision::Allow);
        assert_eq!(
            gate.allows(&ClientMessage::Input { session_id: Uuid::nil(), data: "x".into() }),
            GateDecision::Allow
        );
    }

    #[test]
    fn requires_auth_only_for_non_loopback_peers() {
        let local: std::net::SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let local6: std::net::SocketAddr = "[::1]:5000".parse().unwrap();
        let lan: std::net::SocketAddr = "192.168.1.20:5000".parse().unwrap();
        assert!(!requires_auth(&local));
        assert!(!requires_auth(&local6));
        assert!(requires_auth(&lan));
    }

    #[test]
    fn close_code_is_4401() {
        assert_eq!(CLOSE_UNAUTHORIZED, 4401);
    }
}
