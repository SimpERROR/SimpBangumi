mod auth;
mod bangumi;
mod diagnostics;
mod mal_scraper;
mod ratings;

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::Method;
use serde_json::Value;
use tauri::Manager;
use url::Url;

use auth::{
    AuthSession, OAuthAuthorizeUrl, OAuthFinishStatus, OAuthStartLoginRequest, WebCookieStatus,
};
use bangumi::{BangumiClient, BangumiUser};
use tauri::webview::PageLoadEvent;

struct ApiState {
    client: BangumiClient,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemAudioOutputStatus {
    muted: bool,
    volume: f32,
}

#[cfg(windows)]
#[tauri::command]
fn system_audio_output_status() -> Result<SystemAudioOutputStatus, String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| -> windows::core::Result<SystemAudioOutputStatus> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let endpoint = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let volume: IAudioEndpointVolume = endpoint.Activate(CLSCTX_ALL, None)?;
            Ok(SystemAudioOutputStatus {
                muted: volume.GetMute()?.as_bool(),
                volume: volume.GetMasterVolumeLevelScalar()?,
            })
        })();
        if initialized {
            CoUninitialize();
        }
        result.map_err(|error| format!("Unable to read system audio output: {error}"))
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn system_audio_output_status() -> Result<SystemAudioOutputStatus, String> {
    Err("System audio output detection is only available on Windows".to_string())
}

impl ApiState {
    fn new() -> Result<Self, String> {
        Ok(Self {
            client: BangumiClient::new()?,
        })
    }
}

