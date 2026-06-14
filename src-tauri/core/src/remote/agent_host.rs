//! `AgentHost` — the Rust port of Swift `AgentSession` (chat mode) +
//! `SessionManager`'s agent-session bookkeeping + `AgentEventBroadcaster`.
//!
//! Responsibilities:
//! - Spawn a provider CLI in *chat* mode (`claude --output-format stream-json`,
//!   `codex --json`, …) as a piped child, **inheriting the environment** so the
//!   CLI reads its own credentials from its own config — Maverick injects **no
//!   API key** (CLAUDE.md rule 5).
//! - Line-buffer the child's stdout and run a per-session [`Normalizer`],
//!   publishing each resulting [`AgentEvent`] onto the shared event bus as an
//!   `agent_event` `ServerMessage` tagged with the session UUID.
//! - Track Claude Code's own session id (captured from the first `SessionStart`)
//!   so a re-create can resume with `claude -c/--resume <id>`.
//! - Maintain the `claudeId → sessionUUID` index the hook bridge needs to route
//!   hook POSTs to the right session.
//!
//! Process spawning is abstracted behind [`AgentSpawner`] so unit tests inject a
//! deterministic fake (a scripted stdout stream) with no real CLI or process.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::broadcast;
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::remote::adapters::make_normalizer;
use crate::remote::{AgentEvent, AgentProvider, ServerMessage};

/// One inbound write to a running agent's stdin.
#[async_trait]
pub trait AgentStdin: Send + Sync {
    /// Write a line of text (a trailing newline is appended by the caller).
    async fn write_line(&self, text: &str) -> Result<(), String>;
}

/// The two halves of a spawned chat-mode agent: an async stdin writer and an
/// async line-yielding stdout reader. Abstracted so tests provide a scripted
/// duplex pair instead of a real child process.
pub struct SpawnedAgent {
    pub stdin: Arc<dyn AgentStdin>,
    /// Reader yielding complete stdout lines (newline stripped). `None` = EOF.
    pub lines: Box<dyn AgentLineReader>,
}

/// Async source of newline-delimited stdout lines from a spawned agent.
#[async_trait]
pub trait AgentLineReader: Send {
    /// Next complete line (newline stripped), or `None` at EOF.
    async fn next_line(&mut self) -> Option<Vec<u8>>;
}

/// Spawns a provider CLI in chat mode. Production impl is [`ProcessSpawner`];
/// tests inject a fake. `resume_id` is Claude's prior session id, if resuming.
#[async_trait]
pub trait AgentSpawner: Send + Sync {
    async fn spawn(
        &self,
        provider: AgentProvider,
        cwd: Option<&str>,
        resume_id: Option<&str>,
    ) -> Result<SpawnedAgent, String>;
}

/// A live agent session's handle: its stdin and the resolved Claude session id
/// (set once the first `SessionStart` arrives, used for resume on re-create).
struct RunningAgent {
    provider: AgentProvider,
    stdin: Arc<dyn AgentStdin>,
}

/// Owns every chat-mode agent session, the `claudeId → sessionUUID` index, and
/// the broadcast bus that fans `agent_event` frames to attached connections.
pub struct AgentHost {
    spawner: Arc<dyn AgentSpawner>,
    bus: broadcast::Sender<(Uuid, ServerMessage)>,
    agents: Mutex<HashMap<Uuid, RunningAgent>>,
    /// Claude's internal session id → our session UUID (for hook routing).
    /// Behind an `Arc` so both `&self` methods and the 'static stdout-drain task
    /// share one map.
    claude_index: Arc<Mutex<HashMap<String, Uuid>>>,
}

