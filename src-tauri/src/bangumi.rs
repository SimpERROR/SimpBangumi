use std::collections::BTreeMap;

use reqwest::{header, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

pub const API_BASE_URL: &str = "https://api.bgm.tv";
pub const USER_AGENT: &str = "bangumi-client/0.1.0 (Tauri desktop app)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiUser {
    pub id: u64,
    pub username: String,
    pub nickname: String,
    pub sign: Option<String>,
    pub avatar: Value,
}

pub struct BangumiClient {
    http: reqwest::Client,
    access_token: Option<String>,
}

impl BangumiClient {
    pub fn new(access_token: Option<String>) -> Result<Self, String> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/json"),
        );

        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .build()
            .map_err(|err| format!("Failed to build Bangumi HTTP client: {err}"))?;

        Ok(Self { http, access_token })
    }

    pub async fn me(&self) -> Result<BangumiUser, String> {
        self.get_json("/v0/me", None).await
    }

    pub async fn get_json<T>(
        &self,
        path: &str,
        query: Option<BTreeMap<String, String>>,
    ) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let value = self
            .request_json(Method::GET, path, query, None)
            .await?;

        serde_json::from_value(value)
            .map_err(|err| format!("Failed to parse Bangumi API response: {err}"))
    }

    pub async fn request_json(
        &self,
        method: Method,
        path: &str,
        query: Option<BTreeMap<String, String>>,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let url = api_url(path, query)?;
        let mut request = self.http.request(method, url);

        if let Some(token) = self.access_token.as_deref() {
            request = request.bearer_auth(token);
        }

        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request
            .send()
            .await
            .map_err(|err| format!("Bangumi API request failed: {err}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("Failed to read Bangumi API response: {err}"))?;

        if !status.is_success() {
            return Err(format!("Bangumi API returned {status}: {body}"));
        }

        if body.trim().is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&body)
                .map_err(|err| format!("Failed to parse Bangumi API JSON: {err}"))
        }
    }
}

fn api_url(path: &str, query: Option<BTreeMap<String, String>>) -> Result<Url, String> {
    if !path.starts_with('/') || path.contains("://") {
        return Err("Bangumi API path must be an absolute API path like /v0/me".to_string());
    }

    let mut url = Url::parse(&format!("{API_BASE_URL}{path}"))
        .map_err(|err| format!("Invalid Bangumi API path: {err}"))?;

    if let Some(query) = query {
        let mut pairs = url.query_pairs_mut();

        for (key, value) in query {
            pairs.append_pair(&key, &value);
        }
    }

    Ok(url)
}
