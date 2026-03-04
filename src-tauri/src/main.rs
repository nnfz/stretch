#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
struct AppSettings {
    #[serde(default = "default_true")]
    hardware_acceleration: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hardware_acceleration: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn get_settings_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(appdata).join("com.nnfz.stretch").join("settings.json")
}

fn read_settings() -> AppSettings {
    let path = get_settings_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

fn write_settings(settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn maximize_window(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
async fn whep_request(url: String, sdp: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/sdp")
        .body(sdp)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("WHEP вернул статус {}", response.status()));
    }

    response.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_stream_live(url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .map_err(|_| "fetch failed".to_string())?;

    Ok(response.status().as_u16() != 404)
}

#[cfg(target_os = "windows")]
fn shell_execute(path: &std::path::Path, args: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> isize;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    let verb = to_wide("open");
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let params = to_wide(args);

    let result = unsafe {
        ShellExecuteW(
            0,
            verb.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            0, // SW_HIDE
        )
    };

    if result <= 32 {
        Err(format!("Failed to launch installer (error code {})", result))
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn download_and_install_update(
    url: String,
    window: tauri::Window,
) -> Result<bool, String> {
    use std::io::Write;
    use futures_util::StreamExt;

    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join("stretch-update.exe");

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut byte_stream = response.bytes_stream();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
            let _ = window.emit("update-download-progress", progress);
        }
    }

    drop(file);

    shell_execute(&temp_path, "/S")?;

    std::thread::sleep(std::time::Duration::from_millis(500));
    std::process::exit(0);
}

#[tauri::command]
fn get_hardware_acceleration() -> bool {
    read_settings().hardware_acceleration
}

#[tauri::command]
fn set_hardware_acceleration(enabled: bool) -> Result<bool, String> {
    let mut settings = read_settings();
    settings.hardware_acceleration = enabled;
    write_settings(&settings)?;
    Ok(enabled)
}

fn main() {
    // Read settings before creating the webview
    let settings = read_settings();
    if !settings.hardware_acceleration {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            maximize_window,
            close_window,
            whep_request,
            check_stream_live,
            download_and_install_update,
            get_hardware_acceleration,
            set_hardware_acceleration,
        ])
        .setup(|app| {
            use tauri::Manager;
            let window = app.get_webview_window("main").unwrap();
            window.set_decorations(false)?;

            // Fix Windows 10 frameless window border when maximized.
            // DwmExtendFrameIntoClientArea with -1 margins removes the
            // visible 1px "classic" border that appears on Win10 without Aero.
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
                use windows_sys::Win32::UI::Controls::MARGINS;

                let hwnd = window.hwnd().unwrap().0 as *mut std::ffi::c_void;
                let margins = MARGINS {
                    cxLeftWidth: -1,
                    cxRightWidth: -1,
                    cyTopHeight: -1,
                    cyBottomHeight: -1,
                };
                unsafe {
                    DwmExtendFrameIntoClientArea(hwnd, &margins);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
