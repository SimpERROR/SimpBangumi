use serde::{Deserialize, Serialize};
use serde_json::json;
use url::form_urlencoded::byte_serialize;

fn encode(value: &str) -> String {
    byte_serialize(value.as_bytes()).collect()
}

/// Unified external-platform rating result, score always normalized to a 0-10 scale.
#[derive(Debug, Clone, Serialize)]
pub struct ExternalRatingInfo {
    pub matched_title: String,
    pub score: f64,
    pub votes: Option<u64>,
    pub url: Option<String>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) SimpBangumi/1.0")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

#[derive(Deserialize)]
struct AniListResponse {
    data: Option<AniListData>,
}
#[derive(Deserialize)]
struct AniListData {
    #[serde(rename = "Media")]
    media: Option<AniListMedia>,
}
#[derive(Deserialize)]
struct AniListMedia {
    title: AniListTitle,
    #[serde(rename = "averageScore")]
    average_score: Option<f64>,
    #[serde(rename = "siteUrl")]
    site_url: Option<String>,
}
#[derive(Deserialize)]
struct AniListTitle {
    romaji: Option<String>,
    english: Option<String>,
}

#[tauri::command]
pub async fn anilist_search_rating(title: String) -> Result<Option<ExternalRatingInfo>, String> {
    let query = r#"
        query ($search: String) {
          Media(search: $search, type: ANIME) {
            title { romaji english }
            averageScore
            siteUrl
          }
        }
    "#;
    let client = http_client()?;
    let response = client
        .post("https://graphql.anilist.co")
        .json(&json!({ "query": query, "variables": { "search": title } }))
        .send()
        .await
        .map_err(|e| format!("AniList request failed: {e}"))?;

    if !response.status().is_success() {
        return Ok(None);
    }
    let parsed: AniListResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse AniList response: {e}"))?;
    let media = match parsed.data.and_then(|d| d.media) {
        Some(m) => m,
        None => return Ok(None),
    };
    let score = match media.average_score {
        Some(s) if s > 0.0 => s / 10.0,
        _ => return Ok(None),
    };
    Ok(Some(ExternalRatingInfo {
        matched_title: media
            .title
            .english
            .or(media.title.romaji)
            .unwrap_or_default(),
        score,
        // AniList exposes popularity, not the number of users who rated the title.
        votes: None,
        url: media.site_url,
    }))
}

#[derive(Deserialize)]
struct TmdbSearchResponse {
    #[serde(default)]
    results: Vec<TmdbResult>,
}
#[derive(Deserialize)]
struct TmdbResult {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    media_type: Option<String>,
    #[serde(default)]
    first_air_date: Option<String>,
    #[serde(default)]
    release_date: Option<String>,
    id: u64,
    vote_average: Option<f64>,
    vote_count: Option<u64>,
}

fn tmdb_result_year(result: &TmdbResult) -> Option<u32> {
    result
        .first_air_date
        .as_deref()
        .or(result.release_date.as_deref())
        .and_then(|d| d.get(..4))
        .and_then(|y| y.parse::<u32>().ok())
}

async fn tmdb_search_once(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    path: &str,
    year_param: &str,
    year: Option<u32>,
    multi: bool,
) -> Result<Option<ExternalRatingInfo>, String> {
    let mut url = format!(
        "https://api.themoviedb.org/3{}?api_key={}&query={}",
        path,
        api_key,
        encode(query)
    );
    if let Some(y) = year {
        url.push_str(&format!("&{year_param}={y}"));
    }
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("TMDB request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("TMDB returned HTTP {}", response.status()));
    }
    let parsed: TmdbSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse TMDB response: {e}"))?;

    // 不要盲取第一个结果：优先年份匹配，其次投票数最多，避免选到同名冷门条目（如 10.0 分 1 票）。
    let mut best: Option<&TmdbResult> = None;
    for result in &parsed.results {
        if multi && !matches!(result.media_type.as_deref(), Some("tv") | Some("movie")) {
            continue;
        }
        if result.vote_average.filter(|&s| s > 0.0).is_none() {
            continue;
        }
        // A title can exist as both a movie and a series (and TMDB search often
        // returns localized/episode entries). When the Bangumi item has a year,
        // never select a result from another year. The caller retries without a
        // year only after this strict search has been attempted.
        if let Some(expected_year) = year {
            if tmdb_result_year(result) != Some(expected_year) {
                continue;
            }
        }
        let votes = result.vote_count.unwrap_or(0);
        if votes < 5 {
            continue; // 票数过低的同名条目不可信
        }
        let better = match best {
            None => true,
            Some(current) => votes > current.vote_count.unwrap_or(0),
        };
        if better {
            best = Some(result);
        }
    }

    let Some(best) = best else { return Ok(None) };
    let score = best.vote_average.expect("filtered above");
    let kind = if multi {
        best.media_type.as_deref().unwrap_or("tv")
    } else if path.ends_with("/movie") {
        "movie"
    } else {
        "tv"
    };
    Ok(Some(ExternalRatingInfo {
        matched_title: best.name.clone().or_else(|| best.title.clone()).unwrap_or_default(),
        score,
        votes: best.vote_count,
        url: Some(format!("https://www.themoviedb.org/{kind}/{}", best.id)),
    }))
}

