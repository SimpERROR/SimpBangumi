use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Instant;
use tauri::Manager;

// ── Report structures ──────────────────────────────────────

#[derive(Serialize)]
struct DiagnosticReport {
    schema_version: u32,
    generated_at: String,
    environment: EnvironmentInfo,
    authentication: AuthenticationInfo,
    network: NetworkInfo,
    log_summary: LogSummary,
    backend_logs: Vec<String>,
    frontend_logs: Option<Vec<String>>,
    sanitization_note: String,
    disclaimer: String,
}

#[derive(Serialize)]
struct LogSummary {
    backend: LogStats,
    frontend: LogStats,
}

#[derive(Serialize)]
struct LogStats {
    retained: usize,
    dropped: usize,
    capacity: usize,
    truncated: bool,
    count_consistent: bool,
}

#[derive(Debug, Deserialize)]
pub struct FrontendLogStats {
    retained: usize,
    dropped: usize,
    capacity: usize,
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
struct AuthenticationInfo {
    storage_status: &'static str,
    source: Option<&'static str>,
    expires_at: Option<i64>,
    user_profile_available: bool,
    storage_error: Option<String>,
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
        .args(["-NoProfile", "-Command", "(Get-TimeZone).DisplayName"])
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
        return format!(
            "UTC{:+03}:{:02}",
            offset.whole_hours(),
            offset.minutes_past_hour().unsigned_abs()
        );
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
                .args(["-NoProfile", "-Command", "(Get-Culture).Name"])
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
                error: if status >= 500 {
                    Some(format!("Server error: {status}"))
                } else {
                    None
                },
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

const REDACTED: &str = "[REDACTED]";
const SENSITIVE_KEYS: &[&str] = &[
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "set-cookie",
    "chii_auth",
    "chii_sid",
    "chii_cookietime",
    "chii_sec",
    "client_secret",
    "code_verifier",
    "oauth_code",
    "authorization_code",
    "device_id",
    "username",
    "nickname",
    "user_id",
    "email",
    "password",
];

struct SensitiveIdentity {
    value: String,
    replacement: &'static str,
}

struct SanitizationContext {
    exact_values: Vec<SensitiveIdentity>,
    user_profile: Option<String>,
    home: Option<String>,
}

impl SanitizationContext {
    fn new(user: Option<&crate::bangumi::BangumiUser>) -> Self {
        let mut context = Self {
            exact_values: Vec::new(),
            user_profile: std::env::var("USERPROFILE").ok().filter(|v| !v.is_empty()),
            home: std::env::var("HOME").ok().filter(|v| !v.is_empty()),
        };

        if let Some(profile) = context.user_profile.clone() {
            if let Some(username) = last_path_component(&profile) {
                context.add_identity(username, "[OS_USERNAME]");
            }
        }
        if let Some(user) = user {
            context.add_identity(user.id.to_string(), "[BANGUMI_USER_ID]");
            context.add_identity(user.username.clone(), "[BANGUMI_USERNAME]");
            context.add_identity(user.nickname.clone(), "[BANGUMI_NICKNAME]");
        }
        context
    }

    fn add_identity(&mut self, value: String, replacement: &'static str) {
        let value = value.trim();
        if value.is_empty() || value.starts_with('[') {
            return;
        }
        self.exact_values.push(SensitiveIdentity {
            value: value.to_string(),
            replacement,
        });

        let encoded: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
        if encoded != value {
            self.exact_values.push(SensitiveIdentity {
                value: encoded,
                replacement,
            });
        }
    }

    fn sanitize(&self, input: &str) -> String {
        let mut result = redact_user_directory_segments(input);
        result = redact_bangumi_user_paths(&result);

        for (profile, replacement) in [
            (self.user_profile.as_deref(), r"C:\Users\[OS_USERNAME]"),
            (self.home.as_deref(), "[HOME]"),
        ] {
            if let Some(profile) = profile {
                result = replace_ascii_case_insensitive(&result, profile, replacement);
                let escaped = profile.replace(char::from(92), r"\\");
                if escaped != profile {
                    result = replace_ascii_case_insensitive(
                        &result,
                        &escaped,
                        &replacement.replace(char::from(92), r"\\"),
                    );
                }
                let encoded: String =
                    url::form_urlencoded::byte_serialize(profile.as_bytes()).collect();
                result = replace_ascii_case_insensitive(&result, &encoded, replacement);
            }
        }

        for identity in &self.exact_values {
            result = replace_bounded_ascii_case_insensitive(
                &result,
                &identity.value,
                identity.replacement,
            );
        }

        result = redact_bearer_tokens(&result);
        for key in SENSITIVE_KEYS {
            result = redact_assigned_values(&result, key);
        }
        result
    }

