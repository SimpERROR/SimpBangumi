import { reactive, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { RatingsApi } from "../api/ratings";
import { getCachedMatch, matchAnimeToTenrai, fetchMalAnimeFull, setManualMatch, type AnimeMatchInfo } from "./animeMatch";
import { toRomaji } from "./romaji";

export type ExternalPlatformId = "mal" | "anilist" | "imdb" | "tmdb";
export type PlatformId = "bangumi" | ExternalPlatformId;
/** Platforms that support either an official API (with key) or a keyless web-scraping fallback */
export type ScrapablePlatformId = "imdb" | "tmdb";
export type PlatformSource = "api" | "scrape";

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  bangumi: "Bangumi",
  mal: "MyAnimeList",
  anilist: "AniList",
  imdb: "IMDb",
  tmdb: "TMDB",
};

export interface RatingComparisonConfig {
  /** Master switch for the whole feature */
  enabled: boolean;
  /** Which external platforms the user opted into (Bangumi is always included) */
  platforms: ExternalPlatformId[];
  /** 智能权重分配：根据样本量自动计算各平台权重 */
  smartWeight: boolean;
  /** 是否阻止详情页在综合评分数据就绪后自动切换视图 */
  disableAutoSwitchToAggregate: boolean;
  /** Data source used for TMDB/IMDb: official API (needs a key) or keyless web scraping */
  tmdbSource: PlatformSource;
  imdbSource: PlatformSource;
  tmdbApiKey: string;
  omdbApiKey: string;
}

const CONFIG_KEY = "bangumi.ratingCompare.config";
// v3: v2 could cache the first TMDB search hit even when it was a low-vote or wrong-year title.
// v6: TMDB matching now rejects results from the wrong release year; invalidate
// entries cached by the previous, overly broad search.
const CACHE_KEY = "bangumi.ratingCompare.cache.v6";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // ratings drift slowly, refresh weekly

const DEFAULT_CONFIG: RatingComparisonConfig = {
  enabled: false,
  platforms: ["mal"],
  smartWeight: true,
  disableAutoSwitchToAggregate: false,
  tmdbSource: "scrape",
  imdbSource: "scrape",
  tmdbApiKey: "",
  omdbApiKey: "",
};

function loadConfigFromStorage(): RatingComparisonConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<RatingComparisonConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Shared reactive singleton (module-level, like src/stores/*) so every mounted view — the
 * settings page and the subject detail page — observes the same config instantly, without
 * requiring a full page/subject reload after the user flips a toggle.
 */
export const ratingComparisonConfig = reactive<RatingComparisonConfig>(loadConfigFromStorage());

watch(
  ratingComparisonConfig,
  (val) => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(val));
    } catch {
      // Storage full or unavailable — silently ignore
    }
  },
  { deep: true },
);

/** @deprecated use the reactive `ratingComparisonConfig` singleton directly */
export function getRatingComparisonConfig(): RatingComparisonConfig {
  return ratingComparisonConfig;
}

/** @deprecated mutate `ratingComparisonConfig` properties directly; this merges into the same singleton */
export function setRatingComparisonConfig(config: RatingComparisonConfig): void {
  Object.assign(ratingComparisonConfig, config);
}

export interface PlatformRatingEntry {
  score: number; // normalized to 0-10
  votes: number | null;
  matchedTitle?: string;
  url?: string | null;
}

export interface RatingComparisonCacheItem {
  fetchedAt: number;
  entries: Partial<Record<ExternalPlatformId, PlatformRatingEntry | null>>;
  /** Human-readable reason a platform yielded no data (missing key, no match, network error, etc.) */
  errors: Partial<Record<ExternalPlatformId, string>>;
}

function loadCache(): Record<number, RatingComparisonCacheItem> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<number, RatingComparisonCacheItem>) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<number, RatingComparisonCacheItem>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function getCachedRatingComparison(bgmId: number): RatingComparisonCacheItem | null {
  return loadCache()[bgmId] ?? null;
}

export function clearCachedRatingComparison(bgmId: number): void {
  const cache = loadCache();
  delete cache[bgmId];
  saveCache(cache);
}

/** Additional search queries for TMDB/IMDb: the MAL English title first (IMDb/OMDb/TMDB index
 * titles in English, e.g. "Spirited Away"), then the original Japanese title, then its romaji,
 * deduplicated against the primary query. */
