//! Per-socket connection state: owns the single attach lifecycle for one client
//! and provides multi-client fan-out helpers.
//!
//! A connection attaches to at most one session at a time (mirroring the Swift
//! `ClientHandler.attachedSessionId`). Attaching while already attached cleanly
//! detaches the previous stream first. Detach is also driven on disconnect/error
//! so a dropped socket never leaves a live tee-draining task running.
//!
//! Companion-2's tee receiver is a blocking `std::sync::mpsc::Receiver<Vec<u8>>`.
//! We drain it on a dedicated `spawn_blocking` task and forward each chunk as an
//! `Output` `ServerMessage` into the connection's async outbound channel. A
//! shared `AtomicBool` "detached" flag lets us tear that blocking task down: the
//! drain loop checks it on every wakeup, and `recv` unblocks when the underlying
//! `Subscription` (and thus its `Sender`) is dropped on detach.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::broadcast;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::remote::bridge::AttachDirective;
use crate::remote::ServerMessage;

/// One live attach: the session it streams plus the flag that stops its blocking
/// drain task. Dropping it (or calling `stop`) signals the task to exit and drops
/// the `Subscription`, which closes the tee `Sender` and unblocks `recv`.
struct ActiveAttach {
    session_id: Uuid,
    detached: Arc<AtomicBool>,
}

impl ActiveAttach {
    fn stop(&self) {
        self.detached.store(true, Ordering::Release);
    }
}

/// One live agent-event forward: the session whose `agent_event` frames are
/// forwarded, plus the abort handle for the bus-draining task.
struct ActiveAgentAttach {
    session_id: Uuid,
    task: tokio::task::JoinHandle<()>,
}

impl ActiveAgentAttach {
    fn stop(&self) {
        self.task.abort();
    }
}

/// Tracks the single attach for one connection and turns `AttachDirective`s into
/// running drain tasks that emit `Output` frames on `outbound`. Also forwards
/// `agent_event` frames from the shared bus for the connection's attached agent
/// session (Companion-4).
pub struct ConnectionManager {
    outbound: UnboundedSender<ServerMessage>,
    active: parking_lot_mutex::Mutex<Option<ActiveAttach>>,
    agent_active: parking_lot_mutex::Mutex<Option<ActiveAgentAttach>>,
}

// A tiny std-Mutex wrapper kept private to avoid leaking lock-poisoning into the
// connection API; the protected value is a single Option so contention is nil.
mod parking_lot_mutex {
    use std::sync::Mutex as StdMutex;

    pub struct Mutex<T>(StdMutex<T>);

    impl<T> Mutex<T> {
        pub fn new(v: T) -> Self {
            Self(StdMutex::new(v))
        }
        pub fn lock(&self) -> std::sync::MutexGuard<'_, T> {
            self.0.lock().unwrap_or_else(|e| e.into_inner())
        }
    }
}

impl ConnectionManager {
    pub fn new(outbound: UnboundedSender<ServerMessage>) -> Self {
        Self {
            outbound,
            active: parking_lot_mutex::Mutex::new(None),
            agent_active: parking_lot_mutex::Mutex::new(None),
        }
    }

    /// The session this connection is currently attached to, if any.
    pub fn attached_session(&self) -> Option<Uuid> {
        self.active.lock().as_ref().map(|a| a.session_id)
    }

    /// The agent session whose events this connection is currently forwarding.
    pub fn attached_agent_session(&self) -> Option<Uuid> {
        self.agent_active.lock().as_ref().map(|a| a.session_id)
    }

    /// Detach the current PTY stream (if any). Idempotent. Safe on disconnect.
    pub fn detach(&self) {
        if let Some(prev) = self.active.lock().take() {
            prev.stop();
        }
    }

    /// Stop forwarding agent events (if any). Idempotent.
    pub fn detach_agent(&self) {
        if let Some(prev) = self.agent_active.lock().take() {
            prev.stop();
        }
    }

