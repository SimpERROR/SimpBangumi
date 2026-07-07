/**
 * Tenrai v4 API proxy (MAL unofficial API mirror)
 * https://api.tenrai.org/v1
 */

const Tenrai_BASE = "https://api.tenrai.org/v1";

export interface TenraiPagination {
  last_visible_page: number;
  has_next_page: boolean;
  items: {
    count: number;
    total: number;
    per_page: number;
  };
}

export interface TenraiAnimeSearchItem {
  mal_id: number;
  url: string;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string | null;
  episodes: number | null;
  status: string | null;
  aired: {
    from: string | null;
    to: string | null;
    prop: {
      from: { day: number | null; month: number | null; year: number | null };
      to: { day: number | null; month: number | null; year: number | null };
    };
    string: string | null;
  };
  duration: string | null;
  score: number | null;
  synopsis: string | null;
  images: {
    jpg: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
    webp: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
  };
}

export interface TenraiAnimeSearchResponse {
  pagination: TenraiPagination;
  data: TenraiAnimeSearchItem[];
}

export interface TenraiBroadcast {
  day: string | null;
  time: string | null;
  timezone: string | null;
  string: string | null;
}

export interface TenraiAnimeFull {
  mal_id: number;
  url: string;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string | null;
  status: string | null;
  episodes: number | null;
  aired: {
    from: string | null;
    to: string | null;
    prop: {
      from: { day: number | null; month: number | null; year: number | null };
      to: { day: number | null; month: number | null; year: number | null };
    };
    string: string | null;
  };
  duration: string | null;
  rating: string | null;
  score: number | null;
  broadcast: TenraiBroadcast;
  synopsis: string | null;
  images: {
    jpg: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
    webp: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
  };
}

export interface TenraiAnimeFullResponse {
  data: TenraiAnimeFull;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple rate limiter: ensures at least `intervalMs` between calls */
let lastCallTime = 0;
const MIN_INTERVAL_MS = 350; // ~3 req/s

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastCallTime));
  if (wait > 0) {
    await delay(wait);
  }
  lastCallTime = Date.now();

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 429) {
    // Rate limited, wait and retry once
    await delay(2000);
    lastCallTime = Date.now();
    return fetch(url, {
      headers: { Accept: "application/json" },
    });
  }
  return response;
}

export const TenraiApi = {
  async searchAnime(query: string, limit = 10): Promise<TenraiAnimeSearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      sfw: "true",
    });
    const url = `${Tenrai_BASE}/anime?${params.toString()}`;

    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      throw new Error(`Tenrai API returned ${response.status}: ${response.statusText}`);
    }

    return response.json();
  },

  async getAnimeFull(malId: number): Promise<TenraiAnimeFullResponse> {
    const url = `${Tenrai_BASE}/anime/${malId}/full`;

    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      throw new Error(`Tenrai API returned ${response.status}: ${response.statusText}`);
    }

    return response.json();
  },
};