#[tauri::command]
pub async fn tmdb_search_rating(
    title: String,
    api_key: String,
    year: Option<u32>,
    additional_queries: Vec<String>,
) -> Result<Option<ExternalRatingInfo>, String> {
    if api_key.trim().is_empty() {
        return Err("未配置 TMDB API Key".to_string());
    }
    let client = http_client()?;
    // 动画既可能是剧集也可能是电影：依次尝试 TV → Movie → Multi，先带年份、搜不到再去掉年份。
    for query in scrape_queries(&title, additional_queries) {
        let paths = [
            ("/search/tv", "first_air_date_year", false),
            ("/search/movie", "year", false),
            ("/search/multi", "year", true),
        ];
        // Search every media type with the known year before relaxing it. This
        // prevents a wrong-year TV result from hiding the correct movie result.
        if year.is_some() {
            for (path, year_param, multi) in paths {
                if let Some(info) = tmdb_search_once(&client, &api_key, &query, path, year_param, year, multi).await? {
                    return Ok(Some(info));
                }
            }
        }
        // Some entries use a re-release/air date that differs from Bangumi's year.
        for (path, year_param, multi) in paths {
            if let Some(info) = tmdb_search_once(&client, &api_key, &query, path, year_param, None, multi).await? {
                return Ok(Some(info));
            }
        }
    }
    Ok(None)
}

#[derive(Deserialize)]
struct OmdbResponse {
    #[serde(rename = "Title")]
    title: Option<String>,
    #[serde(rename = "imdbRating")]
    imdb_rating: Option<String>,
    #[serde(rename = "imdbVotes")]
    imdb_votes: Option<String>,
    #[serde(rename = "imdbID")]
    imdb_id: Option<String>,
    #[serde(rename = "Response")]
    response: Option<String>,
    #[serde(rename = "Error")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct OmdbSearchResponse {
    #[serde(rename = "Search", default)]
    search: Vec<OmdbSearchItem>,
    #[serde(rename = "Response")]
    response: Option<String>,
    #[serde(rename = "Error")]
    error: Option<String>,
}
#[derive(Deserialize)]
struct OmdbSearchItem {
    #[serde(rename = "imdbID")]
    imdb_id: String,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Year", default)]
    year: String,
}

/// Fatal OMDb errors should surface to the user instead of masquerading as "not found".
fn omdb_fatal_error(error: &str) -> Option<String> {
    let normalized = error.to_lowercase();
    if normalized.contains("invalid api key") || normalized.contains("no api key") {
        return Some("OMDb API Key 无效，请检查设置中的密钥".to_string());
    }
    if normalized.contains("limit") {
        return Some("OMDb 请求次数已达上限，请稍后再试".to_string());
    }
    None
}

