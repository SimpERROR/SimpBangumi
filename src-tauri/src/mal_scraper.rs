use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MalAnimeInfo {
    pub mal_id: u64,
    pub title: String,
    pub title_english: Option<String>,
    pub title_japanese: Option<String>,
    pub status: Option<String>,
    pub episodes: Option<u32>,
    pub duration: Option<String>,
    pub broadcast_day: Option<String>,
    pub broadcast_time: Option<String>,
    pub aired_from: Option<String>,
    pub aired_to: Option<String>,
    pub score: Option<f64>,
}

/// Scrape anime info from myanimelist.net/anime/{mal_id}
pub async fn scrape_anime(mal_id: u64) -> Result<MalAnimeInfo, String> {
    crate::log_info(&format!("mal_scrape: fetching MAL #{mal_id}"));
    let url = format!("https://myanimelist.net/anime/{mal_id}");
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| {
            crate::log_error(&format!("mal_scrape: fetch failed for MAL #{mal_id}: {e}"));
            format!("Failed to fetch MAL page: {e}")
        })?;

    let status = response.status();
    if !status.is_success() {
        crate::log_error(&format!("mal_scrape: MAL #{mal_id} returned HTTP {status}"));
        return Err(format!("MAL returned HTTP {status}"));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read MAL page: {e}"))?;

    let info = parse_mal_html(&html, mal_id).map_err(|e| {
        crate::log_error(&format!("mal_scrape: parse failed for MAL #{mal_id}: {e}"));
        e
    })?;

    crate::log_info(&format!(
        "mal_scrape: MAL #{} parsed OK — title={}, status={:?}, broadcast={:?} @ {:?}",
        mal_id, info.title, info.status, info.broadcast_day, info.broadcast_time,
    ));
    Ok(info)
}

fn parse_mal_html(html: &str, mal_id: u64) -> Result<MalAnimeInfo, String> {
    let title = extract_og_title(html)
        .or_else(|| extract_page_title(html))
        .unwrap_or_else(|| "Unknown".to_string());

    let title_english = extract_sidebar_alt_title(html, "English:")
        .or_else(|| extract_sidebar_alt_title(html, "English"))
        .filter(|s| !s.is_empty());

    let title_japanese = extract_sidebar_alt_title(html, "Japanese:")
        .or_else(|| extract_sidebar_alt_title(html, "Japanese"))
        .filter(|s| !s.is_empty());

    let status = extract_sidebar_value(html, "Status:");
    let episodes_str = extract_sidebar_value(html, "Episodes:");
    let episodes = episodes_str
        .and_then(|s| s.trim().parse::<u32>().ok());

    let duration = extract_sidebar_value(html, "Duration:");

    let aired = extract_sidebar_value(html, "Aired:");
    let (aired_from, aired_to) = parse_aired(&aired);

    let broadcast_raw = extract_sidebar_value(html, "Broadcast:");
    let (broadcast_day, broadcast_time) = parse_broadcast(&broadcast_raw);

    let score_str = extract_sidebar_value(html, "Score:");
    let score = score_str
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|&s| s > 0.0);

    Ok(MalAnimeInfo {
        mal_id,
        title,
        title_english,
        title_japanese,
        status,
        episodes,
        duration,
        broadcast_day,
        broadcast_time,
        aired_from,
        aired_to,
        score,
    })
}

/// Extract og:title meta content
fn extract_og_title(html: &str) -> Option<String> {
    // Find <meta property="og:title" content="Title Here"/>
    let needle = "og:title";
    let pos = html.find(needle)?;
    let after = &html[pos + needle.len()..];
    // Find content="
    let content_pos = after.find("content=\"")?;
    let after_content = &after[content_pos + "content=\"".len()..];
    let end = after_content.find('"')?;
    let title = after_content[..end].trim().to_string();
    if title.is_empty() || title.len() < 2 {
        None
    } else {
        Some(title)
    }
}

/// Extract <title> tag content
fn extract_page_title(html: &str) -> Option<String> {
    let start = html.find("<title>")?;
    let after = &html[start + "<title>".len()..];
    let end = after.find("</title>")?;
    let raw = after[..end].trim().to_string();
    // MAL titles are like "Anime Name - MyAnimeList.net"
    let title = raw
        .split(" - ")
        .next()
        .unwrap_or(&raw)
        .trim()
        .to_string();
    if title.is_empty() || title.len() < 2 {
        None
    } else {
        Some(title)
    }
}

