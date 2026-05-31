//! Companion-5 device pairing: the desktop's long-lived static identity, the
//! QR pairing payload, single-use pairing tokens, and the Noise_XX **responder**
//! that authenticates a mobile client.
//!
//! ## Wire contract (authoritative source = the RN client)
//!
//! The mobile client at
//! `maverick-app/mobile/src/pairing/{noise-xx,noise-crypto,qr-payload}.ts`
//! is the wire authority; this module is built to interoperate byte-for-byte:
//!
//! - **Noise:** `Noise_XX_25519_ChaChaPoly_SHA256`, **empty prologue**
//!   (`mixHash(EMPTY)` on the client), HKDF-SHA256 with empty `info`,
//!   ChaCha20-Poly1305 with an 8-byte little-endian counter nonce. The client is
//!   the *initiator*; we are the *responder*. We drive it via [`snow`], the
//!   vetted pure-Rust Noise implementation, which is RFC-exact for this suite.
//! - **Token:** the 128-bit single-use pairing token `PT` rides as the *payload*
//!   of handshake message 1 (`session.start()` on the client). We decrypt msg1
//!   and verify `PT` is the live, unexpired, not-yet-consumed token before
//!   proceeding — and we rate-limit failures (<= 5).
//! - **QR:** `maverick://pair/v1?k=<S_desk_pub>&e=<E_desk_pub>&t=<PT>&r=<rendezvous>&n=<name>&f=<fp4>`
//!   where keys are base64url X25519 public keys and `f` is the 8-hex-char short
//!   fingerprint of `k` (matching the client's `shortFingerprint`).
//! - **TOFU:** on a successful first pairing we pin the client's static key (the
//!   responder's `remote_static`) against its device token; the
//!   [`crate::remote::device_store`] persists it. A later mismatch aborts.
//!
//! ## No API keys
//!
//! Per ADR-1 the Rust core owns this identity. The static identity is an X25519
//! keypair generated once and persisted to `~/.maverick/companion/identity.key`
//! (0600). It is NOT a provider credential — every backend still reads its own
//! CLI config. Nothing here ever touches `~/.claude.json` etc.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use snow::params::NoiseParams;
use uuid::Uuid;

/// The Noise suite, fixed to match the client exactly.
pub const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_SHA256";

/// X25519 public/secret key length.
pub const KEY_LEN: usize = 32;

/// Single-use pairing token length in bytes (128-bit, per MASTER-PLAN 6.2).
pub const TOKEN_BYTES: usize = 16;

/// Pairing-session lifetime. MASTER-PLAN specifies a 60-120 s window; we use 120 s
/// to tolerate the user walking the QR over to a phone and scanning.
pub const PAIRING_TTL: Duration = Duration::from_secs(120);

/// Maximum failed token attempts against a single pairing session before it is
/// burned. Bounds online guessing of the 128-bit token to a negligible window.
pub const MAX_TOKEN_ATTEMPTS: u32 = 5;

/// The desktop's long-lived static identity: an X25519 keypair. The private key
/// stays in the Rust core; only the public key ever leaves (in the QR `k` field
/// and on the Noise wire). `Clone` is intentionally NOT derived to discourage
/// copying the secret around.
pub struct StaticIdentity {
    private: [u8; KEY_LEN],
    public: [u8; KEY_LEN],
}

impl StaticIdentity {
    /// Generate a fresh identity using snow's CSPRNG-backed keypair generator
    /// (X25519 over the curve25519-dalek resolver).
    pub fn generate() -> Self {
        let params: NoiseParams = NOISE_PARAMS.parse().expect("static noise params parse");
        let kp = snow::Builder::new(params)
            .generate_keypair()
            .expect("x25519 keypair generation");
        Self::from_private(&kp.private).expect("snow keypair has 32-byte private")
    }

    /// Reconstruct an identity from a persisted 32-byte private key, deriving the
    /// matching public key via a throwaway snow builder. Returns `None` for a
    /// wrong-length key.
    pub fn from_private(private: &[u8]) -> Option<Self> {
        if private.len() != KEY_LEN {
            return None;
        }
        // Derive the public key by running it through a responder build, which
        // computes `s.public` from the supplied private key.
        let params: NoiseParams = NOISE_PARAMS.parse().ok()?;
        let hs = snow::Builder::new(params)
            .local_private_key(private)
            .ok()?
            .build_responder()
            .ok()?;
        // snow doesn't expose our own public key directly; derive it with the
        // curve25519 base-point multiply via a second keypair-from-private path.
        // `get_remote_static` is the peer's; for ours we recompute with dalek.
        let public = x25519_public_from_private(private);
        // Drop the handshake state; it was only used to validate the key length.
        drop(hs);
        let mut priv_arr = [0u8; KEY_LEN];
        priv_arr.copy_from_slice(private);
        Some(Self { private: priv_arr, public })
    }