const MAX_SAVED_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ANALYZED_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[tauri::command]
async fn bangumi_fetch_image_data_url(url: String) -> Result<String, String> {
    let parsed = Url::parse(&url).map_err(|error| format!("Invalid image URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS Bangumi images can be analyzed".to_string());
    }
    let host = parsed
        .host_str()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(host.as_str(), "lain.bgm.tv" | "lain.bangumi.tv" | "lain.chii.in") {
        return Err("Image host is not an allowed Bangumi image domain".to_string());
    }

    let response = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build image analysis client: {error}"))?
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("Failed to download image for analysis: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Image server returned an error: {error}"))?;

    if response
        .content_length()
        .is_some_and(|size| size > MAX_ANALYZED_IMAGE_BYTES)
    {
        return Err("Image is larger than the analysis limit".to_string());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("image/jpeg")
        .trim()
        .to_ascii_lowercase();
    if !matches!(content_type.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
        return Err("Unsupported image content type".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read image data: {error}"))?;
    if bytes.len() as u64 > MAX_ANALYZED_IMAGE_BYTES {
        return Err("Image is larger than the analysis limit".to_string());
    }
    Ok(format!(
        "data:{content_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

#[tauri::command]
async fn save_image_to_path(url: String, path: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("Invalid image URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS images can be saved".to_string());
    }

    let response = reqwest::Client::new()
        .get(parsed)
        .header(reqwest::header::USER_AGENT, "SimpBangumi/0.1")
        .send()
        .await
        .map_err(|error| format!("Failed to download image: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Image server returned an error: {error}"))?;

    if response
        .content_length()
        .is_some_and(|size| size > MAX_SAVED_IMAGE_BYTES)
    {
        return Err("Image is larger than the 50 MB limit".to_string());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read image data: {error}"))?;
    if bytes.len() as u64 > MAX_SAVED_IMAGE_BYTES {
        return Err("Image is larger than the 50 MB limit".to_string());
    }

    std::fs::write(path, &bytes).map_err(|error| format!("Failed to write image: {error}"))
}

#[tauri::command]
fn save_image_bytes_to_path(bytes: Vec<u8>, path: String) -> Result<(), String> {
    if bytes.len() as u64 > MAX_SAVED_IMAGE_BYTES {
        return Err("Image is larger than the 50 MB limit".to_string());
    }
    std::fs::write(path, bytes).map_err(|error| format!("Failed to write image: {error}"))
}

const WEB_LOGIN_WINDOW_LABEL: &str = "bangumi-web-login";
const WEB_COOKIE_RECOVERY_WINDOW_LABEL_PREFIX: &str = "bangumi-web-cookie-recovery";

fn allowed_bangumi_host(host: &str) -> bool {
    let normalized = host.trim().to_ascii_lowercase();
    normalized == "bangumi.tv"
        || normalized.ends_with(".bangumi.tv")
        || normalized == "bgm.tv"
        || normalized.ends_with(".bgm.tv")
        || normalized == "chii.in"
        || normalized.ends_with(".chii.in")
}

fn should_keep_cookie(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "chii_auth" | "chii_sid" | "chii_cookietime" | "chii_sec"
    )
}

fn parse_cookie_header_map(raw: &str) -> BTreeMap<String, String> {
    let mut cookies = BTreeMap::<String, String>::new();

    for part in raw.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut segments = trimmed.splitn(2, '=');
        let name = segments.next().unwrap_or("").trim();
        let value = segments.next().unwrap_or("").trim();

        if name.is_empty() || value.is_empty() {
            continue;
        }

        if should_keep_cookie(name) {
            cookies.insert(name.to_string(), value.to_string());
        }
    }

    cookies
}

fn parse_set_cookie_name_value(raw: &str) -> Option<(String, String)> {
    let first = raw.split(';').next()?.trim();
    if first.is_empty() {
        return None;
    }

    let mut segments = first.splitn(2, '=');
    let name = segments.next()?.trim();
    let value = segments.next().unwrap_or("").trim();

    if name.is_empty() {
        return None;
    }

    Some((name.to_string(), value.to_string()))
}

fn page_shows_auth_buttons(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let has_login_link = lower.contains("href=\"/login\"") || lower.contains("href='/login'");
    let has_signup_link = lower.contains("href=\"/signup\"") || lower.contains("href='/signup'");
    let has_login_text =
        html.contains("登录") || lower.contains(">log in<") || lower.contains(">login<");
    let has_signup_text =
        html.contains("注册") || lower.contains(">sign up<") || lower.contains(">signup<");

    (has_login_link && has_signup_link)
        || (has_login_link && has_login_text)
        || (has_signup_link && has_signup_text)
}

fn format_backend_log(level: &str, message: &str) -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "[{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z][tauri]{level} {message}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond(),
    )
}

fn page_shows_web_verification(html: &str) -> bool {
    html.contains("cf-chl-") || html.contains("Enable JavaScript and cookies")
}

fn decode_html_url(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&#x26;", "&")
}

fn find_mono_collection_action(
    html: &str,
    mono_type: &str,
    mono_id: u64,
    collected: bool,
) -> Option<String> {
    let action = if collected {
        "collect"
    } else {
        "erase_collect"
    };
    let marker = format!("/{mono_type}/{mono_id}/{action}");
    let start = html.find(&marker)?;
    let tail = &html[start..];
    let end = tail
        .find(|character: char| {
            character.is_ascii_whitespace() || matches!(character, '\"' | '\'' | '<' | '>')
        })
        .unwrap_or(tail.len());
    let candidate = decode_html_url(&tail[..end]);

    // The web action is protected by Bangumi's per-session form hash.
    if candidate.contains("gh=") {
        Some(candidate)
    } else {
        None
    }
}

fn find_index_collection_action(html: &str, index_id: u64, collected: bool) -> Option<String> {
    let action = if collected {
        "collect"
    } else {
        "erase_collect"
    };
    let marker = format!("/index/{index_id}/{action}");
    let start = html.find(&marker)?;
    let tail = &html[start..];
    let end = tail
        .find(|character: char| {
            character.is_ascii_whitespace() || matches!(character, '\"' | '\'' | '<' | '>')
        })
        .unwrap_or(tail.len());
    let candidate = decode_html_url(&tail[..end]);

    candidate.contains("gh=").then_some(candidate)
}

fn html_attribute(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let attribute = attribute.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut search_from = 0;

    while let Some(relative_start) = lower[search_from..].find(&attribute) {
        let start = search_from + relative_start;
        let before_is_boundary =
            start == 0 || bytes[start - 1].is_ascii_whitespace() || bytes[start - 1] == b'<';
        let mut cursor = start + attribute.len();
        let after_is_boundary =
            cursor == bytes.len() || bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'=';
        if !before_is_boundary || !after_is_boundary {
            search_from = start + attribute.len();
            continue;
        }
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            search_from = start + attribute.len();
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let quote = *bytes.get(cursor)?;
        if quote != b'\'' && quote != b'"' {
            return None;
        }
        cursor += 1;
        let end = bytes[cursor..].iter().position(|byte| *byte == quote)? + cursor;
        return Some(decode_html_url(&tag[cursor..end]));
    }

    None
}

fn find_index_related_form(html: &str, index_id: u64, category: &str) -> Option<(String, String)> {
    let expected_action = format!("/index/{index_id}/add_related");

    html.match_indices("<form").find_map(|(start, _)| {
        let tail = &html[start..];
        let end = tail.find("</form>")? + 7;
        let form = &tail[..end];
        let opening_end = form.find('>')? + 1;
        let action = html_attribute(&form[..opening_end], "action")?;
        if action != expected_action {
            return None;
        }

        let mut formhash = None;
        let mut matches_category = false;
        for (input_start, _) in form.match_indices("<input") {
            let input_tail = &form[input_start..];
            let input_end = input_tail.find('>')? + 1;
            let input = &input_tail[..input_end];
            match html_attribute(input, "name").as_deref() {
                Some("formhash") => formhash = html_attribute(input, "value"),
                Some("cat") => {
                    matches_category = html_attribute(input, "value").as_deref() == Some(category)
                }
                _ => {}
            }
        }

        if matches_category {
            Some((action, formhash?))
        } else {
            None
        }
    })
}

#[cfg(test)]
mod mono_collection_action_tests {
    use super::{
        find_index_collection_action, find_index_related_form, find_mono_collection_action,
    };

    #[test]
    fn extracts_character_uncollect_action_and_decodes_query_separator() {
        let html = r#"<a href="/character/13369/erase_collect?gh=abc&amp;ajax=1">取消收藏</a>"#;

        assert_eq!(
            find_mono_collection_action(html, "character", 13369, false).as_deref(),
            Some("/character/13369/erase_collect?gh=abc&ajax=1")
        );
    }

    #[test]
    fn extracts_person_collect_action_without_matching_other_ids() {
        let html = r#"<a href='/person/42/collect?gh=secret'>收藏人物</a>"#;

        assert_eq!(
            find_mono_collection_action(html, "person", 42, true).as_deref(),
            Some("/person/42/collect?gh=secret")
        );
        assert!(find_mono_collection_action(html, "person", 41, true).is_none());
    }

    #[test]
    fn rejects_action_without_form_hash() {
        let html = r#"<a href="/character/13369/erase_collect">取消收藏</a>"#;

        assert!(find_mono_collection_action(html, "character", 13369, false).is_none());
    }

    #[test]
    fn extracts_index_uncollect_action() {
        let html = r#"<a href="/index/90607/erase_collect?gh=abc&amp;ajax=1">取消收藏</a>"#;

        assert_eq!(
            find_index_collection_action(html, 90607, false).as_deref(),
            Some("/index/90607/erase_collect?gh=abc&ajax=1")
        );
    }

    #[test]
    fn extracts_character_and_person_index_related_forms() {
        let html = r#"
            <form method="post" action="/index/101917/add_related">
                <input type="hidden" name="formhash" value="secret" />
                <input type="hidden" name ="cat" value="1" />
                <input name="add_related" type="text" />
            </form>
            <form method="post" action="/index/101917/add_related">
                <input type="hidden" name="formhash" value="secret" />
                <input type="hidden" name ="cat" value="2" />
                <input name="add_related" type="text" />
            </form>
        "#;
        assert_eq!(
            find_index_related_form(html, 101917, "1"),
            Some((
                "/index/101917/add_related".to_string(),
                "secret".to_string()
            ))
        );
        assert_eq!(
            find_index_related_form(html, 101917, "2"),
            Some((
                "/index/101917/add_related".to_string(),
                "secret".to_string()
            ))
        );
        assert!(find_index_related_form(html, 101917, "3").is_none());
        assert!(find_index_related_form(html, 101918, "1").is_none());
    }
}

pub(crate) fn log_info(message: &str) {
    let formatted = format_backend_log("", message);
    push_rust_log(formatted.clone());
    eprintln!("{formatted}");
}

pub(crate) fn log_error(message: &str) {
    let formatted = format_backend_log("[error]", message);
    push_rust_log(formatted.clone());
    eprintln!("{formatted}");
}

// ── Rust backend log buffer for diagnostics ──────────────

use std::sync::Mutex;

struct RustLogBuffer {
    lines: Vec<String>,
    dropped: usize,
}

static RUST_LOG_BUFFER: Mutex<RustLogBuffer> = Mutex::new(RustLogBuffer {
    lines: Vec::new(),
    dropped: 0,
});
pub(crate) const MAX_RUST_LOGS: usize = 500;

fn push_rust_log(line: String) {
    if let Ok(mut buffer) = RUST_LOG_BUFFER.lock() {
        if buffer.lines.len() >= MAX_RUST_LOGS {
            buffer.lines.remove(0);
            buffer.dropped += 1;
        }
        buffer.lines.push(line);
    }
}

pub(crate) fn snapshot_rust_logs() -> (Vec<String>, usize) {
    let buffer = RUST_LOG_BUFFER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    (buffer.lines.clone(), buffer.dropped)
}

/// Send a GET request with the given Cookie header, manually following redirects
/// while re-attaching the Cookie header on every hop. This avoids reqwest's default
/// behaviour of stripping the Cookie header on cross-domain redirects (e.g.
/// bangumi.tv → bgm.tv), which would cause false "cookie expired" results.
async fn fetch_with_cookie_redirect(
    client: &reqwest::Client,
    initial_url: &str,
    cookie: &str,
) -> Result<reqwest::Response, String> {
    let mut url = initial_url.to_string();

    for _ in 0..8 {
        let response = client
            .get(&url)
            .header(reqwest::header::COOKIE, cookie)
            .send()
            .await
            .map_err(|error| format!("Failed to request {url}: {error}"))?;

        let status = response.status();
        if !status.is_redirection() {
            return Ok(response);
        }

        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Redirect without Location header from {url}"))?;

        let base = Url::parse(&url).map_err(|error| format!("Invalid base URL {url}: {error}"))?;
        let next_url = base
            .join(&location)
            .map_err(|error| format!("Invalid redirect location {location}: {error}"))?;

        let Some(host) = next_url.host_str() else {
            return Err("Cookie redirect target has no host".to_string());
        };
        if next_url.scheme() != "https" || !allowed_bangumi_host(host) {
            return Err(
                "Refusing to forward Bangumi Cookie to an untrusted redirect target".to_string(),
            );
        }
        url = next_url.to_string();
    }

    Err("Too many redirects while fetching with cookie".to_string())
}

async fn validate_cookie_header_against_bangumi(cookie: &str) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build cookie validation HTTP client: {error}"))?;

    let response = fetch_with_cookie_redirect(&client, "https://bgm.tv/", cookie).await?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read cookie validation page body: {error}"))?;

    if !status.is_success() {
        return Err(format!("Cookie validation page returned {status}: {body}"));
    }

    Ok(!page_shows_auth_buttons(&body))
}

