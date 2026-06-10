use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn skills_list(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("skills.list", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skills_run(
    state: State<'_, AppState>,
    workspace_id: String,
    skill_name: String,
    vars: HashMap<String, String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "skills.run",
            json!({
                "workspaceId": workspace_id,
                "skillName": skill_name,
                "vars": vars,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skills_list_global(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("skills.listGlobal", json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skills_create_global(
    state: State<'_, AppState>,
    name: String,
    description: String,
    prompt: Option<String>,
    backend: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "skills.createGlobal",
            json!({
                "name": name,
                "description": description,
                "prompt": prompt,
                "backend": backend,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
