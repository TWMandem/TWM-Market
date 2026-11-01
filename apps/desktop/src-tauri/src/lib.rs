/// Точка входа настольного приложения.
///
/// На этом шаге оболочка только открывает окно с интерфейсом.
/// Уведомления Windows, значок в трее, ссылки twm:// и автообновление
/// подключаются плагинами Tauri на следующих шагах.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение TWM Market");
}