function buildScrapeQueries(title: string, altTitle: string | undefined, englishTitle?: string): string[] {
  const primary = (englishTitle || title).trim().toLowerCase();
  const queries: string[] = [];
  const push = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const exists = queries.some((q) => q.toLowerCase() === trimmed.toLowerCase());
    if (!exists && trimmed.toLowerCase() !== primary) {
      queries.push(trimmed);
    }
  };
  push(englishTitle ?? "");
  push(title);
  push(toRomaji(title));
  push(altTitle ?? "");
  return queries;
}

async function fetchPlatform(
  platform: ExternalPlatformId,
  title: string,
  altTitle: string | undefined,
  year: number | undefined,
  config: RatingComparisonConfig,
  bgmId: number,
  bgmAirDate?: string,
  bgmEpisodes?: number,
): Promise<{ entry: PlatformRatingEntry | null; error: string | null }> {
  const none = (error: string): { entry: null; error: string } => ({ entry: null, error });
  // Prefer MAL's English title, then its canonical romaji title. The latter matters for
  // spellings that cannot be recovered exactly from kana (e.g. ヤーネコ -> "Yani Neko").
  const matchedAnime = getCachedMatch(bgmId)?.data;
  const englishTitle = matchedAnime?.title_english?.trim() || matchedAnime?.title?.trim() || undefined;
  try {
    if (platform === "mal") {
      let match = getCachedMatch(bgmId);
      if (!match) {
        match = await matchAnimeToTenrai(bgmId, title, bgmAirDate, bgmEpisodes);
      }
      if (match && !match.data?.score) {
        // The search result that produced this match sometimes already carries a score even
        // when the full-detail endpoint returns null for it — use it directly, no extra request.
        const candidateScore = match.candidates?.find((c) => c.item.mal_id === match!.malId)?.item.score;
        if (candidateScore && candidateScore > 0) {
          match = { ...match, data: { ...(match.data ?? {}), score: candidateScore } as AnimeMatchInfo["data"] };
          setManualMatch(bgmId, match);
        } else {
          // Score still missing (e.g. still airing, or the Tenrai mirror failed to return it) —
          // retry via Tenrai once, then fall back to scraping MAL directly.
          match = await refreshMalScore(match);
        }
      }
      if (!match) return none("未找到匹配的 MyAnimeList 条目（仅适用于动画类型）");
      const score = match.data?.score;
      if (!score || score <= 0) return none("MyAnimeList 上该条目暂无评分，或 Tenrai/MAL 接口暂时无法访问");
      return { entry: { score, votes: null, matchedTitle: match.data?.title ?? undefined, url: match.data?.url ?? null }, error: null };
    }
    if (platform === "anilist") {
      const result = await RatingsApi.anilistSearchRating(altTitle || title);
      if (!result) return none("未在 AniList 上找到匹配条目或该条目暂无评分");
      return { entry: { score: result.score, votes: result.votes, matchedTitle: result.matched_title, url: result.url }, error: null };
    }
    if (platform === "tmdb") {
      const query = englishTitle || title;
      if (config.tmdbSource === "scrape") {
        const result = await RatingsApi.tmdbScrapeRating(query, year, buildScrapeQueries(title, altTitle, englishTitle));
        if (!result) return none("网页抓取未找到匹配条目，可尝试切换为官方 API");
        return { entry: { score: result.score, votes: result.votes, matchedTitle: result.matched_title, url: result.url }, error: null };
      }
      if (!config.tmdbApiKey.trim()) return none("未配置 TMDB API Key");
      const result = await RatingsApi.tmdbSearchRating(query, config.tmdbApiKey, year, buildScrapeQueries(title, altTitle, englishTitle));
      if (!result) return none("未在 TMDB 上找到匹配条目或该条目暂无评分");
      return { entry: { score: result.score, votes: result.votes, matchedTitle: result.matched_title, url: result.url }, error: null };
    }
    if (platform === "imdb") {
      const query = englishTitle || title;
      if (config.imdbSource === "scrape") {
        const result = await RatingsApi.imdbScrapeRating(query, year, buildScrapeQueries(title, altTitle, englishTitle));
        if (!result) return none("网页抓取未找到匹配条目，可尝试切换为官方 API");
        return { entry: { score: result.score, votes: result.votes, matchedTitle: result.matched_title, url: result.url }, error: null };
      }
      if (!config.omdbApiKey.trim()) return none("未配置 OMDb API Key");
      const result = await RatingsApi.imdbSearchRating(query, config.omdbApiKey, year, buildScrapeQueries(title, altTitle, englishTitle));
      if (!result) return none("未在 IMDb 上找到匹配条目或该条目暂无评分");
      return { entry: { score: result.score, votes: result.votes, matchedTitle: result.matched_title, url: result.url }, error: null };
    }
    return none("不支持的平台");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return none(`获取失败：${message}`);
  }
}

