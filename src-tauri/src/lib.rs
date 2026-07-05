mod auth;
mod bangumi;

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

const WEB_LOGIN_WINDOW_LABEL: &str = "bangumi-web-login";

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

fn log_info(message: &str) {
    eprintln!("[tauri] {message}");
}

fn log_error(message: &str) {
    eprintln!("[tauri][error] {message}");
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
        return Err("未捕获到登录 Cookie，请确认已在窗口内完成登录并保持窗口开启。".to_string());
    }

    let header = selected
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ");

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
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
            bangumi_open_embedded_web_login,
            bangumi_capture_embedded_web_cookie
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
