mod auth;
mod bangumi;
mod diagnostics;
mod mal_scraper;

use std::collections::BTreeMap;

use reqwest::Method;
use serde_json::Value;
use tauri::Manager;
use url::Url;

use auth::{
    AuthSession, OAuthAuthorizeUrl, OAuthLoginStatus, OAuthStartLoginRequest,
    WebCookieStatus,
    WorkerExchangeCodeRequest, WorkerExchangeTokenResponse, WorkerOAuthTokenRequest,
    WorkerRefreshTokenRequest,
};
use bangumi::{BangumiClient, BangumiUser};
use tauri::webview::PageLoadEvent;

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
    let has_login_text = html.contains("登录") || lower.contains(">log in<") || lower.contains(">login<");
    let has_signup_text = html.contains("注册") || lower.contains(">sign up<") || lower.contains(">signup<");

    (has_login_link && has_signup_link) || (has_login_link && has_login_text) || (has_signup_link && has_signup_text)
}

pub(crate) fn log_info(message: &str) {
    let formatted = format!("[tauri] {message}");
    push_rust_log(formatted.clone());
    eprintln!("{formatted}");
}

pub(crate) fn log_error(message: &str) {
    let formatted = format!("[tauri][error] {message}");
    push_rust_log(formatted.clone());
    eprintln!("{formatted}");
}

// ── Rust backend log buffer for diagnostics ──────────────

use std::sync::Mutex;

static RUST_LOG_BUFFER: Mutex<Vec<String>> = Mutex::new(Vec::new());
const MAX_RUST_LOGS: usize = 500;

fn push_rust_log(line: String) {
    if let Ok(mut buffer) = RUST_LOG_BUFFER.lock() {
        if buffer.len() >= MAX_RUST_LOGS {
            buffer.remove(0);
        }
        buffer.push(line);
    }
}

pub(crate) fn take_rust_logs() -> Vec<String> {
    let mut buffer = RUST_LOG_BUFFER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *buffer)
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

        let base = Url::parse(&url)
            .map_err(|error| format!("Invalid base URL {url}: {error}"))?;
        url = base
            .join(&location)
            .map_err(|error| format!("Invalid redirect location {location}: {error}"))?
            .to_string();
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

    let window = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::External(page_url),
    )
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
    let (window, should_close_after_capture) = match app.get_webview_window(WEB_LOGIN_WINDOW_LABEL) {
        Some(existing) => (existing, false),
        None => (open_hidden_bangumi_cookie_recovery_window(&app).await?, true),
    };

    let captured = capture_cookie_header_from_window(window.clone()).await;

    if should_close_after_capture {
        let _ = window.close();
    }

    let header = captured?;
    let valid = validate_cookie_header_against_bangumi(&header).await?;
    if !valid {
        return Err("应用内网页登录会话当前未检测到有效登录状态，无法自动恢复 Cookie。".to_string());
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
fn bangumi_oauth_start_login(request: Option<OAuthStartLoginRequest>) -> Result<OAuthAuthorizeUrl, String> {
    log_info("invoke bangumi_oauth_start_login");
    let state = request.and_then(|value| value.state);
    auth::start_oauth_login(state)
}

#[tauri::command]
fn bangumi_oauth_wait_login_result() -> Result<OAuthLoginStatus, String> {
    auth::wait_oauth_login_result()
}

#[tauri::command]
async fn bangumi_login_with_pat(token: String) -> Result<AuthSession, String> {
    auth::login_with_personal_access_token(token).await
}

#[tauri::command]
async fn bangumi_login_with_worker_token(request: WorkerOAuthTokenRequest) -> Result<AuthSession, String> {
    auth::login_with_worker_token(request).await
}

#[tauri::command]
async fn bangumi_worker_exchange_code(
    request: WorkerExchangeCodeRequest,
) -> Result<WorkerExchangeTokenResponse, String> {
    auth::exchange_code_via_worker(request).await
}

#[tauri::command]
async fn bangumi_worker_refresh_token(
    request: WorkerRefreshTokenRequest,
) -> Result<WorkerExchangeTokenResponse, String> {
    auth::refresh_token_via_worker(request).await
}

#[tauri::command]
fn bangumi_auth_session() -> Result<AuthSession, String> {
    log_info("invoke bangumi_auth_session");
    auth::load_token().map(auth::session_from_token)
}

#[tauri::command]
fn bangumi_logout() -> Result<AuthSession, String> {
    auth::delete_token()?;
    Ok(auth::session_from_token(None))
}

#[tauri::command]
async fn bangumi_get_me() -> Result<BangumiUser, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "No Bangumi token stored. Login first.".to_string())?;
    let client = BangumiClient::new(Some(token.access_token))?;

    client.me().await
}

