#[tauri::command]
pub fn default_shell() -> String {
    resolve_shell(std::env::var("SHELL"))
}

fn resolve_shell(env_shell: Result<String, std::env::VarError>) -> String {
    env_shell.unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".into()
        } else {
            "/bin/bash".into()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_shell_env_when_set() {
        assert_eq!(resolve_shell(Ok("/usr/local/bin/fish".into())), "/usr/local/bin/fish");
    }

    #[test]
    fn falls_back_to_platform_default_when_unset() {
        let fallback = resolve_shell(Err(std::env::VarError::NotPresent));
        if cfg!(target_os = "macos") {
            assert_eq!(fallback, "/bin/zsh");
        } else {
            assert_eq!(fallback, "/bin/bash");
        }
    }

    #[test]
    fn falls_back_when_env_is_invalid_unicode() {
        let fallback = resolve_shell(Err(std::env::VarError::NotUnicode("\0".into())));
        if cfg!(target_os = "macos") {
            assert_eq!(fallback, "/bin/zsh");
        } else {
            assert_eq!(fallback, "/bin/bash");
        }
    }
}