    pub fn public_key(&self) -> &[u8; KEY_LEN] {
        &self.public
    }

    pub fn private_key(&self) -> &[u8; KEY_LEN] {
        &self.private
    }

    /// The 8-hex-char short fingerprint of the static public key — the QR `f`
    /// field. Mirrors the client's `shortFingerprint` (first 4 SHA-256 bytes).
    pub fn short_fingerprint(&self) -> String {
        short_fingerprint(&self.public)
    }
}

/// X25519 public from a clamped private scalar via curve25519-dalek's base-point
/// multiply (the same primitive snow uses internally), so our derived public key
/// is bit-identical to what the handshake will present.
fn x25519_public_from_private(private: &[u8]) -> [u8; KEY_LEN] {
    use curve25519_dalek::montgomery::MontgomeryPoint;
    let mut scalar = [0u8; KEY_LEN];
    scalar.copy_from_slice(private);
    // `mul_base_clamped` performs the X25519 scalar clamping internally, so the
    // result is the canonical X25519 public key for this private scalar.
    MontgomeryPoint::mul_base_clamped(scalar).to_bytes()
}

/// The 8-hex-char short fingerprint of a static public key (first 4 SHA-256
/// bytes, uppercase hex) — matches the client's `shortFingerprint`.
pub fn short_fingerprint(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    hex::encode_upper(&digest[..4])
}

/// The Signal-style 30-digit safety number (five 6-digit groups) derived from a
/// static public key, matching the client's `safetyNumber` so the user can
/// compare the two displays out-of-band.
pub fn safety_number(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    let mut groups = Vec::with_capacity(5);
    for g in 0..5usize {
        let base = g * 4;
        let value = u32::from_be_bytes([
            digest[base],
            digest[base + 1],
            digest[base + 2],
            digest[base + 3],
        ]);
        groups.push(format!("{:06}", value % 1_000_000));
    }
    groups.join(" ")
}

/// Encode bytes as base64url without padding (the QR/key wire encoding).
pub fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Decode a base64url (padding-optional) string into bytes.
pub fn b64url_decode(s: &str) -> Result<Vec<u8>, String> {
    // Accept padded or unpadded input by stripping any '=' first.
    let trimmed = s.trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed.as_bytes())
        .map_err(|e| format!("invalid base64url: {e}"))
}

/// A live, single-use pairing session minted by `remote_pair`. Holds the QR
/// payload material and the token-verification state. One pairing handshake
/// consumes one session.
pub struct PairingSession {
    /// Opaque id so the UI / WS layer can reference this session.
    pub id: Uuid,
    /// The single-use token bytes (compared in constant time).
    token: [u8; TOKEN_BYTES],
    /// The token rendered as base64url (the QR `t` field, and what the client
    /// echoes back as the msg1 payload).
    token_str: String,
    /// Ephemeral X25519 public key advertised in the QR `e` field (hint only —
    /// the real ephemeral is exchanged in the Noise handshake).
    ephemeral_public: [u8; KEY_LEN],
    /// When the session was minted, for TTL enforcement.
    created: Instant,
    /// Failed token attempts so far (rate-limit guard).
    attempts: u32,
    /// True once the token has been successfully consumed (single-use).
    consumed: bool,
}

impl PairingSession {
    /// The base64url pairing token string (QR `t`).
    pub fn token_str(&self) -> &str {
        &self.token_str
    }

    /// The advertised ephemeral public key (QR `e`).
    pub fn ephemeral_public(&self) -> &[u8; KEY_LEN] {
        &self.ephemeral_public
    }

    /// Whether the session has outlived its TTL relative to `now`.
    pub fn is_expired_at(&self, now: Instant) -> bool {
        now.duration_since(self.created) > PAIRING_TTL
    }

