use serde::Serialize;
use std::process::Command;
use std::time::Instant;
use tauri::Manager;

// ── Report structures ──────────────────────────────────────

#[derive(Serialize)]
struct DiagnosticReport {
    generated_at: String,
    environment: EnvironmentInfo,
    network: NetworkInfo,
    backend_logs: Vec<String>,
    frontend_logs: Option<Vec<String>>,
    sanitization_note: String,
    disclaimer: String,
}

#[derive(Serialize)]
struct EnvironmentInfo {
    app_name: String,
    app_version: String,
    os_type: String,
    os_version: String,
    os_arch: String,
    webview2_version: Option<String>,
    client_time: String,
    client_timezone: String,
    client_locale: Option<String>,
    cargo_pkg_version: String,
}

#[derive(Serialize)]
struct NetworkInfo {
    bangumi_api: ConnectivityResult,
    tenrai_api: ConnectivityResult,
}

#[derive(Serialize)]
struct ConnectivityResult {
    url: String,
    reachable: bool,
    status_code: Option<u16>,
    error: Option<String>,
    latency_ms: u64,
}

// ── Collection helpers ──────────────────────────────────────

fn get_os_version() -> String {
    // Try PowerShell first for detailed Windows version
    if let Ok(output) = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_OperatingSystem).Caption",
        ])
        .output()
    {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }

    // Fallback: cmd /c ver
    if let Ok(output) = Command::new("cmd").args(["/c", "ver"]).output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }

    "unknown".to_string()
}

fn get_os_arch() -> String {
    std::env::consts::ARCH.to_string()
}

fn get_webview2_version() -> Option<String> {
    // Method 1: Check Evergreen Runtime registry key
    let reg_output = Command::new("reg")
        .args([
            "query",
            r"HKEY_CURRENT_USER\Software\Microsoft\Edge\BLBeacon",
            "/v",
            "version",
        ])
        .output()
        .ok()?;

    if reg_output.status.success() {
        let stdout = String::from_utf8_lossy(&reg_output.stdout);
        // Output looks like: "    version    REG_SZ    123.0.2420.81"
        for line in stdout.lines() {
            if line.contains("version") && line.contains("REG_SZ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(ver) = parts.last() {
                    return Some(ver.to_string());
                }
            }
        }
    }

    // Method 2: Check machine-level registry
    let reg_output = Command::new("reg")
        .args([
            "query",
            r"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v",
            "pv",
        ])
        .output()
        .ok()?;

    if reg_output.status.success() {
        let stdout = String::from_utf8_lossy(&reg_output.stdout);
        for line in stdout.lines() {
            if line.contains("pv") && line.contains("REG_SZ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(ver) = parts.last() {
                    return Some(ver.to_string());
                }
            }
        }
    }

    None
}

fn get_client_timezone() -> String {
    // Try PowerShell timezone
    if let Ok(output) = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-TimeZone).DisplayName",
        ])
        .output()
    {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }

    // Fallback: use time crate
    if let Ok(offset) = time::UtcOffset::current_local_offset() {
        return format!("UTC{:+03}:{:02}", offset.whole_hours(), offset.minutes_past_hour().unsigned_abs());
    }

    "unknown".to_string()
}

fn get_client_locale() -> Option<String> {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .or_else(|_| std::env::var("LC_MESSAGES"))
        .ok()
        .or_else(|| {
            // Windows locale via PowerShell
            Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    "(Get-Culture).Name",
                ])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                })
        })
}

async fn test_connectivity(url: &str) -> ConnectivityResult {
    let start = Instant::now();

    let client = match reqwest::Client::builder()
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/json"),
            );
            headers
        })
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ConnectivityResult {
                url: url.to_string(),
                reachable: false,
                status_code: None,
                error: Some(format!("Failed to create HTTP client: {e}")),
                latency_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            ConnectivityResult {
                url: url.to_string(),
                reachable: status >= 200 && status < 500,
                status_code: Some(status),
                error: if status >= 500 { Some(format!("Server error: {status}")) } else { None },
                latency_ms: start.elapsed().as_millis() as u64,
            }
        }
        Err(e) => ConnectivityResult {
            url: url.to_string(),
            reachable: false,
            status_code: None,
            error: Some(format!("{e}")),
            latency_ms: start.elapsed().as_millis() as u64,
        },
    }
}

// ── Sanitization ────────────────────────────────────────────

/// Extract the current Windows username from USERPROFILE, if possible.
fn get_windows_username() -> Option<String> {
    let userprofile = std::env::var("USERPROFILE").ok()?;
    std::path::Path::new(&userprofile)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
}

