//! Модели персонажей из установленной игры Amazing Online.
//!
//! Приложение только читает файлы игры на компьютере игрока: описание
//! персонажей (data\peds_info.ide), список папок с моделями (data\default.dat)
//! и сами модели .dff/.txd. Ничего не изменяется и никуда не отправляется.
//! Интерфейс получает файлы модели по номеру персонажа — произвольный путь
//! запросить нельзя.

use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::Response;

/// Модель или текстуры персонажа больше этого размера не читаем.
const MAX_FILE_BYTES: u64 = 48 * 1024 * 1024;

/// Описания персонажей: сначала то, что грузит лаунчер Amazing, затем стандартное.
const PED_FILES: [&str; 2] = ["data/peds_info.ide", "data/peds.ide"];

/// Где обычно лежит игра (лаунчер ставит её в «Amazing Games»).
fn default_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for drive in ['C', 'D', 'E', 'F', 'G', 'H'] {
        for base in ["Amazing Games\\Amazing Online", "Games\\Amazing Online", "Amazing Online"] {
            out.push(PathBuf::from(format!("{drive}:\\{base}")));
        }
    }
    out
}

/// Папка игры — та, где есть data\peds_info.ide (обычно ...\Amazing Online\PC).
fn resolve_root(dir: &Path) -> Option<PathBuf> {
    for candidate in [dir.to_path_buf(), dir.join("PC")] {
        if PED_FILES.iter().any(|f| candidate.join(f).is_file()) {
            return candidate.canonicalize().ok();
        }
    }
    None
}

fn read_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > 8 * 1024 * 1024 {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    // Файлы игры в однобайтовой кодировке: нужны только латинские имена.
    Some(bytes.iter().map(|&b| if b.is_ascii() { b as char } else { ' ' }).collect())
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Имя модели и словаря текстур персонажа по его номеру.
fn find_ped(root: &Path, id: u32) -> Option<(String, String)> {
    for file in PED_FILES {
        let Some(text) = read_text(&root.join(file)) else { continue };
        let mut in_peds = false;
        for raw in text.lines() {
            let line = raw.split(['#', ';']).next().unwrap_or("").trim();
            let lower = line.to_ascii_lowercase();
            if lower == "peds" {
                in_peds = true;
                continue;
            }
            if lower == "end" {
                in_peds = false;
                continue;
            }
            let parts: Vec<&str> = line.split(',').map(str::trim).collect();
            if !in_peds || parts.len() < 3 {
                continue;
            }
            if parts[0].parse::<u32>().ok() != Some(id) {
                continue;
            }
            let (model, txd) = (parts[1], parts[2]);
            if valid_name(model) && valid_name(txd) {
                return Some((model.to_ascii_lowercase(), txd.to_ascii_lowercase()));
            }
        }
    }
    None
}

/// Папки с моделями из data\default.dat (строки «IMG models\assets\skins»).
fn model_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(text) = read_text(&root.join("data/default.dat")) {
        for line in text.lines() {
            let mut words = line.split_whitespace();
            if !words.next().is_some_and(|w| w.eq_ignore_ascii_case("IMG")) {
                continue;
            }
            let Some(rel) = words.next() else { continue };
            let rel = PathBuf::from(rel.replace('\\', "/"));
            // Только вложенные папки игры: без «..» и абсолютных путей.
            if rel.components().all(|c| matches!(c, Component::Normal(_))) {
                dirs.push(root.join(rel));
            }
        }
    }
    // На случай старой версии файла — стандартная папка персонажей.
    dirs.push(root.join("models/assets/skins"));
    dirs
}

/// Файл модели без учёта регистра имени.
fn find_model_file(root: &Path, file_name: &str) -> Option<PathBuf> {
    for dir in model_dirs(root) {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(file_name) {
                let path = entry.path().canonicalize().ok()?;
                if path.starts_with(root) && path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|_| "Не удалось прочитать файл модели".to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("Файл модели слишком большой".into());
    }
    fs::read(path).map_err(|_| "Не удалось прочитать файл модели".to_string())
}

/// Ищет игру в обычных местах. Возвращает папку или null.
#[tauri::command]
pub async fn game_detect() -> Option<String> {
    default_candidates()
        .into_iter()
        .find_map(|dir| resolve_root(&dir))
        .map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

/// Проверяет выбранную игроком папку. Возвращает папку игры (с data\peds_info.ide).
#[tauri::command]
pub async fn game_check(dir: String) -> Result<String, String> {
    resolve_root(Path::new(&dir))
        .map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string())
        .ok_or_else(|| "В этой папке не нашлась игра Amazing Online. Выберите папку, где лежит amazing.exe (обычно …\\Amazing Online\\PC).".into())
}

/// Модель персонажа: [длина .dff, 4 байта LE][.dff][.txd].
#[tauri::command]
pub async fn game_ped_model(dir: String, id: u32) -> Result<Response, String> {
    let root = resolve_root(Path::new(&dir)).ok_or("Папка с игрой не найдена — укажите её заново")?;
    let (model, txd) = find_ped(&root, id).ok_or_else(|| format!("В файлах игры нет персонажа с ID {id}. Возможно, игра не обновлена."))?;
    let dff_path = find_model_file(&root, &format!("{model}.dff")).ok_or_else(|| format!("Не найден файл модели {model}.dff"))?;
    let txd_path = find_model_file(&root, &format!("{txd}.txd")).ok_or_else(|| format!("Не найден файл текстур {txd}.txd"))?;
    let dff = read_limited(&dff_path)?;
    let tex = read_limited(&txd_path)?;
    let mut out = Vec::with_capacity(4 + dff.len() + tex.len());
    out.extend_from_slice(&(dff.len() as u32).to_le_bytes());
    out.extend_from_slice(&dff);
    out.extend_from_slice(&tex);
    Ok(Response::new(out))
}
