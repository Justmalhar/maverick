//! The single Tauri-aware PTY piece: forwards PtyManager output to the webview's
//! `pty:data`/`pty:exit` listeners. Lives in the desktop crate; the headless
//! daemon never references it.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::pty::PtyEventSink;

#[derive(Clone, Serialize)]
struct PtyData<'a> {
    #[serde(rename = "ptyId")]
    pty_id: &'a str,
    data: &'a str,
}

#[derive(Clone, Serialize)]
struct PtyExit<'a> {
    #[serde(rename = "ptyId")]
    pty_id: &'a str,
    code: i32,
}

pub struct TauriPtySink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriPtySink<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> PtyEventSink for TauriPtySink<R> {
    fn data(&self, pty_id: &str, chunk: &str) {
        let _ = self.app.emit("pty:data", PtyData { pty_id, data: chunk });
    }
    fn exit(&self, pty_id: &str, code: i32) {
        let _ = self.app.emit("pty:exit", PtyExit { pty_id, code });
    }
}
