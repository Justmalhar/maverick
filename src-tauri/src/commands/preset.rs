use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn preset_list(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request("preset.list", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preset_launch(
    state: State<'_, AppState>,
    preset: Value,
    project_path: String,
    branch: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "preset.launch",
            json!({
                "preset": preset,
                "projectPath": project_path,
                "branch": branch,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

// Build the `preset.save_current` JSON-RPC params. Extracted from the command
// so the field forwarding (notably layout/description/baseBranch, which the
// frontend sends and the sidecar Zod schema requires) is unit-testable without
// a live sidecar transport.
fn save_current_params(
    workspace_id: String,
    name: String,
    layout: Value,
    description: Option<String>,
    base_branch: Option<String>,
) -> Value {
    json!({
        "workspaceId": workspace_id,
        "name": name,
        "layout": layout,
        "description": description,
        "baseBranch": base_branch,
    })
}

#[tauri::command]
pub async fn preset_save_current(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    layout: Value,
    description: Option<String>,
    base_branch: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "preset.save_current",
            save_current_params(workspace_id, name, layout, description, base_branch),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_current_params_forwards_all_fields() {
        let layout = json!({ "type": "terminal", "agent": "claude", "cwd": "/", "mode": "agent" });
        let params = save_current_params(
            "ws-1".into(),
            "My Preset".into(),
            layout.clone(),
            Some("desc".into()),
            Some("main".into()),
        );
        assert_eq!(params["workspaceId"], "ws-1");
        assert_eq!(params["name"], "My Preset");
        assert_eq!(params["layout"], layout);
        assert_eq!(params["description"], "desc");
        assert_eq!(params["baseBranch"], "main");
    }

    #[test]
    fn save_current_params_emits_null_for_absent_optionals() {
        let layout = json!({ "type": "terminal", "agent": "shell", "cwd": "/", "mode": "terminal" });
        let params = save_current_params("ws-2".into(), "n".into(), layout, None, None);
        assert_eq!(params["description"], Value::Null);
        assert_eq!(params["baseBranch"], Value::Null);
    }
}