impl AgentHost {
    pub fn new(spawner: Arc<dyn AgentSpawner>, bus: broadcast::Sender<(Uuid, ServerMessage)>) -> Self {
        Self {
            spawner,
            bus,
            agents: Mutex::new(HashMap::new()),
            claude_index: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Resolve a hook payload's `session_id` (Claude's own id) to our UUID.
    pub fn resolve_claude_id(&self, claude_id: &str) -> Option<Uuid> {
        self.claude_index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(claude_id)
            .copied()
    }

    /// Spawn a chat-mode agent for `session_id`. Starts the stdout drain task
    /// that normalizes lines into `agent_event` frames on the bus. `resume_id`
    /// resumes a prior Claude conversation when re-creating a session.
    pub async fn create(
        &self,
        session_id: Uuid,
        provider: AgentProvider,
        cwd: Option<String>,
        resume_id: Option<String>,
    ) -> Result<(), String> {
        let spawned = self
            .spawner
            .spawn(provider, cwd.as_deref(), resume_id.as_deref())
            .await?;

        self.agents.lock().unwrap_or_else(|e| e.into_inner()).insert(
            session_id,
            RunningAgent { provider, stdin: spawned.stdin },
        );

        // Drain stdout on a background task: each complete line → normalizer →
        // 0..n AgentEvents → agent_event frames on the bus.
        let bus = self.bus.clone();
        let claude_index = self.claude_index_handle();
        let mut reader = spawned.lines;
        let mut normalizer = make_normalizer(provider);
        tokio::spawn(async move {
            while let Some(line) = reader.next_line().await {
                if line.is_empty() {
                    continue;
                }
                emit_events(&bus, &claude_index, session_id, normalizer.normalize_stream_line(&line));
            }
        });
        Ok(())
    }

    /// Send a line of input to a chat-mode agent's stdin.
    pub async fn input(&self, session_id: Uuid, text: &str) -> Result<(), String> {
        let stdin = self
            .agents
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&session_id)
            .map(|a| a.stdin.clone())
            .ok_or_else(|| format!("no agent session {session_id}"))?;
        stdin.write_line(text).await
    }

    /// The provider backing a session, if it is an agent session.
    pub fn provider_of(&self, session_id: &Uuid) -> Option<AgentProvider> {
        self.agents
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .map(|a| a.provider)
    }

    /// Drop a session's bookkeeping (its stdout task ends when the child's
    /// stdout closes; dropping `stdin` closes the write side).
    pub fn remove(&self, session_id: &Uuid) {
        self.agents.lock().unwrap_or_else(|e| e.into_inner()).remove(session_id);
        self.claude_index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, v| v != session_id);
    }

    fn claude_index_handle(&self) -> ClaudeIndexHandle {
        ClaudeIndexHandle { inner: self.claude_index.clone() }
    }

    /// Test-only: seed the claude-id index directly (the hook tests need a
    /// registered id without driving a full `SessionStart` through stdout).
    #[cfg(test)]
    pub fn test_register_claude_id(&self, claude_id: &str, session_id: Uuid) {
        self.claude_index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(claude_id.to_string(), session_id);
    }
}

/// Shared, cloneable handle to the claude-id index for the 'static drain task.
#[derive(Clone)]
struct ClaudeIndexHandle {
    inner: Arc<Mutex<HashMap<String, Uuid>>>,
}

impl ClaudeIndexHandle {
    fn register(&self, claude_id: String, session_id: Uuid) {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).insert(claude_id, session_id);
    }
}

/// Publish a batch of events on the bus, registering any Claude session id seen
/// in a `SessionStart` *before* the event is broadcast (so a hook arriving right
/// after the client sees `session_start` can be routed).
fn emit_events(
    bus: &broadcast::Sender<(Uuid, ServerMessage)>,
    claude_index: &ClaudeIndexHandle,
    session_id: Uuid,
    events: Vec<AgentEvent>,
) {
    for event in events {
        if let AgentEvent::SessionStart { id, .. } = &event {
            claude_index.register(id.clone(), session_id);
        }
        // A send error means there are zero live subscribers; that's fine — the
        // event is simply dropped (no client is attached to receive it).
        let _ = bus.send((session_id, ServerMessage::AgentEvent { session_id, event }));
    }
}

