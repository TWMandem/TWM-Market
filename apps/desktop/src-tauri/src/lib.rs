mod credentials;
mod game_models;
mod game_overlay;

/// Трей и окно — только на компьютере.
#[cfg(desktop)]
mod desktop {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        App, AppHandle, Manager,
    };

    /// Показывает главное окно, если оно свёрнуто или спрятано в трей.
    pub fn show_main(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
        // Схема twm-market:// прописывается установщиком; на всякий случай — и при запуске
        // (для текущего пользователя Windows). Ошибка здесь не мешает работе приложения.
        #[cfg(any(windows, target_os = "linux"))]
        {
            use tauri_plugin_deep_link::DeepLinkExt;
            let _ = app.deep_link().register_all();
        }
        let open = MenuItem::with_id(app, "open", "Открыть TWM Market", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;

        let mut tray = TrayIconBuilder::with_id("main")
            .tooltip("TWM Market")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    }
}

/// Точка входа приложения (компьютер и Android).
///
/// На компьютере крестик окна прячет приложение в трей: уведомления о сообщениях
/// продолжают приходить. Полностью закрыть — «Выход» в меню значка.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Должен регистрироваться первым: второй запуск просто показывает окно.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)));

    // Ссылки twm-market://listing/ID: интерфейс получает их и открывает объявление.
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_apk_update::init())
        .plugin(tauri_plugin_background_notify::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| desktop::setup(app))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    builder
        .invoke_handler(tauri::generate_handler![
            credentials::auth_token_get,
            credentials::auth_token_set,
            credentials::auth_token_clear,
            game_models::game_detect,
            game_models::game_check,
            game_models::game_ped_model,
            game_overlay::game_overlay_write,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение TWM Market");
}