async fn capture_cookie_header_from_window(
    webview_window: tauri::WebviewWindow,
) -> Result<String, String> {
    let webview_window_for_read = webview_window.clone();

    let cookies = tauri::async_runtime::spawn_blocking(move || webview_window_for_read.cookies())
        .await
        .map_err(|error| format!("Failed to wait cookie reading task: {error}"))?
        .map_err(|error| format!("Failed to read webview cookies: {error}"))?;

    let mut selected = BTreeMap::<String, String>::new();

    for cookie in cookies {
        let name = cookie.name().trim().to_string();
        let value = cookie.value().trim().to_string();
        if name.is_empty() || value.is_empty() {
            continue;
        }

        if !should_keep_cookie(&name) {
            continue;
        }

        if let Some(domain) = cookie.domain() {
            let cleaned = domain.trim_start_matches('.');
            if !allowed_bangumi_host(cleaned) {
                continue;
            }
        }

        selected.insert(name, value);
    }

    if selected.is_empty() {
        return Err("未捕获到可用的 Bangumi 登录 Cookie。".to_string());
    }

    Ok(selected
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; "))
}

async fn open_hidden_bangumi_cookie_recovery_window(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, String> {
    let label = format!(
        "{}-{}",
        WEB_COOKIE_RECOVERY_WINDOW_LABEL_PREFIX,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Failed to resolve current time: {error}"))?
            .as_millis()
    );

    let page_url = Url::parse("https://bangumi.tv/")
        .map_err(|error| format!("Failed to build recovery URL: {error}"))?;

    let (sender, receiver) = std::sync::mpsc::sync_channel::<()>(1);
    let signal = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
    let signal_for_page_load = signal.clone();

    let window =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(page_url))
            .title("Bangumi 会话恢复")
            .inner_size(980.0, 760.0)
            .resizable(true)
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .on_navigation(|url| {
                if matches!(url.scheme(), "http" | "https") {
                    if let Some(host) = url.host_str() {
                        return allowed_bangumi_host(host);
                    }
                }

                false
            })
            .on_page_load(move |_window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }

                let Some(host) = payload.url().host_str() else {
                    return;
                };

                if !allowed_bangumi_host(host) {
                    return;
                }

                if let Ok(mut guard) = signal_for_page_load.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(());
                    }
                }
            })
            .build()
            .map_err(|error| format!("Failed to open hidden Bangumi recovery window: {error}"))?;

    let wait_result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(15))
    })
    .await
    .map_err(|error| format!("Failed to wait for recovery page load task: {error}"))?;

    match wait_result {
        Ok(()) => Ok(window),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            let _ = window.close();
            Err("等待应用内网页登录会话加载超时，无法自动恢复 Cookie。".to_string())
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            let _ = window.close();
            Err("应用内网页登录会话加载被中断，无法自动恢复 Cookie。".to_string())
        }
    }
}

async fn restore_web_cookie_from_embedded_session_impl(
    app: tauri::AppHandle,
) -> Result<WebCookieStatus, String> {
    let (window, should_close_after_capture) = match app.get_webview_window(WEB_LOGIN_WINDOW_LABEL)
    {
        Some(existing) => (existing, false),
        None => (
            open_hidden_bangumi_cookie_recovery_window(&app).await?,
            true,
        ),
    };

    let captured = capture_cookie_header_from_window(window.clone()).await;

    if should_close_after_capture {
        let _ = window.close();
    }

    let header = captured?;
    let valid = validate_cookie_header_against_bangumi(&header).await?;
    if !valid {
        return Err(
            "应用内网页登录会话当前未检测到有效登录状态，无法自动恢复 Cookie。".to_string(),
        );
    }

    auth::save_web_cookie(header)
}

#[derive(serde::Serialize)]
struct WebCookieValidationStatus {
    configured: bool,
    valid: bool,
    reason: Option<String>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! Rust command is available.")
}

#[tauri::command]
fn bangumi_oauth_start_login(
    request: Option<OAuthStartLoginRequest>,
) -> Result<OAuthAuthorizeUrl, String> {
    log_info("invoke bangumi_oauth_start_login");
    let state = request.and_then(|value| value.state);
    auth::start_oauth_login(state)
}

#[tauri::command]
async fn bangumi_login_with_pat(
    state: tauri::State<'_, ApiState>,
    token: String,
) -> Result<AuthSession, String> {
    auth::login_with_personal_access_token(&state.client, token).await
}

#[tauri::command]
async fn bangumi_oauth_finish_login(
    state: tauri::State<'_, ApiState>,
) -> Result<OAuthFinishStatus, String> {
    auth::finish_oauth_login(&state.client).await
}

#[tauri::command]
async fn bangumi_refresh_oauth_session(
    state: tauri::State<'_, ApiState>,
) -> Result<AuthSession, String> {
    auth::refresh_saved_oauth_session_if_current(&state.client, None).await
}

#[tauri::command]
fn bangumi_auth_session() -> Result<AuthSession, String> {
    log_info("invoke bangumi_auth_session");
    let token = auth::load_token()?;
    Ok(auth::session_from_token(token.as_deref()))
}

#[tauri::command]
fn bangumi_logout() -> Result<AuthSession, String> {
    auth::delete_token()?;
    Ok(auth::session_from_token(None))
}

#[tauri::command]
async fn bangumi_get_me(state: tauri::State<'_, ApiState>) -> Result<BangumiUser, String> {
    let token =
        auth::load_token()?.ok_or_else(|| "No Bangumi token stored. Login first.".to_string())?;
    state.client.me(&token.access_token).await
}

#[tauri::command]
async fn bangumi_api_get(
    state: tauri::State<'_, ApiState>,
    path: String,
    query: Option<BTreeMap<String, String>>,
) -> Result<Value, String> {
    log_info(&format!("invoke bangumi_api_get path={path}"));
    let token = auth::load_token()?;
    let access_token = token.as_deref().map(|token| token.access_token.as_str());
    let first_attempt = state
        .client
        .request_json(Method::GET, &path, query.clone(), None, access_token)
        .await;

    match first_attempt {
        Ok(value) => {
            log_info(&format!("bangumi_api_get success path={path}"));
            Ok(value)
        }
        Err(error) if auth::is_auth_error(&error) => {
            log_error(&format!(
                "bangumi_api_get auth failure path={path}: {error}"
            ));
            auth::refresh_saved_oauth_session_if_current(&state.client, access_token).await?;
            let refreshed = auth::load_token()?;
            let refreshed_access_token = refreshed
                .as_deref()
                .map(|token| token.access_token.as_str());
            log_info(&format!(
                "retrying bangumi_api_get after refresh path={path}"
            ));
            state
                .client
                .request_json(Method::GET, &path, query, None, refreshed_access_token)
                .await
        }
        Err(error) => {
            log_error(&format!("bangumi_api_get failed path={path}: {error}"));
            Err(error)
        }
    }
}

