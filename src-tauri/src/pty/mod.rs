mod da_filter;
mod utf8_carry;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use self::da_filter::DaFilter;
use self::utf8_carry::Utf8Carry;

static COUNTER: AtomicU64 = AtomicU64::new(0);

// Reader fills this per read(); larger than the old 8 KiB to cut syscall count
// on chatty TUIs.
const READ_BUF: usize = 16 * 1024;
// Coalesce window: after the first byte of a burst lands, wait this long so a
// flood of small writes flushes as one `pty:data` instead of hundreds. Keeps
// us under the 16ms write→paint budget while drastically cutting event count.
const FLUSH_COALESCE: Duration = Duration::from_millis(4);
// Safety net wakeup for the flusher if a condvar notify is ever missed.
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
// Cap on pending-but-not-yet-emitted UTF-8 text. On overflow we discard the
// whole pending buffer and inject a full terminal reset so xterm recovers a
// clean screen instead of rendering a sliced-mid-sequence corruption. 4 MiB is
// ~1000 full 80x24 screens — only reachable if the webview has stalled hard.
const MAX_PENDING: usize = 4 * 1024 * 1024;
// ESC c = RIS (full reset) + a dim notice. Injected verbatim when we drop
// backlog. All ASCII, so it stays valid UTF-8 in the pending String.
const OVERFLOW_NOTICE: &str =
    "\x1bc\x1b[2m[maverick: dropped output due to backpressure]\x1b[0m\r\n";

#[derive(Clone, Serialize)]
struct PtyData {
    #[serde(rename = "ptyId")]
    pty_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    #[serde(rename = "ptyId")]
    pty_id: String,
    code: i32,
}

/// Shared coalesce buffer: decoded UTF-8 text waiting to be emitted, plus a
/// condvar the reader signals and the flusher waits on.
type Pending = Arc<(Mutex<String>, Condvar)>;

/// RAII cleanup for the spawn fan-out. If any of the three thread spawns fails
/// after the reader/flusher are already running, dropping this guard sets
/// `done` and wakes the condvar so those threads observe shutdown and exit
/// instead of looping forever holding an AppHandle clone. `disarm()` is called
/// only once all three threads spawned successfully and the waiter owns teardown.
struct SpawnGuard {
    done: Arc<AtomicBool>,
    pending: Pending,
    armed: bool,
}

