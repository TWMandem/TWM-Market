//! Хранение токена входа в системном хранилище учётных данных.
//!
//! На Windows это «Диспетчер учётных данных»: запись шифруется системой
//! и привязана к учётной записи Windows. Токен не лежит в открытом виде
//! ни в файлах приложения, ни в браузерном хранилище.

use keyring::Entry;

const SERVICE: &str = "TWM Market";
const ACCOUNT: &str = "refresh-token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("хранилище учётных данных недоступно: {e}"))
}

/// Возвращает сохранённый токен или None, если входа ещё не было.
#[tauri::command]
pub fn auth_token_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("не удалось прочитать токен: {e}")),
    }
}

#[tauri::command]
pub fn auth_token_set(token: String) -> Result<(), String> {
    // Защита от мусора: refresh-токен — короткая строка base64url.
    if token.is_empty() || token.len() > 200 {
        return Err("неверный формат токена".into());
    }
    entry()?
        .set_password(&token)
        .map_err(|e| format!("не удалось сохранить токен: {e}"))
}

#[tauri::command]
pub fn auth_token_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("не удалось удалить токен: {e}")),
    }
}