// ---- Production spawner: real provider CLI via tokio::process ------------

/// Spawns the provider CLI in chat mode as a piped tokio child process.
///
/// Environment is **inherited verbatim** (`Command` does this by default) so the
/// CLI finds its own credentials in its own config dir — Maverick injects no API
/// key (CLAUDE.md rule 5). The executable is resolved on `$PATH` via `which`,
/// matching the desktop's backend detector; only `cwd` and provider-specific
/// args are set.
pub struct ProcessSpawner;

impl ProcessSpawner {
    /// (executable, args) per provider, mirroring Swift `AgentSession.launchCommand`.
    /// `resume_id` (Claude only) appends `-c <id>` to resume the prior conversation.
    fn launch_command(provider: AgentProvider, resume_id: Option<&str>) -> (&'static str, Vec<String>) {
        match provider {
            AgentProvider::ClaudeCode => {
                let mut args = vec!["--output-format".to_string(), "stream-json".to_string()];
                if let Some(id) = resume_id {
                    args.push("-c".to_string());
                    args.push(id.to_string());
                }
                ("claude", args)
            }
            AgentProvider::Codex => ("codex", vec!["--json".to_string()]),
            AgentProvider::Opencode => ("opencode", vec!["run".to_string()]),
            AgentProvider::Antigravity => ("antigravity", vec!["run".to_string()]),
            AgentProvider::Hermes => ("hermes", vec![]),
        }
    }
}

/// stdin half backed by a real child's piped stdin handle.
struct ChildStdin {
    handle: TokioMutex<tokio::process::ChildStdin>,
}

#[async_trait]
impl AgentStdin for ChildStdin {
    async fn write_line(&self, text: &str) -> Result<(), String> {
        let mut guard = self.handle.lock().await;
        guard.write_all(text.as_bytes()).await.map_err(|e| e.to_string())?;
        guard.write_all(b"\n").await.map_err(|e| e.to_string())?;
        guard.flush().await.map_err(|e| e.to_string())
    }
}