#[tauri::command]
async fn bangumi_api_request(
    state: tauri::State<'_, ApiState>,
    method: String,
    path: String,
    query: Option<BTreeMap<String, String>>,
    body: Option<Value>,
) -> Result<Value, String> {
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    log_info(&format!(
        "invoke bangumi_api_request method={} path={}",
        method.as_str(),
        path
    ));

    let token = auth::load_token()?;
    let access_token = token.as_deref().map(|token| token.access_token.as_str());
    let first_attempt = state
        .client
        .request_json(
            method.clone(),
            &path,
            query.clone(),
            body.clone(),
            access_token,
        )
        .await;

    match first_attempt {
        Ok(value) => {
            log_info(&format!(
                "bangumi_api_request success method={} path={}",
                method.as_str(),
                path
            ));
            Ok(value)
        }
        Err(error) if auth::is_auth_error(&error) => {
            log_error(&format!(
                "bangumi_api_request auth failure method={} path={}: {}",
                method.as_str(),
                path,
                error
            ));
            auth::refresh_saved_oauth_session_if_current(&state.client, access_token).await?;
            let refreshed = auth::load_token()?;
            let refreshed_access_token = refreshed
                .as_deref()
                .map(|token| token.access_token.as_str());
            log_info(&format!(
                "retrying bangumi_api_request after refresh method={} path={}",
                method.as_str(),
                path
            ));
            state
                .client
                .request_json(method, &path, query, body, refreshed_access_token)
                .await
        }
        Err(error) => {
            log_error(&format!(
                "bangumi_api_request failed method={} path={}: {}",
                method.as_str(),
                path,
                error
            ));
            Err(error)
        }
    }
}