/// IMDb has no free public API; OMDb wraps IMDb data and is used as the data source here.
#[tauri::command]
pub async fn imdb_search_rating(
    title: String,
    api_key: String,
    year: Option<u32>,
    additional_queries: Vec<String>,
) -> Result<Option<ExternalRatingInfo>, String> {
    if api_key.trim().is_empty() {
        return Err("未配置 OMDb API Key".to_string());
    }
    let client = http_client()?;
    // 依次尝试 series → movie → 不限类型。t= 精确匹配对动漫日文名过于苛刻，
    // 改为先用 s= 宽松搜索拿到 imdbID，再用 i= 取详情评分。
    let type_filters: [Option<&str>; 3] = [Some("series"), Some("movie"), None];
    let mut found_but_unrated = false;
    for query in scrape_queries(&title, additional_queries) {
        for type_filter in type_filters {
            let mut search_url = format!(
                "https://www.omdbapi.com/?apikey={}&s={}",
                api_key,
                encode(&query)
            );
            if let Some(t) = type_filter {
                search_url.push_str(&format!("&type={t}"));
            }
            // Do not pass OMDb's optional `y` filter here. For upcoming anime and titles whose
            // release year differs between databases, OMDb can return `Movie not found!` even
            // though the title is present and rated. We still prefer a matching year below.
            let response = client
                .get(&search_url)
                .send()
                .await
                .map_err(|e| format!("OMDb request failed: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("OMDb returned HTTP {}", response.status()));
            }
            let parsed: OmdbSearchResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse OMDb response: {e}"))?;
            if parsed.response.as_deref() != Some("True") {
                if let Some(error) = parsed.error.as_deref().and_then(omdb_fatal_error) {
                    return Err(error);
                }
                continue;
            }

            // 优先选年份匹配的条目，否则取第一条。
            let best = year
                .and_then(|y| {
                    parsed.search.iter().find(|item| {
                        item.year
                            .get(..4)
                            .and_then(|s| s.parse::<u32>().ok())
                            == Some(y)
                    })
                })
                .or_else(|| parsed.search.first());
            let Some(best) = best else { continue };

            let detail_url = format!(
                "https://www.omdbapi.com/?apikey={}&i={}",
                api_key, best.imdb_id
            );
            let detail_response = client
                .get(&detail_url)
                .send()
                .await
                .map_err(|e| format!("OMDb request failed: {e}"))?;
            if !detail_response.status().is_success() {
                return Err(format!("OMDb returned HTTP {}", detail_response.status()));
            }
            let detail: OmdbResponse = detail_response
                .json()
                .await
                .map_err(|e| format!("Failed to parse OMDb response: {e}"))?;
            if detail.response.as_deref() != Some("True") {
                if let Some(error) = detail.error.as_deref().and_then(omdb_fatal_error) {
                    return Err(error);
                }
                continue;
            }
            let score: f64 = match detail.imdb_rating.as_deref() {
                Some(s) if s != "N/A" => s.parse().unwrap_or(0.0),
                _ => {
                    found_but_unrated = true;
                    continue;
                }
            };
            if score <= 0.0 {
                found_but_unrated = true;
                continue;
            }
            let votes = detail
                .imdb_votes
                .as_deref()
                .filter(|v| *v != "N/A")
                .map(|v| v.replace(',', ""))
                .and_then(|v| v.parse::<u64>().ok());
            return Ok(Some(ExternalRatingInfo {
                matched_title: detail.title.unwrap_or_else(|| best.title.clone()),
                score,
                votes,
                url: detail
                    .imdb_id
                    .map(|id| format!("https://www.imdb.com/title/{id}/")),
            }));
        }
    }
    if found_but_unrated {
        return Err("已在 IMDb 找到该条目，但该条目暂无 IMDb 评分".to_string());
    }
    Ok(None)
}

fn scrape_http_client() -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(
        reqwest::header::ACCEPT_LANGUAGE,
        reqwest::header::HeaderValue::from_static("en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"),
    );
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

/// Reads a number (digits, optionally with a decimal point) immediately following `needle`.
fn parse_number_after(html: &str, needle: &str) -> Option<String> {
    let pos = html.find(needle)?;
    // JSON-LD uses both numeric values (`"ratingValue":7.0`) and quoted
    // strings (`"ratingValue":"7.0"`). Accept either form, including
    // whitespace between the field and value.
    let mut after = html[pos + needle.len()..].trim_start();
    if let Some(stripped) = after.strip_prefix('"') {
        after = stripped;
    }
    let end = after.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(after.len());
    let raw = after[..end].trim();
    if raw.is_empty() { None } else { Some(raw.to_string()) }
}

/// Extracts the text between `<title>` and `</title>`, stripping the given site suffix.
fn extract_title_tag(html: &str, strip_suffix: &str) -> Option<String> {
    let start = html.find("<title>")? + "<title>".len();
    let end = html[start..].find("</title>")? + start;
    let raw = html[start..end].trim();
    Some(raw.strip_suffix(strip_suffix).unwrap_or(raw).trim().to_string())
}

/// Finds every unique title href matching one of the given prefixes whose ID starts with a digit
/// (e.g. `href="/tv/228744-..."`), skipping site navigation links like `/movie/now-playing`.
fn find_title_hrefs(html: &str, prefixes: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    for prefix in prefixes {
        let marker = format!("href=\"{prefix}");
        let mut search_from = html;
        while let Some(pos) = search_from.find(&marker) {
            let after = &search_from[pos + marker.len()..];
            let end = after.find('"').unwrap_or(after.len());
            let path = &after[..end];
            let full_path = format!("{prefix}{path}");
            if path.chars().next().is_some_and(|c| c.is_ascii_digit()) && !paths.contains(&full_path) {
                paths.push(full_path);
            }
            search_from = &after[1..];
        }
    }
    paths
}

/// Build the query list for scraping: the primary title plus any additional queries
/// (original title, romaji, etc.), deduplicated.
fn scrape_queries(title: &str, additional_queries: Vec<String>) -> Vec<String> {
    let mut queries = vec![title.to_string()];
    for extra in additional_queries {
        let extra = extra.trim().to_string();
        if !extra.is_empty() && !queries.contains(&extra) {
            queries.push(extra);
        }
    }
    queries
}

/// Extracts the numeric TMDB id from a detail path like `/tv/228744-kimi-to-...`.
fn numeric_id_from_path(path: &str) -> Option<u64> {
    let start = path.find(|c: char| c.is_ascii_digit())?;
    let end = path[start..].find(|c: char| !c.is_ascii_digit()).unwrap_or(path.len() - start) + start;
    path[start..end].parse().ok()
}

/// Collects rating candidates from the JSON tree for the object(s) whose `id` matches the
/// subject. Keeps the one with the most votes: sub-objects (episodes/seasons/recommendation
/// mirrors) can share the id but carry junk data like 10.0 with 1 vote.
fn collect_tmdb_rating_candidates(
    value: &serde_json::Value,
    subject_id: u64,
    best: &mut Option<(f64, u64, String)>,
) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("id").and_then(|i| i.as_u64()) == Some(subject_id) {
                if let Some(score) = map.get("vote_average").and_then(|s| s.as_f64()).filter(|&s| s > 0.0) {
                    let votes = map.get("vote_count").and_then(|v| v.as_u64()).unwrap_or(0);
                    // 少于 5 票的对象（子对象/占位数据）不可信，跳过
                    if votes >= 5 {
                        let title = map
                            .get("name")
                            .or_else(|| map.get("title"))
                            .and_then(|t| t.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let is_better = best.as_ref().is_none_or(|(_, best_votes, _)| votes > *best_votes);
                        if is_better {
                            *best = Some((score, votes, title));
                        }
                    }
                }
            }
            for child in map.values() {
                collect_tmdb_rating_candidates(child, subject_id, best);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_tmdb_rating_candidates(item, subject_id, best);
            }
        }
        _ => {}
    }
}