    /// Build the QR payload string for this session given the desktop identity
    /// and an optional rendezvous hint + human name.
    ///
    /// `maverick://pair/v1?k=&e=&t=&r=&n=&f=` — `k`/`e`/`f` always present; `r`
    /// and `n` are emitted only when supplied. Rendezvous + name are
    /// percent-encoded so the QR survives URI parsing on the client.
    pub fn qr_payload(
        &self,
        identity: &StaticIdentity,
        rendezvous: Option<&str>,
        name: Option<&str>,
    ) -> String {
        let mut s = format!(
            "maverick://pair/v1?k={}&e={}&t={}",
            b64url(identity.public_key()),
            b64url(&self.ephemeral_public),
            self.token_str,
        );
        if let Some(r) = rendezvous {
            s.push_str(&format!("&r={}", percent_encode(r)));
        }
        if let Some(n) = name {
            s.push_str(&format!("&n={}", percent_encode(n)));
        }
        s.push_str(&format!("&f={}", identity.short_fingerprint()));
        s
    }

    /// Verify a token presented by the client (the decrypted msg1 payload).
    /// Enforces: not expired, not already consumed, rate-limit not exhausted, and
    /// a constant-time byte match. On success marks the session consumed.
    pub fn verify_token(&mut self, presented: &[u8], now: Instant) -> Result<(), PairingError> {
        if self.consumed {
            return Err(PairingError::TokenConsumed);
        }
        if self.is_expired_at(now) {
            return Err(PairingError::Expired);
        }
        if self.attempts >= MAX_TOKEN_ATTEMPTS {
            return Err(PairingError::RateLimited);
        }
        if !constant_time_eq(presented, &self.token) {
            self.attempts += 1;
            return Err(PairingError::TokenMismatch);
        }
        self.consumed = true;
        Ok(())
    }
}

/// Constant-time byte comparison (length-checked first; an early length return is
/// not a timing oracle on the secret because the token length is public).
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

/// Minimal RFC-3986 percent-encoding for the QR `r`/`n` fields, escaping
/// everything outside the unreserved set so the client's `decodeURIComponent`
/// round-trips. Kept dependency-free.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        let unreserved = b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~');
        if unreserved {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Errors raised while verifying a pairing token or driving the handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairingError {
    /// No live pairing session matched (unknown id, or already removed).
    NoSession,
    /// The session's TTL elapsed.
    Expired,
    /// The session's token was already consumed (single-use violation / replay).
    TokenConsumed,
    /// Too many failed token attempts; the session is burned.
    RateLimited,
    /// The presented token did not match.
    TokenMismatch,
    /// A Noise-layer failure (decrypt/auth/state).
    Noise(String),
    /// The client's static key was already pinned to a different value (TOFU).
    TofuMismatch,
}

impl std::fmt::Display for PairingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PairingError::NoSession => write!(f, "no live pairing session"),
            PairingError::Expired => write!(f, "pairing session expired"),
            PairingError::TokenConsumed => write!(f, "pairing token already used"),
            PairingError::RateLimited => write!(f, "too many failed token attempts"),
            PairingError::TokenMismatch => write!(f, "pairing token mismatch"),
            PairingError::Noise(e) => write!(f, "noise handshake failed: {e}"),
            PairingError::TofuMismatch => write!(f, "device static key changed (TOFU mismatch)"),
        }
    }
}

impl std::error::Error for PairingError {}

/// Registry of live pairing sessions. `remote_pair` mints one; the `/pair` WS
/// endpoint consumes it. Sessions are pruned on expiry. Process-wide (held in
/// Tauri state), guarded by a std `Mutex` (contention is nil — a human pairs one
/// device at a time).
#[derive(Default)]
pub struct PairingRegistry {
    sessions: Mutex<Vec<PairingSession>>,
}

