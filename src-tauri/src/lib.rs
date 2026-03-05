use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Emitter, Manager, WebviewUrl,
};
use tauri_plugin_store::StoreExt;

mod commands;

fn create_or_toggle_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.set_focus();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    } else {
        let on_top = app
            .store("settings.json")
            .ok()
            .and_then(|store| store.get("always_on_top").and_then(|v| v.as_bool()))
            .unwrap_or(true);

        // Read saved popup geometry from store
        let store = app.store("settings.json").ok();
        let popup_w = store.as_ref().and_then(|s| s.get("popup_width").and_then(|v| v.as_f64())).unwrap_or(600.0);
        let popup_h = store.as_ref().and_then(|s| s.get("popup_height").and_then(|v| v.as_f64())).unwrap_or(450.0);
        let popup_x = store.as_ref().and_then(|s| s.get("popup_x").and_then(|v| v.as_f64()));
        let popup_y = store.as_ref().and_then(|s| s.get("popup_y").and_then(|v| v.as_f64()));

        let mut builder = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("/".into()))
            .title("Voice to Prompt")
            .inner_size(popup_w, popup_h)
            .min_inner_size(350.0, 280.0)
            .decorations(false)
            .resizable(true)
            .skip_taskbar(true)
            .always_on_top(on_top)
            .visible(true);

        // Restore saved position, or center if none saved
        if let (Some(x), Some(y)) = (popup_x, popup_y) {
            builder = builder.position(x, y);
        } else {
            builder = builder.center();
        }

        let _win = builder.build();
    }
}

pub fn show_settings(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItemBuilder::with_id("open", "Open Voice to Prompt").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Developer Voice to Prompt")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => create_or_toggle_popup(app),
            "settings" => show_settings(app),
            "quit" => {
                // Close all windows first so WebView2 cleans up properly
                for (_, win) in app.webview_windows() {
                    let _ = win.destroy();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                create_or_toggle_popup(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_global_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    use tauri_plugin_store::StoreExt;

    // Read saved shortcut from store, fall back to default
    let shortcut_str = app
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store
                .get("shortcut")
                .and_then(|v: serde_json::Value| v.as_str().map(String::from))
        })
        .unwrap_or_else(|| "CommandOrControl+Shift+Space".into());

    let app_handle = app.clone();
    if shortcut_str.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut_str.as_str(), move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            create_or_toggle_popup(&app_handle);
        }
    }) {
        eprintln!("Failed to register global shortcut: {}", e);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::toggle_popup,
            commands::hide_popup,
            commands::update_shortcut,
            commands::get_settings,
            commands::save_settings,
            commands::show_settings,
        ])
        .on_window_event(|window, event| {
            // Hide the main/settings window instead of closing the app
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            setup_tray(app.handle())?;
            setup_global_shortcut(app.handle());

            // On first run, if no settings exist, show the settings window
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Small delay to let the store plugin initialize
                std::thread::sleep(std::time::Duration::from_millis(500));
                let _ = app_handle.emit("check-first-run", ());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
