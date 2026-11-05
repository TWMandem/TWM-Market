//! Фоновые уведомления на Android: раз в ~15 минут Android будит приложение
//! (WorkManager), оно спрашивает сервер о новых уведомлениях по ключу
//! устройства и показывает их. Работа — в Kotlin (android/src/main/java).

use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct BackgroundNotify<R: Runtime>(PluginHandle<R>);

fn handle<R: Runtime>(app: &AppHandle<R>) -> &PluginHandle<R> {
    &app.state::<BackgroundNotify<R>>().inner().0
}

/// Включить фоновую проверку: адрес сервера и ключ устройства.
#[tauri::command]
async fn start<R: Runtime>(app: AppHandle<R>, api_url: String, token: String) -> Result<Value, String> {
    handle(&app)
        .run_mobile_plugin("start", serde_json::json!({ "apiUrl": api_url, "token": token }))
        .map_err(|e| e.to_string())
}

/// Выключить. Возвращает { token } — чтобы отозвать его на сервере.
#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("stop", ()).map_err(|e| e.to_string())
}

/// { active, permission }
#[tauri::command]
async fn status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("status", ()).map_err(|e| e.to_string())
}

/// Приложение само показало уведомления до номера id — фоновая задача их пропустит.
#[tauri::command]
async fn seen<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("seen", serde_json::json!({ "id": id })).map_err(|e| e.to_string())
}

/// Показать уведомление Android (по нажатию открывается нужный экран).
#[tauri::command]
async fn notify<R: Runtime>(app: AppHandle<R>, id: i64, title: String, body: String, link: Option<String>) -> Result<Value, String> {
    handle(&app)
        .run_mobile_plugin("notify", serde_json::json!({ "id": id, "title": title, "body": body, "link": link }))
        .map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("background-notify")
        .invoke_handler(tauri::generate_handler![start, stop, status, seen, notify])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("ru.twmmarket.bgnotify", "BackgroundNotifyPlugin")?;
                app.manage(BackgroundNotify(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
