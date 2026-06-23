/// Reports whether a usable WSL installation is present. The frontend uses this
/// to decide whether to offer a "WSL" entry in the new-terminal menu — `wsl.exe`
/// ships with Windows even when no distro is installed, so mere presence of the
/// binary is not enough; we check that `wsl -l -q` lists at least one distro.
#[tauri::command]
pub fn wsl_available() -> bool {
    #[cfg(windows)]
    {
        detect_wsl()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn detect_wsl() -> bool {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW — don't flash a console window when probing.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match std::process::Command::new("wsl.exe")
        .args(["-l", "-q"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) => wsl_output_has_distro(out.status.success(), &out.stdout),
        Err(_) => false,
    }
}

/// `wsl -l -q` emits one distro name per line as UTF-16LE. WSL is usable when the
/// command succeeded and named at least one non-empty distro.
#[cfg_attr(not(windows), allow(dead_code))]
fn wsl_output_has_distro(success: bool, stdout: &[u8]) -> bool {
    success
        && decode_utf16le_lossy(stdout)
            .lines()
            .any(|line| !line.trim().is_empty())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn decode_utf16le_lossy(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn decode_round_trips_utf16le() {
        assert_eq!(decode_utf16le_lossy(&utf16le("Ubuntu")), "Ubuntu");
    }

    #[test]
    fn decode_drops_trailing_odd_byte() {
        let mut bytes = utf16le("ok");
        bytes.push(0x00); // dangling half code unit
        assert_eq!(decode_utf16le_lossy(&bytes), "ok");
    }

    #[test]
    fn distro_present_when_success_and_named() {
        assert!(wsl_output_has_distro(true, &utf16le("Ubuntu\r\nDebian\r\n")));
    }

    #[test]
    fn no_distro_when_output_blank() {
        assert!(!wsl_output_has_distro(true, &utf16le("\r\n   \r\n")));
        assert!(!wsl_output_has_distro(true, &[]));
    }

    #[test]
    fn no_distro_when_command_failed() {
        assert!(!wsl_output_has_distro(false, &utf16le("Ubuntu")));
    }

    #[cfg(not(windows))]
    #[test]
    fn unavailable_off_windows() {
        assert!(!wsl_available());
    }
}
