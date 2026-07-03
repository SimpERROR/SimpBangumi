use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::mpsc::TryRecvError;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use url::Url;

use crate::bangumi::{BangumiClient, BangumiUser};

const KEYRING_SERVICE: &str = "bangumi-client";
const KEYRING_ACCOUNT: &str = "bangumi-token";
const SESSION_CACHE_DIR: &str = "bangumi-client";
const SESSION_CACHE_FILE: &str = "auth-session.json";
const AUTH_BASE_URL: &str = "https://bgm.tv";
const WORKER_PROXY_URL: &str = "https://simpbangumiproxy.pulsebeatrhythm.top";
const OAUTH_CLIENT_ID: &str = "bgm64976a469e533c132";
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:46231/oauth/callback";
const OAUTH_SCOPE: Option<&str> = None;
const OAUTH_TIMEOUT_SECONDS: u64 = 180;

static OAUTH_LOGIN_RECEIVER: OnceLock<Mutex<Option<mpsc::Receiver<Result<String, String>>>>> =
    OnceLock::new();

fn log_info(message: &str) {
    eprintln!("[auth] {message}");
}

fn log_error(message: &str) {
    eprintln!("[auth][error] {message}");
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenSource {
    PersonalAccessToken,
    OAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub source: TokenSource,
    pub user: Option<BangumiUser>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthSession {
    pub authenticated: bool,
    pub source: Option<TokenSource>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub user: Option<BangumiUser>,
}

#[derive(Debug, Clone)]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub redirect_uri: String,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OAuthAuthorizeUrl {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct OAuthLoginStatus {
    pub completed: bool,
    pub code: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkerOAuthTokenRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerExchangeCodeRequest {
    pub code: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerRefreshTokenRequest {
    pub refresh_token: String,
    pub grant_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerExchangeTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user_id: Option<serde_json::Value>,
}

pub fn load_token() -> Result<Option<StoredToken>, String> {
    let entry = token_entry()?;

    match entry.get_password() {
        Ok(raw) => {
            log_info("loaded token from keyring");
            serde_json::from_str(&raw)
                .map(Some)
                .map_err(|err| format!("Failed to parse stored token: {err}"))
        }
        Err(keyring::Error::NoEntry) => {
            log_info("no token found in keyring");
            load_token_from_file()
        }
        Err(err) => Err(format!("Failed to read token from keyring: {err}")),
    }
}

pub fn save_token(token: &StoredToken) -> Result<(), String> {
    let raw = serde_json::to_string(token)
        .map_err(|err| format!("Failed to serialize token: {err}"))?;

    save_token_to_file(&raw)?;

    let entry = token_entry()?;

    if let Err(err) = entry.set_password(&raw) {
        log_error(&format!("failed to save token to keyring, using file fallback: {err}"));
    } else {
        log_info("saved token to keyring");
    }

    log_info("saved token to local session cache");
    Ok(())
}

pub fn delete_token() -> Result<(), String> {
    let entry = token_entry()?;
    delete_token_file()?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            log_info("deleted token from keyring and local session cache");
            Ok(())
        }
        Err(err) => {
            log_error(&format!("failed to delete token from keyring: {err}"));
            Ok(())
        }
    }
}

pub fn session_from_token(token: Option<StoredToken>) -> AuthSession {
    match token {
        Some(token) => AuthSession {
            authenticated: true,
            source: Some(token.source),
            scope: token.scope,
            expires_at: token.expires_at,
            user: token.user,
        },
        None => AuthSession {
            authenticated: false,
            source: None,
            scope: None,
            expires_at: None,
            user: None,
        },
    }
}

pub fn load_oauth_client_config() -> Result<OAuthClientConfig, String> {
    if OAUTH_CLIENT_ID.trim().is_empty() || OAUTH_REDIRECT_URI.trim().is_empty() {
        return Err(
            "OAuth is not configured in app build. Please ask the developer to set client id/redirect in src-tauri/src/auth.rs".to_string(),
        );
    }

    let client_id = OAUTH_CLIENT_ID.trim().to_string();
    let redirect_uri = OAUTH_REDIRECT_URI.trim().to_string();
    let scope = OAUTH_SCOPE.map(|value| value.to_string());

    Ok(OAuthClientConfig {
        client_id,
        redirect_uri,
        scope,
    })
}

pub fn start_oauth_login() -> Result<OAuthAuthorizeUrl, String> {
    log_info("starting OAuth login flow");
    let config = load_oauth_client_config()?;
    let receiver_store = OAUTH_LOGIN_RECEIVER.get_or_init(|| Mutex::new(None));
    let mut guard = receiver_store
        .lock()
        .map_err(|_| "OAuth login state lock poisoned".to_string())?;

    if guard.is_some() {
        return Err("OAuth login already in progress".to_string());
    }

    let authorize_url = build_oauth_authorize_url(&config)?;
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    *guard = Some(rx);

    std::thread::spawn(move || {
        let result = wait_for_callback_and_capture_code(config);
        let _ = tx.send(result);
    });

    Ok(authorize_url)
}

pub fn wait_oauth_login_result() -> Result<OAuthLoginStatus, String> {
    let receiver_store = OAUTH_LOGIN_RECEIVER.get_or_init(|| Mutex::new(None));
    let mut guard = receiver_store
        .lock()
        .map_err(|_| "OAuth login state lock poisoned".to_string())?;
    let receiver = guard
        .as_ref()
        .ok_or_else(|| "No OAuth login in progress".to_string())?;

    match receiver.try_recv() {
        Ok(result) => {
            *guard = None;
            match result {
                Ok(code) => {
                    log_info("OAuth callback code received");
                    Ok(OAuthLoginStatus {
                        completed: true,
                        code: Some(code),
                        error: None,
                    })
                }
                Err(error) => {
                    log_error(&format!("OAuth login worker returned error: {error}"));
                    Ok(OAuthLoginStatus {
                        completed: true,
                        code: None,
                        error: Some(error),
                    })
                }
            }
        }
        Err(TryRecvError::Empty) => Ok(OAuthLoginStatus {
            completed: false,
            code: None,
            error: None,
        }),
        Err(TryRecvError::Disconnected) => {
            *guard = None;
            log_error("OAuth login worker disconnected");
            Ok(OAuthLoginStatus {
                completed: true,
                code: None,
                error: Some("OAuth login worker disconnected".to_string()),
            })
        }
    }
}

fn wait_for_callback_and_capture_code(config: OAuthClientConfig) -> Result<String, String> {
    let redirect = Url::parse(&config.redirect_uri)
        .map_err(|err| format!("Invalid OAuth redirect URI: {err}"))?;

    if redirect.scheme() != "http" {
        return Err("OAuth redirect URI must use http:// for local callback capture".to_string());
    }

    let host = redirect
        .host_str()
        .ok_or_else(|| "OAuth redirect URI missing host".to_string())?;
    let port = redirect
        .port_or_known_default()
        .ok_or_else(|| "OAuth redirect URI missing port".to_string())?;
    let callback_path = redirect.path().to_string();

    let listener = TcpListener::bind((host, port))
        .map_err(|err| format!("Failed to bind OAuth callback listener: {err}"))?;
    log_info(&format!("listening for OAuth callback on {host}:{port}{callback_path}"));
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("Failed to configure OAuth callback listener: {err}"))?;

    let deadline = Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECONDS);

    loop {
        if Instant::now() > deadline {
            log_error("OAuth authorization timed out");
            return Err("OAuth authorization timed out".to_string());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0u8; 4096];
                let read_size = stream
                    .read(&mut buffer)
                    .map_err(|err| format!("Failed to read OAuth callback request: {err}"))?;
                let request = String::from_utf8_lossy(&buffer[..read_size]);
                let first_line = request
                    .lines()
                    .next()
                    .ok_or_else(|| "Invalid OAuth callback request".to_string())?;

                let path_query = first_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| "Invalid OAuth callback request line".to_string())?;

                let callback_url = Url::parse(&format!("http://localhost{path_query}"))
                    .map_err(|err| format!("Failed to parse OAuth callback URL: {err}"))?;

                if callback_url.path() != callback_path {
                    log_error("received OAuth callback on unexpected path");
                    write_callback_response(&mut stream, "OAuth callback path mismatch");
                    continue;
                }

                let code = callback_url
                    .query_pairs()
                    .find_map(|(key, value)| (key == "code").then(|| value.into_owned()))
                    .ok_or_else(|| "OAuth callback missing code".to_string())?;

                write_callback_response(&mut stream, "OAuth login succeeded. You can close this tab.");
                log_info("OAuth callback handled successfully");

                return Ok(code);
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(err) => {
                return Err(format!("Failed accepting OAuth callback: {err}"));
            }
        }
    }
}