    /// Begin forwarding `agent_event` (and any other per-session) frames for
    /// `session_id` from the shared bus to this connection. Replaces any prior
    /// agent attach. The task ends when the bus closes, the outbound sink closes,
    /// or `detach_agent` aborts it. Bus lag drops the oldest frames (logged) but
    /// keeps the task alive — a slow client never wedges the whole bus.
    pub fn start_agent_attach(
        &self,
        session_id: Uuid,
        mut bus: broadcast::Receiver<(Uuid, ServerMessage)>,
    ) {
        self.detach_agent();
        let outbound = self.outbound.clone();
        let task = tokio::spawn(async move {
            loop {
                match bus.recv().await {
                    Ok((sid, msg)) => {
                        if sid != session_id {
                            continue;
                        }
                        if outbound.send(msg).is_err() {
                            break; // socket writer gone
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("remote: agent bus lagged, dropped {n} frames");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        *self.agent_active.lock() = Some(ActiveAgentAttach { session_id, task });
    }

    /// Begin streaming `directive`'s live subscription to this connection,
    /// detaching any prior attach first. Spawns a blocking drain task that
    /// forwards every tee chunk as an `Output` frame until the flag is set or
    /// the tee closes.
    pub fn start_attach(&self, directive: AttachDirective) {
        // Detach the previous stream before swapping in the new one.
        self.detach();

        let session_id = directive.session_id;
        let detached = Arc::new(AtomicBool::new(false));
        let detached_task = detached.clone();
        let outbound = self.outbound.clone();
        let subscription = directive.subscription;

        tokio::task::spawn_blocking(move || {
            // Blocking drain: `recv` parks until a chunk arrives or the tee
            // `Sender` is dropped (detach / pty death), at which point it errs and
            // we exit. The flag check covers the detach-while-idle case once a
            // chunk wakes us, and also short-circuits if detach raced us at start.
            loop {
                if detached_task.load(Ordering::Acquire) {
                    break;
                }
                match subscription.receiver.recv() {
                    Ok(chunk) => {
                        if detached_task.load(Ordering::Acquire) {
                            break;
                        }
                        let msg = ServerMessage::Output {
                            session_id,
                            data: encode_b64(&chunk),
                        };
                        // Receiver gone → the writer task ended → stop draining.
                        if outbound.send(msg).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            drop(subscription);
        });

        *self.active.lock() = Some(ActiveAttach { session_id, detached });
    }
}

impl Drop for ConnectionManager {
    fn drop(&mut self) {
        // Ensure no orphaned drain/forward task survives a dropped connection.
        self.detach();
        self.detach_agent();
    }
}

fn encode_b64(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::Ring;
    use crate::remote::bridge::AttachDirective;
    use std::time::Duration;
    use tokio::sync::mpsc::unbounded_channel;

    fn b64_decode(s: &str) -> Vec<u8> {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        STANDARD.decode(s).unwrap()
    }

    /// Pull the next `Output` frame's decoded bytes within a short timeout.
    async fn next_output(rx: &mut tokio::sync::mpsc::UnboundedReceiver<ServerMessage>) -> Vec<u8> {
        let msg = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("output within timeout")
            .expect("channel open");
        match msg {
            ServerMessage::Output { data, .. } => b64_decode(&data),
            other => panic!("expected Output, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn attach_streams_live_chunks_as_output() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);

        let ring = Ring::new();
        let session_id = Uuid::new_v4();
        cm.start_attach(AttachDirective { session_id, subscription: ring.subscribe() });
        assert_eq!(cm.attached_session(), Some(session_id));

        ring.push(b"hello");
        ring.push(b"world");
        assert_eq!(next_output(&mut rx).await, b"hello");
        assert_eq!(next_output(&mut rx).await, b"world");
    }

    #[tokio::test]
    async fn reattach_detaches_previous_stream() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);

        let ring_a = Ring::new();
        let sid_a = Uuid::new_v4();
        cm.start_attach(AttachDirective { session_id: sid_a, subscription: ring_a.subscribe() });

        // Switch to a second session.
        let ring_b = Ring::new();
        let sid_b = Uuid::new_v4();
        cm.start_attach(AttachDirective { session_id: sid_b, subscription: ring_b.subscribe() });
        assert_eq!(cm.attached_session(), Some(sid_b));

        // The detached subscription's Sender is dropped; pushing to ring_a must be
        // pruned and produce no frames. Give the blocking task a beat to unwind.
        tokio::time::sleep(Duration::from_millis(50)).await;
        ring_a.push(b"stale");
        ring_b.push(b"fresh");

        let bytes = next_output(&mut rx).await;
        assert_eq!(bytes, b"fresh", "only the live session streams");
        // ring_a's subscriber was pruned on its next push (receiver dropped).
        assert_eq!(ring_a.subscriber_count_for_test(), 0);
    }

    #[tokio::test]
    async fn detach_stops_streaming() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);
        let ring = Ring::new();
        cm.start_attach(AttachDirective { session_id: Uuid::new_v4(), subscription: ring.subscribe() });

        ring.push(b"before");
        assert_eq!(next_output(&mut rx).await, b"before");

        cm.detach();
        assert!(cm.attached_session().is_none());
        // Let the blocking task observe the dropped Sender and exit.
        tokio::time::sleep(Duration::from_millis(50)).await;
        ring.push(b"after");
        // No more frames arrive; the subscriber was pruned.
        let got = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await;
        assert!(got.is_err(), "no output after detach");
    }

    #[tokio::test]
    async fn drop_connection_manager_detaches() {
        let (tx, _rx) = unbounded_channel();
        let ring = Ring::new();
        let count_handle = ring.clone();
        {
            let cm = ConnectionManager::new(tx);
            cm.start_attach(AttachDirective { session_id: Uuid::new_v4(), subscription: ring.subscribe() });
            assert_eq!(count_handle.subscriber_count_for_test(), 1);
        } // cm dropped here → detach()
        tokio::time::sleep(Duration::from_millis(50)).await;
        // After drop, a push prunes the now-dead subscriber.
        count_handle.push(b"x");
        assert_eq!(count_handle.subscriber_count_for_test(), 0);
    }

    #[tokio::test]
    async fn detach_when_idle_is_noop() {
        let (tx, _rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);
        cm.detach(); // nothing attached
        assert!(cm.attached_session().is_none());
    }

    // ---- Agent-event forwarding (Companion-4) ----

    async fn next_msg(rx: &mut tokio::sync::mpsc::UnboundedReceiver<ServerMessage>) -> ServerMessage {
        tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("msg within timeout")
            .expect("channel open")
    }

    #[tokio::test]
    async fn agent_attach_forwards_only_matching_session_events() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);
        let (bus, _keep) = broadcast::channel(16);
        let mine = Uuid::new_v4();
        let other = Uuid::new_v4();
        cm.start_agent_attach(mine, bus.subscribe());
        assert_eq!(cm.attached_agent_session(), Some(mine));

        // An event for a different session is filtered out...
        bus.send((other, ServerMessage::Error { message: "other".into() })).unwrap();
        // ...while one for my session is forwarded.
        bus.send((mine, ServerMessage::Error { message: "mine".into() })).unwrap();
        match next_msg(&mut rx).await {
            ServerMessage::Error { message } => assert_eq!(message, "mine"),
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn reattach_agent_replaces_previous_forward() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);
        let (bus, _keep) = broadcast::channel(16);
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        cm.start_agent_attach(a, bus.subscribe());
        cm.start_agent_attach(b, bus.subscribe());
        assert_eq!(cm.attached_agent_session(), Some(b));

        // Only session b is forwarded now.
        bus.send((a, ServerMessage::Error { message: "a".into() })).unwrap();
        bus.send((b, ServerMessage::Error { message: "b".into() })).unwrap();
        match next_msg(&mut rx).await {
            ServerMessage::Error { message } => assert_eq!(message, "b"),
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn detach_agent_stops_forwarding() {
        let (tx, mut rx) = unbounded_channel();
        let cm = ConnectionManager::new(tx);
        let (bus, _keep) = broadcast::channel(16);
        let sid = Uuid::new_v4();
        cm.start_agent_attach(sid, bus.subscribe());
        cm.detach_agent();
        assert!(cm.attached_agent_session().is_none());
        // Give the aborted task a beat to unwind, then a send reaches no one.
        tokio::time::sleep(Duration::from_millis(20)).await;
        bus.send((sid, ServerMessage::Error { message: "x".into() })).unwrap();
        let got = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await;
        assert!(got.is_err(), "no forward after detach_agent");
    }
}
