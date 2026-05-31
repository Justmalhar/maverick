// Per-session server-side scrollback ring buffer + tee/subscription fan-out.
//
// This is the second sink for coalesced PTY output (the first is the existing
// `pty:data` Tauri emit to the webview, which is untouched). Companion-3's WS
// server attaches here to serve history-then-live replay to remote viewports
// with no gap: `subscribe()` returns the most-recent 256 KiB suffix *and* a
// live receiver, atomically under one lock, so nothing emitted between the two
// can slip through.
//
// Budgets (MASTER-PLAN §4/§6.4): hot ring = exactly 1 MiB raw bytes/session;
// replay slice = 256 KiB tail. A monotonic `next_offset` and a `dropped`
// counter let a late consumer detect gaps when the producer overran the ring.
//
// The tee/read API (subscribe / read_since / Subscription / the cap consts) has
// no in-crate caller yet: Companion-3 (cc-feature/companion-ws-server, PTY ring
// tee) wires the WS server to it. Until then it is intentionally unused public
// surface, hence the crate-local dead_code allowance below.
#![allow(dead_code)]

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// Hot ring capacity per session. Exactly 1 MiB of raw output bytes
/// (~6-12k terminal lines). O(1) overwrite-oldest once full.
pub const RING_CAP: usize = 1_048_576;

/// Most-recent suffix handed to a freshly attaching consumer. 256 KiB keeps the
/// base64-encoded replay (~340 KiB) well under the 16 MiB WS frame ceiling.
pub const REPLAY_CAP: usize = 256 * 1024;

/// Snapshot returned by `subscribe`: the history suffix to replay first, then a
/// live receiver carrying every chunk appended after the snapshot. `base_offset`
/// is the absolute stream offset of the first replay byte; `dropped` is the
/// total bytes the ring had already overwritten at snapshot time, so a consumer
/// can render a gap marker if it expected to be caught up from an earlier point.
pub struct Subscription {
    pub replay: Vec<u8>,
    pub base_offset: u64,
    pub dropped: u64,
    pub receiver: Receiver<Vec<u8>>,
}

/// Inner state guarded by a single mutex so `push` (append + fan-out) and
/// `subscribe` (snapshot + register) are each atomic with respect to one
/// another — the invariant that makes replay-then-live gapless.
struct Inner {
    // Contiguous backing store, length clamped to RING_CAP. We keep a flat Vec
    // with an O(1) overwrite-oldest via `drain` of the overflow prefix; for the
    // append sizes a coalesced flusher produces (<= a few KiB) this is cheaper
    // and simpler than a fixed-index circular array, and amortises to O(1).
    buf: Vec<u8>,
    // Absolute offset of the next byte to be appended (monotonic, never resets).
    // Equivalently: total bytes ever pushed to this session.
    next_offset: u64,
    // Total bytes evicted from the front of the ring because of capacity
    // overflow. A consumer that saw offset X but finds `dropped > X` knows it
    // missed a span.
    dropped: u64,
    // Live subscribers. Closed receivers (consumer gone) are pruned lazily on
    // the next push when their send fails.
    subscribers: Vec<Sender<Vec<u8>>>,
}

impl Inner {
    /// Absolute offset of the oldest byte still resident in `buf`.
    fn oldest_offset(&self) -> u64 {
        self.next_offset - self.buf.len() as u64
    }
}

/// Thread-safe handle to one session's ring. Cheaply cloneable (Arc); the
/// reader/flusher side holds one clone to `push`, each WS attach gets a
/// `Subscription` via `subscribe`.
#[derive(Clone)]
pub struct Ring {
    inner: Arc<Mutex<Inner>>,
}

impl Default for Ring {
    fn default() -> Self {
        Self::new()
    }
}

