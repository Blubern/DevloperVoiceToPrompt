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
