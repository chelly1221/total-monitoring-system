// Isolated manual window regression test. No database, server or collector starts.
// Run: cargo run --example window-controls-check
#[path = "../src/window_controls.rs"]
mod window_controls;

fn main() {
    let mut context = tauri::generate_context!("examples/tauri.conf.json");
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![window_controls::control_window])
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("window-controls-check.html".into()))
                .title("TMS 창 동작 검증")
                .inner_size(900.0, 600.0)
                .decorations(false)
                .initialization_script(r#"
                  document.addEventListener('DOMContentLoaded', () => {
                    document.body.style.cssText='margin:0;background:#18181b;color:white;font:18px sans-serif';
                    document.body.innerHTML='<header style="height:56px;background:#303038;display:flex;align-items:center;justify-content:space-between;padding:0 20px;user-select:none"><span>TMS 창 동작 검증 · 여기를 드래그</span><button style="padding:10px">최대화 / 복원</button></header><p style="padding:20px">운영 DB와 연결하지 않는 테스트 창입니다.</p><pre style="padding:20px"></pre>';
                    const header=document.querySelector('header'), button=document.querySelector('button'), output=document.querySelector('pre');
                    let busy=false;
                    async function control(action,x,y) {
                      if(busy) return;
                      busy=true;
                      try {
                        await window.__TAURI__.core.invoke('control_window',{action,x,y});
                        const win=window.__TAURI__.window.getCurrentWindow();
                        const pos=await win.outerPosition(), size=await win.outerSize();
                        output.textContent=JSON.stringify({action,maximized:await win.isMaximized(),pos,size},null,2);
                      } catch(e) {output.textContent=String(e)} finally {busy=false}
                    }
                    header.onmousedown=e=>{if(e.button===0&&!e.target.closest('button')){e.preventDefault();control(e.detail===2?'toggle':'drag',e.clientX,e.clientY)}};
                    button.onclick=()=>{const r=button.getBoundingClientRect();control('toggle',r.left+r.width/2,r.top+r.height/2)};
                  });
                "#)
                .build()?;
            let monitors = window.available_monitors()?;
            for monitor in &monitors {
                eprintln!("Monitor: {:?} {:?}", monitor.position(), monitor.size());
            }
            // Start across a horizontal boundary: the center stays on the left
            // monitor while the maximize button is on the right monitor.
            'placement: for left in &monitors {
                for right in &monitors {
                    let boundary = left.position().x + left.size().width as i32;
                    let top = left.position().y.max(right.position().y);
                    let bottom = (left.position().y + left.size().height as i32)
                        .min(right.position().y + right.size().height as i32);
                    let gap = right.position().x - boundary;
                    if (0..=64).contains(&gap) && bottom - top > 600 {
                        window.set_size(tauri::PhysicalSize::new(1100 + gap as u32, 600))?;
                        window.set_position(tauri::PhysicalPosition::new(boundary - 1000, top + 100))?;
                        eprintln!("Button target: {:?}; window center remains left of {}", right.position(), boundary);
                        break 'placement;
                    }
                }
            }
            Ok(())
        })
        .run(context)
        .expect("창 동작 검증 실행 실패");
}
