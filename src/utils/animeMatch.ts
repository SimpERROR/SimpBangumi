import { TenraiApi, type TenraiAnimeFull, type TenraiAnimeSearchItem } from "../api/Tenrai";
import { compareImages, TenraiImageUrl, bgmImageUrl } from "./imageCompare";
import { toRomaji, romajiTitleScore } from "./romaji";

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
  /** Whether the match was locked (year+eps exact) */
  locked: boolean;
  /** All candidates with their scores (for debug panel) */
  candidates?: ScoredCandidate[];
}

const MATCH_CACHE_KEY = "bangumi.Tenrai.matchMap";
const SUPPRESSED_KEY = "bangumi.Tenrai.suppressed";
const CONFIRMED_KEY = "bangumi.Tenrai.confirmed";
const MIN_MATCH_SCORE = 50;

/** Gap between #1 and #2 scores below which we ask for manual confirmation */
const CONFIRM_SCORE_GAP = 25;
/** Top score below which we ask for manual confirmation (even if gap is large) */
const CONFIRM_MIN_SCORE = 80;

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

/**
 * Locked match: year AND episodes both match exactly.
 * Returns the MAL ID if found, null otherwise.
 */
function tryLockMatch(
  candidates: TenraiAnimeSearchItem[],
  bgmYear: number | null,
  bgmEpisodes: number | null,
): number | null {
  if (bgmYear === null || bgmEpisodes === null || bgmEpisodes <= 0) {
    return null;
  }

  const exact = candidates.find(
    (item) =>
      item.episodes === bgmEpisodes &&
      TenraiYear(item) === bgmYear,
  );

  return exact?.mal_id ?? null;
}

function matchScoreDetail(candidate: TenraiAnimeSearchItem, bgmName: string, bgmYear?: number | null, bgmEpisodes?: number | null): ScoreBreakdown {
  const jYear = TenraiYear(candidate);
  let yearScore = 0;
  if (bgmYear !== null && bgmYear !== undefined && jYear === bgmYear) {
    yearScore = 60;
  } else if (bgmYear !== null && bgmYear !== undefined && jYear !== null) {
    const diff = Math.abs(jYear - bgmYear);
    if (diff === 1) yearScore = 25;
    else if (diff === 2) yearScore = 10;
  }

  let epScore = 0;
  if (bgmEpisodes !== null && bgmEpisodes !== undefined && bgmEpisodes > 0 && candidate.episodes === bgmEpisodes) {
    epScore = 100;
  } else if (bgmEpisodes !== null && bgmEpisodes !== undefined && bgmEpisodes > 0 && candidate.episodes !== null) {
    const diff = Math.abs(candidate.episodes - bgmEpisodes);
    if (diff <= 2) epScore = 40;
    else if (diff <= 5) epScore = 20;
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

    // ── Step 1: try LOCK (year + episodes exact match) ──
    const lockedMalId = tryLockMatch(uniqueResults, bgmYear, eps);
    let bestMalId: number;
    let locked = false;
    let scoredCandidates: ScoredCandidate[] = [];

    if (lockedMalId !== null) {
      bestMalId = lockedMalId;
      locked = true;
      // Still score all candidates for debug panel
      scoredCandidates = uniqueResults
        .map((item) => ({ item, score: matchScoreDetail(item, bgmName, bgmYear, eps) }))
        .sort((a, b) => b.score.total - a.score.total);
    } else {
      // ── Step 2: fallback to scoring ──
      scoredCandidates = uniqueResults
        .map((item) => ({ item, score: matchScoreDetail(item, bgmName, bgmYear, eps) }))
        .sort((a, b) => b.score.total - a.score.total);

      // ── Step 3: image comparison for top 5 candidates ──
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
      // Ensure all image comparisons finish (they resolve void regardless)
      await Promise.allSettled(imageScores);

      // Re-sort with image scores
      scoredCandidates.sort((a, b) => b.score.total - a.score.total);

      const best = scoredCandidates[0];
      if (!best || best.score.total < MIN_MATCH_SCORE) {
        return null;
      }
      bestMalId = best.item.mal_id;
    }

    // Fetch full anime data for broadcast info
    let fullData: TenraiAnimeFull | null = null;
    try {
      const fullResponse = await TenraiApi.getAnimeFull(bestMalId);
      fullData = fullResponse.data;
    } catch {
      // Full data fetch failed, but we still have the match
    }

    const matchInfo: AnimeMatchInfo = {
      bgmId,
      malId: bestMalId,
      data: fullData,
      cachedAt: Date.now(),
      locked,
      candidates: scoredCandidates.slice(0, 20), // keep top 20 for debug
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
 * Fetch full Tenrai info for a given MAL ID.
 */
export async function fetchMalAnimeFull(
  malId: number,
): Promise<TenraiAnimeFull | null> {
  try {
    const response = await TenraiApi.getAnimeFull(malId);
    return response.data;
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
 * Does NOT trigger for locked matches (year+eps exact).
 */
export function shouldConfirmMatch(match: AnimeMatchInfo): boolean {
  if (match.locked) return false;
  if (isConfirmed(match.bgmId)) return false;

  const candidates = match.candidates;
  if (!candidates || candidates.length === 0) return false;

  const top = candidates[0].score.total;
  const second = candidates.length > 1 ? candidates[1].score.total : 0;

  if (top < CONFIRM_MIN_SCORE && top > MIN_MATCH_SCORE) return true;
  if (top - second < CONFIRM_SCORE_GAP) return true;

  return false;
}
