mod credentials;

/// Точка входа настольного приложения.
///
/// Уведомления Windows, значок в трее, ссылки twm:// и автообновление
/// подключаются плагинами Tauri на следующих шагах.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            credentials::auth_token_get,
            credentials::auth_token_set,
            credentials::auth_token_clear,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение TWM Market");
}