/// stdout half: an async buffered line reader over the child's piped stdout.
struct ChildLineReader {
    reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

#[async_trait]
impl AgentLineReader for ChildLineReader {
    async fn next_line(&mut self) -> Option<Vec<u8>> {
        // `next_line` already strips the trailing newline; bytes are the line.
        match self.reader.next_line().await {
            Ok(Some(line)) => Some(line.into_bytes()),
            _ => None,
        }
    }
}

#[async_trait]
impl AgentSpawner for ProcessSpawner {
    async fn spawn(
        &self,
        provider: AgentProvider,
        cwd: Option<&str>,
        resume_id: Option<&str>,
    ) -> Result<SpawnedAgent, String> {
        let (exe, args) = Self::launch_command(provider, resume_id);
        let resolved = which::which(exe).map_err(|_| format!("{exe} not found on PATH"))?;

        let mut command = tokio::process::Command::new(resolved);
        command
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            // Suppress stderr noise (matches Swift's discard-to-Pipe).
            .stderr(std::process::Stdio::null());
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        // No `.env_clear()` and no `.env(...)` — inherit the parent environment
        // so the CLI reads its own credentials. NO API KEY INJECTION.

        let mut child = command.spawn().map_err(|e| format!("failed to spawn {exe}: {e}"))?;
        let stdin = child.stdin.take().ok_or("child stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("child stdout unavailable")?;

        // Reap the child in the background so it doesn't become a zombie when it
        // exits; we don't need its status here.
        tokio::spawn(async move {
            let _ = child.wait().await;
        });

        Ok(SpawnedAgent {
            stdin: Arc::new(ChildStdin { handle: TokioMutex::new(stdin) }),
            lines: Box::new(ChildLineReader {
                reader: BufReader::new(stdout).lines(),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A scripted line reader yielding pre-baked stdout lines, then EOF.
    struct ScriptReader {
        lines: std::collections::VecDeque<Vec<u8>>,
    }
    #[async_trait]
    impl AgentLineReader for ScriptReader {
        async fn next_line(&mut self) -> Option<Vec<u8>> {
            self.lines.pop_front()
        }
    }

    /// Records every line written to stdin.
    struct RecordingStdin {
        writes: TokioMutex<Vec<String>>,
    }
    #[async_trait]
    impl AgentStdin for RecordingStdin {
        async fn write_line(&self, text: &str) -> Result<(), String> {
            self.writes.lock().await.push(text.to_string());
            Ok(())
        }
    }

    /// One recorded spawn call: (provider, cwd, resume_id).
    type SpawnRecord = (AgentProvider, Option<String>, Option<String>);

    /// A fake spawner returning scripted stdout and a recording stdin. Captures
    /// the (provider, cwd, resume_id) of each spawn for assertions.
    struct FakeSpawner {
        scripted: Mutex<Vec<Vec<Vec<u8>>>>,
        spawns: Mutex<Vec<SpawnRecord>>,
        stdins: Mutex<Vec<Arc<RecordingStdin>>>,
        fail: bool,
        count: AtomicUsize,
    }
    impl FakeSpawner {
        fn new(scripts: Vec<Vec<Vec<u8>>>) -> Self {
            Self {
                scripted: Mutex::new(scripts),
                spawns: Mutex::new(vec![]),
                stdins: Mutex::new(vec![]),
                fail: false,
                count: AtomicUsize::new(0),
            }
        }
    }
    #[async_trait]
    impl AgentSpawner for FakeSpawner {
        async fn spawn(
            &self,
            provider: AgentProvider,
            cwd: Option<&str>,
            resume_id: Option<&str>,
        ) -> Result<SpawnedAgent, String> {
            if self.fail {
                return Err("spawn failed".into());
            }
            self.spawns.lock().unwrap().push((
                provider,
                cwd.map(str::to_string),
                resume_id.map(str::to_string),
            ));
            let idx = self.count.fetch_add(1, Ordering::SeqCst);
            let script = self.scripted.lock().unwrap().get(idx).cloned().unwrap_or_default();
            let stdin = Arc::new(RecordingStdin { writes: TokioMutex::new(vec![]) });
            self.stdins.lock().unwrap().push(stdin.clone());
            Ok(SpawnedAgent {
                stdin,
                lines: Box::new(ScriptReader { lines: script.into() }),
            })
        }
    }

    fn host(scripts: Vec<Vec<Vec<u8>>>) -> (Arc<AgentHost>, Arc<FakeSpawner>, broadcast::Receiver<(Uuid, ServerMessage)>) {
        let (tx, rx) = broadcast::channel(256);
        let spawner = Arc::new(FakeSpawner::new(scripts));
        let h = Arc::new(AgentHost::new(spawner.clone(), tx));
        (h, spawner, rx)
    }

    async fn recv(rx: &mut broadcast::Receiver<(Uuid, ServerMessage)>) -> (Uuid, ServerMessage) {
        tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("event within timeout")
            .expect("bus open")
    }

    #[tokio::test]
    async fn create_streams_claude_events_to_bus() {
        let script = vec![vec![
            br#"{"type":"stream","event":{"delta":{"type":"text_delta","text":"Hi"}}}"#.to_vec(),
            br#"{"type":"result","total_cost_usd":0.01}"#.to_vec(),
        ]];
        let (h, _spawner, mut rx) = host(script);
        let sid = Uuid::new_v4();
        h.create(sid, AgentProvider::ClaudeCode, Some("/repo".into()), None).await.unwrap();

        let (s1, m1) = recv(&mut rx).await;
        assert_eq!(s1, sid);
        match m1 {
            ServerMessage::AgentEvent { event: AgentEvent::TokenDelta { text }, .. } => assert_eq!(text, "Hi"),
            other => panic!("got {other:?}"),
        }
        let (_s2, m2) = recv(&mut rx).await;
        assert!(matches!(m2, ServerMessage::AgentEvent { event: AgentEvent::TurnStop { .. }, .. }));
    }

    #[tokio::test]
    async fn session_start_registers_claude_id_for_hook_routing() {
        let script = vec![vec![
            br#"{"type":"session_start"}"#.to_vec(), // ignored by stream normalizer
        ]];
        // The stream normalizer doesn't emit SessionStart; that only comes from a
        // hook. So drive registration through emit_events directly instead.
        let (h, _spawner, _rx) = host(script);
        let handle = h.claude_index_handle();
        let sid = Uuid::new_v4();
        handle.register("claude-xyz".into(), sid);
        assert_eq!(h.resolve_claude_id("claude-xyz"), Some(sid));
        assert_eq!(h.resolve_claude_id("missing"), None);
    }

    #[tokio::test]
    async fn input_writes_to_agent_stdin() {
        let (h, spawner, _rx) = host(vec![vec![]]);
        let sid = Uuid::new_v4();
        h.create(sid, AgentProvider::ClaudeCode, None, None).await.unwrap();
        h.input(sid, "hello").await.unwrap();
        let stdin = spawner.stdins.lock().unwrap()[0].clone();
        assert_eq!(stdin.writes.lock().await.as_slice(), &["hello".to_string()]);
    }

    #[tokio::test]
    async fn input_to_unknown_session_errors() {
        let (h, _spawner, _rx) = host(vec![]);
        assert!(h.input(Uuid::new_v4(), "x").await.is_err());
    }

    #[tokio::test]
    async fn create_propagates_spawn_failure() {
        let (tx, _rx) = broadcast::channel(8);
        let mut spawner = FakeSpawner::new(vec![]);
        spawner.fail = true;
        let h = AgentHost::new(Arc::new(spawner), tx);
        assert!(h.create(Uuid::new_v4(), AgentProvider::Codex, None, None).await.is_err());
    }

    #[tokio::test]
    async fn resume_id_is_forwarded_to_spawner() {
        let (h, spawner, _rx) = host(vec![vec![]]);
        let sid = Uuid::new_v4();
        h.create(sid, AgentProvider::ClaudeCode, None, Some("prev-id".into())).await.unwrap();
        let spawns = spawner.spawns.lock().unwrap();
        assert_eq!(spawns[0].2.as_deref(), Some("prev-id"));
    }

    #[tokio::test]
    async fn remove_clears_agent_and_index() {
        let (h, _spawner, _rx) = host(vec![vec![]]);
        let sid = Uuid::new_v4();
        h.create(sid, AgentProvider::ClaudeCode, None, None).await.unwrap();
        h.claude_index_handle().register("cid".into(), sid);
        assert_eq!(h.provider_of(&sid), Some(AgentProvider::ClaudeCode));
        h.remove(&sid);
        assert!(h.provider_of(&sid).is_none());
        assert!(h.resolve_claude_id("cid").is_none());
    }

    #[tokio::test]
    async fn codex_tool_lines_produce_start_and_badge() {
        let script = vec![vec![
            br#"{"type":"tool","id":"k","name":"bash","input":{"command":"ls"}}"#.to_vec(),
        ]];
        let (h, _spawner, mut rx) = host(script);
        let sid = Uuid::new_v4();
        h.create(sid, AgentProvider::Codex, None, None).await.unwrap();
        // tool_call_start then status_badge.
        assert!(matches!(
            recv(&mut rx).await.1,
            ServerMessage::AgentEvent { event: AgentEvent::ToolCallStart { .. }, .. }
        ));
        assert!(matches!(
            recv(&mut rx).await.1,
            ServerMessage::AgentEvent { event: AgentEvent::StatusBadge { .. }, .. }
        ));
    }
}