/// Extract title_english / title_japanese from sidebar "English:" / "Japanese:" labels
fn extract_sidebar_alt_title(html: &str, label: &str) -> Option<String> {
    let value = extract_sidebar_value(html, label)?;
    if value.is_empty() || value == "-" {
        None
    } else {
        Some(value)
    }
}

/// Extract a value from the MAL sidebar info table
/// MAL sidebar has <span class="dark_text">Label:</span> value pattern
fn extract_sidebar_value(html: &str, label: &str) -> Option<String> {
    // Find the label's closing </span> tag
    let search = format!("\">{}</span>", label);
    let pos = html.find(&search)?;
    let after_label = &html[pos + search.len()..];

    // Extract text until the next structural tag: <span, <br, </div, <div
    let value_end = after_label
        .find("<span")
        .or_else(|| after_label.find("<br"))
        .or_else(|| after_label.find("</div"))
        .or_else(|| after_label.find("<div"))
        .unwrap_or(after_label.len());

    let raw = &after_label[..value_end];
    let cleaned = strip_html_tags(raw).trim().to_string();

    // Limit to reasonable length (status/duration values should be short)
    let truncated: String = cleaned.chars().take(200).collect();
    let result = truncated.trim().to_string();

    if !result.is_empty() && result != "-" && result != "Unknown" && result != "N/A" {
        Some(result)
    } else {
        None
    }
}

/// Strip HTML tags and decode entities from a string
fn strip_html_tags(input: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<' {
            in_tag = true;
        } else if chars[i] == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(chars[i]);
        }
        i += 1;
    }
    // Decode common HTML entities
    result = result.replace("&amp;", "&");
    result = result.replace("&lt;", "<");
    result = result.replace("&gt;", ">");
    result = result.replace("&quot;", "\"");
    result = result.replace("&#039;", "'");
    result = result.replace("&nbsp;", " ");
    result
}

/// Parse "Aired: Jan 7, 2024 to Mar 24, 2024" into (from, to) ISO-like strings
fn parse_aired(aired: &Option<String>) -> (Option<String>, Option<String>) {
    let text = match aired {
        Some(s) => s.as_str(),
        None => return (None, None),
    };

    let parts: Vec<&str> = text.split(" to ").collect();
    let from = parts.first().map(|s| parse_date_str(s.trim()));
    let to = parts.get(1).map(|s| parse_date_str(s.trim()));
    (from.flatten(), to.flatten())
}

/// Parse "Mondays at 22:00 (JST)" into (day, time)
fn parse_broadcast(raw: &Option<String>) -> (Option<String>, Option<String>) {
    let text = match raw {
        Some(s) => s.as_str(),
        None => return (None, None),
    };

    let day = DAY_NAMES
        .iter()
        .find(|&&d| text.to_lowercase().contains(&d.to_lowercase()))
        .map(|&d| d.to_string());

    // Extract HH:MM
    let time = if let Some(pos) = text.find(|c: char| c.is_ascii_digit()) {
        let after = &text[pos..];
        if after.len() >= 5 && after.chars().nth(2) == Some(':') {
            Some(after[..5].to_string())
        } else {
            None
        }
    } else {
        None
    };

    (day, time)
}

const DAY_NAMES: &[&str] = &[
    "Mondays", "Tuesdays", "Wednesdays", "Thursdays",
    "Fridays", "Saturdays", "Sundays",
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
];

/// Parse "Jan 7, 2024" to "2024-01-07"
fn parse_date_str(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s == "?" || s == "Not available" {
        return None;
    }

    let months: &[(&str, u32)] = &[
        ("Jan", 1), ("Feb", 2), ("Mar", 3), ("Apr", 4),
        ("May", 5), ("Jun", 6), ("Jul", 7), ("Aug", 8),
        ("Sep", 9), ("Oct", 10), ("Nov", 11), ("Dec", 12),
    ];

    for &(abbr, num) in months {
        if s.starts_with(abbr) {
            let rest = &s[abbr.len()..].trim();
            // "7, 2024" or "7 2024"
            let rest = rest.trim_start_matches(',').trim();
            let parts: Vec<&str> = rest.splitn(2, |c: char| c == ',' || c == ' ').collect();
            if parts.len() >= 2 {
                let day: u32 = parts[0].trim().parse().ok()?;
                let year: u32 = parts[1].trim().parse().ok()?;
                return Some(format!("{:04}-{:02}-{:02}", year, num, day));
            }
            break;
        }
    }
    None
}

#[tauri::command]
pub async fn mal_scrape_anime(mal_id: u64) -> Result<MalAnimeInfo, String> {
    scrape_anime(mal_id).await
}