/// Parses the TMDB detail page. Prefers the page's own JSON-LD `aggregateRating` (which is
/// always the main entity), then falls back to walking the embedded `__NEXT_DATA__` JSON by
/// subject id. Never uses the first `vote_average` occurrence on the page — recommendations
/// and other embedded data would yield the wrong score.
// TMDB's JSON-LD can expose stale tiny samples (for example 8.2 based on 10 votes).
// Treat those as untrusted so they cannot replace the main subject score.
const MIN_TMDB_VOTES: u64 = 100;

fn tmdb_detail_year(html: &str) -> Option<u32> {
    for field in ["\"release_date\":\"", "\"first_air_date\":\"", "\"datePublished\":\""] {
        if let Some(pos) = html.find(field) {
            if let Some(year) = html[pos + field.len()..].get(..4).and_then(|value| value.parse::<u32>().ok()) {
                return Some(year);
            }
        }
    }
    None
}

fn parse_tmdb_detail(html: &str, subject_id: u64) -> Option<(f64, Option<u64>, String)> {
    let title = extract_title_tag(html, " — The Movie Database (TMDB)").unwrap_or_default();

    // 1) JSON-LD aggregateRating of the main entity
    if let Some(pos) = html.find("\"aggregateRating\"") {
        if let Some(score) = parse_number_after(&html[pos..], "\"ratingValue\":")
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|&s| s > 0.0)
        {
            let votes = parse_number_after(&html[pos..], "\"ratingCount\":")
                .and_then(|s| s.parse::<u64>().ok());
            if votes.is_some_and(|count| count >= MIN_TMDB_VOTES) {
                return Some((score, votes, title));
            }
        }
    }

    // 2) __NEXT_DATA__ JSON, matched by subject id and filtered by vote count
    if let Some(start) = html.find("__NEXT_DATA__") {
        if let Some(tag_rel_end) = html[start..].find('>') {
            let json_start = start + tag_rel_end + 1;
            if let Some(script_rel_end) = html[json_start..].find("</script>") {
                let json_end = json_start + script_rel_end;
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&html[json_start..json_end]) {
                    let mut best: Option<(f64, u64, String)> = None;
                    collect_tmdb_rating_candidates(&value, subject_id, &mut best);
                    if let Some((score, votes, matched_title)) = best {
                        let matched_title = if matched_title.is_empty() { title } else { matched_title };
                        return Some((score, Some(votes), matched_title));
                    }
                }
            }
        }
    }

    None
}
#[tauri::command]
pub async fn tmdb_scrape_rating(
    title: String,
    year: Option<u32>,
    additional_queries: Vec<String>,
) -> Result<Option<ExternalRatingInfo>, String> {
    let client = scrape_http_client()?;
    let mut last_page_len = 0;
    for query in scrape_queries(&title, additional_queries) {
        crate::log_info(&format!("tmdb_scrape: searching for \"{query}\""));
        let search_url = format!("https://www.themoviedb.org/search?query={}", encode(&query));
        let search_html = client
            .get(&search_url)
            .send()
            .await
            .map_err(|e| format!("TMDB search request failed: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Failed to read TMDB search page: {e}"))?;
        last_page_len = search_html.len();
        if last_page_len < 3000 {
            crate::log_error("tmdb_scrape: search page looks like a bot-challenge page");
            return Err("TMDB 拒绝了请求（可能触发了反爬虫），建议在设置中切换为官方 API 模式".to_string());
        }
        let paths = find_title_hrefs(&search_html, &["/tv/", "/movie/"]);
        if paths.is_empty() {
            continue;
        }

        // Search-page ordering is not a reliable identity signal. Inspect its title candidates,
        // then prefer an exact release-year match and the largest vote sample.
        let mut best: Option<(bool, u64, ExternalRatingInfo)> = None;
        for path in paths.into_iter().take(12) {
            let Some(subject_id) = numeric_id_from_path(&path) else { continue };
            let detail_url = format!("https://www.themoviedb.org{path}");
            let detail_html = client
                .get(&detail_url)
                .send()
                .await
                .map_err(|e| format!("TMDB detail request failed: {e}"))?
                .text()
                .await
                .map_err(|e| format!("Failed to read TMDB detail page: {e}"))?;
            let Some((score, votes, matched_title)) = parse_tmdb_detail(&detail_html, subject_id) else { continue };
            let vote_count = votes.unwrap_or(0);
            if vote_count < MIN_TMDB_VOTES {
                continue;
            }
            let year_match = year.is_some_and(|expected| tmdb_detail_year(&detail_html) == Some(expected));
            let candidate = ExternalRatingInfo {
                matched_title,
                score,
                votes,
                url: Some(detail_url),
            };
            let is_better = best.as_ref().is_none_or(|(best_year_match, best_votes, _)| {
                if year_match != *best_year_match {
                    year_match
                } else {
                    vote_count > *best_votes
                }
            });
            if is_better {
                best = Some((year_match, vote_count, candidate));
            }
        }
        if let Some((_, _, info)) = best {
            return Ok(Some(info));
        }
    }

    crate::log_info(&format!(
        "tmdb_scrape: no numeric result link for \"{title}\" (last search page length {last_page_len})"
    ));
    let _ = year; // year is only used to disambiguate results in the API mode
    Ok(None)
}

