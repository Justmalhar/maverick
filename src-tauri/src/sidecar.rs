use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("sidecar transport closed")]
    TransportClosed,
    #[error("sidecar rpc error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("sidecar request timed out")]
    Timeout,
    #[error("sidecar io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("sidecar serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("sidecar internal: {0}")]
    Other(String),
}

impl From<anyhow::Error> for SidecarError {
    fn from(e: anyhow::Error) -> Self {
        SidecarError::Other(e.to_string())
    }
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: Value,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Clone, Debug)]
pub enum SidecarMessage {
    Response {
        id: u64,
        result: Option<Value>,
        error: Option<(i64, String)>,
    },
    Notification {
        method: String,
        params: Value,
    },
}

pub trait NotificationSink: Send + Sync + 'static {
    fn forward(&self, method: &str, params: Value);
}

pub struct NoopSink;

impl NotificationSink for NoopSink {
    fn forward(&self, _method: &str, _params: Value) {}
}

pub struct Sidecar {
    next_id: AtomicU64,
    pending: Arc<DashMap<u64, oneshot::Sender<Result<Value, SidecarError>>>>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    request_timeout: Duration,
}

impl Sidecar {
    pub async fn spawn<S: NotificationSink>(
        cmd: &str,
        args: &[&str],
        cwd: Option<PathBuf>,
        sink: Arc<S>,
    ) -> Result<Arc<Self>> {
        let mut command = Command::new(cmd);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("failed to spawn sidecar '{cmd}'"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("sidecar stdin missing"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("sidecar stdout missing"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("sidecar stderr missing"))?;

        let sidecar = Arc::new(Self {
            next_id: AtomicU64::new(1),
            pending: Arc::new(DashMap::new()),
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(Some(child)),
            request_timeout: Duration::from_secs(60),
        });

        let pending = sidecar.pending.clone();
        let sink_for_stdout = sink.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match parse_message(&line) {
                            Ok(SidecarMessage::Response { id, result, error }) => {
                                if let Some((_, tx)) = pending.remove(&id) {
                                    let payload = match (result, error) {
                                        (Some(v), _) => Ok(v),
                                        (None, Some((code, message))) => {
                                            Err(SidecarError::Rpc { code, message })
                                        }
                                        (None, None) => Ok(Value::Null),
                                    };
                                    let _ = tx.send(payload);
                                }
                            }
                            Ok(SidecarMessage::Notification { method, params }) => {
                                sink_for_stdout.forward(&method, params);
                            }
                            Err(e) => log::warn!("sidecar parse error: {e}: line={line}"),
                        }
                    }
                    Ok(None) => {
                        log::warn!("sidecar stdout EOF");
                        break;
                    }
                    Err(e) => {
                        log::warn!("sidecar stdout read error: {e}");
                        break;
                    }
                }
            }
            for entry in pending.iter() {
                log::warn!("dropping pending id {} due to sidecar EOF", entry.key());
            }
            pending.clear();
        });

        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log::warn!("[sidecar:stderr] {line}");
            }
        });

        Ok(sidecar)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, SidecarError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);

        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let mut buf = serde_json::to_vec(&req)?;
        buf.push(b'\n');

        {
            let mut guard = self.stdin.lock().await;
            let stdin = guard
                .as_mut()
                .ok_or(SidecarError::TransportClosed)?;
            stdin.write_all(&buf).await?;
            stdin.flush().await?;
        }

        match timeout(self.request_timeout, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => {
                self.pending.remove(&id);
                Err(SidecarError::TransportClosed)
            }
            Err(_) => {
                self.pending.remove(&id);
                Err(SidecarError::Timeout)
            }
        }
    }

    /// Build a non-functional placeholder used when the real sidecar process
    /// can't be spawned. All `request()` calls return `TransportClosed`, the
    /// UI shell still renders, and the user sees a clear error in StatusBar.
    pub fn placeholder() -> Arc<Self> {
        Arc::new(Self {
            next_id: AtomicU64::new(1),
            pending: Arc::new(DashMap::new()),
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            request_timeout: Duration::from_secs(1),
        })
    }

    pub async fn shutdown(&self) {
        {
            let mut guard = self.stdin.lock().await;
            *guard = None;
        }
        let mut guard = self.child.lock().await;
        if let Some(child) = guard.as_mut() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        *guard = None;
    }
}

pub fn parse_message(line: &str) -> Result<SidecarMessage, SidecarError> {
    let resp: JsonRpcResponse = serde_json::from_str(line)?;
    if let Some(method) = resp.method {
        let params = resp.params.unwrap_or(Value::Null);
        return Ok(SidecarMessage::Notification { method, params });
    }
    let id = match resp.id {
        Some(Value::Number(n)) => n
            .as_u64()
            .ok_or_else(|| SidecarError::Other("rpc id not u64".into()))?,
        Some(Value::String(s)) => s
            .parse::<u64>()
            .map_err(|_| SidecarError::Other(format!("rpc id not parseable: {s}")))?,
        _ => return Err(SidecarError::Other("rpc message missing id".into())),
    };
    Ok(SidecarMessage::Response {
        id,
        result: resp.result,
        error: resp.error.map(|e| (e.code, e.message)),
    })
}

pub fn jsonrpc_event_name(method: &str) -> String {
    method.replace('.', ":")
}

pub fn forward_request_payload(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}
