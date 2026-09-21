// Native Windows regression check. No server, database or collector is started.
// Run: cargo run --example fullscreen-check
use std::time::Duration;
#[path = "../src/window_controls.rs"]
mod window_controls;

#[cfg(windows)]
async fn drag_to(window: &tauri::WebviewWindow, destination: (i32, i32), cancel: bool, move_pointer: bool) -> Result<bool, String> {
    use windows_sys::Win32::UI::{WindowsAndMessaging::SetCursorPos,
        Input::KeyboardAndMouse::{mouse_event, keybd_event, GetAsyncKeyState, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, KEYEVENTF_KEYUP, VK_ESCAPE, VK_LBUTTON}};
    let (rect, _, _) = bounds(window)?;
    let start = (rect[0] + 120, rect[1] + 24);
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    unsafe { SetCursorPos(start.0, start.1); mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); }
    tokio::time::sleep(Duration::from_millis(70)).await;
    println!("Pointer test: start={start:?} destination={destination:?} cancel={cancel} move={move_pointer} held={}", unsafe { GetAsyncKeyState(VK_LBUTTON as i32) < 0 });
    let pointer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        if move_pointer {
            for step in 1..=12 {
                unsafe { SetCursorPos(start.0 + (destination.0 - start.0) * step / 12, start.1 + (destination.1 - start.1) * step / 12); }
                std::thread::sleep(Duration::from_millis(40));
            }
        }
        unsafe {
            if cancel {
                keybd_event(VK_ESCAPE as u8, 0, 0, 0);
                std::thread::sleep(Duration::from_millis(300));
                keybd_event(VK_ESCAPE as u8, 0, KEYEVENTF_KEYUP, 0);
            }
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        }
    });
    let result = window_controls::control_window(window.clone(), "drag".into(), 120.0 / scale, 24.0 / scale).await;
    pointer.join().map_err(|_| "Pointer test failed")?;
    tokio::time::sleep(Duration::from_millis(350)).await;
    result
}

#[cfg(windows)]
fn bounds(window: &tauri::WebviewWindow) -> Result<([i32; 4], [i32; 4], [i32; 4]), String> {
    use windows_sys::Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::WindowsAndMessaging::GetWindowRect,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetWindowRect(hwnd, &mut rect) == 0 || GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let coords = |r: RECT| [r.left, r.top, r.right, r.bottom];
        Ok((coords(rect), coords(info.rcMonitor), coords(info.rcWork)))
    }
}

#[cfg(windows)]
fn covers_taskbar_area(window: &tauri::WebviewWindow) -> Result<bool, String> {
    use windows_sys::Win32::{Foundation::{HWND, POINT}, UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT}};
    let (_, monitor, work) = bounds(window)?;
    let x = (monitor[0] + monitor[2]) / 2;
    let y = (monitor[1] + monitor[3]) / 2;
    let point = if work[3] < monitor[3] { Some(POINT { x, y: (work[3] + monitor[3]) / 2 }) }
        else if work[1] > monitor[1] { Some(POINT { x, y: (work[1] + monitor[1]) / 2 }) }
        else if work[0] > monitor[0] { Some(POINT { x: (work[0] + monitor[0]) / 2, y }) }
        else if work[2] < monitor[2] { Some(POINT { x: (work[2] + monitor[2]) / 2, y }) }
        else { None };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    Ok(point.map(|point| unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) == hwnd }).unwrap_or(true))
}

#[cfg(windows)]
async fn verify(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let normal = bounds(&window)?.0;
    for maximized in [false, true] {
        if maximized { window.maximize().map_err(|e| e.to_string())?; }
        tokio::time::sleep(Duration::from_millis(300)).await;
        let previous = bounds(&window)?.0;
        for cycle in 1..=2 {
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
            let mut covered = false;
            for _ in 0..40 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                let (actual, monitor, work) = bounds(&window)?;
                if actual == monitor && window.is_fullscreen().map_err(|e| e.to_string())? && covers_taskbar_area(&window)? {
                    println!("PASS fullscreen: maximized={maximized} cycle={cycle} window={actual:?} monitor={monitor:?} work={work:?}");
                    covered = true;
                    break;
                }
            }
            if !covered { return Err(format!("Fullscreen did not cover monitor: {:?}", bounds(&window)?)); }
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            if maximized {
                window.unmaximize().map_err(|e| e.to_string())?;
                window.maximize().map_err(|e| e.to_string())?;
            }
            let mut restored = false;
            for _ in 0..40 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                if bounds(&window)?.0 == previous && !window.is_fullscreen().map_err(|e| e.to_string())?
                    && window.is_maximized().map_err(|e| e.to_string())? == maximized {
                    restored = true;
                    break;
                }
            }
            if !restored { return Err(format!("Original window was not restored: expected={previous:?} actual={:?}", bounds(&window)?)); }
            println!("PASS restore: maximized={maximized} cycle={cycle}");
        }
    }
    window.unmaximize().map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    if bounds(&window)?.0 != normal { return Err("Normal window placement was lost after fullscreen".into()); }
    println!("PASS original normal placement after maximized fullscreen cycles");
    if drag_to(&window, (0, 0), false, false).await? || window.is_fullscreen().map_err(|e| e.to_string())? {
        return Err("A plain click entered fullscreen".into());
    }
    if drag_to(&window, (350, 180), true, true).await? || bounds(&window)?.0 != normal {
        return Err("Cancelled window drag changed placement".into());
    }
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    for monitor in &monitors {
        let position = monitor.position();
        let size = monitor.size();
        let destination = (position.x + size.width as i32 / 2, position.y + size.height as i32 / 2);
        if !drag_to(&window, destination, false, true).await? { return Err("Drag was not detected".into()); }
        let (actual, current, work) = bounds(&window)?;
        let expected = [position.x, position.y, position.x + size.width as i32, position.y + size.height as i32];
        if actual != expected || current != expected || !window.is_fullscreen().map_err(|e| e.to_string())? || !covers_taskbar_area(&window)? {
            return Err(format!("Drop did not cover its target monitor: actual={actual:?} expected={expected:?} work={work:?}"));
        }
        println!("PASS real pointer drop covers target monitor and taskbar: {expected:?}");
    }
    let before_cancel = bounds(&window)?.0;
    if drag_to(&window, (350, 180), true, true).await? || bounds(&window)?.0 != before_cancel || !window.is_fullscreen().map_err(|e| e.to_string())? {
        return Err("Cancelled fullscreen drag did not restore fullscreen".into());
    }
    if drag_to(&window, (0, 0), false, false).await? || !window.is_fullscreen().map_err(|e| e.to_string())? {
        return Err("Plain click exited fullscreen".into());
    }
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    if window.is_fullscreen().map_err(|e| e.to_string())? { return Err("Drop fullscreen cannot be exited".into()); }
    println!("PASS drag cancellation, plain clicks and fullscreen exit");
    Ok(())
}

fn main() {
    let mut context = tauri::generate_context!("examples/tauri.conf.json");
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("TMS 전체화면 검증")
                .inner_size(900.0, 600.0)
                .decorations(false)
                .visible(false)
                .build()?;
            let handle = app.handle().clone();
            #[cfg(windows)]
            tauri::async_runtime::spawn(async move {
                match verify(window).await {
                    Ok(()) => { println!("Native fullscreen and restore checks passed"); handle.exit(0); }
                    Err(error) => { eprintln!("{error}"); handle.exit(1); }
                }
            });
            Ok(())
        })
        .run(context)
        .expect("전체화면 검증 창 실행 실패");
}
