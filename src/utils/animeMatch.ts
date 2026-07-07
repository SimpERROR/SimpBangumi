import { TenraiApi, type TenraiAnimeFull, type TenraiAnimeSearchItem } from "../api/Tenrai";
import { compareImages, TenraiImageUrl, bgmImageUrl } from "./imageCompare";
import { toRomaji, romajiTitleScore } from "./romaji";
import { invoke } from "@tauri-apps/api/core";

export interface ScoreBreakdown {
  year: { score: number; bgmYear: number | null; TenraiYear: number | null };
  episodes: { score: number; bgmEps: number | null; TenraiEps: number | null };
  type: { score: number; TenraiType: string | null };
  status: { score: number; TenraiStatus: string | null };
  image: { score: number; distance: number | null };
  title: { score: number; bgmRomaji: string; TenraiRomaji: string };
  total: number;
}

export interface ScoredCandidate {
  item: TenraiAnimeSearchItem;
  score: ScoreBreakdown;
}

export interface AnimeMatchInfo {
  /** Bangumi subject ID */
  bgmId: number;
  /** Matched MyAnimeList ID */
  malId: number;
  /** Tenrai full anime data (for broadcast info) */
  data: TenraiAnimeFull | null;
  /** Timestamp when this match was cached */
  cachedAt: number;
  /** Timestamp when detail data was last fetched */
  detailFetchedAt?: number;
  /** Data source used for full anime details */
  detailSource?: string;
  /** All candidates with their scores (for debug panel) */
  candidates?: ScoredCandidate[];
}

const MATCH_CACHE_KEY = "bangumi.Tenrai.matchMap";
const SUPPRESSED_KEY = "bangumi.Tenrai.suppressed";
const CONFIRMED_KEY = "bangumi.Tenrai.confirmed";
const DETAIL_SOURCE_KEY = "bangumi.broadcast.detailSource";
const MIN_MATCH_SCORE = 50;

const CONFIRM_SCORE_GAP = 25;
const CONFIRM_MIN_SCORE = 90;