fn sanitize_string(input: &str) -> String {
    let mut result = input.to_string();

    // ── Redact Windows username in all path variants ──────
    if let Some(ref username) = get_windows_username() {
        if !username.is_empty() {
            // Single backslash: C:\Users\ALW\
            let pattern1 = format!(":\\Users\\{}\\", username);
            result = result.replace(&pattern1, &format!(":\\Users\\<USER>\\"));

            // Double backslash (JSON-escaped): C:\\Users\\ALW\\
            let pattern2 = format!(":\\\\Users\\\\{}\\\\", username);
            result = result.replace(&pattern2, &format!(":\\\\Users\\\\<USER>\\\\"));

            // Forward slash (URL-style): C:/Users/ALW/
            let pattern3 = format!(":/Users/{}/", username);
            result = result.replace(&pattern3, ":/Users/<USER>/");

            // URL-encoded: %2FUsers%2FALW%2F (case-sensitive, the username part)
            let pattern4 = format!("%2FUsers%2F{}%2F", username);
            result = result.replace(&pattern4, "%2FUsers%2F<USER>%2F");

            // Standalone %5C encoded: %5CUsers%5CALW%5C
            let pattern5 = format!("%5CUsers%5C{}%5C", username);
            result = result.replace(&pattern5, "%5CUsers%5C<USER>%5C");

            // Also handle 'Users\USERNAME\' at any position (not just C:)
            // for paths that may appear without the drive letter prefix
        }
    }

    // ── Redact %USERPROFILE% env var style ─────────────────
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        result = result.replace(&userprofile, r"C:\Users\<USER>");
    }

    // Also try to catch HOME style
    if let Ok(home) = std::env::var("HOME") {
        result = result.replace(&home, "<HOME>");
    }

    // ── Redact common token/secret patterns ────────────────
    let sensitive_keys = [
        "access_token",
        "refresh_token",
        "chii_auth",
        "chii_sid",
        "chii_cookietime",
        "chii_sec",
        "Authorization",
        "authorization",
    ];

    for key in &sensitive_keys {
        // JSON pattern: "key":"value"
        let pattern = format!("\"{}\":\"", key);
        result = redact_json_value(&result, &pattern);

        // JSON pattern: "key": "value"
        let pattern_spaced = format!("\"{}\": \"", key);
        result = redact_json_value(&result, &pattern_spaced);
    }

    // ── Redact Bearer tokens ───────────────────────────────
    result = redact_bearer_tokens(&result);

    result
}

/// Replace the value after a JSON key pattern with [REDACTED].
fn redact_json_value(text: &str, pattern: &str) -> String {
    let mut result = text.to_string();
    let mut search_start = 0;
    while let Some(start) = result[search_start..].find(pattern) {
        let abs_start = search_start + start;
        let value_start = abs_start + pattern.len();
        if let Some(rest) = result.get(value_start..) {
            if let Some(end) = rest.find('"') {
                let before = &result[..value_start];
                let after = &result[value_start + end..];
                result = format!("{}[REDACTED]{}", before, after);
                search_start = value_start + "[REDACTED]".len();
                continue;
            }
        }
        search_start = abs_start + 1;
    }
    result
}

/// Redact Bearer <token> patterns.
fn redact_bearer_tokens(text: &str) -> String {
    let mut new_result = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 7 <= chars.len() {
            let slice: String = chars[i..i + 7].iter().collect();
            if slice.eq_ignore_ascii_case("Bearer ") {
                new_result.push_str("Bearer [REDACTED]");
                i += 7;
                while i < chars.len() && !chars[i].is_whitespace() {
                    i += 1;
                }
                continue;
            }
        }
        new_result.push(chars[i]);
        i += 1;
    }
    new_result
}

fn sanitize_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            *s = sanitize_string(s);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                sanitize_json_value(item);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                sanitize_json_value(v);
            }
        }
        _ => {}
    }
}

// ── Main command ────────────────────────────────────────────

/// Replace the user's Bangumi ID with [USER_ID] in a log line.
/// Only replaces when the ID appears as a distinct token (path segment, JSON value, etc).
fn redact_user_id(line: &str, user_id: Option<&str>) -> String {
    let Some(id) = user_id else {
        return line.to_string();
    };
    if id.is_empty() {
        return line.to_string();
    }

    let mut result = line.to_string();

    // /v0/users/{id}/ → /v0/users/[USER_ID]/
    let pattern_path = format!("/users/{}/", id);
    result = result.replace(&pattern_path, "/users/[USER_ID]/");

    // /v0/users/{id} (end of string)
    let pattern_path_end = format!("/users/{}", id);
    if result.ends_with(&pattern_path_end) {
        let new_end = result.trim_end_matches(id);
        result = format!("{}[USER_ID]", new_end);
    }

    // "username":"{id}" → "username":"[USER_ID]"
    let pattern_username = format!("\"username\":\"{}\"", id);
    result = result.replace(&pattern_username, "\"username\":\"[USER_ID]\"");

    // Standalone occurrences (surrounded by non-alphanumeric chars, not part of another number)
    // This handles cases like: method=GET path=/v0/users/{id}/collections
    // We already handled /users/{id}/ above, so standalone is a fallback.
    // Only replace if bounded by non-digit chars to avoid partial number matches.
    let id_len = id.len();
    let mut final_result = String::with_capacity(result.len());
    let chars: Vec<char> = result.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + id_len <= chars.len() {
            let slice: String = chars[i..i + id_len].iter().collect();
            if slice == id {
                let before_digit = if i == 0 { true } else { !chars[i - 1].is_ascii_digit() };
                let after_digit = if i + id_len >= chars.len() { true } else { !chars[i + id_len].is_ascii_digit() };
                if before_digit && after_digit {
                    final_result.push_str("[USER_ID]");
                    i += id_len;
                    continue;
                }
            }
        }
        final_result.push(chars[i]);
        i += 1;
    }
    final_result
}

