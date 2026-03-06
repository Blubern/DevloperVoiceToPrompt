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

/// Toggle macOS Dock icon visibility at runtime.
/// On non-macOS platforms this is a no-op.
pub fn set_dock_visibility(visible: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
        unsafe {
            let app = NSApplication::sharedApplication();
            let policy = if visible {
                NSApplicationActivationPolicy::Regular
            } else {
                NSApplicationActivationPolicy::Accessory
            };
            app.setActivationPolicy(policy);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = visible;
    }
}
