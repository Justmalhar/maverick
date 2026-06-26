use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::State;

use crate::state::AppState;

/// Start a headless agent run. Returns `{ agentId }` immediately; the long-running
/// process streams `agent.data`/`agent.exit`/`agent.error` notifications which the
/// generic sidecar event sink forwards to the webview as `agent:*` events — so
/// this command must NOT wait on completion (it would otherwise hit the request
/// timeout). Pure passthrough per the layer rules.
#[tauri::command]
pub async fn agent_run(
    state: State<'_, AppState>,
    workspace_id: String,
    backend: String,
    prompt: String,
    cwd: Option<String>,
    resume_session_id: Option<String>,
    permission_mode: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "agent.run",
            json!({
                "workspaceId": workspace_id,
                "backend": backend,
                "prompt": prompt,
                "cwd": cwd,
                "resumeSessionId": resume_session_id,
                "permissionMode": permission_mode,
                "env": env,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_kill(state: State<'_, AppState>, agent_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.kill", json!({ "agentId": agent_id }))
        .await
        .map_err(|e| e.to_string())
}