#[tauri::command]
pub async fn export_diagnostics(
    app: tauri::AppHandle,
    frontend_errors: Option<Vec<String>>,
) -> Result<String, String> {
    let config = app.config();

    // 1. Collect environment info
    let now = time::OffsetDateTime::now_utc();
    let local_now = now
        .to_offset(
            time::UtcOffset::current_local_offset()
                .unwrap_or(time::UtcOffset::UTC),
        );

    let client_time = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        local_now.year(),
        local_now.month() as u8,
        local_now.day(),
        local_now.hour(),
        local_now.minute(),
        local_now.second(),
    );

    let environment = EnvironmentInfo {
        app_name: config
            .product_name
            .clone()
            .unwrap_or_else(|| "SimpBangumi".to_string()),
        app_version: config.version.clone().unwrap_or_else(|| "0.0.0".to_string()),
        os_type: std::env::consts::OS.to_string(),
        os_version: get_os_version(),
        os_arch: get_os_arch(),
        webview2_version: get_webview2_version(),
        client_time,
        client_timezone: get_client_timezone(),
        client_locale: get_client_locale(),
        cargo_pkg_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    // 2. Test API connectivity
    let bangumi_result = test_connectivity("https://api.bgm.tv/").await;
    let tenrai_result = test_connectivity("https://api.tenrai.org/v1").await;

    let network = NetworkInfo {
        bangumi_api: bangumi_result,
        tenrai_api: tenrai_result,
    };

    // 3. Resolve sensitive user identifiers for redaction
    let bangumi_user_id: Option<String> =
        crate::auth::load_token().ok().flatten().and_then(|token| {
            token.user.map(|u| u.id.to_string())
        });

    // 4. Collect and sanitize backend logs
    let raw_backend_logs = crate::take_rust_logs();
    let sanitized_backend_logs: Vec<String> = raw_backend_logs
        .into_iter()
        .map(|line| sanitize_string(&line))
        .map(|line| redact_user_id(&line, bangumi_user_id.as_deref()))
        .collect();

    // 5. Sanitize frontend logs (captured console.log/info/warn/error + unhandled rejections)
    let sanitized_frontend_logs: Option<Vec<String>> = frontend_errors.map(|logs| {
        logs.into_iter()
            .map(|line| sanitize_string(&line))
            .map(|line| redact_user_id(&line, bangumi_user_id.as_deref()))
            .collect()
    });

    // 6. Build report
    let report = DiagnosticReport {
        generated_at: format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            now.year(),
            now.month() as u8,
            now.day(),
            now.hour(),
            now.minute(),
            now.second(),
        ),
        environment,
        network,
        backend_logs: sanitized_backend_logs,
        frontend_logs: sanitized_frontend_logs,
        sanitization_note: "Sensitive data (tokens, user paths, authorization headers, user IDs) have been automatically redacted. Values containing access_token, refresh_token, Authorization headers, Bearer tokens, chii_auth/sid, Windows user profile paths, and Bangumi user IDs are replaced with [REDACTED] or [USER_ID]. Frontend logs include ALL console output (log/info/warn/error) and unhandled rejections. Backend logs include all Rust eprintln output since app start.".to_string(),
        disclaimer: "诊断信息用于排查软件运行异常。请不要将包含敏感信息的日志公开上传到公共讨论区。".to_string(),
    };

    // 5. Serialize to JSON
    let mut json_value = serde_json::to_value(&report)
        .map_err(|e| format!("Failed to serialize diagnostic report: {e}"))?;

    // Double-check sanitization on final JSON
    sanitize_json_value(&mut json_value);

    let json_str = serde_json::to_string_pretty(&json_value)
        .map_err(|e| format!("Failed to format diagnostic report: {e}"))?;

    // 6. Write to temp file
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;

    let diagnostics_dir = app_data_dir.join("diagnostics");
    std::fs::create_dir_all(&diagnostics_dir)
        .map_err(|e| format!("无法创建诊断目录: {e}"))?;

    let timestamp = format!(
        "{}{:02}{:02}_{:02}{:02}{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    );

    let file_name = format!("diagnostics_{}.json", timestamp);
    let file_path = diagnostics_dir.join(&file_name);

    std::fs::write(&file_path, &json_str)
        .map_err(|e| format!("无法写入诊断文件: {e}"))?;

    crate::log_info(&format!("Diagnostics exported to: {}", file_path.display()));

    Ok(file_path
        .to_str()
        .ok_or_else(|| "路径包含非 UTF-8 字符".to_string())?
        .to_string())
}
