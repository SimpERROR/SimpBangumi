use base64::{
    engine::general_purpose::STANDARD as BASE64_STANDARD,
    engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL, Engine as _,
};
use keyring::Entry;
use rand::RngCore;
use ring::digest::{digest, SHA256};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::mpsc::TryRecvError;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::bangumi::{BangumiClient, BangumiUser};

const KEYRING_SERVICE: &str = "bangumi-client";
const KEYRING_ACCOUNT: &str = "bangumi-token";
const KEYRING_DEVICE_ACCOUNT: &str = "bangumi-worker-device";
const KEYRING_WEB_COOKIE_ACCOUNT: &str = "bangumi-web-cookie";
const SESSION_CACHE_DIR: &str = "bangumi-client";
const SESSION_CACHE_FILE: &str = "auth-session.json";
const WEB_COOKIE_CACHE_FILE: &str = "web-cookie.enc";
const DEVICE_KEY_CACHE_FILE: &str = "worker-device-key.enc";
const ENCRYPTED_FILE_PREFIX: &str = "dpapi:v1:";
const AUTH_BASE_URL: &str = "https://bgm.tv";
const WORKER_PROXY_URL: &str = "https://simpbangumiproxy.pulsebeatrhythm.top";
const OAUTH_CLIENT_ID: &str = "bgm64976a469e533c132";
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:46231/oauth/callback";
const OAUTH_TIMEOUT_SECONDS: u64 = 180;
const WORKER_SIGNATURE_VERSION: &str = "v2";

static OAUTH_LOGIN_RECEIVER: OnceLock<
    Mutex<Option<mpsc::Receiver<Result<OAuthCallbackResult, String>>>>,
> = OnceLock::new();
static OAUTH_PENDING_CALLBACK: OnceLock<Mutex<Option<OAuthCallbackResult>>> = OnceLock::new();
static WEB_COOKIE_CACHE: OnceLock<Mutex<Option<Arc<StoredWebCookie>>>> = OnceLock::new();
static OAUTH_REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn log_info(message: &str) {
    crate::log_info(&format!("[auth] {message}"));
}

fn log_error(message: &str) {
    crate::log_error(&format!("[auth] {message}"));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenSource {
    PersonalAccessToken,
    OAuth,
}

#[derive(Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub source: TokenSource,
    pub user: Option<BangumiUser>,
}

impl Drop for StoredToken {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
        self.token_type.zeroize();
        self.scope.zeroize();
    }
}

#[derive(Default)]
struct TokenCache {
    initialized: bool,
    token: Option<Arc<StoredToken>>,
}

static TOKEN_CACHE: OnceLock<Mutex<TokenCache>> = OnceLock::new();

fn token_cache() -> &'static Mutex<TokenCache> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(TokenCache::default()))
}

fn lock_token_cache() -> Result<std::sync::MutexGuard<'static, TokenCache>, String> {
    token_cache()
        .lock()
        .map_err(|_| "Token cache lock is poisoned".to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthSession {
    pub authenticated: bool,
    pub source: Option<TokenSource>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub user: Option<BangumiUser>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebCookieStatus {
    pub configured: bool,
    pub updated_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct StoredWebCookie {
    cookie: String,
    updated_at: i64,
}

impl Drop for StoredWebCookie {
    fn drop(&mut self) {
        self.cookie.zeroize();
    }
}

fn read_web_cookie_raw_with_retry(entry: &Entry) -> Result<Option<Zeroizing<String>>, String> {
    // Some Windows keyring backends may not expose newly written credentials immediately.
    const RETRIES: usize = 5;
    const RETRY_DELAY_MS: u64 = 120;

    for attempt in 0..RETRIES {
        match entry.get_password() {
            Ok(raw) => return Ok(Some(Zeroizing::new(raw))),
            Err(keyring::Error::NoEntry) if attempt + 1 < RETRIES => {
                std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
            }
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(format!("Failed to read web cookie from keyring: {err}")),
        }
    }

    Ok(None)
}

fn load_cached_web_cookie() -> Option<Arc<StoredWebCookie>> {
    let store = WEB_COOKIE_CACHE.get_or_init(|| Mutex::new(None));
    match store.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => None,
    }
}

fn set_cached_web_cookie(value: Option<Arc<StoredWebCookie>>) {
    let store = WEB_COOKIE_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = store.lock() {
        *guard = value;
    }
}

fn parse_stored_web_cookie(raw: &str) -> Option<StoredWebCookie> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(stored) = serde_json::from_str::<StoredWebCookie>(trimmed) {
        if stored.cookie.trim().is_empty() {
            return None;
        }
        return Some(stored);
    }

    Some(StoredWebCookie {
        cookie: trimmed.to_string(),
        updated_at: 0,
    })
}

fn parse_cookie_pairs(raw: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::<String, String>::new();

    for part in raw.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut segments = trimmed.splitn(2, '=');
        let name = segments.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = segments.next().unwrap_or("").trim();
        if name.is_empty() || value.is_empty() {
            continue;
        }

        map.insert(name, value.to_string());
    }

    map
}

fn validate_web_cookie_header(raw: &str) -> Result<(), String> {
    let pairs = parse_cookie_pairs(raw);
    if pairs.is_empty() {
        return Err("Cookie 为空或无效，请重新登录后再自动获取。".to_string());
    }

    let has_auth = pairs
        .get("chii_auth")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_sid = pairs
        .get("chii_sid")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if !has_auth || !has_sid {
        return Err(
            "Cookie 无效：缺少 chii_auth 或 chii_sid，请重新登录后再自动获取。".to_string(),
        );
    }

    Ok(())
}