fn write_callback_response(stream: &mut std::net::TcpStream, message: &str) {
    let body = format!("<html><body><h3>{message}</h3></body></html>");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub fn build_oauth_authorize_url(config: &OAuthClientConfig) -> Result<OAuthAuthorizeUrl, String> {
    let mut url = Url::parse(&format!("{AUTH_BASE_URL}/oauth/authorize"))
        .map_err(|err| format!("Failed to build OAuth authorize URL: {err}"))?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &config.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &config.redirect_uri);

        if let Some(scope) = config.scope.as_deref() {
            query.append_pair("scope", scope);
        }
    }

    Ok(OAuthAuthorizeUrl {
        url: url.to_string(),
    })
}

pub async fn login_with_personal_access_token(token: String) -> Result<AuthSession, String> {
    log_info("logging in with personal access token");
    let client = BangumiClient::new(Some(token.clone()))?;
    let user = client.me().await?;

    let stored = StoredToken {
        access_token: token,
        refresh_token: None,
        token_type: Some("Bearer".to_string()),
        scope: None,
        expires_at: None,
        source: TokenSource::PersonalAccessToken,
        user: Some(user),
    };

    save_token(&stored)?;
    Ok(session_from_token(Some(stored)))
}

pub async fn login_with_worker_token(req: WorkerOAuthTokenRequest) -> Result<AuthSession, String> {
    log_info(&format!(
        "logging in with worker token (has_refresh_token={})",
        req.refresh_token.is_some()
    ));
    let client = BangumiClient::new(Some(req.access_token.clone()))?;
    let user = client.me().await?;

    let stored = StoredToken {
        access_token: req.access_token,
        refresh_token: req.refresh_token,
        token_type: Some("Bearer".to_string()),
        scope: None,
        expires_at: None,
        source: TokenSource::OAuth,
        user: Some(user),
    };

    save_token(&stored)?;
    Ok(session_from_token(Some(stored)))
}

