mod auth;
mod bangumi;

use std::collections::BTreeMap;

use reqwest::Method;
use serde_json::Value;

use auth::{AuthSession, OAuthAuthorizeRequest, OAuthAuthorizeUrl, OAuthExchangeRequest};
use bangumi::{BangumiClient, BangumiUser};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! Rust command is available.")
}

#[tauri::command]
fn bangumi_oauth_authorize_url(
    request: OAuthAuthorizeRequest,
) -> Result<OAuthAuthorizeUrl, String> {
    auth::build_oauth_authorize_url(request)
}

#[tauri::command]
async fn bangumi_oauth_exchange_code(
    request: OAuthExchangeRequest,
) -> Result<AuthSession, String> {
    auth::exchange_oauth_code(request).await
}

#[tauri::command]
async fn bangumi_login_with_pat(token: String) -> Result<AuthSession, String> {
    auth::login_with_personal_access_token(token).await
}

#[tauri::command]
fn bangumi_auth_session() -> Result<AuthSession, String> {
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
    let token = auth::load_token()?;
    let client = BangumiClient::new(token.map(|token| token.access_token))?;

    client.request_json(Method::GET, &path, query, None).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            bangumi_oauth_authorize_url,
            bangumi_oauth_exchange_code,
            bangumi_login_with_pat,
            bangumi_auth_session,
            bangumi_logout,
            bangumi_get_me,
            bangumi_api_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