fn save_web_cookie_to_encrypted_file(payload: &StoredWebCookie) -> Result<(), String> {
    let serialized = Zeroizing::new(
        serde_json::to_vec(payload)
            .map_err(|err| format!("Failed to serialize web cookie file payload: {err}"))?,
    );

    let encrypted = encrypt_local_secret_bytes(&serialized)?;
    let encoded = format!(
        "{ENCRYPTED_FILE_PREFIX}{}",
        BASE64_STANDARD.encode(encrypted)
    );
    let path = web_cookie_cache_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create web cookie cache directory: {err}"))?;
    }

    fs::write(&path, encoded)
        .map_err(|err| format!("Failed to write encrypted web cookie cache: {err}"))
}

fn load_web_cookie_from_encrypted_file() -> Result<Option<StoredWebCookie>, String> {
    let path = web_cookie_cache_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = Zeroizing::new(
        fs::read_to_string(&path)
            .map_err(|err| format!("Failed to read encrypted web cookie cache: {err}"))?,
    );
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if !trimmed.starts_with(ENCRYPTED_FILE_PREFIX) {
        return Err("Unsupported encrypted web cookie cache format".to_string());
    }

    let encoded = &trimmed[ENCRYPTED_FILE_PREFIX.len()..];
    let encrypted = BASE64_STANDARD
        .decode(encoded)
        .map_err(|err| format!("Failed to decode encrypted web cookie cache: {err}"))?;
    let decrypted = Zeroizing::new(decrypt_local_secret_bytes(&encrypted)?);

    let stored = serde_json::from_slice::<StoredWebCookie>(&decrypted)
        .map_err(|err| format!("Failed to parse encrypted web cookie cache payload: {err}"))?;

    if stored.cookie.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(stored))
}

fn delete_web_cookie_file() -> Result<(), String> {
    let path = web_cookie_cache_path()?;
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(&path)
        .map_err(|err| format!("Failed to delete encrypted web cookie cache: {err}"))
}

#[cfg(windows)]
fn encrypt_local_secret_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            ptr::null(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("Failed to encrypt local secret via DPAPI: {code}"));
    }

    let bytes = unsafe {
        std::slice::from_raw_parts(output.pbData as *const u8, output.cbData as usize).to_vec()
    };

    unsafe {
        let _ = LocalFree(output.pbData as *mut std::ffi::c_void);
    }

    Ok(bytes)
}

#[cfg(windows)]
fn decrypt_local_secret_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: cipher.len() as u32,
        pbData: cipher.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut output,
        )
    };

    if ok == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("Failed to decrypt local secret via DPAPI: {code}"));
    }

    let bytes = unsafe {
        std::slice::from_raw_parts(output.pbData as *const u8, output.cbData as usize).to_vec()
    };

    unsafe {
        let _ = LocalFree(output.pbData as *mut std::ffi::c_void);
    }

    Ok(bytes)
}

#[cfg(not(windows))]
fn encrypt_local_secret_bytes(_plain: &[u8]) -> Result<Vec<u8>, String> {
    Err("Encrypted local cookie fallback is currently supported on Windows only".to_string())
}

#[cfg(not(windows))]
fn decrypt_local_secret_bytes(_cipher: &[u8]) -> Result<Vec<u8>, String> {
    Err("Encrypted local cookie fallback is currently supported on Windows only".to_string())
}

