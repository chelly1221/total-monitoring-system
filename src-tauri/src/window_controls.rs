use tauri::WebviewWindow;

// Run the native move loop on the window thread. startDragging's IPC response
// only acknowledges dispatch and cannot be used as a mouse-release notification.
#[tauri::command]
pub async fn control_window(
    window: WebviewWindow,
    action: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("창 위치가 올바르지 않습니다".into());
    }
    #[cfg(windows)]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(native::control(&target, &action, x, y));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (x, y);
        match action.as_str() {
            "drag" => window.start_dragging(),
            _ => window.toggle_maximize(),
        }
        .map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::{
            ClientToScreen, GetMonitorInfoW, MonitorFromPoint, MONITORINFO,
            MONITOR_DEFAULTTONEAREST,
        },
        UI::{
            Input::KeyboardAndMouse::{
                DragDetect, GetAsyncKeyState, ReleaseCapture, VK_ESCAPE, VK_LBUTTON,
            },
            WindowsAndMessaging::*,
        },
    };

    fn check(success: i32) -> Result<(), String> {
        if success == 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }

    unsafe fn maximize_at(hwnd: HWND, point: POINT) -> Result<(), String> {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        check(GetMonitorInfoW(monitor, &mut info))?;
        ShowWindow(hwnd, SW_RESTORE);
        let mut rect: RECT = std::mem::zeroed();
        check(GetWindowRect(hwnd, &mut rect))?;
        let work = info.rcWork;
        // Place the restored window wholly inside the selected monitor before
        // maximizing so Windows cannot select a monitor by the old window center.
        let width = (rect.right - rect.left).min(work.right - work.left);
        let height = (rect.bottom - rect.top).min(work.bottom - work.top);
        check(SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            work.left + (work.right - work.left - width) / 2,
            work.top + (work.bottom - work.top - height) / 2,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        ))?;
        ShowWindow(hwnd, SW_MAXIMIZE);
        Ok(())
    }

    pub fn control(window: &WebviewWindow, action: &str, x: f64, y: f64) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        unsafe {
            let mut point = POINT {
                x: (x * scale).round() as i32,
                y: (y * scale).round() as i32,
            };
            check(ClientToScreen(hwnd, &mut point))?;
            match action {
                "toggle" => {
                    if IsZoomed(hwnd) != 0 {
                        ShowWindow(hwnd, SW_RESTORE);
                        Ok(())
                    } else {
                        maximize_at(hwnd, point)
                    }
                }
                "drag" => {
                    // A click, double click or released button must never maximize.
                    if GetAsyncKeyState(VK_LBUTTON as i32) >= 0 || DragDetect(hwnd, point) == 0 {
                        return Ok(());
                    }
                    let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                    check(GetWindowPlacement(hwnd, &mut placement))?;
                    let mut rect: RECT = std::mem::zeroed();
                    check(GetWindowRect(hwnd, &mut rect))?;
                    let ratio =
                        (point.x - rect.left) as f64 / (rect.right - rect.left).max(1) as f64;
                    let offset_y = point.y - rect.top;
                    ShowWindow(hwnd, SW_RESTORE);
                    check(GetWindowRect(hwnd, &mut rect))?;
                    check(GetCursorPos(&mut point))?;
                    check(SetWindowPos(
                        hwnd,
                        std::ptr::null_mut(),
                        point.x - ((rect.right - rect.left) as f64 * ratio.clamp(0.0, 1.0)) as i32,
                        point.y - offset_y,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                    ))?;
                    ReleaseCapture();
                    // SendMessage returns only when the native move loop ends.
                    SendMessageW(hwnd, WM_SYSCOMMAND, (SC_MOVE | HTCAPTION) as usize, 0);
                    if GetAsyncKeyState(VK_ESCAPE as i32) < 0 {
                        check(SetWindowPlacement(hwnd, &placement))
                    } else {
                        check(GetCursorPos(&mut point))?;
                        maximize_at(hwnd, point)
                    }
                }
                _ => Err("지원하지 않는 창 동작입니다".into()),
            }
        }
    }
}