#[tauri::command]
async fn bangumi_api_get(
    path: String,
    query: Option<BTreeMap<String, String>>,
) -> Result<Value, String> {
    log_info(&format!("invoke bangumi_api_get path={path}"));
    let token = auth::load_token()?;
    let client = BangumiClient::new(token.map(|token| token.access_token))?;
    let first_attempt = client
        .request_json(Method::GET, &path, query.clone(), None)
        .await;

    match first_attempt {
        Ok(value) => {
            log_info(&format!("bangumi_api_get success path={path}"));
            Ok(value)
        }
        Err(error) if auth::is_auth_error(&error) => {
            log_error(&format!("bangumi_api_get auth failure path={path}: {error}"));
            auth::refresh_saved_oauth_session().await?;
            let refreshed = auth::load_token()?;
            let refreshed_client = BangumiClient::new(refreshed.map(|token| token.access_token))?;
            log_info(&format!("retrying bangumi_api_get after refresh path={path}"));
            refreshed_client.request_json(Method::GET, &path, query, None).await
        }
        Err(error) => {
            log_error(&format!("bangumi_api_get failed path={path}: {error}"));
            Err(error)
        }
    }
}

#[tauri::command]
async fn bangumi_api_request(
    method: String,
    path: String,
    query: Option<BTreeMap<String, String>>,
    body: Option<Value>,
) -> Result<Value, String> {
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    log_info(&format!("invoke bangumi_api_request method={} path={}", method.as_str(), path));

    let token = auth::load_token()?;
    let client = BangumiClient::new(token.map(|token| token.access_token))?;
    let first_attempt = client
        .request_json(method.clone(), &path, query.clone(), body.clone())
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
            auth::refresh_saved_oauth_session().await?;
            let refreshed = auth::load_token()?;
            let refreshed_client = BangumiClient::new(refreshed.map(|token| token.access_token))?;
            log_info(&format!(
                "retrying bangumi_api_request after refresh method={} path={}",
                method.as_str(),
                path
            ));
            refreshed_client
                .request_json(method, &path, query, body)
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
        .ok_or_else(|| "未找到网页登录窗口，请先点击“应用内登录并自动获取”并保持其开启。".to_string())?;

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
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == ' ') {
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
        let n = entry.file_name().to_str().unwrap_or("").to_ascii_lowercase();
        if n.ends_with(".model.json") || n.ends_with(".model3.json") {
            model_file_name = Some(entry.file_name().to_str().unwrap_or("").to_string());
            break;
        }
    }
    let model_file_name = model_file_name
        .ok_or_else(|| "未找到 Live2D 模型入口文件（*.model.json / *.model3.json）。".to_string())?;

    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("无法获取数据目录: {e}"))?;
    let dest_root = app_data_dir.join("live2d").join(&name);

    // 重名检查
    if dest_root.exists() {
        return Err(format!("模型「{name}」已存在，请使用不同的名称。"));
    }

    std::fs::create_dir_all(&dest_root).map_err(|e| format!("无法创建目录: {e}"))?;
    copy_dir_recursive(source, &dest_root)?;

    let dest_model_path = dest_root.join(&model_file_name);
    if !dest_model_path.exists() {
        return Err(format!("复制失败，未找到: {model_file_name}"));
    }

    let path = dest_model_path.to_str().ok_or("路径非 UTF-8")?.to_string();
    log_info(&format!("Model imported: {name} -> {path}"));
    Ok(Live2dModelInfo { name: name.to_string(), path })
}