#[derive(Deserialize)]
struct ImdbSuggestionResponse {
    #[serde(default)]
    d: Vec<ImdbSuggestionItem>,
}
#[derive(Deserialize)]
struct ImdbSuggestionItem {
    id: String,
    #[serde(default)]
    l: Option<String>,
    #[serde(default)]
    y: Option<u32>,
}

/// Resolve an IMDb title ID via the lightweight suggestion JSON endpoint, which is far less
/// likely to be blocked than the HTML /find page.
async fn imdb_suggest(
    client: &reqwest::Client,
    query: &str,
    year: Option<u32>,
) -> Result<Option<(String, String)>, String> {
    let first = query.chars().next().unwrap_or('a').to_ascii_lowercase();
    let url = format!(
        "https://v2.sg.media-imdb.com/suggestion/{}/{}.json",
        first,
        encode(query)
    );
    let response = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("IMDb suggestion request failed: {e}"))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let parsed: ImdbSuggestionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse IMDb suggestion response: {e}"))?;
    let items: Vec<&ImdbSuggestionItem> = parsed.d.iter().filter(|i| i.id.starts_with("tt")).collect();
    if let Some(y) = year {
        if let Some(item) = items.iter().find(|i| i.y == Some(y)) {
            return Ok(Some((item.id.clone(), item.l.clone().unwrap_or_else(|| query.to_string()))));
        }
    }
    Ok(items.first().map(|i| {
        (i.id.clone(), i.l.clone().unwrap_or_else(|| query.to_string()))
    }))
}

