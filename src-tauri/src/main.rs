// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// In `tauri dev` the binary is not bundled, so embed Info.plist (microphone usage string).
#[cfg(target_os = "macos")]
embed_plist::embed_info_plist!("../Info.plist");

fn main() {
    plaudenote_lib::run()
}