#[derive(Debug, Clone)]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
pub struct OAuthAuthorizeUrl {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct OAuthStartLoginRequest {
    pub state: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct OAuthLoginStatus {
    pub completed: bool,
    pub code: Option<String>,
    pub code_verifier: Option<String>,
    pub error: Option<String>,
}

impl Drop for OAuthLoginStatus {
    fn drop(&mut self) {
        self.code.zeroize();
        self.code_verifier.zeroize();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct OAuthFinishStatus {
    pub completed: bool,
    pub authorized: bool,
    pub session: Option<AuthSession>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct WorkerOAuthTokenRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

impl Drop for WorkerOAuthTokenRequest {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
pub struct WorkerExchangeCodeRequest {
    pub grant_type: String,
    pub code: String,
    pub redirect_uri: String,
    pub code_verifier: String,
    auth: Option<WorkerRequestAuth>,
}

impl Drop for WorkerExchangeCodeRequest {
    fn drop(&mut self) {
        self.code.zeroize();
        self.code_verifier.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
pub struct WorkerRefreshTokenRequest {
    pub refresh_token: String,
    pub grant_type: String,
    auth: Option<WorkerRequestAuth>,
}

impl Drop for WorkerRefreshTokenRequest {
    fn drop(&mut self) {
        self.refresh_token.zeroize();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredDeviceKey {
    device_id: String,
    secret_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkerRequestAuth {
    device_id: String,
    device_public_key: String,
    timestamp: i64,
    nonce: String,
    signature: String,
}

struct OAuthCallbackResult {
    code: String,
    code_verifier: String,
}

impl Drop for OAuthCallbackResult {
    fn drop(&mut self) {
        self.code.zeroize();
        self.code_verifier.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
pub struct WorkerExchangeTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user_id: Option<serde_json::Value>,
}

impl Drop for WorkerExchangeTokenResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

pub fn load_token() -> Result<Option<Arc<StoredToken>>, String> {
    let mut cache = lock_token_cache()?;
    if cache.initialized {
        return Ok(cache.token.clone());
    }

    let entry = token_entry()?;
    let loaded = match entry.get_password() {
        Ok(raw) => {
            log_info("loaded token from keyring");
            let raw = Zeroizing::new(raw);
            serde_json::from_str(&raw)
                .map(Some)
                .map_err(|err| format!("Failed to parse stored token: {err}"))
        }
        Err(keyring::Error::NoEntry) => {
            log_info("no token found in keyring");
            load_token_from_file()
        }
        Err(err) => Err(format!("Failed to read token from keyring: {err}")),
    }?;

    cache.token = loaded.map(Arc::new);
    cache.initialized = true;
    Ok(cache.token.clone())
}

pub fn save_token(token: Arc<StoredToken>) -> Result<(), String> {
    let raw = Zeroizing::new(
        serde_json::to_string(token.as_ref())
            .map_err(|err| format!("Failed to serialize token: {err}"))?,
    );

    save_token_to_file(&raw)?;

    let entry = token_entry()?;

    if let Err(err) = entry.set_password(&raw) {
        log_error(&format!(
            "failed to save token to keyring, using file fallback: {err}"
        ));
    } else {
        log_info("saved token to keyring");
    }

    let mut cache = lock_token_cache()?;
    cache.token = Some(token);
    cache.initialized = true;
    log_info("saved token to local session cache");
    Ok(())
}

pub fn delete_token() -> Result<(), String> {
    {
        let mut cache = lock_token_cache()?;
        cache.token = None;
        cache.initialized = true;
    }

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

pub fn session_from_token(token: Option<&StoredToken>) -> AuthSession {
    match token {
        Some(token) => AuthSession {
            authenticated: true,
            source: Some(token.source.clone()),
            scope: token.scope.clone(),
            expires_at: token.expires_at,
            user: token.user.clone(),
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

pub fn load_web_cookie() -> Result<Option<String>, String> {
    let entry = web_cookie_entry()?;

    match read_web_cookie_raw_with_retry(&entry) {
        Ok(Some(raw)) => {
            if let Some(stored) = parse_stored_web_cookie(&raw) {
                let cookie = stored.cookie.trim().to_string();
                set_cached_web_cookie(Some(Arc::new(stored)));
                return Ok(Some(cookie));
            }

            Ok(None)
        }
        Ok(None) => {
            if let Some(stored) = load_web_cookie_from_encrypted_file()? {
                let cookie = stored.cookie.trim().to_string();
                set_cached_web_cookie(Some(Arc::new(stored)));
                return Ok(Some(cookie));
            }

            Ok(load_cached_web_cookie().and_then(|stored| {
                let cookie = stored.cookie.trim().to_string();
                if cookie.is_empty() {
                    None
                } else {
                    Some(cookie)
                }
            }))
        }
        Err(error) => {
            log_error(&format!(
                "failed reading web cookie from keyring, using memory fallback: {error}"
            ));
            if let Some(stored) = load_web_cookie_from_encrypted_file()? {
                let cookie = stored.cookie.trim().to_string();
                set_cached_web_cookie(Some(Arc::new(stored)));
                return Ok(Some(cookie));
            }

            Ok(load_cached_web_cookie().and_then(|stored| {
                let cookie = stored.cookie.trim().to_string();
                if cookie.is_empty() {
                    None
                } else {
                    Some(cookie)
                }
            }))
        }
    }
}

pub fn save_web_cookie(cookie: String) -> Result<WebCookieStatus, String> {
    let mut normalized = cookie.trim().to_string();

    if let Some(stripped) = normalized.strip_prefix("Cookie:") {
        normalized = stripped.trim().to_string();
    }

    if normalized.is_empty() {
        return Err("Cookie 不能为空".to_string());
    }

    validate_web_cookie_header(&normalized)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("Failed to resolve current time: {err}"))?
        .as_secs() as i64;

    let payload = Arc::new(StoredWebCookie {
        cookie: normalized,
        updated_at: now,
    });

    let raw = Zeroizing::new(
        serde_json::to_string(payload.as_ref())
            .map_err(|err| format!("Failed to serialize web cookie: {err}"))?,
    );

    set_cached_web_cookie(Some(payload.clone()));

    let keyring_ok = match web_cookie_entry()?.set_password(&raw) {
        Ok(()) => true,
        Err(err) => {
            log_error(&format!(
                "failed to save web cookie to system keyring, trying encrypted file fallback: {err}"
            ));
            false
        }
    };

    let file_ok = match save_web_cookie_to_encrypted_file(payload.as_ref()) {
        Ok(()) => true,
        Err(err) => {
            log_error(&format!(
                "failed to save encrypted local web cookie cache: {err}"
            ));
            false
        }
    };

    if !keyring_ok && !file_ok {
        return Err(
            "无法保存 Cookie：系统钥匙串与本地加密回退均失败，请检查系统权限或安全策略。"
                .to_string(),
        );
    }

    Ok(WebCookieStatus {
        configured: true,
        updated_at: Some(now),
    })
}

pub fn clear_web_cookie() -> Result<WebCookieStatus, String> {
    set_cached_web_cookie(None);

    let keyring_result = match web_cookie_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!(
            "Failed to clear web cookie from system keyring: {err}"
        )),
    };

    let file_result = delete_web_cookie_file();

    if keyring_result.is_err() && file_result.is_err() {
        return Err(format!(
            "Failed to clear web cookie from both keyring and encrypted file fallback: {} | {}",
            keyring_result.err().unwrap_or_default(),
            file_result.err().unwrap_or_default()
        ));
    }

    Ok(WebCookieStatus {
        configured: false,
        updated_at: None,
    })
}

pub fn web_cookie_status() -> Result<WebCookieStatus, String> {
    let entry = web_cookie_entry()?;

    match read_web_cookie_raw_with_retry(&entry) {
        Ok(Some(raw)) => {
            if let Some(stored) = parse_stored_web_cookie(&raw) {
                let stored = Arc::new(stored);
                set_cached_web_cookie(Some(stored.clone()));
                return Ok(WebCookieStatus {
                    configured: !stored.cookie.trim().is_empty(),
                    updated_at: Some(stored.updated_at),
                });
            }

            Ok(WebCookieStatus {
                configured: false,
                updated_at: None,
            })
        }
        Ok(None) => {
            if let Some(stored) = load_web_cookie_from_encrypted_file()? {
                let stored = Arc::new(stored);
                set_cached_web_cookie(Some(stored.clone()));
                return Ok(WebCookieStatus {
                    configured: !stored.cookie.trim().is_empty(),
                    updated_at: Some(stored.updated_at),
                });
            }

            if let Some(stored) = load_cached_web_cookie() {
                return Ok(WebCookieStatus {
                    configured: !stored.cookie.trim().is_empty(),
                    updated_at: Some(stored.updated_at),
                });
            }

            Ok(WebCookieStatus {
                configured: false,
                updated_at: None,
            })
        }
        Err(error) => {
            log_error(&format!(
                "failed reading web cookie status from keyring, using memory fallback: {error}"
            ));

            if let Some(stored) = load_web_cookie_from_encrypted_file()? {
                let stored = Arc::new(stored);
                set_cached_web_cookie(Some(stored.clone()));
                return Ok(WebCookieStatus {
                    configured: !stored.cookie.trim().is_empty(),
                    updated_at: Some(stored.updated_at),
                });
            }

            if let Some(stored) = load_cached_web_cookie() {
                return Ok(WebCookieStatus {
                    configured: !stored.cookie.trim().is_empty(),
                    updated_at: Some(stored.updated_at),
                });
            }

            Ok(WebCookieStatus {
                configured: false,
                updated_at: None,
            })
        }
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
    Ok(OAuthClientConfig {
        client_id,
        redirect_uri,
    })
}

pub fn start_oauth_login(_state: Option<String>) -> Result<OAuthAuthorizeUrl, String> {
    log_info("starting OAuth login flow");
    let config = load_oauth_client_config()?;
    let receiver_store = OAUTH_LOGIN_RECEIVER.get_or_init(|| Mutex::new(None));
    let mut guard = receiver_store
        .lock()
        .map_err(|_| "OAuth login state lock poisoned".to_string())?;

    if guard.is_some() {
        return Err("OAuth login already in progress".to_string());
    }

    let pending_store = OAUTH_PENDING_CALLBACK.get_or_init(|| Mutex::new(None));
    let mut pending = pending_store
        .lock()
        .map_err(|_| "OAuth pending callback lock poisoned".to_string())?;
    *pending = None;

    let state = generate_oauth_state()?;
    let code_verifier = generate_pkce_verifier()?;
    let code_challenge = pkce_code_challenge(&code_verifier);
    let authorize_url = build_oauth_authorize_url(&config, &state, &code_challenge)?;
    let (tx, rx) = mpsc::channel::<Result<OAuthCallbackResult, String>>();
    *guard = Some(rx);

    std::thread::spawn(move || {
        let result = wait_for_callback_and_capture_code(config, state, code_verifier);
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
                Ok(mut callback) => {
                    log_info("OAuth callback code received");
                    Ok(OAuthLoginStatus {
                        completed: true,
                        code: Some(std::mem::take(&mut callback.code)),
                        code_verifier: Some(std::mem::take(&mut callback.code_verifier)),
                        error: None,
                    })
                }
                Err(error) => {
                    log_error(&format!("OAuth login worker returned error: {error}"));
                    Ok(OAuthLoginStatus {
                        completed: true,
                        code: None,
                        code_verifier: None,
                        error: Some(error),
                    })
                }
            }
        }
        Err(TryRecvError::Empty) => Ok(OAuthLoginStatus {
            completed: false,
            code: None,
            code_verifier: None,
            error: None,
        }),
        Err(TryRecvError::Disconnected) => {
            *guard = None;
            log_error("OAuth login worker disconnected");
            Ok(OAuthLoginStatus {
                completed: true,
                code: None,
                code_verifier: None,
                error: Some("OAuth login worker disconnected".to_string()),
            })
        }
    }
}

pub async fn finish_oauth_login(client: &BangumiClient) -> Result<OAuthFinishStatus, String> {
    let pending_store = OAUTH_PENDING_CALLBACK.get_or_init(|| Mutex::new(None));
    let pending_callback = pending_store
        .lock()
        .map_err(|_| "OAuth pending callback lock poisoned".to_string())?
        .take();

    if let Some(mut callback) = pending_callback {
        let mut exchanged = exchange_code_via_worker(WorkerExchangeCodeRequest {
            grant_type: "authorization_code".to_string(),
            code: std::mem::take(&mut callback.code),
            redirect_uri: OAUTH_REDIRECT_URI.to_string(),
            code_verifier: std::mem::take(&mut callback.code_verifier),
            auth: None,
        })
        .await?;

        let session = login_with_worker_token(
            client,
            WorkerOAuthTokenRequest {
                access_token: std::mem::take(&mut exchanged.access_token),
                refresh_token: std::mem::take(&mut exchanged.refresh_token),
            },
        )
        .await?;

        return Ok(OAuthFinishStatus {
            completed: true,
            authorized: true,
            session: Some(session),
            error: None,
        });
    }

    let mut status = wait_oauth_login_result()?;
    if !status.completed {
        return Ok(OAuthFinishStatus {
            completed: false,
            authorized: false,
            session: None,
            error: None,
        });
    }

    if let Some(error) = status.error.take() {
        return Ok(OAuthFinishStatus {
            completed: true,
            authorized: false,
            session: None,
            error: Some(error),
        });
    }

    let code = status
        .code
        .take()
        .ok_or_else(|| "OAuth callback missing code".to_string())?;
    let code_verifier = status
        .code_verifier
        .take()
        .ok_or_else(|| "OAuth callback missing PKCE verifier".to_string())?;
    let mut pending = pending_store
        .lock()
        .map_err(|_| "OAuth pending callback lock poisoned".to_string())?;
    *pending = Some(OAuthCallbackResult {
        code,
        code_verifier,
    });

    Ok(OAuthFinishStatus {
        completed: false,
        authorized: true,
        session: None,
        error: None,
    })
}

fn wait_for_callback_and_capture_code(
    config: OAuthClientConfig,
    expected_state: String,
    code_verifier: String,
) -> Result<OAuthCallbackResult, String> {
    let mut code_verifier = Zeroizing::new(code_verifier);
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
    log_info(&format!(
        "listening for OAuth callback on {host}:{port}{callback_path}"
    ));
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
                    write_callback_response(
                        &mut stream,
                        false,
                        "OAuth callback path mismatch",
                        None,
                    );
                    continue;
                }

                let callback_state = callback_url.query_pairs().find_map(|(key, value)| {
                    if key == "state" {
                        Some(value.into_owned())
                    } else {
                        None
                    }
                });

                if callback_state.as_deref() != Some(expected_state.as_str()) {
                    write_callback_response(
                        &mut stream,
                        false,
                        "OAuth state validation failed",
                        None,
                    );
                    log_error("rejected OAuth callback with mismatched state");
                    continue;
                }

                let code = match callback_url
                    .query_pairs()
                    .find_map(|(key, value)| (key == "code").then(|| value.into_owned()))
                {
                    Some(code) => code,
                    None => {
                        write_callback_response(
                            &mut stream,
                            false,
                            "授权回调缺少 code 参数，请返回应用重试。",
                            None,
                        );
                        return Err("OAuth callback missing code".to_string());
                    }
                };

                write_callback_response(
                    &mut stream,
                    true,
                    "Bangumi 授权完成，此页面可直接关闭。登录流程尚未完成。",
                    None,
                );
                log_info("OAuth callback handled successfully");

                return Ok(OAuthCallbackResult {
                    code,
                    code_verifier: std::mem::take(&mut *code_verifier),
                });
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

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn build_callback_html(message: &str, success: bool, theme: Option<&str>) -> String {
    let escaped_message = escape_html(message);
    let status_text = if success {
        "OAuth 登录成功"
    } else {
        "OAuth 登录未完成"
    };
    let icon = if success { "✓" } else { "!" };
    let theme_attr = theme.unwrap_or("auto");

    format!(
        r#"<!doctype html>
<html lang="zh-CN" data-theme="{theme_attr}">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SimpBangumi OAuth</title>
        <style>
            :root {{
                color-scheme: light dark;
                --bg: #f4f6fb;
                --bg-accent: radial-gradient(circle at 10% 10%, rgba(90, 127, 255, 0.14), transparent 40%),
                    radial-gradient(circle at 85% 15%, rgba(34, 197, 94, 0.12), transparent 42%);
                --panel: rgba(255, 255, 255, 0.84);
                --panel-border: rgba(255, 255, 255, 0.85);
                --text: #1f2937;
                --muted: #6b7280;
                --ring: rgba(37, 99, 235, 0.25);
                --ok: #15803d;
                --warn: #b45309;
            }}

            @media (prefers-color-scheme: dark) {{
                :root {{
                    --bg: #0f172a;
                    --bg-accent: radial-gradient(circle at 15% 10%, rgba(96, 165, 250, 0.18), transparent 42%),
                        radial-gradient(circle at 85% 20%, rgba(34, 197, 94, 0.14), transparent 45%);
                    --panel: rgba(15, 23, 42, 0.75);
                    --panel-border: rgba(148, 163, 184, 0.24);
                    --text: #e5e7eb;
                    --muted: #94a3b8;
                    --ring: rgba(96, 165, 250, 0.35);
                    --ok: #4ade80;
                    --warn: #f59e0b;
                }}
            }}

            html[data-theme='light'] {{
                --bg: #f4f6fb;
                --bg-accent: radial-gradient(circle at 10% 10%, rgba(90, 127, 255, 0.14), transparent 40%),
                    radial-gradient(circle at 85% 15%, rgba(34, 197, 94, 0.12), transparent 42%);
                --panel: rgba(255, 255, 255, 0.84);
                --panel-border: rgba(255, 255, 255, 0.85);
                --text: #1f2937;
                --muted: #6b7280;
                --ring: rgba(37, 99, 235, 0.25);
                --ok: #15803d;
                --warn: #b45309;
            }}

            html[data-theme='dark'] {{
                --bg: #0f172a;
                --bg-accent: radial-gradient(circle at 15% 10%, rgba(96, 165, 250, 0.18), transparent 42%),
                    radial-gradient(circle at 85% 20%, rgba(34, 197, 94, 0.14), transparent 45%);
                --panel: rgba(15, 23, 42, 0.75);
                --panel-border: rgba(148, 163, 184, 0.24);
                --text: #e5e7eb;
                --muted: #94a3b8;
                --ring: rgba(96, 165, 250, 0.35);
                --ok: #4ade80;
                --warn: #f59e0b;
            }}

            * {{ box-sizing: border-box; }}

            body {{
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
                color: var(--text);
                background: var(--bg-accent), var(--bg);
            }}

            .card {{
                width: min(560px, calc(100vw - 32px));
                border-radius: 20px;
                border: 1px solid var(--panel-border);
                background: var(--panel);
                backdrop-filter: blur(14px);
                box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
                padding: 28px 24px;
            }}

            .brand {{
                font-size: 12px;
                letter-spacing: 0.12em;
                text-transform: uppercase;
                color: var(--muted);
                margin-bottom: 12px;
            }}

            .status {{
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 10px;
            }}

            .badge {{
                width: 34px;
                height: 34px;
                border-radius: 50%;
                display: grid;
                place-items: center;
                font-weight: 700;
                color: {icon_color};
                background: {icon_bg};
                box-shadow: inset 0 0 0 1px {icon_ring};
            }}

            h1 {{
                margin: 0;
                font-size: 23px;
                line-height: 1.35;
            }}

            p {{
                margin: 10px 0 0;
                line-height: 1.72;
                color: var(--muted);
                font-size: 15px;
            }}

            .tip {{
                margin-top: 16px;
                font-size: 13px;
                color: var(--muted);
                border-top: 1px solid var(--ring);
                padding-top: 14px;
            }}
        </style>
    </head>
    <body>
        <main class="card">
            <div class="brand">SimpBangumi</div>
            <div class="status">
                <div class="badge" aria-hidden="true">{icon}</div>
                <h1>{status_text}</h1>
            </div>
            <p>{escaped_message}</p>
            <p class="tip">登录流程尚未完成，请切回 SimpBangumi 查看登录状态。</p>
        </main>
    </body>
</html>"#,
        icon_color = if success { "var(--ok)" } else { "var(--warn)" },
        icon_bg = if success {
            "color-mix(in srgb, var(--ok) 16%, transparent)"
        } else {
            "color-mix(in srgb, var(--warn) 16%, transparent)"
        },
        icon_ring = if success {
            "color-mix(in srgb, var(--ok) 32%, transparent)"
        } else {
            "color-mix(in srgb, var(--warn) 32%, transparent)"
        }
    )
}

fn write_callback_response(
    stream: &mut std::net::TcpStream,
    success: bool,
    message: &str,
    theme: Option<&str>,
) {
    let body = build_callback_html(message, success, theme);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub fn build_oauth_authorize_url(
    config: &OAuthClientConfig,
    state: &str,
    code_challenge: &str,
) -> Result<OAuthAuthorizeUrl, String> {
    let mut url = Url::parse(&format!("{AUTH_BASE_URL}/oauth/authorize"))
        .map_err(|err| format!("Failed to build OAuth authorize URL: {err}"))?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &config.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &config.redirect_uri);

        query
            .append_pair("state", state)
            .append_pair("code_challenge", code_challenge)
            .append_pair("code_challenge_method", "S256");
    }

    Ok(OAuthAuthorizeUrl {
        url: url.to_string(),
    })
}

fn generate_pkce_verifier() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| format!("Failed to generate PKCE verifier: {error}"))?;
    let verifier = BASE64_URL.encode(bytes);
    bytes.zeroize();
    Ok(verifier)
}

fn pkce_code_challenge(verifier: &str) -> String {
    BASE64_URL.encode(digest(&SHA256, verifier.as_bytes()).as_ref())
}

fn generate_oauth_state() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| format!("Failed to generate OAuth state: {error}"))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

pub async fn login_with_personal_access_token(
    client: &BangumiClient,
    token: String,
) -> Result<AuthSession, String> {
    log_info("logging in with personal access token");
    let mut token = Zeroizing::new(token);
    let user = client.me(&token).await?;

    let stored = Arc::new(StoredToken {
        access_token: std::mem::take(&mut *token),
        refresh_token: None,
        token_type: Some("Bearer".to_string()),
        scope: None,
        expires_at: None,
        source: TokenSource::PersonalAccessToken,
        user: Some(user),
    });

    save_token(stored.clone())?;
    Ok(session_from_token(Some(stored.as_ref())))
}

pub async fn login_with_worker_token(
    client: &BangumiClient,
    mut req: WorkerOAuthTokenRequest,
) -> Result<AuthSession, String> {
    log_info(&format!(
        "logging in with worker token (has_refresh_token={})",
        req.refresh_token.is_some()
    ));
    let user = client.me(&req.access_token).await?;

    let stored = Arc::new(StoredToken {
        access_token: std::mem::take(&mut req.access_token),
        refresh_token: std::mem::take(&mut req.refresh_token),
        token_type: Some("Bearer".to_string()),
        scope: None,
        expires_at: None,
        source: TokenSource::OAuth,
        user: Some(user),
    });

    save_token(stored.clone())?;
    Ok(session_from_token(Some(stored.as_ref())))
}

pub async fn refresh_saved_oauth_session_if_current(
    client: &BangumiClient,
    failed_access_token: Option<&str>,
) -> Result<AuthSession, String> {
    log_info("refreshing saved OAuth session");
    let _refresh_guard = OAUTH_REFRESH_LOCK.lock().await;
    let stored = load_token()?.ok_or_else(|| "No stored Bangumi session".to_string())?;

    if failed_access_token.is_some_and(|failed| failed != stored.access_token) {
        log_info("OAuth session was already refreshed by another request");
        return Ok(session_from_token(Some(stored.as_ref())));
    }

    if !matches!(stored.source, TokenSource::OAuth) {
        return Err("Stored session is not an OAuth session".to_string());
    }

    let mut refresh_token = Zeroizing::new(
        stored
            .refresh_token
            .clone()
            .ok_or_else(|| "Stored OAuth session has no refresh token".to_string())?,
    );

    let mut refreshed = refresh_token_via_worker(WorkerRefreshTokenRequest {
        refresh_token: refresh_token.to_string(),
        grant_type: "refresh_token".to_string(),
        auth: None,
    })
    .await?;

    log_info(&format!(
        "worker refresh completed (has_refresh_token={})",
        refreshed.refresh_token.is_some()
    ));

    login_with_worker_token(
        client,
        WorkerOAuthTokenRequest {
            access_token: std::mem::take(&mut refreshed.access_token),
            refresh_token: std::mem::take(&mut refreshed.refresh_token)
                .or_else(|| Some(std::mem::take(&mut *refresh_token))),
        },
    )
    .await
}

pub fn is_auth_error(error: &str) -> bool {
    error.contains("401") || error.contains("403")
}

fn load_or_create_device_key() -> Result<StoredDeviceKey, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_DEVICE_ACCOUNT);
    match entry {
        Ok(entry) => match entry.get_password() {
            Ok(raw) => {
                let stored = parse_stored_device_key(&raw)?;
                log_info(&format!(
                    "device key loaded source=keyring device_id={}",
                    stored.device_id
                ));
                if let Err(error) = save_device_key_to_file(&stored) {
                    log_error(&format!(
                        "failed to refresh encrypted device key fallback: {error}"
                    ));
                }
                Ok(stored)
            }
            Err(keyring::Error::NoEntry) => {
                if let Some(stored) = load_device_key_from_file()? {
                    if let Err(error) = entry.set_password(&serialize_device_key(&stored)?) {
                        log_error(&format!("failed to restore device key to keyring: {error}"));
                    }
                    log_info(&format!(
                        "device key loaded source=encrypted-file-fallback device_id={}",
                        stored.device_id
                    ));
                    return Ok(stored);
                }
                create_and_store_device_key(&entry)
            }
            Err(error) => {
                if let Some(stored) = load_device_key_from_file()? {
                    log_error(&format!(
                        "device keyring unavailable, using encrypted fallback: {error}"
                    ));
                    log_info(&format!(
                        "device key loaded source=encrypted-file-fallback device_id={}",
                        stored.device_id
                    ));
                    return Ok(stored);
                }
                Err(format!(
                    "Device keyring unavailable and no encrypted fallback exists: {error}"
                ))
            }
        },
        Err(error) => {
            if let Some(stored) = load_device_key_from_file()? {
                log_error(&format!(
                    "device keyring unavailable, using encrypted fallback: {error}"
                ));
                log_info(&format!(
                    "device key loaded source=encrypted-file-fallback device_id={}",
                    stored.device_id
                ));
                return Ok(stored);
            }
            Err(format!(
                "Device keyring unavailable and no encrypted fallback exists: {error}"
            ))
        }
    }
}

fn create_and_store_device_key(entry: &Entry) -> Result<StoredDeviceKey, String> {
    let mut secret = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut secret)
        .map_err(|e| e.to_string())?;
    Ed25519KeyPair::from_seed_unchecked(&secret)
        .map_err(|e| format!("Failed to create device key: {e}"))?;
    let stored = StoredDeviceKey {
        device_id: BASE64_URL.encode(&secret[..16]),
        secret_key: BASE64_URL.encode(secret),
    };
    let serialized = serialize_device_key(&stored)?;
    if let Err(error) = entry.set_password(&serialized) {
        save_device_key_to_file(&stored).map_err(|fallback| {
            format!("Failed to save device key to keyring: {error}; encrypted fallback also failed: {fallback}")
        })?;
    } else if let Err(error) = save_device_key_to_file(&stored) {
        log_error(&format!(
            "failed to save encrypted device key fallback: {error}"
        ));
    }
    log_info(&format!(
        "device key loaded source=newly-created device_id={}",
        stored.device_id
    ));
    Ok(stored)
}

fn serialize_device_key(key: &StoredDeviceKey) -> Result<String, String> {
    serde_json::to_string(key).map_err(|error| format!("Failed to serialize device key: {error}"))
}

fn parse_stored_device_key(raw: &str) -> Result<StoredDeviceKey, String> {
    let stored = serde_json::from_str::<StoredDeviceKey>(raw)
        .map_err(|error| format!("Invalid stored device key: {error}"))?;
    let secret = BASE64_URL
        .decode(&stored.secret_key)
        .map_err(|error| format!("Invalid stored device key secret: {error}"))?;
    let secret: [u8; 32] = secret
        .try_into()
        .map_err(|_| "Invalid stored device key secret length".to_string())?;
    Ed25519KeyPair::from_seed_unchecked(&secret)
        .map_err(|error| format!("Invalid stored device key secret: {error}"))?;
    let expected_device_id = BASE64_URL.encode(&secret[..16]);
    if stored.device_id != expected_device_id {
        return Err(
            "Stored device key is inconsistent: device_id does not match secret_key".to_string(),
        );
    }
    Ok(stored)
}

fn load_device_key_from_file() -> Result<Option<StoredDeviceKey>, String> {
    let path = device_key_cache_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read encrypted device key fallback: {error}"))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !trimmed.starts_with(ENCRYPTED_FILE_PREFIX) {
        return Err("Unsupported encrypted device key fallback format".to_string());
    }
    let encrypted = BASE64_STANDARD
        .decode(&trimmed[ENCRYPTED_FILE_PREFIX.len()..])
        .map_err(|error| format!("Failed to decode encrypted device key fallback: {error}"))?;
    let decrypted = decrypt_local_secret_bytes(&encrypted)?;
    let raw = String::from_utf8(decrypted)
        .map_err(|error| format!("Invalid encrypted device key fallback text: {error}"))?;
    parse_stored_device_key(&raw).map(Some)
}

fn save_device_key_to_file(key: &StoredDeviceKey) -> Result<(), String> {
    let path = device_key_cache_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create device key fallback directory: {error}"))?;
    }
    let serialized = serialize_device_key(key)?;
    let encrypted = encrypt_local_secret_bytes(serialized.as_bytes())?;
    let encoded = format!(
        "{ENCRYPTED_FILE_PREFIX}{}",
        BASE64_STANDARD.encode(encrypted)
    );
    fs::write(&path, encoded)
        .map_err(|error| format!("Failed to write encrypted device key fallback: {error}"))
}
fn worker_auth(
    key: &StoredDeviceKey,
    grant_type: &str,
    value: &str,
    binding: Option<&str>,
) -> Result<WorkerRequestAuth, String> {
    let secret = BASE64_URL
        .decode(&key.secret_key)
        .map_err(|e| format!("Invalid device key: {e}"))?;
    let secret: [u8; 32] = secret
        .try_into()
        .map_err(|_| "Invalid device key length".to_string())?;
    let signing = Ed25519KeyPair::from_seed_unchecked(&secret)
        .map_err(|e| format!("Invalid device key: {e}"))?;
    let mut nonce_bytes = [0u8; 24];
    rand::rngs::OsRng
        .try_fill_bytes(&mut nonce_bytes)
        .map_err(|e| e.to_string())?;
    let nonce = BASE64_URL.encode(nonce_bytes);
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let message_value = binding
        .map(|extra| format!("{value}.{extra}"))
        .unwrap_or_else(|| value.to_string());
    let message = format!(
        "{WORKER_SIGNATURE_VERSION}.{grant_type}.{}.{}.{}.{}",
        key.device_id, timestamp, nonce, message_value
    );
    let device_public_key = BASE64_URL.encode(signing.public_key().as_ref());
    let signature = BASE64_URL.encode(signing.sign(message.as_bytes()).as_ref());
    log_info(&format!("device request signed version={WORKER_SIGNATURE_VERSION} grant_type={grant_type} device_id={} public_key_len={} timestamp={} nonce_prefix={} message_len={} value_len={} binding_present={}", key.device_id, device_public_key.len(), timestamp, &nonce[..8.min(nonce.len())], message.len(), value.len(), binding.is_some()));
    Ok(WorkerRequestAuth {
        device_id: key.device_id.clone(),
        device_public_key,
        timestamp,
        nonce,
        signature,
    })
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

    let mut req = req;
    let device_key = load_or_create_device_key()?;
    req.auth = Some(worker_auth(
        &device_key,
        "authorization_code",
        &req.code,
        Some(&req.code_verifier),
    )?);
    log_info(&format!("posting authorization-code request worker_url={} device_id={} code_len={} code_verifier_len={}", WORKER_PROXY_URL, device_key.device_id, req.code.len(), req.code_verifier.len()));
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

    let mut req = req;
    let device_key = load_or_create_device_key()?;
    req.auth = Some(worker_auth(
        &device_key,
        "refresh_token",
        &req.refresh_token,
        None,
    )?);
    log_info(&format!(
        "posting refresh-token request worker_url={} device_id={} refresh_token_len={}",
        WORKER_PROXY_URL,
        device_key.device_id,
        req.refresh_token.len()
    ));
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

fn web_cookie_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_WEB_COOKIE_ACCOUNT)
        .map_err(|err| format!("Failed to open web cookie keyring entry: {err}"))
}

fn load_token_from_file() -> Result<Option<StoredToken>, String> {
    let path = token_cache_path()?;

    if !path.exists() {
        log_info("no token found in local session cache");
        return Ok(None);
    }

    let raw = Zeroizing::new(
        fs::read_to_string(&path)
            .map_err(|err| format!("Failed to read local session cache: {err}"))?,
    );
    log_info("loaded token from local session cache");

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.starts_with(ENCRYPTED_FILE_PREFIX) {
        let encoded = &trimmed[ENCRYPTED_FILE_PREFIX.len()..];
        let encrypted = BASE64_STANDARD
            .decode(encoded)
            .map_err(|err| format!("Failed to decode encrypted local session cache: {err}"))?;
        let decrypted = Zeroizing::new(decrypt_local_secret_bytes(&encrypted)?);

        return serde_json::from_slice::<StoredToken>(&decrypted)
            .map(Some)
            .map_err(|err| format!("Failed to parse encrypted local session cache: {err}"));
    }

    serde_json::from_str(trimmed)
        .map(Some)
        .map_err(|err| format!("Failed to parse local session cache: {err}"))
}

fn save_token_to_file(raw: &str) -> Result<(), String> {
    let path = token_cache_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create local session cache directory: {err}"))?;
    }