/// Scrape an IMDb rating, no API key required.
#[tauri::command]
pub async fn imdb_scrape_rating(
    title: String,
    year: Option<u32>,
    additional_queries: Vec<String>,
) -> Result<Option<ExternalRatingInfo>, String> {
    let client = scrape_http_client()?;
    for query in scrape_queries(&title, additional_queries) {
        crate::log_info(&format!("imdb_scrape: searching for \"{query}\""));
        let (imdb_id, suggested_title) = match imdb_suggest(&client, &query, year).await? {
            Some(x) => x,
            None => continue, // try the next query (romaji fallback)
        };

        let detail_url = format!("https://www.imdb.com/title/{imdb_id}/");
        let detail_html = client
            .get(&detail_url)
            .send()
            .await
            .map_err(|e| format!("IMDb detail request failed: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Failed to read IMDb detail page: {e}"))?;
        if detail_html.len() < 3000 {
            crate::log_error(&format!(
                "imdb_scrape: detail page for {imdb_id} looks like a bot-challenge page (length {})",
                detail_html.len()
            ));
            return Err("IMDb 拒绝了请求（可能触发了反爬虫或所在地区无法直接访问 IMDb），建议在设置中切换为 OMDb API 模式".to_string());
        }

        let score = parse_number_after(&detail_html, "\"ratingValue\":")
            .or_else(|| parse_number_after(&detail_html, "itemprop=\"ratingValue\" content=\""))
            .and_then(|s| s.parse::<f64>().ok());
        if let Some(score) = score.filter(|&s| s > 0.0) {
            let votes = parse_number_after(&detail_html, "\"ratingCount\":").and_then(|s| s.parse::<u64>().ok());
            let matched_title = extract_title_tag(&detail_html, " - IMDb").unwrap_or(suggested_title);
            return Ok(Some(ExternalRatingInfo {
                matched_title,
                score,
                votes,
                url: Some(detail_url),
            }));
        }
        crate::log_info(&format!(
            "imdb_scrape: no ratingValue found on {detail_url} (page length {})",
            detail_html.len()
        ));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::parse_number_after;

    #[test]
    fn parses_json_ld_numbers_and_strings() {
        assert_eq!(parse_number_after(r#"{"ratingValue":7.0}"#, "\"ratingValue\":"), Some("7.0".into()));
        assert_eq!(parse_number_after(r#"{"ratingValue":"7.0"}"#, "\"ratingValue\":"), Some("7.0".into()));
        assert_eq!(parse_number_after(r#"{"ratingValue": 7.0}"#, "\"ratingValue\":"), Some("7.0".into()));
    }
}