pub async fn refresh_saved_oauth_session() -> Result<AuthSession, String> {
    log_info("refreshing saved OAuth session");
    let stored = load_token()?
        .ok_or_else(|| "No stored Bangumi session".to_string())?;

    if !matches!(stored.source, TokenSource::OAuth) {
        return Err("Stored session is not an OAuth session".to_string());
    }

    let refresh_token = stored
        .refresh_token
        .clone()
        .ok_or_else(|| "Stored OAuth session has no refresh token".to_string())?;

    let refreshed = refresh_token_via_worker(WorkerRefreshTokenRequest {
        refresh_token: refresh_token.clone(),
        grant_type: "refresh_token".to_string(),
    })
    .await?;

    log_info(&format!(
        "worker refresh completed (has_refresh_token={})",
        refreshed.refresh_token.is_some()
    ));

    login_with_worker_token(WorkerOAuthTokenRequest {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token.or(Some(refresh_token)),
    })
    .await
}

pub fn is_auth_error(error: &str) -> bool {
    error.contains("401") || error.contains("403")
}

pub async fn exchange_code_via_worker(
    req: WorkerExchangeCodeRequest,
) -> Result<WorkerExchangeTokenResponse, String> {
    log_info(&format!(
        "exchanging OAuth code via worker for redirect_uri={} ",
        req.redirect_uri
    ));
    let http = reqwest::Client::builder()
        .user_agent(crate::bangumi::USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to build worker HTTP client: {err}"))?;

    let response = http
        .post(WORKER_PROXY_URL)
        .json(&req)
        .send()
        .await
        .map_err(|err| format!("Worker token exchange failed: {err}"))?;

    parse_worker_response(response, "Worker token exchange failed").await
}

pub async fn refresh_token_via_worker(
    req: WorkerRefreshTokenRequest,
) -> Result<WorkerExchangeTokenResponse, String> {
    log_info(&format!(
        "refreshing token via worker (grant_type={})",
        req.grant_type
    ));
    let http = reqwest::Client::builder()
        .user_agent(crate::bangumi::USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to build worker HTTP client: {err}"))?;

    let response = http
        .post(WORKER_PROXY_URL)
        .json(&req)
        .send()
        .await
        .map_err(|err| format!("Worker token refresh failed: {err}"))?;

    parse_worker_response(response, "Worker token refresh failed").await
}

async fn parse_worker_response(
    response: reqwest::Response,
    label: &str,
) -> Result<WorkerExchangeTokenResponse, String> {
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_error(&format!("{label}: {status} {body}"));
        return Err(format!("{label}: {status} {body}"));
    }

    log_info(&format!("{label}: success"));

    response
        .json::<WorkerExchangeTokenResponse>()
        .await
        .map_err(|err| format!("{label}: invalid response body: {err}"))
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|err| format!("Failed to open keyring entry: {err}"))
}

fn load_token_from_file() -> Result<Option<StoredToken>, String> {
    let path = token_cache_path()?;

    if !path.exists() {
        log_info("no token found in local session cache");
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read local session cache: {err}"))?;
    log_info("loaded token from local session cache");

    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| format!("Failed to parse local session cache: {err}"))
}

fn save_token_to_file(raw: &str) -> Result<(), String> {
    let path = token_cache_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create local session cache directory: {err}"))?;
    }

    fs::write(&path, raw)
        .map_err(|err| format!("Failed to write local session cache: {err}"))
}

fn delete_token_file() -> Result<(), String> {
    let path = token_cache_path()?;

    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(&path)
        .map_err(|err| format!("Failed to delete local session cache: {err}"))
}

fn token_cache_path() -> Result<PathBuf, String> {
    let base_dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "Failed to resolve local session cache directory".to_string())?;

    Ok(base_dir.join(SESSION_CACHE_DIR).join(SESSION_CACHE_FILE))
}