impl PairingRegistry {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(Vec::new()) }
    }

    /// Mint a new single-use pairing session, returning its id and the QR string.
    /// Prunes any expired sessions first so the list never grows unbounded.
    pub fn mint(
        &self,
        identity: &StaticIdentity,
        rendezvous: Option<&str>,
        name: Option<&str>,
    ) -> (Uuid, String) {
        let mut token = [0u8; TOKEN_BYTES];
        getrandom::getrandom(&mut token).expect("OS CSPRNG for pairing token");
        // The QR-advertised ephemeral is a fresh X25519 public key (hint only).
        let ephemeral = StaticIdentity::generate();
        let session = PairingSession {
            id: Uuid::new_v4(),
            token,
            token_str: b64url(&token),
            ephemeral_public: *ephemeral.public_key(),
            created: Instant::now(),
            attempts: 0,
            consumed: false,
        };
        let id = session.id;
        let qr = session.qr_payload(identity, rendezvous, name);
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        guard.retain(|s| !s.is_expired_at(now));
        guard.push(session);
        (id, qr)
    }

    /// Attempt to consume a token across all live sessions. Returns the matched
    /// session id on success (the session is marked consumed and stays in the
    /// list for audit until it expires). Used by the `/pair` endpoint, which
    /// receives the token in handshake msg1 and does not know which session id it
    /// belongs to ahead of time.
    pub fn consume_token(&self, presented: &[u8]) -> Result<Uuid, PairingError> {
        let now = Instant::now();
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|s| !s.is_expired_at(now));
        // Walk live sessions; the first whose token verifies wins. A mismatch
        // bumps that session's attempt counter (rate-limit), so brute force burns
        // the session within MAX_TOKEN_ATTEMPTS tries.
        let mut last_err = PairingError::NoSession;
        for s in guard.iter_mut() {
            match s.verify_token(presented, now) {
                Ok(()) => return Ok(s.id),
                Err(e) => last_err = e,
            }
        }
        Err(last_err)
    }

    /// Live (non-expired, non-consumed) session count — for the UI badge / tests.
    pub fn live_count(&self) -> usize {
        let now = Instant::now();
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|s| !s.is_expired_at(now) && !s.consumed)
            .count()
    }
}

/// Outcome of a completed Noise responder handshake: the authenticated client
/// static key, the device id derived from it, the pairing session it consumed,
/// and the negotiated transport state ready to encrypt/decrypt MaverickProtocol
/// frames.
pub struct HandshakeOutcome {
    /// The client's static X25519 public key (learned during XX), pinned by TOFU.
    pub remote_static: [u8; KEY_LEN],
    /// Deterministic device id = base64url(SHA-256(remote_static)) truncated; the
    /// stable key the device store and revoke use.
    pub device_id: String,
    /// The pairing session id that authorized this handshake.
    pub session_id: Uuid,
    /// The snow transport state (post-`into_transport_mode`), wrapping the
    /// derived send/recv keys.
    pub transport: snow::TransportState,
}

/// Stateful Noise_XX **responder** driving one pairing handshake over the
/// `/pair` endpoint. The three messages are pumped as raw bytes by the caller
/// (the WS layer base64url-decodes each text frame first, matching the client's
/// LAN channel framing):
///
/// ```text
/// let mut r = NoiseResponder::new(identity, &registry)?;
/// // <- client msg1 (carries the pairing token as payload)
/// let msg2 = r.read_msg1(&msg1)?;   // verifies token, returns msg2 to send
/// // send msg2; <- client msg3
/// let outcome = r.read_msg3(&msg3)?; // completes; transport keys + device id
/// ```
pub struct NoiseResponder<'a> {
    state: ResponderState,
    registry: &'a PairingRegistry,
    session_id: Option<Uuid>,
}

enum ResponderState {
    /// Awaiting msg1; holds the handshake state.
    AwaitMsg1(Box<snow::HandshakeState>),
    /// Awaiting msg3; holds the handshake state.
    AwaitMsg3(Box<snow::HandshakeState>),
    /// Spent (success or failure).
    Done,
}

impl<'a> NoiseResponder<'a> {
    /// Build a responder bound to the desktop static identity and a pairing
    /// registry. Uses an empty prologue to match the client.
    pub fn new(
        identity: &StaticIdentity,
        registry: &'a PairingRegistry,
    ) -> Result<Self, PairingError> {
        let params: NoiseParams = NOISE_PARAMS
            .parse()
            .map_err(|e| PairingError::Noise(format!("params: {e}")))?;
        let hs = snow::Builder::new(params)
            .prologue(&[])
            .map_err(|e| PairingError::Noise(e.to_string()))?
            .local_private_key(identity.private_key())
            .map_err(|e| PairingError::Noise(e.to_string()))?
            .build_responder()
            .map_err(|e| PairingError::Noise(e.to_string()))?;
        Ok(Self {
            state: ResponderState::AwaitMsg1(Box::new(hs)),
            registry,
            session_id: None,
        })
    }

