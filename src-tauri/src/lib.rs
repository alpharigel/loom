use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, RunEvent};

const PREFERRED_PORT: u16 = 3000;

struct ServerHandle(Mutex<Option<std::process::Child>>);

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// In `tauri dev`, server.js lives at repo_root/server.js (parent of src-tauri).
/// In a bundled build, it's copied as a resource next to the binary.
fn resolve_server_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
            if let Ok(root) = PathBuf::from(manifest).join("..").canonicalize() {
                if root.join("server.js").exists() {
                    return Some(root);
                }
            }
        }
    }
    app.path()
        .resource_dir()
        .ok()
        .filter(|p| p.join("server.js").exists())
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

fn set_status(app: &tauri::AppHandle, msg: &str) {
    log::info!("[loom] {}", msg);
    let _ = app.emit("loom:status", msg.to_string());
    if let Some(win) = app.get_webview_window("main") {
        let safe = msg.replace('\\', "\\\\").replace('\'', "\\'");
        let _ = win.eval(&format!(
            "window.__setStatus && window.__setStatus('{}')",
            safe
        ));
    }
}

fn set_host(app: &tauri::AppHandle, host: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let safe = host.replace('\\', "\\\\").replace('\'', "\\'");
        let _ = win.eval(&format!(
            "window.__setHost && window.__setHost('{}')",
            safe
        ));
    }
}

/// Parse the port from server.js's stdout line:
///   "  Loom running at http://127.0.0.1:3000"
fn parse_port_from_line(line: &str) -> Option<u16> {
    let marker = "Loom running at http://";
    let idx = line.find(marker)?;
    let rest = &line[idx + marker.len()..];
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let end = after_colon
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(after_colon.len());
    after_colon[..end].parse().ok()
}

fn spawn_server_and_navigate(app: tauri::AppHandle) {
    let Some(root) = resolve_server_root(&app) else {
        set_status(&app, "error: could not locate server.js");
        return;
    };

    // Prefer port 3000 so Claude Code hooks (hardcoded to localhost:3000 in
    // setup.sh) reach this instance. If it's taken, server.js's own
    // listenWithFallback will walk forward from there; we parse stdout to
    // learn the actual bound port.
    let start_port = if port_is_free(PREFERRED_PORT) {
        PREFERRED_PORT
    } else {
        set_status(
            &app,
            &format!(
                "port {} busy — will pick next free port",
                PREFERRED_PORT
            ),
        );
        PREFERRED_PORT
    };

    set_status(&app, &format!("starting loom server (preferring :{})", start_port));

    let node = which_node();
    let mut cmd = Command::new(&node);
    cmd.arg("server.js")
        .current_dir(&root)
        .env("PORT", start_port.to_string())
        .env("HOST", "127.0.0.1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            set_status(&app, &format!("error spawning node: {}", e));
            return;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(state) = app.try_state::<ServerHandle>() {
        *state.0.lock().unwrap() = Some(child);
    }

    // Channel: stdout reader -> navigation thread with the detected port.
    let (port_tx, port_rx) = mpsc::channel::<u16>();

    if let Some(out) = stdout {
        let app_for_stdout = app.clone();
        let tx = port_tx.clone();
        thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(out).lines().flatten() {
                log::info!("[node] {}", line);
                if !announced {
                    if let Some(p) = parse_port_from_line(&line) {
                        announced = true;
                        set_host(&app_for_stdout, &format!("127.0.0.1:{}", p));
                        let _ = tx.send(p);
                    }
                }
            }
        });
    }
    if let Some(err) = stderr {
        thread::spawn(move || {
            for line in BufReader::new(err).lines().flatten() {
                log::warn!("[node] {}", line);
            }
        });
    }

    // Wait for the real port (from stdout) or fall back to the start port.
    thread::spawn(move || {
        set_status(&app, "waiting for server");
        let detected = port_rx.recv_timeout(Duration::from_secs(30)).ok();
        let port = detected.unwrap_or(start_port);
        if detected.is_none() {
            log::warn!("[loom] did not see bound-port log line; falling back to {}", port);
        }
        if wait_for_port(port, Duration::from_secs(30)) {
            set_status(&app, &format!("ready at http://127.0.0.1:{}", port));
            thread::sleep(Duration::from_millis(250));
            if let Some(win) = app.get_webview_window("main") {
                let url = format!("http://127.0.0.1:{}/", port);
                if let Ok(parsed) = url.parse() {
                    if let Err(e) = win.navigate(parsed) {
                        log::error!("[loom] navigate failed: {}", e);
                    }
                }
            }
        } else {
            set_status(&app, "server did not start within 30s");
        }
    });
}

fn which_node() -> String {
    let candidates = [
        std::env::var("LOOM_NODE_PATH").ok(),
        Some("/opt/homebrew/bin/node".to_string()),
        Some("/usr/local/bin/node".to_string()),
    ];
    for c in candidates.into_iter().flatten() {
        if std::path::Path::new(&c).exists() {
            return c;
        }
    }
    "node".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerHandle(Mutex::new(None)))
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            let handle = app.handle().clone();
            spawn_server_and_navigate(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app.try_state::<ServerHandle>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
