//! Обновление приложения на Android без браузера: APK скачивается внутрь
//! приложения (с проверкой SHA-256), затем открывается системный установщик.
//! Android ставит обновление, только если оно подписано тем же ключом,
//! что и установленное приложение.
//!
//! Сама работа — в Kotlin (android/src/main/java/ApkUpdatePlugin.kt);
//! здесь команды только передаются туда.

use serde::Serialize;
use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct ApkUpdate<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct DownloadArgs {
    url: String,
    sha256: Option<String>,
}

fn handle<R: Runtime>(app: &AppHandle<R>) -> &PluginHandle<R> {
    &app.state::<ApkUpdate<R>>().inner().0
}

/// Начать загрузку APK. Ход загрузки — командой status.
#[tauri::command]
async fn download<R: Runtime>(app: AppHandle<R>, url: String, sha256: Option<String>) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("download", DownloadArgs { url, sha256 }).map_err(|e| e.to_string())
}

/// { state: idle | downloading | ready | error, downloaded, total, error? }
#[tauri::command]
async fn status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("status", ()).map_err(|e| e.to_string())
}

/// Открыть установщик. { needsPermission: true } — сначала нужно разрешить
/// установку приложений (открыто окно настроек Android).
#[tauri::command]
async fn install<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    handle(&app).run_mobile_plugin("install", ()).map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("apk-update")
        .invoke_handler(tauri::generate_handler![download, status, install])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("ru.twmmarket.apkupdate", "ApkUpdatePlugin")?;
                app.manage(ApkUpdate(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
