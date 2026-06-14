//! Companion transports. The Noise channel (pairing.rs) is transport-independent;
//! this module owns *where the bytes flow*:
//!
//! - **Tier 1 — LAN direct (shipped).** When the companion is enabled AND at
//!   least one device is paired, the WS listener binds the LAN wildcard
//!   (`0.0.0.0`) instead of loopback, and we advertise `_maverick._tcp` over
//!   mDNS via the `mdns-sd` crate so the client discovers the host without
//!   typing an IP. Plain `ws://` is fine — Noise wraps the payload end-to-end.
//! - **Tier 3 — iroh P2P (stubbed).** The connectivity plan calls for embedding
//!   the `iroh` crate (~3-5 MB) to dial the desktop by `NodeId` with n0's free
//!   DERP relay, tunneling the *same* Noise channel. That dependency is heavy
//!   and its API surface is still churning, so Companion-5 ships LAN+pairing
//!   solidly and leaves a clean [`RemoteDialer`] trait as the integration seam.
//!   The `iroh` crate is intentionally NOT added to Cargo.toml until the seam is
//!   filled (per the fallback: LAN guaranteed, iroh/relay incremental).
//!
//! ## Bind policy
//!
//! [`BindPolicy::resolve`] is the single source of truth for which interface the
//! listener binds, given (enabled, has-paired-device). It NEVER widens to the LAN
//! while unpaired — an enabled-but-unpaired server stays loopback-only, so there
//! is no window where the server is reachable off-box without a trusted device.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

/// The address family / interface the companion listener should bind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BindScope {
    /// `127.0.0.1` — local webview / dev tooling only (default, always safe).
    Loopback,
    /// `0.0.0.0` — every IPv4 interface, for LAN reachability. Only chosen when
    /// the companion is enabled AND a device is paired; every off-box connection
    /// still has to pass the Noise auth gate.
    Lan,
}

impl BindScope {
    /// The concrete IP this scope binds.
    pub fn ip(self) -> IpAddr {
        match self {
            BindScope::Loopback => IpAddr::V4(Ipv4Addr::LOCALHOST),
            BindScope::Lan => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        }
    }

    /// Build the bind `SocketAddr` for a port under this scope.
    pub fn socket_addr(self, port: u16) -> SocketAddr {
        SocketAddr::new(self.ip(), port)
    }
}

/// Decides the bind scope from the companion's enabled + paired state. Pure so it
/// is exhaustively unit-tested; the WS server calls it on every (re)start.
pub struct BindPolicy;

impl BindPolicy {
    /// Resolve the scope: LAN only when **both** enabled and at least one paired
    /// device exist; loopback otherwise. This is the security invariant — an
    /// enabled server with zero paired devices never widens beyond loopback.
    pub fn resolve(enabled: bool, has_paired_device: bool) -> BindScope {
        if enabled && has_paired_device {
            BindScope::Lan
        } else {
            BindScope::Loopback
        }
    }
}

/// The mDNS service type the host advertises and the client browses for.
pub const MDNS_SERVICE_TYPE: &str = "_maverick._tcp.local.";

/// A running mDNS advertisement of `_maverick._tcp`. Dropping it (or calling
/// [`MdnsAdvertiser::stop`]) unregisters the service and shuts the daemon down so
/// the host stops being discoverable the moment LAN exposure ends.
pub struct MdnsAdvertiser {
    daemon: mdns_sd::ServiceDaemon,
    fullname: String,
}

impl MdnsAdvertiser {
    /// Advertise `_maverick._tcp` for `instance_name` on `port`, carrying a TXT
    /// record with the desktop static-key short fingerprint so a client can
    /// pre-confirm it is browsing toward the device it paired with (the
    /// fingerprint is public; pairing still gates access). Addresses are
    /// auto-detected by the daemon.
    pub fn start(
        instance_name: &str,
        host_name: &str,
        port: u16,
        fingerprint: &str,
    ) -> Result<Self, String> {
        let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
        let properties = [("fp", fingerprint), ("v", "1")];
        // Empty `()` IP set => the daemon resolves the host's addresses itself.
        let mut service = mdns_sd::ServiceInfo::new(
            MDNS_SERVICE_TYPE,
            instance_name,
            host_name,
            (),
            port,
            &properties[..],
        )
        .map_err(|e| e.to_string())?;
        service = service.enable_addr_auto();
        let fullname = service.get_fullname().to_string();
        daemon.register(service).map_err(|e| e.to_string())?;
        Ok(Self { daemon, fullname })
    }