    let encrypted = encrypt_local_secret_bytes(raw.as_bytes())?;
    let encoded = format!(
        "{ENCRYPTED_FILE_PREFIX}{}",
        BASE64_STANDARD.encode(encrypted)
    );

    fs::write(&path, encoded).map_err(|err| format!("Failed to write local session cache: {err}"))
}

fn delete_token_file() -> Result<(), String> {
    let path = token_cache_path()?;

    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(&path).map_err(|err| format!("Failed to delete local session cache: {err}"))
}

fn token_cache_path() -> Result<PathBuf, String> {
    let base_dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "Failed to resolve local session cache directory".to_string())?;

    Ok(base_dir.join(SESSION_CACHE_DIR).join(SESSION_CACHE_FILE))
}

fn web_cookie_cache_path() -> Result<PathBuf, String> {
    let base_dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "Failed to resolve web cookie cache directory".to_string())?;

    Ok(base_dir.join(SESSION_CACHE_DIR).join(WEB_COOKIE_CACHE_FILE))
}

fn device_key_cache_path() -> Result<PathBuf, String> {
    let base_dir = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| "Failed to resolve device key fallback directory".to_string())?;

    Ok(base_dir.join(SESSION_CACHE_DIR).join(DEVICE_KEY_CACHE_FILE))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_matches_rfc7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_code_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    }

    #[test]
    fn generated_pkce_verifier_is_valid_length_and_charset() {
        let verifier = generate_pkce_verifier().expect("verifier generation");
        assert_eq!(verifier.len(), 43);
        assert!(verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte)));
    }

    #[test]
    fn oauth_authorize_url_does_not_request_unsupported_scope() {
        let config = OAuthClientConfig {
            client_id: "test-client".to_string(),
            redirect_uri: "http://127.0.0.1:46231/oauth/callback".to_string(),
        };
        let authorize = build_oauth_authorize_url(&config, "test-state", "test-challenge")
            .expect("authorize URL");
        let url = Url::parse(&authorize.url).expect("valid authorize URL");
        let query = url.query_pairs().collect::<BTreeMap<_, _>>();

        assert!(!query.contains_key("scope"));
        assert_eq!(
            query.get("client_id").map(|value| value.as_ref()),
            Some("test-client")
        );
        assert_eq!(
            query.get("response_type").map(|value| value.as_ref()),
            Some("code")
        );
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
    }
}
