mod auth;
mod bangumi;

use std::collections::BTreeMap;

use reqwest::Method;
use serde_json::Value;

use auth::{
    AuthSession, OAuthAuthorizeUrl, OAuthLoginStatus, WorkerExchangeCodeRequest,
    WorkerExchangeTokenResponse, WorkerOAuthTokenRequest, WorkerRefreshTokenRequest,
};
use bangumi::{BangumiClient, BangumiUser};

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
fn bangumi_oauth_start_login() -> Result<OAuthAuthorizeUrl, String> {
    log_info("invoke bangumi_oauth_start_login");
    auth::start_oauth_login()
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
            bangumi_api_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
