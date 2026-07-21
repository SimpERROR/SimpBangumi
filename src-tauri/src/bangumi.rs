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
            let cleaned = strip_null_fields(body);
            request = request.json(&cleaned);
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

/// Recursively remove null fields from a JSON Value (Object or Array).
/// This prevents Tauri IPC from leaking `undefined`→`null` into API requests,
/// which would cause Bangumi API to reject fields like `vol_status: null`.
fn strip_null_fields(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let cleaned: serde_json::Map<String, Value> = map
                .into_iter()
                .filter_map(|(k, v)| {
                    let v = strip_null_fields(v);
                    if v.is_null() {
                        None
                    } else {
                        Some((k, v))
                    }
                })
                .collect();
            Value::Object(cleaned)
        }
        Value::Array(arr) => {
            Value::Array(arr.into_iter().map(strip_null_fields).collect())
        }
        other => other,
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
