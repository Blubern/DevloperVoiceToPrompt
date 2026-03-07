use tauri::Manager;

#[tauri::command]
pub fn toggle_popup(app: tauri::AppHandle) {
    crate::create_or_toggle_popup(&app);
}

#[tauri::command]
pub fn hide_popup(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn show_settings(app: tauri::AppHandle) {
    crate::show_settings(&app);
}

/// Toggle Dock (macOS) or Taskbar (Windows) icon visibility at runtime.
/// On other platforms this is a no-op.
pub fn set_dock_visibility(app: &tauri::AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let ns_app = NSApplication::sharedApplication(mtm);
            let policy = if visible {
                NSApplicationActivationPolicy::Regular
            } else {
                NSApplicationActivationPolicy::Accessory
            };
            ns_app.setActivationPolicy(policy);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_skip_taskbar(!visible);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        let _ = visible;
    }
}
