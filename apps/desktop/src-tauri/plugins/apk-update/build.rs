const COMMANDS: &[&str] = &["download", "status", "install"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
