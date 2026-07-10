pub mod agent;
pub mod attachment;
pub mod bootstrap;
pub mod browser;
pub mod caffeinate;
pub mod checks;
pub mod config;
pub mod context;
pub mod diff;
pub mod file_tree;
pub mod git;
pub mod hooks;
pub mod instructions;
pub mod kanban;
pub mod mcp;
pub mod messages;
pub mod notify;
pub mod pr;
pub mod preset;
pub mod project;
pub mod remote;
pub mod project_settings;
pub mod providers;
pub mod pty;
pub mod shell;
pub mod skills;
pub mod usage;
pub mod workspace;

pub use agent::{
    agent_attachment_save, agent_capabilities, agent_interrupt, agent_queue_remove, agent_rewind,
    agent_send, agent_set_options, agent_state,
};
pub use attachment::attachment_create;
pub use bootstrap::{
    bootstrap_complete, bootstrap_status, bootstrap_update_settings, detect_backends,
    read_maverick_md, request_notification_permission, reset_first_run, write_maverick_md,
};
pub use browser::{
    browser_capture, browser_close, browser_eval, browser_hide, browser_navigate, browser_open,
    browser_set_bounds, browser_show,
};
pub use caffeinate::{caffeinate_start, caffeinate_status, caffeinate_stop};
pub use checks::checks_get;
pub use config::{config_load, config_save};
pub use context::{context_record, context_usage};
pub use diff::{diff_get, diff_stage_hunk, diff_unstage_hunk};
pub use file_tree::{
    file_read, file_search, file_tree, file_write, fs_watch_add, fs_watch_remove, fs_watch_start,
    fs_watch_stop,
};
pub use git::{
    ai_branch_name, ai_branch_name_from_diff, ai_commit_message, file_read_at_ref, git_blame, git_branch_create, git_branch_list, git_branches, git_checkout,
    git_rename_branch,
    git_cherry_pick, git_commit, git_conflicts, git_credential_connect, git_credential_disconnect,
    git_credential_status, git_diff_stat, git_discard_file, git_fetch,
    git_log, git_pull, git_push, git_remote_info, git_resolve_conflict, git_stash_apply,
    git_stash_drop, git_stash_list, git_stash_pop,
};
pub use hooks::hooks_claude_settings_path;
pub use instructions::instructions_resolve;
pub use kanban::{kanban_delete, kanban_list, kanban_upsert};
pub use mcp::{mcp_add, mcp_list, mcp_logs, mcp_start, mcp_stop};
pub use messages::{message_append, messages_list};
pub use notify::{
    notify_clear, notify_delete, notify_list, notify_mark_all_read, notify_mark_read, notify_send,
    notify_unread_count,
};
pub use pr::pr_create;
pub use preset::{preset_launch, preset_list, preset_save_current};
pub use project::{project_add, project_destroy, project_list};
pub use remote::{
    remote_devices, remote_pair, remote_revoke, remote_start, remote_status, remote_stop,
};
pub use project_settings::{
    project_settings_get, project_settings_open_file, project_settings_update,
};
pub use providers::list_ollama_models;
pub use pty::{pty_close_all, pty_kill, pty_resize, pty_spawn, pty_write};
pub use shell::wsl_available;
pub use skills::{skills_create_global, skills_list, skills_list_global, skills_run};
pub use usage::usage_summary;
pub use workspace::{workspace_create, workspace_destroy, workspace_list};
