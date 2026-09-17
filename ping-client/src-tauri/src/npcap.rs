//! Npcap for the portable zip: the installer ships next to the exe and the client offers to
//! run it (elevated, Npcap's own wizard) when packet capture is not available. Ping, alarms,
//! auto-connect, file transfer and event sharing never depend on it.

use std::path::PathBuf;

const INSTALLER: &str = "npcap-installer.exe";

/// True when the Npcap runtime library is present in the Windows system directory.
pub fn installed() -> bool {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    PathBuf::from(root).join("System32").join("Npcap").join("wpcap.dll").is_file()
}

/// The bundled installer next to the executable, if the zip was extracted whole.
pub fn installer_path() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?.parent()?.join(INSTALLER);
    path.is_file().then_some(path)
}

/// Run the bundled installer with elevation and wait for it; returns whether Npcap is now installed.
pub fn install() -> Result<bool, String> {
    if installed() {
        return Ok(true);
    }
    let path = installer_path().ok_or_else(|| {
        "Npcap 설치 파일(npcap-installer.exe)이 실행 파일 옆에 없습니다. ZIP을 통째로 풀어 주세요".to_string()
    })?;
    log::info!("running Npcap installer {}", path.display());
    let code = crate::transfer::run_file(&path, true)?;
    log::info!("Npcap installer exited with {code}");
    Ok(installed())
}

/// First-start offer: ask once per launch when capture is unavailable and the installer is bundled.
pub fn offer_at_startup() {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONQUESTION, MB_YESNO};

    if installed() || installer_path().is_none() {
        return;
    }
    // SAFETY: plain modal message box with static wide strings.
    let answer = unsafe {
        MessageBoxW(
            None,
            w!("패킷·ASTERIX 감시에 필요한 Npcap이 설치되어 있지 않습니다.\n\n지금 함께 들어 있는 Npcap 설치 마법사를 열까요? 인터넷 연결은 필요 없으며 관리자 승인이 필요합니다.\n\n아니요를 누르면 ping 감시·경보·서버 자동 연결은 그대로 사용하고, 나중에 네트워크 메뉴에서 설치할 수 있습니다."),
            w!("네트워크 ping 감시"),
            MB_YESNO | MB_ICONQUESTION,
        )
    };
    if answer != IDYES {
        return;
    }
    match install() {
        Ok(true) => log::info!("Npcap installed"),
        Ok(false) => log::warn!("Npcap installer finished but wpcap.dll is still missing"),
        Err(e) => log::warn!("Npcap install failed: {e}"),
    }
}
