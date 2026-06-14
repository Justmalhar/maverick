//! Output sink for PTY sessions. Decouples `PtyManager` from any specific event
//! transport: the desktop app emits Tauri `pty:data`/`pty:exit` events, the
//! headless daemon uses the no-op sink (remote clients read via the ring +
//! `subscribe()`, not the sink).

/// Receives coalesced PTY output and the final exit code. Implementations must be
/// cheap to call from the flusher/waiter threads and must not block.
pub trait PtyEventSink: Send + Sync + 'static {
    fn data(&self, pty_id: &str, chunk: &str);
    fn exit(&self, pty_id: &str, code: i32);
}

/// No-op sink: drops all output. Used by the headless daemon, where remote
/// clients consume output via the scrollback ring rather than this sink.
#[allow(dead_code)]
pub struct NoopPtySink;

impl PtyEventSink for NoopPtySink {
    fn data(&self, _pty_id: &str, _chunk: &str) {}
    fn exit(&self, _pty_id: &str, _code: i32) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// A capturing sink the PtyManager tests reuse to assert emitted output.
    struct Capture {
        data: Arc<Mutex<Vec<(String, String)>>>,
        exits: Arc<Mutex<Vec<(String, i32)>>>,
    }
    impl PtyEventSink for Capture {
        fn data(&self, pty_id: &str, chunk: &str) {
            self.data.lock().unwrap().push((pty_id.into(), chunk.into()));
        }
        fn exit(&self, pty_id: &str, code: i32) {
            self.exits.lock().unwrap().push((pty_id.into(), code));
        }
    }

    #[test]
    fn noop_sink_is_inert() {
        let s = NoopPtySink;
        s.data("pty_0", "hello");
        s.exit("pty_0", 0);
        // No panic, nothing observable — that's the contract.
    }

    #[test]
    fn capture_sink_records() {
        let data = Arc::new(Mutex::new(Vec::new()));
        let exits = Arc::new(Mutex::new(Vec::new()));
        let s = Capture { data: data.clone(), exits: exits.clone() };
        s.data("pty_0", "abc");
        s.exit("pty_0", 3);
        assert_eq!(data.lock().unwrap().as_slice(), &[("pty_0".into(), "abc".into())]);
        assert_eq!(exits.lock().unwrap().as_slice(), &[("pty_0".into(), 3)]);
    }
}
