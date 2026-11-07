#[cfg(windows)]
#[tauri::command]
pub fn game_overlay_write(text: String) -> Result<(), String> {
    if text.encode_utf16().count() > 8192 {
        return Err("слишком длинные данные для игрового окна".into());
    }
    let root = std::env::var_os("LOCALAPPDATA").ok_or("папка LOCALAPPDATA не найдена")?;
    let folder = std::path::PathBuf::from(root).join("TWM Market");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut bytes = vec![0xff, 0xfe];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(folder.join("game-overlay.txt"), bytes).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn game_overlay_write(_text: String) -> Result<(), String> { Ok(()) }

