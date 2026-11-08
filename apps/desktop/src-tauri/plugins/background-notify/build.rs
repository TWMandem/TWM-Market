const COMMANDS: &[&str] = &["start", "stop", "status", "ensure", "seen", "notify", "insets", "status_bar"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}

