use keyring::Entry;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use url::Url;

use crate::bangumi::{BangumiClient, BangumiUser};

const KEYRING_SERVICE: &str = "bangumi-client";
const KEYRING_ACCOUNT: &str = "bangumi-token";
const AUTH_BASE_URL: &str = "https://bgm.tv";

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

#[derive(Debug, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthExchangeRequest {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct OAuthAuthorizeRequest {
    pub client_id: String,
    pub redirect_uri: String,
    pub state: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OAuthAuthorizeUrl {
    pub url: String,
}

pub fn load_token() -> Result<Option<StoredToken>, String> {
    let entry = token_entry()?;

    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|err| format!("Failed to parse stored token: {err}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("Failed to read token from keyring: {err}")),
    }
}

pub fn save_token(token: &StoredToken) -> Result<(), String> {
    let entry = token_entry()?;
    let raw = serde_json::to_string(token)
        .map_err(|err| format!("Failed to serialize token: {err}"))?;

    entry
        .set_password(&raw)
        .map_err(|err| format!("Failed to save token to keyring: {err}"))
}

pub fn delete_token() -> Result<(), String> {
    let entry = token_entry()?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to delete token from keyring: {err}")),
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

pub fn build_oauth_authorize_url(req: OAuthAuthorizeRequest) -> Result<OAuthAuthorizeUrl, String> {
    let mut url = Url::parse(&format!("{AUTH_BASE_URL}/oauth/authorize"))
        .map_err(|err| format!("Failed to build OAuth authorize URL: {err}"))?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &req.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &req.redirect_uri);

        if let Some(state) = req.state.as_deref() {
            query.append_pair("state", state);
        }

        if let Some(scope) = req.scope.as_deref() {
            query.append_pair("scope", scope);
        }
    }

    Ok(OAuthAuthorizeUrl {
        url: url.to_string(),
    })
}

pub async fn login_with_personal_access_token(token: String) -> Result<AuthSession, String> {
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

pub async fn exchange_oauth_code(req: OAuthExchangeRequest) -> Result<AuthSession, String> {
    let http = reqwest::Client::builder()
        .user_agent(crate::bangumi::USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;

    let response = http
        .post(format!("{AUTH_BASE_URL}/oauth/access_token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", req.client_id.as_str()),
            ("client_secret", req.client_secret.as_str()),
            ("redirect_uri", req.redirect_uri.as_str()),
            ("code", req.code.as_str()),
        ])
        .send()
        .await
        .map_err(|err| format!("OAuth token request failed: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OAuth token request failed with {status}: {body}"));
    }

    let token_response = response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|err| format!("Failed to parse OAuth token response: {err}"))?;

    let client = BangumiClient::new(Some(token_response.access_token.clone()))?;
    let user = client.me().await?;

    let stored = StoredToken {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        token_type: token_response.token_type,
        scope: token_response.scope,
        expires_at: token_response
            .expires_in
            .map(|seconds| OffsetDateTime::now_utc().unix_timestamp() + seconds),
        source: TokenSource::OAuth,
        user: Some(user),
    };

    save_token(&stored)?;
    Ok(session_from_token(Some(stored)))
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|err| format!("Failed to open keyring entry: {err}"))
}
