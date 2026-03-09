use tauri::{
    webview::WebviewWindowBuilder,
    Manager, WebviewUrl,
};
use tauri_plugin_store::StoreExt;

// Store keys used to persist the popup window geometry between sessions.
// Must match the keys written by the frontend in Popup.svelte.
const STORE_KEY_POPUP_WIDTH:  &str = "popup_width";
const STORE_KEY_POPUP_HEIGHT: &str = "popup_height";
const STORE_KEY_POPUP_X:      &str = "popup_x";
const STORE_KEY_POPUP_Y:      &str = "popup_y";

/// Show the popup without toggling — always makes it visible and focused.
/// Used by the MCP server to open the popup when a tool call arrives.
pub fn create_or_show_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if let Err(e) = win.show() {
            tracing::error!("Failed to show popup: {e}");
        }
        if let Err(e) = win.set_focus() {
            tracing::warn!("Failed to set popup focus: {e}");
        }
    } else {
        create_or_toggle_popup(app);
    }
}

pub fn create_or_toggle_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            if let Err(e) = win.set_focus() {
                tracing::warn!("Failed to set popup focus: {e}");
            }
        } else {
            if let Err(e) = win.show() {
                tracing::warn!("Failed to show popup: {e}");
            }
            if let Err(e) = win.set_focus() {
                tracing::warn!("Failed to set popup focus: {e}");
            }
        }
    } else {
        let user_settings = crate::settings::load_settings(app);
        let on_top = user_settings.always_on_top;
        let show_in_dock = user_settings.show_in_dock;

        // Read saved popup geometry from store
        let store = match app.store("settings.json") {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("Failed to open settings store for popup geometry: {e}");
                None
            }
        };
        let popup_w = store.as_ref().and_then(|s| s.get(STORE_KEY_POPUP_WIDTH).and_then(|v| v.as_f64())).unwrap_or(926.0);
        let popup_h = store.as_ref().and_then(|s| s.get(STORE_KEY_POPUP_HEIGHT).and_then(|v| v.as_f64())).unwrap_or(582.0);
        let popup_x = store.as_ref().and_then(|s| s.get(STORE_KEY_POPUP_X).and_then(|v| v.as_f64()));
        let popup_y = store.as_ref().and_then(|s| s.get(STORE_KEY_POPUP_Y).and_then(|v| v.as_f64()));

        let mut builder = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("/".into()))
            .title("Voice to Prompt")
            .inner_size(popup_w, popup_h)
            .min_inner_size(350.0, 280.0)
            .decorations(false)
            .resizable(true)
            .skip_taskbar(!show_in_dock)
            .always_on_top(on_top)
            .visible(true);

        // Restore saved position, or center if none saved
        if let (Some(x), Some(y)) = (popup_x, popup_y) {
            builder = builder.position(x, y);
        } else {
            builder = builder.center();
        }

        let _win = builder.build();
        if let Err(ref e) = _win {
            tracing::error!("Failed to create popup window: {e}");
        }
    }
}

pub fn show_settings(app: &tauri::AppHandle) {
    // Temporarily lower the popup so the settings window is not hidden behind it
    if let Some(popup) = app.get_webview_window("popup") {
        if let Err(e) = popup.set_always_on_top(false) {
            tracing::warn!("Failed to lower popup always_on_top: {e}");
        }
    }
    if let Some(win) = app.get_webview_window("main") {
        if let Err(e) = win.show() {
            tracing::error!("Failed to show settings window: {e}");
        }
        if let Err(e) = win.set_focus() {
            tracing::warn!("Failed to set settings focus: {e}");
        }
    }
}
