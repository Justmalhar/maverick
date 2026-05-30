pub mod attachment;
pub mod automation;
pub mod bootstrap;
pub mod browser;
pub mod caffeinate;
pub mod config;
pub mod context;
pub mod diff;
pub mod file_tree;
pub mod git;
pub mod instructions;
pub mod kanban;
pub mod mcp;
pub mod messages;
pub mod notify;
pub mod pr;
pub mod preset;
pub mod project;
pub mod project_settings;
pub mod pty;
pub mod skills;
pub mod workspace;

pub use attachment::attachment_create;
pub use automation::automation_run;
pub use bootstrap::{
    bootstrap_complete, bootstrap_status, bootstrap_update_settings, detect_backends,
    read_maverick_md, request_notification_permission, reset_first_run, write_maverick_md,
};
pub use browser::{
    browser_close, browser_eval, browser_hide, browser_navigate, browser_open,
    browser_set_bounds, browser_show,
};
pub use caffeinate::{caffeinate_start, caffeinate_status, caffeinate_stop};
pub use config::config_load;
pub use context::{context_record, context_usage};
pub use diff::{diff_get, diff_stage_hunk, diff_unstage_hunk};
pub use file_tree::file_tree;
pub use git::{git_branches, git_commit, git_diff_stat, git_log, git_stash_list};
pub use instructions::instructions_resolve;
pub use kanban::{kanban_list, kanban_upsert};
pub use mcp::{mcp_list, mcp_start, mcp_stop};
pub use messages::{message_append, messages_list};
pub use notify::{
    notify_list, notify_mark_all_read, notify_mark_read, notify_send, notify_unread_count,
};
pub use pr::pr_create;
pub use preset::{preset_launch, preset_list, preset_save_current};
pub use project::{project_add, project_list};
pub use project_settings::{
    project_settings_get, project_settings_open_file, project_settings_update,
};
pub use pty::{pty_close_all, pty_kill, pty_resize, pty_spawn, pty_write};
pub use skills::{skills_list, skills_run};
pub use workspace::{workspace_create, workspace_destroy, workspace_list};