    #[cfg(test)]
    fn for_test(
        profile: Option<&str>,
        home: Option<&str>,
        identities: &[(&str, &'static str)],
    ) -> Self {
        let mut context = Self {
            exact_values: Vec::new(),
            user_profile: profile.map(str::to_string),
            home: home.map(str::to_string),
        };
        for (value, replacement) in identities {
            context.add_identity((*value).to_string(), replacement);
        }
        context
    }
}

fn last_path_component(path: &str) -> Option<String> {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .find(|part| !part.is_empty())
        .map(str::to_string)
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str, from: usize) -> Option<usize> {
    if needle.is_empty() || from > haystack.len() || !haystack.is_char_boundary(from) {
        return None;
    }
    haystack[from..]
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
        .map(|index| from + index)
}

fn replace_ascii_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
    let mut result = input.to_string();
    let mut from = 0;
    while let Some(start) = find_ascii_case_insensitive(&result, needle, from) {
        let end = start + needle.len();
        result.replace_range(start..end, replacement);
        from = start + replacement.len();
    }
    result
}

fn is_identity_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-')
}

fn replace_bounded_ascii_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
    let mut result = input.to_string();
    let mut from = 0;
    while let Some(start) = find_ascii_case_insensitive(&result, needle, from) {
        let end = start + needle.len();
        let before_is_identity = result[..start]
            .chars()
            .next_back()
            .is_some_and(is_identity_char);
        let after_is_identity = result[end..].chars().next().is_some_and(is_identity_char);
        if !before_is_identity && !after_is_identity {
            result.replace_range(start..end, replacement);
            from = start + replacement.len();
        } else {
            from = end;
        }
    }
    result
}

fn redact_user_directory_segments(input: &str) -> String {
    let mut result = input.to_string();
    for prefix in [
        r"\\Users\\",
        r"\Users\",
        "/Users/",
        "%5CUsers%5C",
        "%2FUsers%2F",
    ] {
        let mut from = 0;
        while let Some(prefix_start) = find_ascii_case_insensitive(&result, prefix, from) {
            let segment_start = prefix_start + prefix.len();
            let segment_end = result[segment_start..]
                .char_indices()
                .find_map(|(offset, character)| {
                    let terminates = character == '\\'
                        || character == '/'
                        || character == '%'
                        || character == '"'
                        || character == '\''
                        || character == '?'
                        || character == '#'
                        || character.is_whitespace();
                    terminates.then_some(segment_start + offset)
                })
                .unwrap_or(result.len());
            if segment_end == segment_start {
                from = segment_start;
                continue;
            }
            result.replace_range(segment_start..segment_end, "[OS_USERNAME]");
            from = segment_start + "[OS_USERNAME]".len();
        }
    }
    result
}

fn redact_bangumi_user_paths(input: &str) -> String {
    let mut result = input.to_string();
    for prefix in ["/users/", "/user/", "%2Fusers%2F", "%2Fuser%2F"] {
        let mut from = 0;
        while let Some(prefix_start) = find_ascii_case_insensitive(&result, prefix, from) {
            let segment_start = prefix_start + prefix.len();
            let segment_end = result[segment_start..]
                .char_indices()
                .find_map(|(offset, character)| {
                    (character == '/'
                        || character == '%'
                        || character == '"'
                        || character == '\''
                        || character == '?'
                        || character == '#'
                        || character.is_whitespace())
                    .then_some(segment_start + offset)
                })
                .unwrap_or(result.len());
            if segment_end == segment_start {
                from = segment_start;
                continue;
            }
            result.replace_range(segment_start..segment_end, "[BANGUMI_USERNAME]");
            from = segment_start + "[BANGUMI_USERNAME]".len();
        }
    }
    result
}

fn redact_assigned_values(input: &str, key: &str) -> String {
    let mut result = input.to_string();
    let mut from = 0;

    while let Some(key_start) = find_ascii_case_insensitive(&result, key, from) {
        let key_end = key_start + key.len();
        let before_valid = result[..key_start]
            .chars()
            .next_back()
            .is_none_or(|character| !is_identity_char(character));
        if !before_valid {
            from = key_end;
            continue;
        }

        let mut cursor = key_end;
        if result[cursor..].starts_with(['"', '\'']) {
            cursor += 1;
        }
        while result[cursor..].starts_with(char::is_whitespace) {
            cursor += result[cursor..].chars().next().unwrap().len_utf8();
        }
        let Some(separator) = result[cursor..].chars().next() else {
            break;
        };
        if !matches!(separator, ':' | '=') {
            from = key_end;
            continue;
        }
        cursor += separator.len_utf8();
        while result[cursor..].starts_with(char::is_whitespace) {
            cursor += result[cursor..].chars().next().unwrap().len_utf8();
        }

        let quote = result[cursor..]
            .chars()
            .next()
            .filter(|character| matches!(character, '"' | '\''));
        if let Some(quote) = quote {
            cursor += quote.len_utf8();
        }
        let value_start = cursor;
        let value_end = result[value_start..]
            .char_indices()
            .find_map(|(offset, character)| {
                let terminates = quote.map_or_else(
                    || {
                        character.is_whitespace()
                            || matches!(character, '&' | ';' | ',' | '}' | ']')
                    },
                    |quote| character == quote,
                );
                terminates.then_some(value_start + offset)
            })
            .unwrap_or(result.len());

        if value_end > value_start {
            result.replace_range(value_start..value_end, REDACTED);
            from = value_start + REDACTED.len();
        } else {
            from = key_end;
        }
    }
    result
}

fn redact_bearer_tokens(input: &str) -> String {
    let mut result = input.to_string();
    let mut from = 0;
    while let Some(start) = find_ascii_case_insensitive(&result, "Bearer ", from) {
        let value_start = start + "Bearer ".len();
        let value_end = result[value_start..]
            .char_indices()
            .find_map(|(offset, character)| {
                (character.is_whitespace()
                    || matches!(character, '"' | '\'' | ',' | ';' | '}' | ']'))
                .then_some(value_start + offset)
            })
            .unwrap_or(result.len());
        result.replace_range(value_start..value_end, REDACTED);
        from = value_start + REDACTED.len();
    }
    result
}

fn is_sensitive_key(key: &str) -> bool {
    SENSITIVE_KEYS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(key))
}