/// 列出已导入的所有模型
#[tauri::command]
fn list_live2d_models(app: tauri::AppHandle) -> Result<Vec<Live2dModelInfo>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("无法获取数据目录: {e}"))?;
    let live2d_dir = app_data_dir.join("live2d");
    if !live2d_dir.exists() {
        return Ok(vec![]);
    }

    let mut models = vec![];
    for entry in std::fs::read_dir(&live2d_dir).map_err(|e| format!("无法读取目录: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let dir_name = entry.file_name().to_str().unwrap_or("").to_string();
        // 跳过 cubism core 文件
        if dir_name == CUBISM_CORE_FILENAME || dir_name.starts_with('.') { continue; }
        // 在目录中找 model json
        if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
            for sub in sub_entries.flatten() {
                let n = sub.file_name().to_str().unwrap_or("").to_ascii_lowercase();
                if n.ends_with(".model.json") || n.ends_with(".model3.json") {
                    let path = sub.path().to_str().unwrap_or("").to_string();
                    models.push(Live2dModelInfo { name: dir_name.clone(), path });
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
    if name.is_empty() { return Err("模型名称不能为空。".to_string()); }
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("无法获取数据目录: {e}"))?;
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
async fn download_live2d_cubism_core(
    app: tauri::AppHandle,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    let dest_dir = app_data_dir.join("live2d");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|error| format!("无法创建目录: {error}"))?;

    let dest_path = dest_dir.join(CUBISM_CORE_FILENAME);

    // 已存在则跳过
    if dest_path.exists() {
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

    std::fs::write(&dest_path, &bytes)
        .map_err(|error| format!("写入文件失败: {error}"))?;

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
        std::fs::remove_file(&file_path)
            .map_err(|error| format!("删除文件失败: {error}"))?;
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
    std::fs::create_dir_all(&live2d_dir)
        .map_err(|e| format!("无法创建目录: {e}"))?;

    let file_path = live2d_dir.join(DIALOG_FILENAME);
    if !file_path.exists() {
        let content = DEFAULT_DIALOG_MESSAGES.join("\n");
        std::fs::write(&file_path, &content)
            .map_err(|e| format!("无法创建对话文件: {e}"))?;
        log_info(&format!("Created default dialog file: {}", file_path.display()));
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
        return Ok(DEFAULT_DIALOG_MESSAGES.iter().map(|s| s.to_string()).collect());
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("无法读取对话文件: {e}"))?;

    let lines: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return Ok(DEFAULT_DIALOG_MESSAGES.iter().map(|s| s.to_string()).collect());
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
    std::fs::create_dir_all(&live2d_dir)
        .map_err(|e| format!("无法创建目录: {e}"))?;

    tauri_plugin_opener::reveal_item_in_dir(&live2d_dir)
        .map_err(|e| format!("无法打开文件夹: {e}"))
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
    std::fs::create_dir_all(&live2d_dir)
        .map_err(|e| format!("无法创建目录: {e}"))?;

    let file_path = live2d_dir.join(filename);
    if !file_path.exists() {
        let content = default_messages.join("\n");
        std::fs::write(&file_path, &content)
            .map_err(|e| format!("无法创建对话文件: {e}"))?;
    }

    Ok(file_path)
}

fn read_nsfw_dialog_file_inner(
    app: &tauri::AppHandle,
    filename: &str,
    default_messages: &[&str],
) -> Result<Vec<String>, String> {
    let file_path = ensure_nsfw_dialog_file(app, filename, default_messages)?;

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("无法读取对话文件: {e}"))?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
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
            bangumi_oauth_wait_login_result,
            bangumi_login_with_pat,
            bangumi_login_with_worker_token,
            bangumi_worker_exchange_code,
            bangumi_worker_refresh_token,
            bangumi_auth_session,
            bangumi_logout,
            bangumi_get_me,
            bangumi_api_get,
            bangumi_api_request,
            bangumi_fetch_subject_comments_page,
            bangumi_fetch_mono_comments_page,
            bangumi_web_cookie_status,
            bangumi_save_web_cookie,
            bangumi_clear_web_cookie,
            bangumi_restore_web_cookie_from_embedded_session,
            bangumi_validate_web_cookie,
            bangumi_refresh_web_cookie,
            bangumi_open_embedded_web_login,
            bangumi_capture_embedded_web_cookie,
            diagnostics::export_diagnostics,
            mal_scraper::mal_scrape_anime
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
