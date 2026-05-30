use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

static COUNTER: AtomicU64 = AtomicU64::new(0);

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

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct SpawnParams {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub cols: u16,
    pub rows: u16,
}

/// Owns real OS pseudo-terminals. A reader thread per PTY streams bytes to the
/// webview as `pty:data`; a waiter thread emits `pty:exit` and reaps the session.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn<R: Runtime>(&self, app: &AppHandle<R>, params: SpawnParams) -> Result<String, String> {
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
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let id = format!("pty_{}", COUNTER.fetch_add(1, Ordering::SeqCst));

        self.sessions.lock().unwrap().insert(
            id.clone(),
            PtySession {
                writer,
                master: pair.master,
                killer,
            },
        );

        // Reader: stream PTY output to the webview until EOF.
        let app_reader = app.clone();
        let id_reader = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_reader.emit(
                            "pty:data",
                            PtyData {
                                pty_id: id_reader.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });

        // Waiter: reap the child, emit exit, and drop the session.
        let app_exit = app.clone();
        let id_exit = id.clone();
        std::thread::spawn(move || {
            let code = child
                .wait()
                .map(|status| status.exit_code() as i32)
                .unwrap_or(-1);
            if let Some(manager) = app_exit.try_state::<PtyManager>() {
                manager.sessions.lock().unwrap().remove(&id_exit);
            }
            let _ = app_exit.emit(
                "pty:exit",
                PtyExit {
                    pty_id: id_exit,
                    code,
                },
            );
        });

        Ok(id)
    }

    pub fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(pty_id)
            .ok_or_else(|| format!("PTY not found: {pty_id}"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(pty_id)
            .ok_or_else(|| format!("PTY not found: {pty_id}"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, pty_id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(pty_id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }
}