    /// Read client message 1 (`-> e`, payload = pairing token), verify the token
    /// against a live session, and produce message 2 (`<- e, ee, s, es`) to send.
    pub fn read_msg1(&mut self, msg1: &[u8]) -> Result<Vec<u8>, PairingError> {
        let mut hs = match std::mem::replace(&mut self.state, ResponderState::Done) {
            ResponderState::AwaitMsg1(hs) => hs,
            _ => return Err(PairingError::Noise("read_msg1 out of order".into())),
        };
        let mut payload = vec![0u8; msg1.len()];
        let n = hs
            .read_message(msg1, &mut payload)
            .map_err(|e| PairingError::Noise(e.to_string()))?;
        payload.truncate(n);

        // The msg1 payload is the single-use token; verify it before answering.
        let session_id = self.registry.consume_token(&payload)?;
        self.session_id = Some(session_id);

        let mut buf = vec![0u8; 4096];
        let n = hs
            .write_message(&[], &mut buf)
            .map_err(|e| PairingError::Noise(e.to_string()))?;
        buf.truncate(n);
        self.state = ResponderState::AwaitMsg3(hs);
        Ok(buf)
    }

    /// Read client message 3 (`-> s, se`), completing the handshake. Returns the
    /// learned client static key, device id, consumed session id, and transport
    /// state. The caller applies TOFU pinning against the device store.
    pub fn read_msg3(&mut self, msg3: &[u8]) -> Result<HandshakeOutcome, PairingError> {
        let mut hs = match std::mem::replace(&mut self.state, ResponderState::Done) {
            ResponderState::AwaitMsg3(hs) => hs,
            _ => return Err(PairingError::Noise("read_msg3 out of order".into())),
        };
        let mut payload = vec![0u8; msg3.len()];
        hs.read_message(msg3, &mut payload)
            .map_err(|e| PairingError::Noise(e.to_string()))?;

        let remote = hs
            .get_remote_static()
            .ok_or_else(|| PairingError::Noise("no remote static after msg3".into()))?;
        let mut remote_static = [0u8; KEY_LEN];
        remote_static.copy_from_slice(remote);

        let session_id = self
            .session_id
            .ok_or_else(|| PairingError::Noise("session not bound".into()))?;

        let transport = hs
            .into_transport_mode()
            .map_err(|e| PairingError::Noise(e.to_string()))?;

        Ok(HandshakeOutcome {
            device_id: device_id_for(&remote_static),
            remote_static,
            session_id,
            transport,
        })
    }
}