fn sanitize_json_value(value: &mut serde_json::Value, context: &SanitizationContext) {
    match value {
        serde_json::Value::String(string) => *string = context.sanitize(string),
        serde_json::Value::Array(array) => {
            for item in array {
                sanitize_json_value(item, context);
            }
        }
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if is_sensitive_key(key) {
                    *value = serde_json::Value::String(REDACTED.to_string());
                } else {
                    sanitize_json_value(value, context);
                }
            }
        }
        _ => {}
    }
}

// ── Main command ────────────────────────────────────────────

#[tauri::command]
pub async fn export_diagnostics(
    app: tauri::AppHandle,
    frontend_errors: Option<Vec<String>>,
    frontend_log_stats: Option<FrontendLogStats>,
) -> Result<String, String> {
    let config = app.config();

    // 1. Collect environment info
    let now = time::OffsetDateTime::now_utc();
    let local_now =
        now.to_offset(time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC));

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
        app_version: config
            .version
            .clone()
            .unwrap_or_else(|| "0.0.0".to_string()),
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

    // 3. Capture auth health without exporting credentials or identity values.
    let (stored_token, auth_storage_error) = match crate::auth::load_token() {
        Ok(token) => (token, None),
        Err(error) => (None, Some(error)),
    };
    let authentication = AuthenticationInfo {
        storage_status: if auth_storage_error.is_some() {
            "error"
        } else if stored_token.is_some() {
            "loaded"
        } else {
            "empty"
        },
        source: stored_token.as_ref().map(|token| match token.source {
            crate::auth::TokenSource::PersonalAccessToken => "personal_access_token",
            crate::auth::TokenSource::OAuth => "oauth",
        }),
        expires_at: stored_token.as_ref().and_then(|token| token.expires_at),
        user_profile_available: stored_token
            .as_ref()
            .is_some_and(|token| token.user.is_some()),
        storage_error: auth_storage_error,
    };
    let current_user = stored_token.as_ref().and_then(|token| token.user.as_ref());
    let sanitization = SanitizationContext::new(current_user);

    // 4. Snapshot logs without clearing the buffer so repeated exports preserve context.
    let (raw_backend_logs, backend_dropped) = crate::snapshot_rust_logs();
    let sanitized_backend_logs: Vec<String> = raw_backend_logs
        .into_iter()
        .map(|line| sanitization.sanitize(&line))
        .collect();

    // 5. Sanitize frontend logs (console output, window errors and unhandled rejections).
    let sanitized_frontend_logs: Option<Vec<String>> = frontend_errors.map(|logs| {
        logs.into_iter()
            .map(|line| sanitization.sanitize(&line))
            .collect()
    });

    let frontend_retained = sanitized_frontend_logs.as_ref().map_or(0, Vec::len);
    let frontend_dropped = frontend_log_stats.as_ref().map_or(0, |stats| stats.dropped);
    let frontend_count_consistent = frontend_log_stats
        .as_ref()
        .is_none_or(|stats| stats.retained == frontend_retained);
    let frontend_capacity = frontend_log_stats
        .as_ref()
        .map_or(500, |stats| stats.capacity.max(1));
    let log_summary = LogSummary {
        backend: LogStats {
            retained: sanitized_backend_logs.len(),
            dropped: backend_dropped,
            capacity: crate::MAX_RUST_LOGS,
            truncated: backend_dropped > 0,
            count_consistent: true,
        },
        frontend: LogStats {
            retained: frontend_retained,
            dropped: frontend_dropped,
            capacity: frontend_capacity,
            truncated: frontend_dropped > 0,
            count_consistent: frontend_count_consistent,
        },
    };
    // 6. Build report
    let report = DiagnosticReport {
        schema_version: 2,
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
        authentication,
        network,
        log_summary,
        backend_logs: sanitized_backend_logs,
        frontend_logs: sanitized_frontend_logs,
        sanitization_note: "Secrets, authorization data, persistent device identifiers, OS user paths, and Bangumi user identity fields are automatically redacted. Log summary fields report retained and dropped entries so truncation is visible.".to_string(),
        disclaimer: "诊断信息用于排查软件运行异常。请不要将包含敏感信息的日志公开上传到公共讨论区。".to_string(),
    };

    // 5. Serialize to JSON
    let mut json_value = serde_json::to_value(&report)
        .map_err(|e| format!("Failed to serialize diagnostic report: {e}"))?;

    // Double-check sanitization on final JSON
    sanitize_json_value(&mut json_value, &sanitization);

    let json_str = serde_json::to_string_pretty(&json_value)
        .map_err(|e| format!("Failed to format diagnostic report: {e}"))?;

    // 6. Write to temp file
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;

    let diagnostics_dir = app_data_dir.join("diagnostics");
    std::fs::create_dir_all(&diagnostics_dir).map_err(|e| format!("无法创建诊断目录: {e}"))?;

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

    std::fs::write(&file_path, &json_str).map_err(|e| format!("无法写入诊断文件: {e}"))?;

    crate::log_info(&format!("Diagnostics exported to: {}", file_path.display()));

    Ok(file_path
        .to_str()
        .ok_or_else(|| "路径包含非 UTF-8 字符".to_string())?
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_os_username_from_path_variants() {
        let context = SanitizationContext::for_test(
            Some(r"C:\Users\Alice"),
            Some("/home/Alice"),
            &[("Alice", "[OS_USERNAME]")],
        );
        let samples = [
            r"C:\Users\Alice\AppData\Local\app.log",
            r#"{"path":"C:\\Users\\Alice\\app.log"}"#,
            "C:/Users/Alice/app.log",
            "%5CUsers%5CAlice%5Capp.log",
            "%2FUsers%2FAlice%2Fapp.log",
            "/home/Alice/.config/app.log",
        ];

        for sample in samples {
            let sanitized = context.sanitize(sample);
            assert!(
                !sanitized.to_ascii_lowercase().contains("alice"),
                "{sanitized}"
            );
        }
    }

    #[test]
    fn redacts_bangumi_identity_in_fields_and_paths() {
        let context = SanitizationContext::for_test(
            None,
            None,
            &[
                ("alice", "[BANGUMI_USERNAME]"),
                ("12345", "[BANGUMI_USER_ID]"),
                ("Alice Display", "[BANGUMI_NICKNAME]"),
            ],
        );
        let input = r#"username=alice nickname="Alice Display" path=/v0/users/alice/collections user_id=12345 unrelated=aliceblue"#;
        let sanitized = context.sanitize(input);

        assert!(sanitized.contains("username=[REDACTED]"));
        assert!(sanitized.contains("nickname=\"[REDACTED]\""));
        assert!(sanitized.contains("/users/[BANGUMI_USERNAME]/collections"));
        assert!(sanitized.contains("user_id=[REDACTED]"));
        assert!(sanitized.contains("unrelated=aliceblue"));
    }

    #[test]
    fn redacts_sensitive_values_across_log_formats() {
        let context = SanitizationContext::for_test(None, None, &[]);
        let input = r#"{"access_token":"json-secret"} refresh_token=query-secret&next=1 chii_auth=cookie-secret; Authorization: Bearer header-secret device_id=device-secret"#;
        let sanitized = context.sanitize(input);

        for secret in [
            "json-secret",
            "query-secret",
            "cookie-secret",
            "header-secret",
            "device-secret",
        ] {
            assert!(!sanitized.contains(secret), "{sanitized}");
        }
        assert!(sanitized.matches(REDACTED).count() >= 5, "{sanitized}");
    }

    #[test]
    fn final_json_pass_redacts_sensitive_keys_and_embedded_strings() {
        let context = SanitizationContext::for_test(
            Some(r"C:\Users\Alice"),
            None,
            &[("alice", "[BANGUMI_USERNAME]")],
        );
        let mut value = serde_json::json!({
            "access_token": "top-secret",
            "details": ["username=alice", r"C:\Users\Alice\app.log"]
        });

        sanitize_json_value(&mut value, &context);
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(!serialized.contains("top-secret"));
        assert!(!serialized.to_ascii_lowercase().contains("alice"));
    }
}