impl Ring {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                buf: Vec::new(),
                next_offset: 0,
                dropped: 0,
                subscribers: Vec::new(),
            })),
        }
    }

    /// Append `data` to the ring (overwrite-oldest past RING_CAP) and fan it out
    /// to every live subscriber. Empty pushes are a no-op so the offset stays
    /// meaningful. This is the tee point invoked by the flusher alongside — not
    /// instead of — the existing `pty:data` emit.
    pub fn push(&self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        g.next_offset += data.len() as u64;
        g.buf.extend_from_slice(data);
        // Evict the oldest overflow in one O(1)-amortised drain, crediting the
        // dropped counter so late consumers can detect the gap.
        if g.buf.len() > RING_CAP {
            let overflow = g.buf.len() - RING_CAP;
            g.buf.drain(..overflow);
            g.dropped += overflow as u64;
        }

        // Fan out a copy to each subscriber; drop senders whose receiver is gone.
        if !g.subscribers.is_empty() {
            let chunk = data.to_vec();
            g.subscribers.retain(|tx| tx.send(chunk.clone()).is_ok());
        }
    }

    /// Atomically snapshot the most-recent up-to-REPLAY_CAP suffix and register
    /// a live receiver. Everything pushed after this call arrives on the
    /// receiver with no gap and no duplication of the replayed suffix.
    pub fn subscribe(&self) -> Subscription {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());

        let take = g.buf.len().min(REPLAY_CAP);
        let start = g.buf.len() - take;
        let replay = g.buf[start..].to_vec();
        // Absolute offset of the first replayed byte.
        let base_offset = g.next_offset - take as u64;
        let dropped = g.dropped;

        let (tx, rx) = channel();
        g.subscribers.push(tx);

        Subscription {
            replay,
            base_offset,
            dropped,
            receiver: rx,
        }
    }

    /// Read the resident bytes whose absolute offset is `>= offset`. Returns the
    /// bytes, the new `next_offset` (so the caller advances its cursor), and the
    /// total `dropped` count. If `offset` is older than what the ring still
    /// holds, the result starts at the oldest resident byte — the caller detects
    /// that span loss by comparing its requested `offset` against `dropped`
    /// (equivalently against `next_offset - bytes.len()`). If `offset` is at or
    /// beyond `next_offset`, returns empty (caller is already caught up).
    pub fn read_since(&self, offset: u64) -> (Vec<u8>, u64, u64) {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let oldest = g.oldest_offset();
        let from = offset.max(oldest).min(g.next_offset);
        let start = (from - oldest) as usize;
        (g.buf[start..].to_vec(), g.next_offset, g.dropped)
    }

    /// Current monotonic stream offset (total bytes ever pushed). Cheap probe
    /// for a consumer that wants to record a resume cursor.
    pub fn next_offset(&self) -> u64 {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).next_offset
    }

    /// Total bytes evicted by overflow so far.
    pub fn dropped(&self) -> u64 {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).dropped
    }

    #[cfg(test)]
    fn resident_len(&self) -> usize {
        self.inner.lock().unwrap().buf.len()
    }

    #[cfg(test)]
    fn subscriber_count(&self) -> usize {
        self.inner.lock().unwrap().subscribers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain_live(rx: &Receiver<Vec<u8>>) -> Vec<u8> {
        let mut out = Vec::new();
        // try_recv errs on both Empty and Disconnected → loop ends either way.
        while let Ok(chunk) = rx.try_recv() {
            out.extend_from_slice(&chunk);
        }
        out
    }

    #[test]
    fn empty_push_is_noop() {
        let r = Ring::new();
        r.push(b"");
        assert_eq!(r.next_offset(), 0);
        assert_eq!(r.resident_len(), 0);
        assert_eq!(r.dropped(), 0);
    }

    #[test]
    fn append_tracks_offset_without_dropping_under_cap() {
        let r = Ring::new();
        r.push(b"hello ");
        r.push(b"world");
        assert_eq!(r.next_offset(), 11);
        assert_eq!(r.dropped(), 0);
        assert_eq!(r.resident_len(), 11);
        let (bytes, next, dropped) = r.read_since(0);
        assert_eq!(bytes, b"hello world");
        assert_eq!(next, 11);
        assert_eq!(dropped, 0);
    }

    #[test]
    fn overwrite_oldest_at_exactly_one_mib() {
        let r = Ring::new();
        // Fill to exactly RING_CAP: no eviction yet.
        let full = vec![b'a'; RING_CAP];
        r.push(&full);
        assert_eq!(r.resident_len(), RING_CAP);
        assert_eq!(r.dropped(), 0, "exactly at cap must not drop");
        assert_eq!(r.next_offset(), RING_CAP as u64);

        // One more byte past the cap evicts exactly one oldest byte.
        r.push(b"Z");
        assert_eq!(
            r.resident_len(),
            RING_CAP,
            "resident length stays clamped at the 1,048,576 cap"
        );
        assert_eq!(r.dropped(), 1, "one byte overflowed → dropped increments by 1");
        assert_eq!(r.next_offset(), RING_CAP as u64 + 1);

        // The newest byte is the tail; the evicted byte is gone.
        let (bytes, _, _) = r.read_since(r.next_offset() - 1);
        assert_eq!(bytes, b"Z");
    }

    #[test]
    fn dropped_counter_accumulates_across_multiple_overflows() {
        let r = Ring::new();
        r.push(&vec![b'x'; RING_CAP]);
        r.push(&[b'y'; 100]); // evict 100
        r.push(&[b'z'; 250]); // evict 250 more
        assert_eq!(r.dropped(), 350);
        assert_eq!(r.resident_len(), RING_CAP);
        assert_eq!(r.next_offset(), RING_CAP as u64 + 350);
    }

    #[test]
    fn replay_slice_is_correct_256_kib_suffix() {
        let r = Ring::new();
        // Push more than the replay window so the suffix is a strict slice.
        let total = REPLAY_CAP + 10_000;
        let data: Vec<u8> = (0..total).map(|i| (i % 256) as u8).collect();
        r.push(&data);

        let sub = r.subscribe();
        assert_eq!(
            sub.replay.len(),
            REPLAY_CAP,
            "replay must be exactly the 256 KiB cap when more is available"
        );
        // It is the *most recent* suffix.
        assert_eq!(sub.replay, &data[total - REPLAY_CAP..]);
        // base_offset points at the first replayed byte's absolute offset.
        assert_eq!(sub.base_offset, (total - REPLAY_CAP) as u64);
        assert_eq!(sub.dropped, 0);
    }

    #[test]
    fn replay_slice_smaller_than_cap_returns_whole_buffer() {
        let r = Ring::new();
        r.push(b"short");
        let sub = r.subscribe();
        assert_eq!(sub.replay, b"short");
        assert_eq!(sub.base_offset, 0);
    }

    #[test]
    fn subscribe_reports_dropped_after_overflow() {
        let r = Ring::new();
        r.push(&vec![b'a'; RING_CAP]);
        r.push(&vec![b'b'; 500]); // drop 500
        let sub = r.subscribe();
        assert_eq!(sub.dropped, 500, "late subscriber sees the dropped count");
        assert_eq!(sub.replay.len(), REPLAY_CAP);
    }

    #[test]
    fn subscribe_delivers_replay_then_live_no_gap_no_dup_two_subscribers() {
        let r = Ring::new();
        r.push(b"AAAA"); // history before anyone attaches
        r.push(b"BBBB");

        // Two consumers attach mid-stream.
        let s1 = r.subscribe();
        let s2 = r.subscribe();
        assert_eq!(r.subscriber_count(), 2);

        // Both see the same history-then-live boundary.
        assert_eq!(s1.replay, b"AAAABBBB");
        assert_eq!(s2.replay, b"AAAABBBB");
        assert_eq!(s1.base_offset, 0);
        assert_eq!(s2.base_offset, 0);

        // Live appends after the snapshot.
        r.push(b"CCCC");
        r.push(b"DDDD");

        let live1 = drain_live(&s1.receiver);
        let live2 = drain_live(&s2.receiver);

        // No gap and no duplication: replay + live reconstructs the full stream
        // exactly once for each subscriber, with the replayed suffix NOT repeated
        // on the live channel.
        let mut full1 = s1.replay.clone();
        full1.extend_from_slice(&live1);
        let mut full2 = s2.replay.clone();
        full2.extend_from_slice(&live2);

        assert_eq!(full1, b"AAAABBBBCCCCDDDD");
        assert_eq!(full2, b"AAAABBBBCCCCDDDD");
        // Live channel carries ONLY the post-snapshot data (no dup of replay).
        assert_eq!(live1, b"CCCCDDDD");
        assert_eq!(live2, b"CCCCDDDD");
    }

    #[test]
    fn dropped_subscriber_is_pruned_on_next_push() {
        let r = Ring::new();
        let sub = r.subscribe();
        assert_eq!(r.subscriber_count(), 1);
        drop(sub); // receiver gone
        r.push(b"x"); // send fails → retain prunes it
        assert_eq!(r.subscriber_count(), 0);
    }

    #[test]
    fn read_since_offset_correctness() {
        let r = Ring::new();
        r.push(b"0123456789");
        // Read from a mid-stream offset.
        let (bytes, next, dropped) = r.read_since(4);
        assert_eq!(bytes, b"456789");
        assert_eq!(next, 10);
        assert_eq!(dropped, 0);

        // Offset at next_offset → already caught up → empty.
        let (caught_up, next2, _) = r.read_since(10);
        assert!(caught_up.is_empty());
        assert_eq!(next2, 10);

        // Offset beyond next_offset is clamped → also empty.
        let (beyond, _, _) = r.read_since(999);
        assert!(beyond.is_empty());
    }

    #[test]
    fn read_since_clamps_to_oldest_after_eviction() {
        let r = Ring::new();
        r.push(&vec![b'a'; RING_CAP]);
        r.push(&[b'b'; 100]); // oldest_offset becomes 100, dropped = 100

        // Requesting offset 0 (now evicted) clamps to the oldest resident byte.
        let (bytes, next, dropped) = r.read_since(0);
        assert_eq!(dropped, 100);
        assert_eq!(next, RING_CAP as u64 + 100);
        assert_eq!(bytes.len(), RING_CAP, "returns all resident bytes from oldest");
        // The span loss is detectable: requested 0 but bytes start at offset
        // next - len == 100 == dropped.
        assert_eq!(next - bytes.len() as u64, dropped);
        // The tail is the 100 newest bytes.
        assert_eq!(&bytes[RING_CAP - 100..], &vec![b'b'; 100][..]);
    }

    #[test]
    fn read_since_within_resident_window_after_eviction() {
        let r = Ring::new();
        r.push(&vec![b'a'; RING_CAP]);
        r.push(b"TAIL"); // dropped = 4, oldest_offset = 4

        // Offset just inside the resident window returns from there.
        let from = RING_CAP as u64; // absolute offset of the first 'T'... minus tail
        let (bytes, _, dropped) = r.read_since(from);
        assert_eq!(dropped, 4);
        // from (RING_CAP) maps to resident index RING_CAP - oldest(4) = RING_CAP-4,
        // leaving the last 4 'a's plus "TAIL".
        assert_eq!(&bytes[bytes.len() - 4..], b"TAIL");
    }

    #[test]
    fn default_ring_is_empty() {
        let r = Ring::default();
        assert_eq!(r.next_offset(), 0);
        assert_eq!(r.dropped(), 0);
        assert_eq!(r.resident_len(), 0);
    }
}