/// Deterministic, stable device id for a client static key: base64url of the
/// full SHA-256 digest (43 chars). Used as the device-store key and the revoke
/// handle.
pub fn device_id_for(remote_static: &[u8]) -> String {
    let digest = Sha256::digest(remote_static);
    b64url(&digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A snow XX *initiator* mirroring the RN client: empty prologue, token as
    /// msg1 payload. Used to round-trip against our responder with no real network.
    struct TestInitiator {
        hs: snow::HandshakeState,
    }

    impl TestInitiator {
        fn new(static_private: Option<&[u8]>) -> Self {
            let params: NoiseParams = NOISE_PARAMS.parse().unwrap();
            let builder = snow::Builder::new(params).prologue(&[]).unwrap();
            let generated;
            let priv_bytes: &[u8] = match static_private {
                Some(p) => p,
                None => {
                    generated = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
                        .generate_keypair()
                        .unwrap();
                    &generated.private
                }
            };
            let builder = builder.local_private_key(priv_bytes).unwrap();
            Self { hs: builder.build_initiator().unwrap() }
        }

        fn write_msg1(&mut self, token: &[u8]) -> Vec<u8> {
            let mut buf = vec![0u8; 4096];
            let n = self.hs.write_message(token, &mut buf).unwrap();
            buf.truncate(n);
            buf
        }

        fn read_msg2(&mut self, msg2: &[u8]) {
            let mut buf = vec![0u8; 4096];
            self.hs.read_message(msg2, &mut buf).unwrap();
        }

        fn write_msg3(&mut self) -> Vec<u8> {
            let mut buf = vec![0u8; 4096];
            let n = self.hs.write_message(&[], &mut buf).unwrap();
            buf.truncate(n);
            buf
        }

        fn into_transport(self) -> snow::TransportState {
            self.hs.into_transport_mode().unwrap()
        }

        fn static_public(&self) -> Vec<u8> {
            self.hs.get_remote_static().unwrap_or(&[]).to_vec()
        }
    }

    fn fresh_identity() -> StaticIdentity {
        StaticIdentity::generate()
    }

    #[test]
    fn identity_public_matches_dalek_derivation_and_persists() {
        let id = StaticIdentity::generate();
        let priv_bytes = *id.private_key();
        let reconstructed = StaticIdentity::from_private(&priv_bytes).unwrap();
        assert_eq!(reconstructed.public_key(), id.public_key());
    }

    #[test]
    fn from_private_rejects_wrong_length() {
        assert!(StaticIdentity::from_private(&[0u8; 16]).is_none());
    }

    #[test]
    fn short_fingerprint_is_8_uppercase_hex() {
        let id = fresh_identity();
        let fp = id.short_fingerprint();
        assert_eq!(fp.len(), 8);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit() && (c.is_ascii_digit() || c.is_uppercase())));
    }

    #[test]
    fn safety_number_matches_client_format() {
        // Known vector: SHA-256 over a 32-byte key, five 6-digit groups.
        let key = [7u8; 32];
        let sn = safety_number(&key);
        let groups: Vec<&str> = sn.split(' ').collect();
        assert_eq!(groups.len(), 5);
        assert!(groups.iter().all(|g| g.len() == 6 && g.chars().all(|c| c.is_ascii_digit())));
    }

    #[test]
    fn qr_payload_matches_client_parser_shape() {
        let id = fresh_identity();
        let reg = PairingRegistry::new();
        let (_sid, qr) = reg.mint(&id, Some("wss://relay.example/abc"), Some("Malhar MBA"));
        assert!(qr.starts_with("maverick://pair/v1?k="));
        // Required + optional params all present in the documented order.
        assert!(qr.contains("&e="));
        assert!(qr.contains("&t="));
        assert!(qr.contains("&r="));
        assert!(qr.contains("&n="));
        assert!(qr.contains("&f="));
        // Rendezvous + name are percent-encoded.
        assert!(qr.contains("wss%3A%2F%2Frelay.example%2Fabc"));
        assert!(qr.contains("Malhar%20MBA"));
        // The k field is a 32-byte base64url key.
        let k = qr
            .split("k=")
            .nth(1)
            .unwrap()
            .split('&')
            .next()
            .unwrap();
        assert_eq!(b64url_decode(k).unwrap().len(), KEY_LEN);
    }

    #[test]
    fn qr_payload_omits_optional_fields_when_absent() {
        let id = fresh_identity();
        let reg = PairingRegistry::new();
        let (_sid, qr) = reg.mint(&id, None, None);
        assert!(!qr.contains("&r="));
        assert!(!qr.contains("&n="));
        assert!(qr.contains("&f="));
    }

    #[test]
    fn b64url_round_trips_padded_and_unpadded() {
        let bytes = [251u8, 255, 191, 0, 1];
        let enc = b64url(&bytes);
        assert!(!enc.contains('='));
        assert!(!enc.contains('+'));
        assert!(!enc.contains('/'));
        assert_eq!(b64url_decode(&enc).unwrap(), bytes);
        // Padded input also decodes.
        assert_eq!(b64url_decode("aGk=").unwrap(), b"hi");
        assert_eq!(b64url_decode("aGk").unwrap(), b"hi");
    }

    #[test]
    fn full_handshake_round_trips_with_client_style_initiator() {
        let desktop = fresh_identity();
        let reg = PairingRegistry::new();
        let (_sid, qr) = reg.mint(&desktop, None, None);
        // Extract the token the client would echo back as msg1 payload.
        let token_str = qr.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();

        let client_static = StaticIdentity::generate();
        let mut client = TestInitiator::new(Some(client_static.private_key()));
        let mut responder = NoiseResponder::new(&desktop, &reg).unwrap();

        let msg1 = client.write_msg1(&token);
        let msg2 = responder.read_msg1(&msg1).unwrap();
        client.read_msg2(&msg2);
        let msg3 = client.write_msg3();
        let outcome = responder.read_msg3(&msg3).unwrap();

        // The responder learned the client's static key...
        assert_eq!(outcome.remote_static.to_vec(), *client_static.public_key());
        // ...and the client learned the desktop's static key (matches the QR `k`).
        assert_eq!(client.static_public(), *desktop.public_key());

        // Transport keys interoperate: encrypt on one side, decrypt on the other.
        let mut server_t = outcome.transport;
        let mut client_t = client.into_transport();
        let mut ct = vec![0u8; 1024];
        let n = client_t.write_message(b"{\"type\":\"list_sessions\"}", &mut ct).unwrap();
        let mut pt = vec![0u8; 1024];
        let m = server_t.read_message(&ct[..n], &mut pt).unwrap();
        assert_eq!(&pt[..m], b"{\"type\":\"list_sessions\"}");
    }

    #[test]
    fn handshake_with_wrong_token_is_rejected() {
        let desktop = fresh_identity();
        let reg = PairingRegistry::new();
        let _ = reg.mint(&desktop, None, None);
        let mut client = TestInitiator::new(None);
        let mut responder = NoiseResponder::new(&desktop, &reg).unwrap();
        let msg1 = client.write_msg1(b"not-the-token");
        let err = responder.read_msg1(&msg1).unwrap_err();
        assert_eq!(err, PairingError::TokenMismatch);
    }

    #[test]
    fn token_is_single_use() {
        let reg = PairingRegistry::new();
        let id = fresh_identity();
        let (_sid, qr) = reg.mint(&id, None, None);
        let token_str = qr.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();
        assert!(reg.consume_token(&token).is_ok());
        // Second use is rejected (consumed).
        assert_eq!(reg.consume_token(&token).unwrap_err(), PairingError::TokenConsumed);
    }

    #[test]
    fn token_rate_limit_burns_session_after_five_failures() {
        let reg = PairingRegistry::new();
        let id = fresh_identity();
        let _ = reg.mint(&id, None, None);
        for _ in 0..MAX_TOKEN_ATTEMPTS {
            assert_eq!(reg.consume_token(b"wrong-token-1234").unwrap_err(), PairingError::TokenMismatch);
        }
        // Sixth attempt — even with the wrong token — is rate-limited, not a mismatch.
        assert_eq!(reg.consume_token(b"wrong-token-1234").unwrap_err(), PairingError::RateLimited);
    }

    #[test]
    fn token_expiry_is_enforced() {
        let mut session = PairingSession {
            id: Uuid::new_v4(),
            token: [9u8; TOKEN_BYTES],
            token_str: b64url(&[9u8; TOKEN_BYTES]),
            ephemeral_public: [0u8; KEY_LEN],
            created: Instant::now() - (PAIRING_TTL + Duration::from_secs(1)),
            attempts: 0,
            consumed: false,
        };
        assert_eq!(
            session.verify_token(&[9u8; TOKEN_BYTES], Instant::now()).unwrap_err(),
            PairingError::Expired
        );
    }

    #[test]
    fn consume_token_no_live_session_errors() {
        let reg = PairingRegistry::new();
        assert_eq!(reg.consume_token(b"anything").unwrap_err(), PairingError::NoSession);
    }

    #[test]
    fn live_count_excludes_consumed_and_expired() {
        let reg = PairingRegistry::new();
        let id = fresh_identity();
        let (_a, qr) = reg.mint(&id, None, None);
        let _ = reg.mint(&id, None, None);
        assert_eq!(reg.live_count(), 2);
        let token_str = qr.split("t=").nth(1).unwrap().split('&').next().unwrap();
        reg.consume_token(&b64url_decode(token_str).unwrap()).unwrap();
        // One consumed → one live remains.
        assert_eq!(reg.live_count(), 1);
    }

    #[test]
    fn responder_read_msg3_out_of_order_errors() {
        let desktop = fresh_identity();
        let reg = PairingRegistry::new();
        let mut responder = NoiseResponder::new(&desktop, &reg).unwrap();
        // Calling read_msg3 before read_msg1 is a protocol error. `HandshakeOutcome`
        // wraps a non-Debug `TransportState`, so match the Result directly rather
        // than `unwrap_err`.
        match responder.read_msg3(&[0u8; 64]) {
            Err(PairingError::Noise(_)) => {}
            Err(other) => panic!("expected Noise error, got {other:?}"),
            Ok(_) => panic!("read_msg3 out of order should fail"),
        }
    }

    #[test]
    fn device_id_is_stable_and_distinct() {
        let a = [1u8; KEY_LEN];
        let b = [2u8; KEY_LEN];
        assert_eq!(device_id_for(&a), device_id_for(&a));
        assert_ne!(device_id_for(&a), device_id_for(&b));
        // base64url of a 32-byte SHA-256 digest = 43 chars unpadded.
        assert_eq!(device_id_for(&a).len(), 43);
    }
}
