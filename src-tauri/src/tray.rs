use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};

use crate::window_manager;

pub fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItemBuilder::with_id("open", "Open Voice to Prompt").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let tray_builder = TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Developer Voice to Prompt")
        .menu(&menu);

    #[cfg(target_os = "macos")]
    let tray_builder = tray_builder.icon_as_template(false);

    let _tray = tray_builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => window_manager::create_or_toggle_popup(app),
            "settings" => window_manager::show_settings(app),
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
                window_manager::create_or_toggle_popup(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