/**
 * Refreshes a cached MAL match's score: retries the Tenrai mirror once, and if it still has no
 * score (the mirror can lag/omit data even for well-known titles), falls back to scraping the
 * official MAL page directly for the score alone.
 */
async function refreshMalScore(match: AnimeMatchInfo): Promise<AnimeMatchInfo> {
  try {
    const fresh = await fetchMalAnimeFull(match.malId);
    if (fresh?.score && fresh.score > 0) {
      const updated = { ...match, data: fresh, detailFetchedAt: Date.now() };
      setManualMatch(match.bgmId, updated);
      return updated;
    }
  } catch {
    // Fall through to the scrape fallback below
  }

  try {
    const scraped = await invoke<{ score: number | null; title: string }>("mal_scrape_anime", { malId: match.malId });
    if (scraped?.score && scraped.score > 0) {
      const data = {
        ...(match.data ?? {}),
        mal_id: match.malId,
        title: match.data?.title || scraped.title,
        url: match.data?.url || `https://myanimelist.net/anime/${match.malId}`,
        score: scraped.score,
      } as AnimeMatchInfo["data"];
      const updated = { ...match, data, detailFetchedAt: Date.now() };
      setManualMatch(match.bgmId, updated);
      return updated;
    }
  } catch {
    // Give up — keep the existing (possibly score-less) cached match
  }
  return match;
}

/**
 * Fetches (with cache) ratings for every enabled external platform.
 * Intended to be called lazily/in the background — never blocks the subject page render.
 */
const inFlightFetches = new Map<number, Promise<RatingComparisonCacheItem>>();