    /// The registered fullname (`<instance>._maverick._tcp.local.`).
    pub fn fullname(&self) -> &str {
        &self.fullname
    }

    /// Unregister and shut down the daemon. Idempotent best-effort: errors are
    /// logged, not propagated, since this runs on teardown.
    pub fn stop(self) {
        if let Err(e) = self.daemon.unregister(&self.fullname) {
            log::debug!("mdns: unregister failed: {e}");
        }
        if let Err(e) = self.daemon.shutdown() {
            log::debug!("mdns: shutdown failed: {e}");
        }
    }
}

// ---- Tier 3: iroh P2P seam (stub — see module docs) ------------------------

/// Identifies a remote transport tier for status / selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportTier {
    /// LAN direct (shipped).
    Lan,
    /// Iroh P2P / DERP relay (not yet integrated).
    Iroh,
}

/// The integration seam for a P2P remote transport (Tier 3, iroh). A future
/// `IrohDialer` implements this to accept incoming P2P streams that tunnel the
/// SAME Noise-wrapped MaverickProtocol bytes the LAN listener serves, so the
/// trust layer is untouched when the transport is added.
///
/// Kept as a trait (not a `todo!()`) so the boundary is real and testable today
/// via [`NullDialer`]; wiring a concrete iroh endpoint is a follow-up that adds
/// the `iroh` dependency and an `impl RemoteDialer for IrohDialer`.
pub trait RemoteDialer: Send + Sync {
    /// The tier this dialer provides.
    fn tier(&self) -> TransportTier;
    /// Whether this dialer is currently able to accept connections. The null
    /// dialer always returns false (no remote transport active).
    fn is_available(&self) -> bool;
    /// The dialable node identity to embed in the QR `r` (rendezvous) field, if
    /// any. `None` for tiers that need no out-of-band hint (LAN uses mDNS).
    fn rendezvous_hint(&self) -> Option<String>;
}

/// The default no-op remote dialer used until iroh is integrated: reports the
/// iroh tier as unavailable and offers no rendezvous hint, so the server falls
/// back to LAN-only. Documented stub, not a silent no-op.
pub struct NullDialer;

impl RemoteDialer for NullDialer {
    fn tier(&self) -> TransportTier {
        TransportTier::Iroh
    }
    fn is_available(&self) -> bool {
        false
    }
    fn rendezvous_hint(&self) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_policy_widens_only_when_enabled_and_paired() {
        assert_eq!(BindPolicy::resolve(false, false), BindScope::Loopback);
        assert_eq!(BindPolicy::resolve(true, false), BindScope::Loopback);
        assert_eq!(BindPolicy::resolve(false, true), BindScope::Loopback);
        assert_eq!(BindPolicy::resolve(true, true), BindScope::Lan);
    }

    #[test]
    fn bind_scope_ips_and_sockets() {
        assert_eq!(BindScope::Loopback.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(BindScope::Lan.ip(), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        assert_eq!(
            BindScope::Loopback.socket_addr(8765),
            "127.0.0.1:8765".parse().unwrap()
        );
        assert_eq!(
            BindScope::Lan.socket_addr(8765),
            "0.0.0.0:8765".parse().unwrap()
        );
    }

    #[test]
    fn mdns_service_type_is_maverick_tcp() {
        assert_eq!(MDNS_SERVICE_TYPE, "_maverick._tcp.local.");
    }

    #[test]
    fn mdns_advertiser_registers_and_stops() {
        // Exercises the real daemon (loopback mDNS), deterministic + no external
        // network: register a service, assert the fullname, then stop cleanly.
        let adv = MdnsAdvertiser::start("maverick-test", "maverick-test.local.", 8765, "AB12CD34")
            .expect("mdns advertiser starts");
        assert!(adv.fullname().contains("_maverick._tcp.local."));
        assert!(adv.fullname().starts_with("maverick-test."));
        adv.stop();
    }

    #[test]
    fn null_dialer_reports_iroh_unavailable() {
        let d = NullDialer;
        assert_eq!(d.tier(), TransportTier::Iroh);
        assert!(!d.is_available());
        assert!(d.rendezvous_hint().is_none());
    }
}
