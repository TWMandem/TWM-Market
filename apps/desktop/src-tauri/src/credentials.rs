//! Хранение токена входа.
//!
//! На компьютере — в системном хранилище учётных данных (на Windows это
//! «Диспетчер учётных данных»: запись шифруется системой и привязана
//! к учётной записи Windows).
//!
//! На телефоне (Android) — в файле в личной папке приложения: её содержимое
//! доступно только самому приложению, другие приложения прочитать его не могут.
//!
//! В обоих случаях токен не лежит в браузерном хранилище интерфейса.

/// Защита от мусора: refresh-токен — короткая строка base64url.
fn check_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 200 || !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("неверный формат токена".into());
    }
    Ok(())
}

#[cfg(desktop)]
mod store {
    use keyring::Entry;

    const SERVICE: &str = "TWM Market";
    const ACCOUNT: &str = "refresh-token";

    fn entry() -> Result<Entry, String> {
        Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("хранилище учётных данных недоступно: {e}"))
    }

    pub fn get(_app: &tauri::AppHandle) -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("не удалось прочитать токен: {e}")),
        }
    }

    pub fn set(_app: &tauri::AppHandle, token: &str) -> Result<(), String> {
        entry()?.set_password(token).map_err(|e| format!("не удалось сохранить токен: {e}"))
    }

    pub fn clear(_app: &tauri::AppHandle) -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("не удалось удалить токен: {e}")),
        }
    }
}

#[cfg(mobile)]
mod store {
    use std::fs;
    use std::path::PathBuf;
    use tauri::Manager;

    fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| format!("папка приложения недоступна: {e}"))?;
        fs::create_dir_all(&dir).map_err(|e| format!("папка приложения недоступна: {e}"))?;
        Ok(dir.join("refresh-token"))
    }

    pub fn get(app: &tauri::AppHandle) -> Result<Option<String>, String> {
        match fs::read_to_string(path(app)?) {
            Ok(token) if !token.trim().is_empty() => Ok(Some(token.trim().to_string())),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("не удалось прочитать токен: {e}")),
        }
    }

    pub fn set(app: &tauri::AppHandle, token: &str) -> Result<(), String> {
        // Сначала во временный файл, потом переименование — чтобы не остался обрезанный токен.
        let target = path(app)?;
        let tmp = target.with_extension("tmp");
        fs::write(&tmp, token).map_err(|e| format!("не удалось сохранить токен: {e}"))?;
        fs::rename(&tmp, &target).map_err(|e| format!("не удалось сохранить токен: {e}"))
    }

    pub fn clear(app: &tauri::AppHandle) -> Result<(), String> {
        match fs::remove_file(path(app)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("не удалось удалить токен: {e}")),
        }
    }
}

/// Возвращает сохранённый токен или None, если входа ещё не было.
#[tauri::command]
pub fn auth_token_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    store::get(&app)
}

#[tauri::command]
pub fn auth_token_set(app: tauri::AppHandle, token: String) -> Result<(), String> {
    check_token(&token)?;
    store::set(&app, &token)
}

#[tauri::command]
pub fn auth_token_clear(app: tauri::AppHandle) -> Result<(), String> {
    store::clear(&app)
}