export async function fetchRatingComparison(
  bgmId: number,
  bgmName: string,
  bgmNameCn?: string,
  bgmAirDate?: string,
  bgmEpisodes?: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<RatingComparisonCacheItem> {
  // Reuse an already-running fetch for the same subject (e.g. the modal opening right after the
  // background trigger already started) instead of firing a redundant second round of requests.
  const existingFetch = inFlightFetches.get(bgmId);
  if (existingFetch) return existingFetch;

  const promise = fetchRatingComparisonUncached(bgmId, bgmName, bgmNameCn, bgmAirDate, bgmEpisodes, onProgress).finally(() => {
    inFlightFetches.delete(bgmId);
  });
  inFlightFetches.set(bgmId, promise);
  return promise;
}

async function fetchRatingComparisonUncached(
  bgmId: number,
  bgmName: string,
  bgmNameCn?: string,
  bgmAirDate?: string,
  bgmEpisodes?: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<RatingComparisonCacheItem> {
  const config = getRatingComparisonConfig();
  const cache = loadCache();
  const existing = cache[bgmId];
  const isFresh = existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS;
  const entries: Partial<Record<ExternalPlatformId, PlatformRatingEntry | null>> = isFresh ? { ...existing.entries } : {};
  const errors: Partial<Record<ExternalPlatformId, string>> = isFresh ? { ...existing.errors } : {};

  const year = bgmAirDate ? parseInt(bgmAirDate.slice(0, 4), 10) || undefined : undefined;
  const title = bgmNameCn?.trim() || bgmName;

  // TMDB and IMDb are indexed primarily by English/romaji titles. Resolve the title once even
  // when MAL itself was not selected, so an external-only configuration does not fall back to a
  // broad Chinese-title search that can match an unrelated work.
  const needsEnglishTitle = config.platforms.some((platform) => platform === "tmdb" || platform === "imdb");
  if (needsEnglishTitle && !getCachedMatch(bgmId)) {
    try {
      await matchAnimeToTenrai(bgmId, bgmName, bgmAirDate, bgmEpisodes);
    } catch {
      // Fetching an external rating can still proceed with the original/romaji title.
    }
  }

  // Only trust the cache for platforms that actually returned data. A previous failed/no-match
  // attempt (e.g. the MAL match hadn't resolved yet on first visit) should always be retried —
  // otherwise a transient failure gets "stuck" as a false negative for the whole cache TTL.
  const missing = config.platforms.filter((p) => !isFresh || !entries[p]);
  let completed = 0;
  onProgress?.(0, missing.length);
  for (const platform of missing) {
    const { entry, error } = await fetchPlatform(platform, bgmName, title, year, config, bgmId, bgmAirDate, bgmEpisodes);
    entries[platform] = entry;
    if (error) {
      errors[platform] = error;
    } else {
      delete errors[platform];
    }
    completed += 1;
    onProgress?.(completed, missing.length);
  }

  const item: RatingComparisonCacheItem = { fetchedAt: Date.now(), entries, errors };
  cache[bgmId] = item;
  saveCache(cache);
  return item;
}

export interface PlatformWeightResult {
  platform: PlatformId;
  score: number;
  votes: number | null;
  weight: number;
  /** Human-readable explanation of how this platform's weight was derived */
  reason: string;
  /** Share of the final weighted average contributed by this platform, 0-100 */
  contributionPercent: number;
}

export interface RatingComparisonResult {
  platforms: PlatformWeightResult[];
  aggregateScore: number;
}

/** Bangumi is our primary platform: fixed weight, always the largest, never redistributed. */
export const BANGUMI_WEIGHT = 1;
const DEFAULT_EXTERNAL_WEIGHT = 0.55;
const MIN_EXTERNAL_WEIGHT = 0.12;
const MAX_EXTERNAL_WEIGHT = 0.82; // hard cap: an external platform can never reach Bangumi's weight
/** Sample size at which a platform has accumulated meaningful, but not complete, confidence. */
const REFERENCE_VOTES = 5000;

// Used only when a platform does not expose a real rating-vote count.
const PLATFORM_PRIORS: Record<ExternalPlatformId, number> = {
  mal: 0.62,
  anilist: 0.48,
  imdb: 0.72,
  tmdb: 0.68,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smartExternalWeight(
  platform: ExternalPlatformId,
  score: number,
  bangumiScore: number,
  votes: number | null,
): number {
  const prior = PLATFORM_PRIORS[platform];
  const sampleConfidence = votes && votes > 0
    ? 1 - Math.exp(-votes / REFERENCE_VOTES)
    : prior * 0.58;
  const disagreement = bangumiScore > 0 ? clamp(Math.abs(score - bangumiScore) / 10, 0, 1) : 0;
  const agreement = 1 - disagreement * 0.35;
  return clamp(
    MIN_EXTERNAL_WEIGHT + (MAX_EXTERNAL_WEIGHT - MIN_EXTERNAL_WEIGHT) * sampleConfidence * agreement,
    MIN_EXTERNAL_WEIGHT,
    MAX_EXTERNAL_WEIGHT,
  );
}

/**
 * Computes each platform's weight in the final aggregate score.
 *
 * - Bangumi is fixed at weight 1 and never participates in the reallocation.
 * - When 智能权重分配 (smart weighting) is on, each external platform's weight is derived
 *   from how much data backs its score (vote/sample count), scaled against a reference
 *   sample size and capped below Bangumi's weight.
 * - When it's off, every enabled external platform uses the same fixed default weight.
 */
export function computeRatingWeights(
  bangumiScore: number,
  externalEntries: Partial<Record<ExternalPlatformId, PlatformRatingEntry | null>>,
  smartWeight: boolean,
): RatingComparisonResult {
  const platforms: PlatformWeightResult[] = [];

  if (bangumiScore > 0) {
    platforms.push({
      platform: "bangumi",
      score: bangumiScore,
      votes: null,
      weight: BANGUMI_WEIGHT,
      reason: "主平台，权重固定",
      contributionPercent: 0,
    });
  }

  for (const [platform, entry] of Object.entries(externalEntries) as [ExternalPlatformId, PlatformRatingEntry | null][]) {
    if (!entry || entry.score <= 0) continue;
    let weight: number;
    let reason: string;
    if (!smartWeight) {
      weight = DEFAULT_EXTERNAL_WEIGHT;
      reason = "固定权重";
    } else if (!entry.votes || entry.votes <= 0) {
      weight = smartExternalWeight(platform, entry.score, bangumiScore, entry.votes);
      reason = "无票数，按平台先验估算";
    } else {
      weight = smartExternalWeight(platform, entry.score, bangumiScore, entry.votes);
      reason = `按 ${entry.votes.toLocaleString("zh-CN")} 票样本和评分一致性计算`;
    }
    platforms.push({
      platform,
      score: entry.score,
      votes: entry.votes,
      weight,
      reason,
      contributionPercent: 0,
    });
  }

  const totalWeight = platforms.reduce((sum, p) => sum + p.weight, 0);
  // Keep the weighted result precise so the detail view can show small differences from Bangumi;
  // callers decide how many decimals are appropriate for the main score display.
  const aggregateScore = totalWeight > 0 ? platforms.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight : 0;
  for (const p of platforms) {
    p.contributionPercent = totalWeight > 0 ? (p.weight / totalWeight) * 100 : 0;
  }

  return { platforms, aggregateScore: Math.round(aggregateScore * 10) / 10 };
}