#[tauri::command]
async fn bangumi_fetch_subject_comments_page(
    subject_id: u64,
    interest_type: Option<String>,
    page: Option<u32>,
) -> Result<String, String> {
    let mut url = Url::parse(&format!("https://bangumi.tv/subject/{subject_id}/comments"))
        .map_err(|error| format!("Failed to build comments URL: {error}"))?;

    {
        let mut query = url.query_pairs_mut();

        if let Some(value) = interest_type.as_deref() {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                query.append_pair("interest_type", trimmed);
            }
        }

        if let Some(page) = page {
            if page > 1 {
                query.append_pair("page", &page.to_string());
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build comments HTTP client: {error}"))?;

    let mut request = client.get(url);
    match auth::load_web_cookie() {
        Ok(Some(cookie)) => {
            request = request.header(reqwest::header::COOKIE, cookie);
        }
        Ok(None) => {}
        Err(error) => {
            return Err(format!("Failed to load saved web cookie: {error}"));
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to fetch subject comments page: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read comments page body: {error}"))?;

    if !status.is_success() {
        return Err(format!("Comments page returned {status}: {body}"));
    }

    Ok(body)
}

#[tauri::command]
async fn bangumi_fetch_mono_comments_page(
    mono_type: String,
    mono_id: u64,
    page: Option<u32>,
) -> Result<String, String> {
    let normalized_type = mono_type.trim().to_ascii_lowercase();
    if normalized_type != "character" && normalized_type != "person" {
        return Err("Unsupported mono type. Expected 'character' or 'person'.".to_string());
    }

    let mut url = Url::parse(&format!("https://bangumi.tv/{normalized_type}/{mono_id}"))
        .map_err(|error| format!("Failed to build mono comments URL: {error}"))?;

    if let Some(page) = page {
        if page > 1 {
            url.query_pairs_mut().append_pair("page", &page.to_string());
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build mono comments HTTP client: {error}"))?;

    let mut request = client.get(url);
    match auth::load_web_cookie() {
        Ok(Some(cookie)) => {
            request = request.header(reqwest::header::COOKIE, cookie);
        }
        Ok(None) => {}
        Err(error) => {
            return Err(format!("Failed to load saved web cookie: {error}"));
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to fetch mono comments page: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read mono comments page body: {error}"))?;

    if !status.is_success() {
        return Err(format!("Mono comments page returned {status}: {body}"));
    }

    Ok(body)
}

#[tauri::command]
async fn bangumi_set_mono_collected(
    mono_type: String,
    mono_id: u64,
    collected: bool,
) -> Result<(), String> {
    if mono_id == 0 {
        return Err("Invalid mono ID.".to_string());
    }
    let normalized_type = match mono_type.trim().to_ascii_lowercase().as_str() {
        "character" => "character",
        "person" => "person",
        _ => return Err("Unsupported mono type. Expected 'character' or 'person'.".to_string()),
    };
    let cookie = auth::load_web_cookie()?.ok_or_else(|| {
        "No saved Bangumi web cookie. Log in on the web settings page first.".to_string()
    })?;
    let detail_url = Url::parse(&format!("https://bangumi.tv/{normalized_type}/{mono_id}"))
        .map_err(|error| format!("Failed to build mono detail URL: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build mono collection HTTP client: {error}"))?;

    let detail_response = fetch_with_cookie_redirect(&client, detail_url.as_str(), &cookie).await?;
    let detail_status = detail_response.status();
    let detail_body = detail_response
        .text()
        .await
        .map_err(|error| format!("Failed to read mono detail page: {error}"))?;
    if !detail_status.is_success() {
        return Err(format!(
            "Mono detail page returned {detail_status}: {detail_body}"
        ));
    }
    if page_shows_web_verification(&detail_body) {
        return Err("Bangumi web verification blocked the collection request.".to_string());
    }
    if page_shows_auth_buttons(&detail_body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }

    let Some(action_path) =
        find_mono_collection_action(&detail_body, normalized_type, mono_id, collected)
    else {
        // This command currently backs the API's broken DELETE routes. If an
        // authenticated detail page no longer exposes erase_collect, the
        // requested uncollected state has already been reached.
        if !collected {
            return Ok(());
        }
        return Err(
            "Bangumi did not expose a collection action on the mono detail page.".to_string(),
        );
    };

    let action_url = detail_url
        .join(&action_path)
        .map_err(|error| format!("Invalid mono collection action URL: {error}"))?;
    let action_host = action_url
        .host_str()
        .ok_or_else(|| "Mono collection action URL has no host.".to_string())?;
    if !allowed_bangumi_host(action_host) {
        return Err("Bangumi returned an unsafe collection action URL.".to_string());
    }

    let action_response = fetch_with_cookie_redirect(&client, action_url.as_str(), &cookie).await?;
    let action_status = action_response.status();
    let action_body = action_response
        .text()
        .await
        .map_err(|error| format!("Failed to read mono collection response: {error}"))?;
    if !action_status.is_success() {
        return Err(format!(
            "Mono collection action returned {action_status}: {action_body}"
        ));
    }
    if page_shows_web_verification(&action_body) {
        return Err("Bangumi web verification blocked the collection action.".to_string());
    }
    if page_shows_auth_buttons(&action_body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }

    Ok(())
}

#[tauri::command]
async fn bangumi_set_index_collected(index_id: u64, collected: bool) -> Result<(), String> {
    if index_id == 0 {
        return Err("Invalid index ID.".to_string());
    }
    let cookie = auth::load_web_cookie()?.ok_or_else(|| {
        "No saved Bangumi web cookie. Log in on the web settings page first.".to_string()
    })?;
    let detail_url = Url::parse(&format!("https://bangumi.tv/index/{index_id}"))
        .map_err(|error| format!("Failed to build index detail URL: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build index collection HTTP client: {error}"))?;

    let detail_response = fetch_with_cookie_redirect(&client, detail_url.as_str(), &cookie).await?;
    let detail_status = detail_response.status();
    let detail_body = detail_response
        .text()
        .await
        .map_err(|error| format!("Failed to read index detail page: {error}"))?;
    if !detail_status.is_success() {
        return Err(format!(
            "Index detail page returned {detail_status}: {detail_body}"
        ));
    }
    if page_shows_web_verification(&detail_body) {
        return Err("Bangumi web verification blocked the index collection request.".to_string());
    }
    if page_shows_auth_buttons(&detail_body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }

    let Some(action_path) = find_index_collection_action(&detail_body, index_id, collected) else {
        if !collected {
            return Ok(());
        }
        return Err(
            "Bangumi did not expose an index collection action on the detail page.".to_string(),
        );
    };
    let action_url = detail_url
        .join(&action_path)
        .map_err(|error| format!("Invalid index collection action URL: {error}"))?;
    let action_host = action_url
        .host_str()
        .ok_or_else(|| "Index collection action URL has no host.".to_string())?;
    if !allowed_bangumi_host(action_host) {
        return Err("Bangumi returned an unsafe index collection action URL.".to_string());
    }

    let action_response = fetch_with_cookie_redirect(&client, action_url.as_str(), &cookie).await?;
    let action_status = action_response.status();
    let action_body = action_response
        .text()
        .await
        .map_err(|error| format!("Failed to read index collection response: {error}"))?;
    if !action_status.is_success() {
        return Err(format!(
            "Index collection action returned {action_status}: {action_body}"
        ));
    }
    if page_shows_web_verification(&action_body) {
        return Err("Bangumi web verification blocked the index collection action.".to_string());
    }
    if page_shows_auth_buttons(&action_body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }

    Ok(())
}

#[tauri::command]
async fn bangumi_add_index_entity(
    index_id: u64,
    entity_type: String,
    entity_id: u64,
) -> Result<(), String> {
    if index_id == 0 || entity_id == 0 {
        return Err("Invalid directory item ID.".to_string());
    }
    let (category, submit_label) = match entity_type.trim().to_ascii_lowercase().as_str() {
        "character" => ("1", "添加角色关联"),
        "person" => ("2", "添加人物关联"),
        _ => return Err("Unsupported directory item type.".to_string()),
    };
    let cookie = auth::load_web_cookie()?.ok_or_else(|| {
        "No saved Bangumi web cookie. Log in on the web settings page first.".to_string()
    })?;
    let index_url = Url::parse(&format!("https://bangumi.tv/index/{index_id}"))
        .map_err(|error| format!("Failed to build directory URL: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build index entity HTTP client: {error}"))?;

    let index_response = fetch_with_cookie_redirect(&client, index_url.as_str(), &cookie).await?;
    let index_status = index_response.status();
    let index_body = index_response
        .text()
        .await
        .map_err(|error| format!("Failed to read directory page: {error}"))?;
    if !index_status.is_success() {
        return Err(format!(
            "Directory page returned {index_status}: {index_body}"
        ));
    }
    if page_shows_web_verification(&index_body) {
        return Err("Bangumi web verification blocked the directory request.".to_string());
    }
    if page_shows_auth_buttons(&index_body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }

    let (action_path, formhash) = find_index_related_form(&index_body, index_id, category)
        .ok_or_else(|| "该 Bangumi 目录不可编辑，或没有提供添加关联表单。".to_string())?;
    let action_url = index_url
        .join(&action_path)
        .map_err(|error| format!("Invalid add-to-directory URL: {error}"))?;
    let action_host = action_url
        .host_str()
        .ok_or_else(|| "Directory action URL has no host.".to_string())?;
    if !allowed_bangumi_host(action_host) {
        return Err("Bangumi returned an unsafe directory action URL.".to_string());
    }

    let response = client
        .post(action_url.as_str())
        .header(reqwest::header::COOKIE, &cookie)
        .form(&[
            ("formhash", formhash.as_str()),
            ("cat", category),
            ("add_related", &entity_id.to_string()),
            ("submit", submit_label),
        ])
        .send()
        .await
        .map_err(|error| format!("Failed to add directory relation: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read directory item response: {error}"))?;
    if !status.is_success() && !status.is_redirection() {
        return Err(format!("Directory item action returned {status}: {body}"));
    }
    if page_shows_web_verification(&body) {
        return Err("Bangumi web verification blocked the directory action.".to_string());
    }
    if page_shows_auth_buttons(&body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
async fn bangumi_fetch_user_indices_page(
    username: String,
    collected: bool,
    page: Option<u32>,
) -> Result<String, String> {
    let normalized_username = username.trim();
    if normalized_username.is_empty() || normalized_username.len() > 64 {
        return Err("Invalid Bangumi username.".to_string());
    }

    let mut url = Url::parse("https://bangumi.tv/")
        .map_err(|error| format!("Failed to build user indices URL: {error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Failed to build user indices path.".to_string())?;
        segments
            .push("user")
            .push(normalized_username)
            .push("index");
        if collected {
            segments.push("collect");
        }
    }
    if let Some(page) = page {
        if page > 1 {
            url.query_pairs_mut().append_pair("page", &page.to_string());
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build user indices HTTP client: {error}"))?;
    let mut request = client.get(url);
    match auth::load_web_cookie() {
        Ok(Some(cookie)) => request = request.header(reqwest::header::COOKIE, cookie),
        Ok(None) => {}
        Err(error) => return Err(format!("Failed to load saved web cookie: {error}")),
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to fetch user indices page: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read user indices page: {error}"))?;
    if !status.is_success() {
        return Err(format!("User indices page returned {status}: {body}"));
    }
    if body.contains("cf-chl-") || body.contains("Enable JavaScript and cookies") {
        return Err("Bangumi web verification blocked the directory list request.".to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn bangumi_fetch_index_page(index_id: u64) -> Result<String, String> {
    if index_id == 0 {
        return Err("Invalid index ID.".to_string());
    }
    let cookie = auth::load_web_cookie()?.ok_or_else(|| {
        "No saved Bangumi web cookie. Log in on the web settings page first.".to_string()
    })?;
    let url = Url::parse(&format!("https://bangumi.tv/index/{index_id}"))
        .map_err(|error| format!("Failed to build directory URL: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build directory HTTP client: {error}"))?;
    let response = fetch_with_cookie_redirect(&client, url.as_str(), &cookie).await?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read directory page: {error}"))?;
    if !status.is_success() {
        return Err(format!("Directory page returned {status}: {body}"));
    }
    if page_shows_web_verification(&body) {
        return Err("Bangumi web verification blocked the directory request.".to_string());
    }
    if page_shows_auth_buttons(&body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }
    Ok(body)
}

#[tauri::command]
async fn bangumi_fetch_subject_page(subject_id: u64) -> Result<String, String> {
    if subject_id == 0 {
        return Err("Invalid subject ID.".to_string());
    }
    let cookie = auth::load_web_cookie()?.ok_or_else(|| {
        "No saved Bangumi web cookie. Log in on the web settings page first.".to_string()
    })?;
    let url = Url::parse(&format!("https://bangumi.tv/subject/{subject_id}"))
        .map_err(|error| format!("Failed to build subject URL: {error}"))?;
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build subject HTTP client: {error}"))?;
    let response = fetch_with_cookie_redirect(&client, url.as_str(), &cookie).await?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read subject page: {error}"))?;
    if !status.is_success() {
        return Err(format!("Subject page returned {status}: {body}"));
    }
    if page_shows_web_verification(&body) {
        return Err("Bangumi web verification blocked the subject request.".to_string());
    }
    if page_shows_auth_buttons(&body) {
        return Err(
            "The saved Bangumi web cookie has expired. Log in on the web settings page again."
                .to_string(),
        );
    }
    Ok(body)
}

#[tauri::command]
async fn bangumi_fetch_anime_browser_page(sort: String, page: u32) -> Result<String, String> {
    if !matches!(sort.as_str(), "trends" | "rank") {
        return Err("Invalid anime browser sort mode.".to_string());
    }
    if !(1..=3).contains(&page) {
        return Err("Invalid anime browser page.".to_string());
    }
    let mut url = Url::parse("https://bangumi.tv/anime/browser/")
        .map_err(|error| format!("Failed to build anime browser URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("sort", &sort)
        .append_pair("page", &page.to_string());
    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build anime browser HTTP client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch anime browser page: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read anime browser page: {error}"))?;
    if !status.is_success() {
        return Err(format!("Anime browser page returned {status}."));
    }
    if page_shows_web_verification(&body) {
        return Err("Bangumi web verification blocked the anime browser request.".to_string());
    }
    Ok(body)
}
#[tauri::command]
async fn bangumi_fetch_user_mono_collections_page(
    username: String,
    mono_type: String,
    page: Option<u32>,
) -> Result<String, String> {
    let normalized_username = username.trim();
    if normalized_username.is_empty() || normalized_username.len() > 64 {
        return Err("Invalid Bangumi username.".to_string());
    }
    let normalized_type = match mono_type.as_str() {
        "character" => "character",
        "person" => "person",
        _ => return Err("Invalid mono collection type.".to_string()),
    };

    let mut url = Url::parse("https://bangumi.tv/")
        .map_err(|error| format!("Failed to build mono collections URL: {error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Failed to build mono collections path.".to_string())?;
        segments
            .push("user")
            .push(normalized_username)
            .push("mono")
            .push(normalized_type);
    }
    if let Some(page) = page {
        if page > 1 {
            url.query_pairs_mut().append_pair("page", &page.to_string());
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("Failed to build mono collections HTTP client: {error}"))?;
    let mut request = client.get(url);
    match auth::load_web_cookie() {
        Ok(Some(cookie)) => request = request.header(reqwest::header::COOKIE, cookie),
        Ok(None) => {}
        Err(error) => return Err(format!("Failed to load saved web cookie: {error}")),
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to fetch mono collections page: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read mono collections page: {error}"))?;
    if !status.is_success() {
        return Err(format!("Mono collections page returned {status}: {body}"));
    }
    if body.contains("cf-chl-") || body.contains("Enable JavaScript and cookies") {
        return Err("Bangumi web verification blocked the mono collections request.".to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn bangumi_open_embedded_web_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WEB_LOGIN_WINDOW_LABEL) {
        existing
            .set_focus()
            .map_err(|error| format!("Failed to focus web login window: {error}"))?;
        return Ok(());
    }

    let login_url = Url::parse("https://bangumi.tv/login")
        .map_err(|error| format!("Failed to build login URL: {error}"))?;

    tauri::WebviewWindowBuilder::new(
        &app,
        WEB_LOGIN_WINDOW_LABEL,
        tauri::WebviewUrl::External(login_url),
    )
    .title("Bangumi 网页登录")
    .inner_size(980.0, 760.0)
    .resizable(true)
    .on_navigation(|url| {
        if matches!(url.scheme(), "http" | "https") {
            if let Some(host) = url.host_str() {
                return allowed_bangumi_host(host);
            }
        }

        false
    })
    .build()
    .map_err(|error| format!("Failed to open embedded web login window: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn bangumi_capture_embedded_web_cookie(
    app: tauri::AppHandle,
) -> Result<WebCookieStatus, String> {
    let webview_window = app
        .get_webview_window(WEB_LOGIN_WINDOW_LABEL)
        .ok_or_else(|| {
            "未找到网页登录窗口，请先点击“应用内登录并自动获取”并保持其开启。".to_string()
        })?;

    let header = capture_cookie_header_from_window(webview_window.clone())
        .await
        .map_err(|_| "未捕获到登录 Cookie，请确认已在窗口内完成登录并保持窗口开启。".to_string())?;

    let status = auth::save_web_cookie(header)?;

    let _ = webview_window.close();

    Ok(status)
}

#[tauri::command]
fn bangumi_web_cookie_status() -> Result<WebCookieStatus, String> {
    auth::web_cookie_status()
}

#[tauri::command]
fn bangumi_save_web_cookie(cookie: String) -> Result<WebCookieStatus, String> {
    auth::save_web_cookie(cookie)
}

#[tauri::command]
fn bangumi_clear_web_cookie() -> Result<WebCookieStatus, String> {
    auth::clear_web_cookie()
}

#[tauri::command]
async fn bangumi_restore_web_cookie_from_embedded_session(
    app: tauri::AppHandle,
) -> Result<WebCookieStatus, String> {
    restore_web_cookie_from_embedded_session_impl(app).await
}

#[tauri::command]
async fn bangumi_validate_web_cookie() -> Result<WebCookieValidationStatus, String> {
    let existing = match auth::load_web_cookie()? {
        Some(value) if !value.trim().is_empty() => value,
        _ => {
            return Ok(WebCookieValidationStatus {
                configured: false,
                valid: false,
                reason: Some("尚未保存 Cookie，请先完成登录并保存。".to_string()),
            });
        }
    };

    if !validate_cookie_header_against_bangumi(&existing).await? {
        return Ok(WebCookieValidationStatus {
            configured: true,
            valid: false,
            reason: Some("当前 Cookie 已失效。".to_string()),
        });
    }

    Ok(WebCookieValidationStatus {
        configured: true,
        valid: true,
        reason: None,
    })
}

#[tauri::command]
async fn bangumi_refresh_web_cookie() -> Result<WebCookieStatus, String> {
    let existing = match auth::load_web_cookie()? {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Err("Cookie 为空或无效，请先完成应用内自动获取。".to_string()),
    };

    let mut merged = parse_cookie_header_map(&existing);
    if merged.is_empty() {
        return Err("Cookie 无效：缺少必要字段，请重新登录后自动获取。".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to build cookie refresh HTTP client: {error}"))?;

    let response = fetch_with_cookie_redirect(&client, "https://bgm.tv/", &existing).await?;

    let headers = response.headers().clone();
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read cookie refresh page body: {error}"))?;

    if !status.is_success() {
        return Err(format!("Cookie refresh page returned {status}: {body}"));
    }

    if page_shows_auth_buttons(&body) {
        return Err("当前 Cookie 已失效。".to_string());
    }

    for value in headers.get_all(reqwest::header::SET_COOKIE).iter() {
        let Some(raw) = value.to_str().ok() else {
            continue;
        };

        let Some((name, cookie_value)) = parse_set_cookie_name_value(raw) else {
            continue;
        };

        if !should_keep_cookie(&name) || cookie_value.is_empty() {
            continue;
        }

        merged.insert(name, cookie_value);
    }

    let refreshed_cookie = merged
        .into_iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ");

    if refreshed_cookie.trim().is_empty() {
        return Err("Cookie 为空或无效，请重新登录后自动获取。".to_string());
    }

    auth::save_web_cookie(refreshed_cookie)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Live2dModelInfo {
    name: String,
    path: String,
}

/// 导入模型：用户选文件夹 + 命名 → 复制到 app_data/live2d/{name}/ → 返回路径
#[tauri::command]
async fn import_live2d_model(
    app: tauri::AppHandle,
    source_dir: String,
    model_name: String,
) -> Result<Live2dModelInfo, String> {
    let name = model_name.trim();
    if name.is_empty() {
        return Err("模型名称不能为空。".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == ' ')
    {
        return Err("模型名称只能包含字母、数字、空格、下划线和连字符。".to_string());
    }

    let source = std::path::Path::new(&source_dir);
    if !source.exists() || !source.is_dir() {
        return Err(format!("文件夹不存在: {source_dir}"));
    }

    // 查找模型入口文件
    let mut model_file_name: Option<String> = None;
    for entry in std::fs::read_dir(source).map_err(|e| format!("无法读取文件夹: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let n = entry
            .file_name()
            .to_str()
            .unwrap_or("")
            .to_ascii_lowercase();
        if n.ends_with(".model.json") || n.ends_with(".model3.json") {
            model_file_name = Some(entry.file_name().to_str().unwrap_or("").to_string());
            break;
        }
    }
    let model_file_name = model_file_name.ok_or_else(|| {
        "未找到 Live2D 模型入口文件（*.model.json / *.model3.json）。".to_string()
    })?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    let dest_root = app_data_dir.join("live2d").join(&name);

    // 重名检查
    if dest_root.exists() {
        return Err(format!("模型「{name}」已存在，请使用不同的名称。"));
    }

    let temp_root = dest_root.with_file_name(format!(".{name}.importing-{}", std::process::id()));
    if temp_root.exists() {
        return Err("模型导入临时目录已存在，请稍后重试。".to_string());
    }
    std::fs::create_dir_all(&temp_root).map_err(|e| format!("无法创建临时目录: {e}"))?;
    if let Err(error) = copy_dir_recursive(source, &temp_root) {
        let _ = std::fs::remove_dir_all(&temp_root);
        return Err(error);
    }

    if dest_root.exists() {
        let _ = std::fs::remove_dir_all(&temp_root);
        return Err(format!("模型“{name}”已存在，请使用不同的名称。"));
    }
    std::fs::rename(&temp_root, &dest_root).map_err(|e| {
        let _ = std::fs::remove_dir_all(&temp_root);
        format!("导入模型失败: {e}")
    })?;

    let dest_model_path = dest_root.join(&model_file_name);
    if !dest_model_path.exists() {
        let _ = std::fs::remove_dir_all(&dest_root);
        return Err(format!("复制失败，未找到: {model_file_name}"));
    }
    let path = dest_model_path.to_str().ok_or("路径非 UTF-8")?.to_string();
    log_info(&format!("Model imported: {name} -> {path}"));
    Ok(Live2dModelInfo {
        name: name.to_string(),
        path,
    })
}

/// 列出已导入的所有模型
#[tauri::command]
fn list_live2d_models(app: tauri::AppHandle) -> Result<Vec<Live2dModelInfo>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    let live2d_dir = app_data_dir.join("live2d");
    if !live2d_dir.exists() {
        return Ok(vec![]);
    }

    let mut models = vec![];
    for entry in std::fs::read_dir(&live2d_dir).map_err(|e| format!("无法读取目录: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir_name = entry.file_name().to_str().unwrap_or("").to_string();
        // 跳过 cubism core 文件
        if dir_name == CUBISM_CORE_FILENAME || dir_name.starts_with('.') {
            continue;
        }
        // 在目录中找 model json
        if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
            for sub in sub_entries.flatten() {
                let n = sub.file_name().to_str().unwrap_or("").to_ascii_lowercase();
                if n.ends_with(".model.json") || n.ends_with(".model3.json") {
                    let path = sub.path().to_str().unwrap_or("").to_string();
                    models.push(Live2dModelInfo {
                        name: dir_name.clone(),
                        path,
                    });
                    break;
                }
            }
        }
    }
    Ok(models)
}

/// 删除指定名称的模型
#[tauri::command]
fn remove_live2d_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    let name = model_name.trim();
    if name.is_empty() {
        return Err("模型名称不能为空。".to_string());
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    let model_dir = app_data_dir.join("live2d").join(name);
    if model_dir.exists() {
        std::fs::remove_dir_all(&model_dir).map_err(|e| format!("删除失败: {e}"))?;
        log_info(&format!("Model removed: {name}"));
    }
    Ok(())
}

const CUBISM_CORE_URL: &str =
    "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const CUBISM_CORE_FILENAME: &str = "live2dcubismcore.min.js";

/// 从 Live2D 官方源下载 Cubism 4 Core 运行时到应用数据目录。
/// 如果文件已存在则跳过下载，返回已有路径。
#[tauri::command]
async fn download_live2d_cubism_core(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    let dest_dir = app_data_dir.join("live2d");
    std::fs::create_dir_all(&dest_dir).map_err(|error| format!("无法创建目录: {error}"))?;

    let dest_path = dest_dir.join(CUBISM_CORE_FILENAME);

    // 已存在则跳过
    if dest_path.exists()
        && std::fs::metadata(&dest_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        log_info("Cubism 4 Core already exists, skipping download.");
        return Ok(dest_path
            .to_str()
            .ok_or_else(|| "路径包含非 UTF-8 字符。".to_string())?
            .to_string());
    }

    log_info("Downloading Cubism 4 Core from official source...");

    let client = reqwest::Client::builder()
        .user_agent(bangumi::USER_AGENT)
        .build()
        .map_err(|error| format!("无法创建 HTTP 客户端: {error}"))?;

    let response = client
        .get(CUBISM_CORE_URL)
        .send()
        .await
        .map_err(|error| format!("下载失败: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载失败 (HTTP {status})"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败: {error}"))?;

    let temp_path = dest_path.with_extension("js.tmp");
    std::fs::write(&temp_path, &bytes).map_err(|error| format!("写入文件失败: {error}"))?;
    if dest_path.exists() {
        let _ = std::fs::remove_file(&dest_path);
    }
    if let Err(error) = std::fs::rename(&temp_path, &dest_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("无法保存运行时文件: {error}"));
    }
    let path_str = dest_path
        .to_str()
        .ok_or_else(|| "路径包含非 UTF-8 字符。".to_string())?
        .to_string();

    log_info(&format!("Cubism 4 Core downloaded to: {path_str}"));
    Ok(path_str)
}

/// 删除已下载的 Cubism 4 Core 运行时文件。文件不存在时不报错。
#[tauri::command]
fn remove_live2d_cubism_core(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    let file_path = app_data_dir.join("live2d").join(CUBISM_CORE_FILENAME);

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|error| format!("删除文件失败: {error}"))?;
        log_info("Cubism 4 Core removed.");
    }

    Ok(())
}

const DIALOG_FILENAME: &str = "dialog.txt";
const DEFAULT_DIALOG_MESSAGES: &[&str] = &[
    "你好呀~",
    "今天天气不错呢！",
    "要来看看有什么新番吗？",
    "主人，你在看什么呢？",
    "工作辛苦了，休息一下吧！",
];

/// 获取看板娘对话文件路径（不存在则用默认内容创建）
#[tauri::command]
fn get_live2d_dialog_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let live2d_dir = app_data_dir.join("live2d");
    std::fs::create_dir_all(&live2d_dir).map_err(|e| format!("无法创建目录: {e}"))?;

    let file_path = live2d_dir.join(DIALOG_FILENAME);
    if !file_path.exists() {
        let content = DEFAULT_DIALOG_MESSAGES.join("\n");
        std::fs::write(&file_path, &content).map_err(|e| format!("无法创建对话文件: {e}"))?;
        log_info(&format!(
            "Created default dialog file: {}",
            file_path.display()
        ));
    }

    file_path
        .to_str()
        .ok_or_else(|| "路径非 UTF-8".to_string())
        .map(|s| s.to_string())
}

/// 读取看板娘对话文件，返回每行内容列表
#[tauri::command]
fn read_live2d_dialog_file(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let file_path = app_data_dir.join("live2d").join(DIALOG_FILENAME);

    if !file_path.exists() {
        // 触发创建默认文件
        get_live2d_dialog_file_path(app)?;
        return Ok(DEFAULT_DIALOG_MESSAGES
            .iter()
            .map(|s| s.to_string())
            .collect());
    }

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("无法读取对话文件: {e}"))?;

    let lines: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return Ok(DEFAULT_DIALOG_MESSAGES
            .iter()
            .map(|s| s.to_string())
            .collect());
    }

    Ok(lines)
}

/// 在资源管理器中打开看板娘数据文件夹
#[tauri::command]
async fn open_live2d_dialog_folder(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let live2d_dir = app_data_dir.join("live2d");
    std::fs::create_dir_all(&live2d_dir).map_err(|e| format!("无法创建目录: {e}"))?;

    tauri_plugin_opener::reveal_item_in_dir(&live2d_dir).map_err(|e| format!("无法打开文件夹: {e}"))
}

// ── NSFW 对话文件 ──────────────────────────────────────

const NSFW_WARNING_FILENAME: &str = "nsfw_warning.txt";
const DEFAULT_NSFW_WARNING_MESSAGES: &[&str] = &[
    "你是不是走错地方了",
    "又在点奇怪的词条了对吧",
    "我就知道你会点这个",
    "这个世界的好奇心有点危险呢",
    "我可以装作没看见吗",
];

const NSFW_BROWSING_FILENAME: &str = "nsfw_browsing.txt";
const DEFAULT_NSFW_BROWSING_MESSAGES: &[&str] = &[
    "这个区域有点危险呢",
    "要不要休息一下",
    "我 还 在 这 里 哦",
    "我是不是应该假装没看见",
    "有些东西看久了会腻的",
];

const NSFW_EXIT_FILENAME: &str = "nsfw_exit.txt";
const DEFAULT_NSFW_EXIT_MESSAGES: &[&str] = &[
    "真是大开眼界呢！",
    "你刚刚看了点奇怪的东西呢",
    "终于回到安全区了吗…",
];

fn ensure_nsfw_dialog_file(
    app: &tauri::AppHandle,
    filename: &str,
    default_messages: &[&str],
) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let live2d_dir = app_data_dir.join("live2d");
    std::fs::create_dir_all(&live2d_dir).map_err(|e| format!("无法创建目录: {e}"))?;

    let file_path = live2d_dir.join(filename);
    if !file_path.exists() {
        let content = default_messages.join("\n");
        std::fs::write(&file_path, &content).map_err(|e| format!("无法创建对话文件: {e}"))?;
    }

    Ok(file_path)
}

fn read_nsfw_dialog_file_inner(
    app: &tauri::AppHandle,
    filename: &str,
    default_messages: &[&str],
) -> Result<Vec<String>, String> {
    let file_path = ensure_nsfw_dialog_file(app, filename, default_messages)?;

    let content =
        std::fs::read_to_string(&file_path).map_err(|e| format!("无法读取对话文件: {e}"))?;

    let lines: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return Ok(default_messages.iter().map(|s| s.to_string()).collect());
    }

    Ok(lines)
}

#[tauri::command]
fn read_live2d_nsfw_warning_file(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    read_nsfw_dialog_file_inner(&app, NSFW_WARNING_FILENAME, DEFAULT_NSFW_WARNING_MESSAGES)
}

#[tauri::command]
fn read_live2d_nsfw_browsing_file(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    read_nsfw_dialog_file_inner(&app, NSFW_BROWSING_FILENAME, DEFAULT_NSFW_BROWSING_MESSAGES)
}

#[tauri::command]
fn read_live2d_nsfw_exit_file(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    read_nsfw_dialog_file_inner(&app, NSFW_EXIT_FILENAME, DEFAULT_NSFW_EXIT_MESSAGES)
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("源路径不是目录: {}", src.display()));
    }

    std::fs::create_dir_all(dest)
        .map_err(|error| format!("无法创建目录 {}: {error}", dest.display()))?;

    for entry in std::fs::read_dir(src)
        .map_err(|error| format!("无法读取目录 {}: {error}", src.display()))?
    {
        let entry = entry.map_err(|error| format!("读取目录条目失败: {error}"))?;
        let entry_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path)?;
        } else {
            std::fs::copy(&entry_path, &dest_path).map_err(|error| {
                format!(
                    "复制文件失败 {} -> {}: {error}",
                    entry_path.display(),
                    dest_path.display()
                )
            })?;
        }
    }

    Ok(())
}

// ── GitHub 更新检查 ─────────────────────────────────────

const GITHUB_REPO_OWNER: &str = "SimpERROR";
const GITHUB_REPO_NAME: &str = "SimpBangumi";

#[derive(serde::Serialize)]
struct UpdateCheckResult {
    has_update: bool,
    current_version: String,
    latest_version: String,
    release_url: String,
    release_notes: String,
}

/// 从 GitHub Releases API 获取最新版本号，与当前版本比较。
/// 不依赖用户的 GitHub token，使用公共 API（有速率限制，但对启动检查足够）。
/// 当前版本取自 tauri.conf.json 中的 version 字段，确保与实际发布版本一致。
#[tauri::command]
async fn check_github_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let url = format!(
        "https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases/latest"
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("{GITHUB_REPO_NAME}/update-check"))
        .build()
        .map_err(|error| format!("无法创建 HTTP 客户端: {error}"))?;

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("无法连接到 GitHub: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        // 404 表示没有 release，视为无更新
        if status.as_u16() == 404 {
            return Ok(UpdateCheckResult {
                has_update: false,
                current_version,
                latest_version: String::new(),
                release_url: String::new(),
                release_notes: String::new(),
            });
        }

        return Err(format!("GitHub API 返回 {status}"));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("无法解析 GitHub 响应: {error}"))?;

    let latest_version = body["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    let release_url = body["html_url"].as_str().unwrap_or("").to_string();

    let release_notes = body["body"].as_str().unwrap_or("").to_string();

    if latest_version.is_empty() {
        return Ok(UpdateCheckResult {
            has_update: false,
            current_version,
            latest_version: String::new(),
            release_url,
            release_notes,
        });
    }

    let has_update = latest_version != current_version;

    log_info(&format!(
        "Update check: current={current_version}, latest={latest_version}, has_update={has_update}"
    ));

    Ok(UpdateCheckResult {
        has_update,
        current_version,
        latest_version,
        release_url,
        release_notes,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let api_state = ApiState::new().expect("failed to initialize Bangumi API client");
    tauri::Builder::default()
        .manage(api_state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bangumi_fetch_image_data_url,
            system_audio_output_status,
            greet,
            import_live2d_model,
            list_live2d_models,
            remove_live2d_model,
            download_live2d_cubism_core,
            remove_live2d_cubism_core,
            get_live2d_dialog_file_path,
            read_live2d_dialog_file,
            open_live2d_dialog_folder,
            read_live2d_nsfw_warning_file,
            read_live2d_nsfw_browsing_file,
            read_live2d_nsfw_exit_file,
            bangumi_oauth_start_login,
            bangumi_oauth_finish_login,
            bangumi_login_with_pat,
            bangumi_refresh_oauth_session,
            bangumi_auth_session,
            bangumi_logout,
            bangumi_get_me,
            bangumi_api_get,
            bangumi_api_request,
            bangumi_fetch_subject_comments_page,
            bangumi_fetch_mono_comments_page,
            bangumi_set_mono_collected,
            bangumi_set_index_collected,
            bangumi_add_index_entity,
            bangumi_fetch_user_indices_page,
            bangumi_fetch_index_page,
            bangumi_fetch_subject_page,
            bangumi_fetch_anime_browser_page,
            bangumi_fetch_user_mono_collections_page,
            bangumi_web_cookie_status,
            bangumi_save_web_cookie,
            bangumi_clear_web_cookie,
            bangumi_restore_web_cookie_from_embedded_session,
            bangumi_validate_web_cookie,
            bangumi_refresh_web_cookie,
            bangumi_open_embedded_web_login,
            bangumi_capture_embedded_web_cookie,
            diagnostics::export_diagnostics,
            mal_scraper::mal_scrape_anime,
            ratings::anilist_search_rating,
            ratings::tmdb_search_rating,
            ratings::imdb_search_rating,
            ratings::tmdb_scrape_rating,
            ratings::imdb_scrape_rating,
            save_image_to_path,
            save_image_bytes_to_path,
            check_github_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