impl SpawnGuard {
    fn new(done: Arc<AtomicBool>, pending: Pending) -> Self {
        Self {
            done,
            pending,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for SpawnGuard {
    fn drop(&mut self) {
        if self.armed {
            self.done.store(true, Ordering::Release);
            self.pending.1.notify_all();
        }
    }
}

struct PtySession {
    // Shared with the reader thread's DA filter so it can answer Device
    // Attributes queries without contending for a second master writer
    // (portable-pty only allows `take_writer` once).
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // Shared so resize() can clone the handle out of the sessions lock and run the
    // TIOCSWINSZ ioctl without holding the global map lock.
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    // Signals reader/flusher/waiter threads to unwind. Set on Drop so a session
    // dropped without an explicit kill (window crash, dev HMR) doesn't leak
    // threads holding the child.
    done: Arc<AtomicBool>,
    pending: Pending,
    // Joined only by the waiter thread, never on the IPC worker.
    reader_handle: Option<JoinHandle<()>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Kill the child so the reader hits EOF, then wake every thread so they
        // observe `done` and exit. We never join here: teardown runs on whatever
        // thread dropped the session (often the IPC worker), and joining could
        // block it. The detached threads unwind on their own.
        let _ = self.killer.kill();
        self.done.store(true, Ordering::Release);
        self.pending.1.notify_all();
    }
}

pub struct SpawnParams {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub cols: u16,
    pub rows: u16,
}

/// Owns real OS pseudo-terminals. Per PTY: a reader thread decodes + filters
/// bytes into a coalesce buffer, a flusher thread emits batched `pty:data`
/// events at most every ~4ms, and a waiter thread emits `pty:exit` and reaps
/// the session.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        params: SpawnParams,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: params.rows.max(1),
                cols: params.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(&params.command);
        for a in &params.args {
            cmd.arg(a);
        }
        if let Some(cwd) = &params.cwd {
            cmd.cwd(cwd);
        }
        // Inherit the app's environment so spawned CLIs resolve their own deps,
        // then layer any explicit overrides on top.
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }
        if let Some(envs) = &params.env {
            for (k, v) in envs {
                cmd.env(k, v);
            }
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        // Single master writer, shared between pty_write and the DA filter.
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| e.to_string())?));
        let da_writer = writer.clone();

        let id = format!("pty_{}", COUNTER.fetch_add(1, Ordering::SeqCst));

        let pending: Pending =
            Arc::new((Mutex::new(String::with_capacity(READ_BUF)), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));

        // Armed until all three threads spawn. If any spawn below returns Err, the
        // guard's Drop sets `done` + notifies so the already-running reader/flusher
        // unwind instead of leaking (esp. the flusher, which holds an AppHandle).
        let mut guard = SpawnGuard::new(done.clone(), pending.clone());

        // Reader: raw bytes -> DA filter -> UTF-8 carry -> coalesce buffer.
        let id_reader = id.clone();
        let pending_r = pending.clone();
        let done_r = done.clone();
        let reader_handle = std::thread::Builder::new()
            .name(format!("mv-pty-reader-{id_reader}"))
            .spawn(move || {
                let mut buf = [0u8; READ_BUF];
                let mut da = DaFilter::new();
                let mut decoder = Utf8Carry::new();
                let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
                loop {
                    if done_r.load(Ordering::Acquire) {
                        break;
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            filtered.clear();
                            da.process(&buf[..n], &mut filtered, |reply| {
                                if let Ok(mut w) = da_writer.lock() {
                                    let _ = w.write_all(reply);
                                    let _ = w.flush();
                                }
                            });
                            if filtered.is_empty() {
                                continue;
                            }
                            let text = decoder.push(&filtered);
                            if text.is_empty() {
                                continue;
                            }
                            let (lock, cv) = &*pending_r;
                            let mut g = lock.lock().unwrap();
                            if g.len() + text.len() > MAX_PENDING {
                                g.clear();
                                g.push_str(OVERFLOW_NOTICE);
                            }
                            g.push_str(&text);
                            cv.notify_one();
                        }
                        Err(_) => break,
                    }
                }
                // Wake the flusher so it can drain any tail and observe `done`.
                pending_r.1.notify_one();
            })
            .map_err(|e| e.to_string())?;

        // Flusher: emit coalesced `pty:data`.
        let app_flush = app.clone();
        let id_flush = id.clone();
        let pending_f = pending.clone();
        let done_f = done.clone();
        let flusher_handle = std::thread::Builder::new()
            .name(format!("mv-pty-flusher-{id_flush}"))
            .spawn(move || {
                let (lock, cv) = &*pending_f;
                loop {
                    {
                        let mut g = lock.lock().unwrap();
                        while g.is_empty() {
                            if done_f.load(Ordering::Acquire) {
                                return;
                            }
                            let (next, _) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
                            g = next;
                        }
                    }
                    // Let the rest of a burst accumulate, then ship it as one chunk.
                    std::thread::sleep(FLUSH_COALESCE);
                    let chunk = std::mem::take(&mut *lock.lock().unwrap());
                    if chunk.is_empty() {
                        continue;
                    }
                    let _ = app_flush.emit(
                        "pty:data",
                        PtyData {
                            pty_id: id_flush.clone(),
                            data: chunk,
                        },
                    );
                }
            })
            .map_err(|e| e.to_string())?;

        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                id.clone(),
                PtySession {
                    writer,
                    master: Arc::new(Mutex::new(pair.master)),
                    killer,
                    done: done.clone(),
                    pending: pending.clone(),
                    reader_handle: Some(reader_handle),
                },
            );

        // Waiter: reap the child, drain the final tail, emit exit, drop session.
        let app_exit = app.clone();
        let id_exit = id.clone();
        let pending_e = pending;
        let done_e = done;
        let waiter = std::thread::Builder::new()
            .name(format!("mv-pty-waiter-{id_exit}"))
            .spawn(move || {
                let code = child
                    .wait()
                    .map(|status| status.exit_code() as i32)
                    .unwrap_or(-1);

                // Reap the session: pull it out of the map (poison-tolerant) and
                // join the reader FIRST so no more bytes can be pushed into the
                // coalesce buffer after this point. We own the session here, so
                // dropping it later won't re-trigger teardown on the IPC worker.
                let reaped = app_exit.try_state::<PtyManager>().and_then(|m| {
                    m.sessions
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&id_exit)
                });
                if let Some(mut session) = reaped {
                    if let Some(handle) = session.reader_handle.take() {
                        let _ = handle.join();
                    }
                }

                // Reader is joined, so the buffer is now final. Under the pending
                // lock: take the tail, mark done so the flusher stops looping, then
                // notify it awake.
                let tail = {
                    let (lock, cv) = &*pending_e;
                    let mut g = lock.lock().unwrap_or_else(|e| e.into_inner());
                    let tail = std::mem::take(&mut *g);
                    done_e.store(true, Ordering::Release);
                    cv.notify_all();
                    tail
                };

                // Join the flusher so any in-flight `pty:data` emit completes
                // before we emit `pty:exit`. After this the flusher is gone and the
                // waiter is the sole emitter — no `pty:data` can follow `pty:exit`.
                let _ = flusher_handle.join();

                if !tail.is_empty() {
                    let _ = app_exit.emit(
                        "pty:data",
                        PtyData {
                            pty_id: id_exit.clone(),
                            data: tail,
                        },
                    );
                }

                let _ = app_exit.emit(
                    "pty:exit",
                    PtyExit {
                        pty_id: id_exit,
                        code,
                    },
                );
            });

        match waiter {
            Ok(_) => {
                // All three threads are live; the waiter owns teardown now.
                guard.disarm();
                Ok(id)
            }
            Err(e) => {
                // Waiter never started: pull the just-inserted session so its Drop
                // kills the child, and let `guard` fire to unwind reader/flusher.
                let _ = self
                    .sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                Err(e.to_string())
            }
        }
    }

    pub fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let sessions = self.sessions.lock().unwrap();
            sessions
                .get(pty_id)
                .ok_or_else(|| format!("PTY not found: {pty_id}"))?
                .writer
                .clone()
        };
        let mut w = writer.lock().map_err(|e| e.to_string())?;
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // Clone the master Arc inside the sessions critical section, then release
        // the sessions lock before the TIOCSWINSZ ioctl so a slow resize can't
        // block other PTY ops (write/kill/close_all). Mirrors write().
        let master = {
            let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            sessions
                .get(pty_id)
                .ok_or_else(|| format!("PTY not found: {pty_id}"))?
                .master
                .clone()
        };
        let result = master
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            });
        result.map_err(|e| e.to_string())
    }

    pub fn kill(&self, pty_id: &str) -> Result<(), String> {
        // Removing from the map drops the PtySession, whose Drop kills the child
        // and wakes the threads. Drop never joins, so this can't block the worker.
        let session = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(pty_id);
        drop(session);
        Ok(())
    }

    /// Kill every live PTY and clear the session map. Used on workspace/window
    /// teardown so no orphaned child outlives the app.
    pub fn close_all(&self) -> Result<(), String> {
        // Drain the map under the lock, then drop the sessions after releasing
        // it. Each Drop kills its child + wakes its threads without joining, so
        // even many sessions tear down without blocking the IPC worker.
        let drained: Vec<PtySession> = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            sessions.drain().map(|(_, s)| s).collect()
        };
        drop(drained);
        Ok(())
    }

    #[cfg(test)]
    fn session_count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{Child, CommandBuilder};
    use std::time::Instant;

    // Build a PtySession wired the same way `spawn` does, but driven directly so
    // tests don't need a Tauri AppHandle. Returns the session plus a handle to
    // the child so the test can observe the child's liveness.
    fn make_session(cmd_args: &[&str]) -> (PtySession, Box<dyn Child + Send + Sync>) {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new(cmd_args[0]);
        for a in &cmd_args[1..] {
            cmd.arg(a);
        }
        let child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));
        let pending: Pending = Arc::new((Mutex::new(String::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));

        let session = PtySession {
            writer,
            master: Arc::new(Mutex::new(pair.master)),
            killer,
            done,
            pending,
            reader_handle: None,
        };
        (session, child)
    }

    fn wait_until_exit(child: &mut Box<dyn Child + Send + Sync>, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn drop_kills_child() {
        let (session, mut child) = make_session(&["/bin/sh", "-c", "sleep 30"]);
        assert!(
            child.try_wait().unwrap().is_none(),
            "child must be alive before drop"
        );
        drop(session);
        assert!(
            wait_until_exit(&mut child, Duration::from_secs(2)),
            "child still running 2s after PtySession drop"
        );
    }

    #[test]
    fn drop_after_child_exited_does_not_panic() {
        let (session, mut child) = make_session(&["/bin/sh", "-c", "exit 0"]);
        let _ = child.wait();
        drop(session); // killing an already-dead child must be a no-op, not a panic.
    }

    #[test]
    fn drop_sets_done_and_wakes_threads() {
        let (session, _child) = make_session(&["/bin/sh", "-c", "sleep 30"]);
        let done = session.done.clone();
        let pending = session.pending.clone();
        // A stand-in flusher blocked on the condvar must wake on drop.
        let done_w = done.clone();
        let pending_w = pending.clone();
        let handle = std::thread::spawn(move || {
            let (lock, cv) = &*pending_w;
            let mut g = lock.lock().unwrap();
            while g.is_empty() {
                if done_w.load(Ordering::Acquire) {
                    return true;
                }
                let (next, _) = cv.wait_timeout(g, Duration::from_secs(5)).unwrap();
                g = next;
            }
            false
        });
        drop(session);
        assert!(done.load(Ordering::Acquire), "Drop must set done");
        assert!(handle.join().unwrap(), "blocked thread must wake via Drop");
    }

    #[test]
    fn spawn_guard_armed_drop_sets_done_and_notifies() {
        // The cleanup guard for partial spawn failure: dropping it while armed must
        // set done=true and wake a thread blocked on the condvar, so a running
        // reader/flusher unwinds instead of leaking.
        let pending: Pending = Arc::new((Mutex::new(String::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));

        let done_w = done.clone();
        let pending_w = pending.clone();
        let waiter = std::thread::spawn(move || {
            let (lock, cv) = &*pending_w;
            let mut g = lock.lock().unwrap();
            while g.is_empty() {
                if done_w.load(Ordering::Acquire) {
                    return true;
                }
                let (next, _) = cv.wait_timeout(g, Duration::from_secs(5)).unwrap();
                g = next;
            }
            false
        });

        let guard = SpawnGuard::new(done.clone(), pending.clone());
        drop(guard);

        assert!(done.load(Ordering::Acquire), "armed Drop must set done");
        assert!(waiter.join().unwrap(), "armed Drop must wake the condvar");
    }

    #[test]
    fn spawn_guard_disarmed_drop_is_inert() {
        // After disarm() the waiter owns teardown; dropping the guard must NOT set
        // done, otherwise it would prematurely shut the live threads down.
        let pending: Pending = Arc::new((Mutex::new(String::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let mut guard = SpawnGuard::new(done.clone(), pending);
        guard.disarm();
        drop(guard);
        assert!(
            !done.load(Ordering::Acquire),
            "disarmed Drop must leave done unset"
        );
    }

    #[test]
    fn kill_removes_session_and_close_all_clears_map() {
        let mgr = PtyManager::new();
        // Insert two sessions directly (no AppHandle needed for map mechanics).
        let (s1, mut c1) = make_session(&["/bin/sh", "-c", "sleep 30"]);
        let (s2, mut c2) = make_session(&["/bin/sh", "-c", "sleep 30"]);
        mgr.sessions.lock().unwrap().insert("a".into(), s1);
        mgr.sessions.lock().unwrap().insert("b".into(), s2);
        assert_eq!(mgr.session_count(), 2);

        mgr.kill("a").expect("kill a");
        assert_eq!(mgr.session_count(), 1);
        assert!(
            wait_until_exit(&mut c1, Duration::from_secs(2)),
            "kill must terminate the child"
        );

        mgr.close_all().expect("close_all");
        assert_eq!(mgr.session_count(), 0, "close_all must clear the map");
        assert!(
            wait_until_exit(&mut c2, Duration::from_secs(2)),
            "close_all must terminate remaining children"
        );
    }

    #[test]
    fn kill_unknown_pty_is_ok() {
        let mgr = PtyManager::new();
        assert!(mgr.kill("nope").is_ok());
    }

    #[test]
    fn close_all_on_empty_is_ok() {
        let mgr = PtyManager::new();
        assert!(mgr.close_all().is_ok());
        assert_eq!(mgr.session_count(), 0);
    }

    // Coalescing: feed many small writes into a pending buffer driven by the same
    // reader/flusher protocol used in `spawn`, and assert the flusher batches them
    // into far fewer emitted chunks than writes.
    #[test]
    fn flusher_coalesces_rapid_writes() {
        let pending: Pending = Arc::new((Mutex::new(String::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let emitted: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let pending_f = pending.clone();
        let done_f = done.clone();
        let emitted_f = emitted.clone();
        let flusher = std::thread::spawn(move || {
            let (lock, cv) = &*pending_f;
            loop {
                {
                    let mut g = lock.lock().unwrap();
                    while g.is_empty() {
                        if done_f.load(Ordering::Acquire) {
                            return;
                        }
                        let (next, _) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
                        g = next;
                    }
                }
                std::thread::sleep(FLUSH_COALESCE);
                let chunk = std::mem::take(&mut *lock.lock().unwrap());
                if !chunk.is_empty() {
                    emitted_f.lock().unwrap().push(chunk);
                }
            }
        });

        // 200 tiny writes with no delay: they should land inside one or a few
        // coalesce windows.
        let writes = 200;
        for i in 0..writes {
            let (lock, cv) = &*pending;
            lock.lock().unwrap().push_str(&format!("{i};"));
            cv.notify_one();
        }
        // Let the flusher drain.
        std::thread::sleep(Duration::from_millis(40));
        done.store(true, Ordering::Release);
        pending.1.notify_all();
        flusher.join().unwrap();

        let chunks = emitted.lock().unwrap();
        let total: String = chunks.concat();
        let expected: String = (0..writes).map(|i| format!("{i};")).collect();
        assert_eq!(total, expected, "no bytes lost during coalescing");
        assert!(
            chunks.len() < writes,
            "expected far fewer chunks ({}) than writes ({writes})",
            chunks.len()
        );
    }

    // Backpressure: overflowing the pending cap must drop the backlog and inject
    // the ESC c reset notice rather than growing unbounded.
    #[test]
    fn overflow_drops_backlog_and_injects_reset() {
        let mut g = String::new();
        // Simulate the reader's overflow branch.
        let big = "x".repeat(MAX_PENDING - 10);
        g.push_str(&big);
        let incoming = "y".repeat(100);
        if g.len() + incoming.len() > MAX_PENDING {
            g.clear();
            g.push_str(OVERFLOW_NOTICE);
        }
        g.push_str(&incoming);
        assert!(g.starts_with("\x1bc"), "overflow must inject ESC c reset");
        assert!(g.contains("backpressure"));
        assert!(g.ends_with(&incoming), "post-overflow data must be kept");
        assert!(g.len() < MAX_PENDING, "buffer must shrink after overflow");
    }
}