function loadMatchCache(): Record<number, AnimeMatchInfo> {
  try {
    const raw = localStorage.getItem(MATCH_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<number, AnimeMatchInfo>;
  } catch {
    return {};
  }
}

function saveMatchCache(cache: Record<number, AnimeMatchInfo>): void {
  try {
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Parse a Bangumi date string (e.g. "2024-01-07" or "2024-01") to a year number */
function parseBgmYear(airDate?: string): number | null {
  if (!airDate) return null;
  const match = airDate.trim().match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/** Parse Tenrai aired.from year (nullable, from search items) */
function TenraiYear(item: TenraiAnimeSearchItem): number | null {
  return item.aired?.prop?.from?.year ?? null;
}

function matchScoreDetail(candidate: TenraiAnimeSearchItem, bgmName: string, bgmYear?: number | null, bgmEpisodes?: number | null): ScoreBreakdown {
  const jYear = TenraiYear(candidate);
  let yearScore = 0;
  if (bgmYear !== null && bgmYear !== undefined && jYear === bgmYear) {
    yearScore = 100;
  } else if (bgmYear !== null && bgmYear !== undefined && jYear !== null) {
    const diff = Math.abs(jYear - bgmYear);
    if (diff === 1) yearScore = 40;
    else if (diff === 2) yearScore = 20;
    else yearScore = -20;
  }

  let epScore = 0;
  if (bgmEpisodes !== null && bgmEpisodes !== undefined && bgmEpisodes > 0 && candidate.episodes === bgmEpisodes) {
    epScore = 20;
  } else if (bgmEpisodes !== null && bgmEpisodes !== undefined && bgmEpisodes > 0 && candidate.episodes !== null) {
    const diff = Math.abs(candidate.episodes - bgmEpisodes);
    if (diff <= 2) epScore = 10;
    else if (diff <= 5) epScore = 5;
  }

  const typeScore = candidate.type === "TV" ? 30 : 0;

  const statusScore = (candidate.status === "Finished Airing" || candidate.status === "Currently Airing") ? 10 : 0;

  const bgmRomaji = toRomaji(bgmName);
  const TenraiRomaji = toRomaji(candidate.title_japanese || candidate.title);
  const titleScore = romajiTitleScore(bgmRomaji, candidate.title, candidate.title_japanese, candidate.title_english);

  return {
    year: { score: yearScore, bgmYear: bgmYear ?? null, TenraiYear: jYear },
    episodes: { score: epScore, bgmEps: bgmEpisodes ?? null, TenraiEps: candidate.episodes },
    type: { score: typeScore, TenraiType: candidate.type },
    status: { score: statusScore, TenraiStatus: candidate.status },
    image: { score: 0, distance: null },
    title: { score: titleScore, bgmRomaji: bgmRomaji.slice(0, 40), TenraiRomaji: TenraiRomaji.slice(0, 40) },
    total: yearScore + epScore + typeScore + statusScore + titleScore,
  };
}

/** Legacy wrapper for backward compatibility */
function matchScore(candidate: TenraiAnimeSearchItem, bgmName: string, bgmYear?: number | null, bgmEpisodes?: number | null): number {
  return matchScoreDetail(candidate, bgmName, bgmYear, bgmEpisodes).total;
}

/**
 * Match a Bangumi anime subject to a Tenrai/MAL entry.
 *
 * Strategy:
 * 1. If year AND episodes both match a candidate exactly → LOCK the match immediately.
 * 2. Otherwise, score candidates by year/episode closeness and pick the best.
 *
 * @param bgmId     Bangumi subject ID
 * @param bgmName   Bangumi subject name (original Japanese name for Tenrai search)
 * @param bgmAirDate Bangumi air_date (e.g. "2024-01-07"), used to extract year
 * @param bgmEpisodes Total episodes from Bangumi (eps field)
 * @param bgmImages  Bangumi subject images record (for cover comparison)
 */
export async function matchAnimeToTenrai(
  bgmId: number,
  bgmName: string,
  bgmAirDate?: string,
  bgmEpisodes?: number,
  bgmImages?: Record<string, string | undefined>,
): Promise<AnimeMatchInfo | null> {
  // Check cache first
  const cache = loadMatchCache();
  const cached = cache[bgmId];
  if (cached) {
    return cached;
  }

  const bgmYear = parseBgmYear(bgmAirDate);
  const eps = bgmEpisodes && bgmEpisodes > 0 ? bgmEpisodes : null;

  try {
    const searchResult = await TenraiApi.searchAnime(bgmName);
    if (!searchResult.data || searchResult.data.length === 0) {
      return null;
    }

    // Deduplicate by mal_id (Tenrai may return dupes like TV vs Movie version)
    const seen = new Set<number>();
    const uniqueResults = searchResult.data.filter((item) => {
      if (seen.has(item.mal_id)) return false;
      seen.add(item.mal_id);
      return true;
    });

    // ── Score all candidates ──
    let scoredCandidates: ScoredCandidate[] = uniqueResults
      .map((item) => ({ item, score: matchScoreDetail(item, bgmName, bgmYear, eps) }))
      .sort((a, b) => b.score.total - a.score.total);

    // ── Image comparison for top 5 candidates ──
    const bgmUrl = bgmImageUrl(bgmImages);
    const topForImage = scoredCandidates.slice(0, 5);
    const imageScores = await Promise.all(
      topForImage.map((sc) =>
        compareImages(bgmUrl, TenraiImageUrl(sc.item.images)).then((result) => {
          if (result !== null) {
            sc.score.image.score = result.score;
            sc.score.image.distance = result.distance;
            sc.score.total += result.score;
          }
        }),
      ),
    );
    await Promise.allSettled(imageScores);

    // Re-sort with image scores
    scoredCandidates.sort((a, b) => b.score.total - a.score.total);

    const best = scoredCandidates[0];
    if (!best || best.score.total < MIN_MATCH_SCORE) {
      return null;
    }
    const bestMalId = best.item.mal_id;

    const detailSource = (localStorage.getItem(DETAIL_SOURCE_KEY) || "tenrai");

    // Fetch full anime data for broadcast info
    let fullData: TenraiAnimeFull | null = null;
    try {
      fullData = await fetchMalAnimeFull(bestMalId);
    } catch {
      // Full data fetch failed, but we still have the match
    }

    const matchInfo: AnimeMatchInfo = {
      bgmId,
      malId: bestMalId,
      data: fullData,
      cachedAt: Date.now(),
      detailFetchedAt: fullData ? Date.now() : undefined,
      detailSource,
      candidates: scoredCandidates.slice(0, 20),
    };

    // Save to cache
    cache[bgmId] = matchInfo;
    saveMatchCache(cache);

    return matchInfo;
  } catch {
    return null;
  }
}

/**
 * Manually set/override the Tenrai match for a Bangumi subject.
 */
export function setManualMatch(
  bgmId: number,
  match: AnimeMatchInfo,
): void {
  const cache = loadMatchCache();
  match.cachedAt = Date.now();
  cache[bgmId] = match;
  saveMatchCache(cache);
}

/**
 * Get cached match info without triggering a search.
 */
export function getCachedMatch(bgmId: number): AnimeMatchInfo | null {
  const cache = loadMatchCache();
  return cache[bgmId] ?? null;
}

/**
 * Search Tenrai for anime candidates (for manual matching UI).
 */
export async function searchTenraiForMatch(
  query: string,
  limit = 10,
): Promise<TenraiAnimeSearchItem[]> {
  const result = await TenraiApi.searchAnime(query, limit);
  return result.data ?? [];
}

/**
 * Fetch full anime info for a given MAL ID, respecting user's data source preference.
 */
export async function fetchMalAnimeFull(
  malId: number,
): Promise<TenraiAnimeFull | null> {
  const source = localStorage.getItem(DETAIL_SOURCE_KEY) || "tenrai";
  if (source === "mal") {
    return fetchMalAnimeFullViaScraping(malId);
  }
  try {
    const response = await TenraiApi.getAnimeFull(malId);
    return response.data;
  } catch {
    return null;
  }
}

/** Raw MAL scraper result from Rust backend */
interface MalScrapeResult {
  mal_id: number;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  status: string | null;
  episodes: number | null;
  duration: string | null;
  broadcast_day: string | null;
  broadcast_time: string | null;
  aired_from: string | null;
  aired_to: string | null;
  score: number | null;
}

/** Convert MAL scraped data to TenraiAnimeFull format */
function malToTenraiFull(mal: MalScrapeResult): TenraiAnimeFull {
  const broadcastStr =
    mal.broadcast_day && mal.broadcast_time
      ? `${mal.broadcast_day} at ${mal.broadcast_time} (JST)`
      : null;
  return {
    mal_id: mal.mal_id,
    url: `https://myanimelist.net/anime/${mal.mal_id}`,
    title: mal.title,
    title_english: mal.title_english ?? null,
    title_japanese: mal.title_japanese ?? null,
    type: null,
    status: mal.status ?? null,
    episodes: mal.episodes ?? null,
    aired: {
      from: mal.aired_from ?? null,
      to: mal.aired_to ?? null,
      prop: {
        from: { day: null, month: null, year: null },
        to: { day: null, month: null, year: null },
      },
      string: [mal.aired_from, mal.aired_to].filter(Boolean).join(" to ") || null,
    },
    duration: mal.duration ?? null,
    rating: null,
    score: mal.score ?? null,
    broadcast: {
      day: mal.broadcast_day ?? null,
      time: mal.broadcast_time ?? null,
      timezone: "JST",
      string: broadcastStr,
    },
    synopsis: null,
    images: {
      jpg: {
        image_url: null,
        small_image_url: null,
        large_image_url: null,
      },
      webp: {
        image_url: null,
        small_image_url: null,
        large_image_url: null,
      },
    },
  };
}

async function fetchMalAnimeFullViaScraping(
  malId: number,
): Promise<TenraiAnimeFull | null> {
  try {
    const raw: MalScrapeResult = await invoke("mal_scrape_anime", { malId });
    return malToTenraiFull(raw);
  } catch {
    return null;
  }
}

/** ── Suppressed subjects (user opted out per-anime) ── */

function loadSuppressedSet(): Set<number> {
  try {
    const raw = localStorage.getItem(SUPPRESSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveSuppressedSet(set: Set<number>): void {
  try {
    localStorage.setItem(SUPPRESSED_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

/** Check if a Bangumi subject has been suppressed (user chose "关闭此功能") */
export function isSuppressed(bgmId: number): boolean {
  return loadSuppressedSet().has(bgmId);
}

/** Suppress Tenrai matching for a specific Bangumi subject */
export function suppressBgmId(bgmId: number): void {
  const set = loadSuppressedSet();
  set.add(bgmId);
  saveSuppressedSet(set);
  // Also clear the cached match for this subject
  clearCachedMatch(bgmId);
}

/** Re-enable Tenrai matching for a specific Bangumi subject */
export function unsuppressBgmId(bgmId: number): void {
  const set = loadSuppressedSet();
  set.delete(bgmId);
  saveSuppressedSet(set);
}

/** Remove a single subject's match from the local cache */
export function clearCachedMatch(bgmId: number): void {
  const cache = loadMatchCache();
  if (cache[bgmId]) {
    delete cache[bgmId];
    saveMatchCache(cache);
  }
}

/** ── Cache management ── */

/** Clear all Tenrai match cache AND suppressed list AND confirmed list */
export function clearAllTenraiCache(): void {
  try {
    localStorage.removeItem(MATCH_CACHE_KEY);
    localStorage.removeItem(SUPPRESSED_KEY);
    localStorage.removeItem(CONFIRMED_KEY);
  } catch { /* ignore */ }
}

/** ── Confirm flow: ask user to verify uncertain auto-matches ── */

function loadConfirmedSet(): Set<number> {
  try {
    const raw = localStorage.getItem(CONFIRMED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveConfirmedSet(set: Set<number>): void {
  localStorage.setItem(CONFIRMED_KEY, JSON.stringify([...set]));
}

/** Check if user has already confirmed this match */
export function isConfirmed(bgmId: number): boolean {
  return loadConfirmedSet().has(bgmId);
}

/** Mark a match as confirmed — won't ask again */
export function confirmBgmId(bgmId: number): void {
  const set = loadConfirmedSet();
  set.add(bgmId);
  saveConfirmedSet(set);
}

/**
 * Determine whether the auto-match result is uncertain enough
 * to warrant a manual confirmation prompt.
 *
 * Triggers when:
 * - Top 2 scores are within CONFIRM_SCORE_GAP (close race), OR
 * - Top score is below CONFIRM_MIN_SCORE (weak match)
 *
 * Checks score gap and minimum thresholds.
 */
export function shouldConfirmMatch(match: AnimeMatchInfo): boolean {
  if (isConfirmed(match.bgmId)) return false;

  const candidates = match.candidates;
  if (!candidates || candidates.length === 0) return false;

  const top = candidates[0].score.total;
  const second = candidates.length > 1 ? candidates[1].score.total : 0;

  if (top < CONFIRM_MIN_SCORE && top > MIN_MATCH_SCORE) return true;
  if (top - second < CONFIRM_SCORE_GAP) return true;

  return false;
}
