const COMMANDS: &[&str] = &["start", "stop", "status", "seen", "notify"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
