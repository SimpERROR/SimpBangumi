import { invoke } from "@tauri-apps/api/core";

export interface ExternalRatingInfo {
  matched_title: string;
  score: number; // normalized to 0-10
  votes: number | null;
  url: string | null;
}

export const RatingsApi = {
  anilistSearchRating(title: string): Promise<ExternalRatingInfo | null> {
    return invoke("anilist_search_rating", { title });
  },
  tmdbSearchRating(title: string, apiKey: string, year?: number, additionalQueries: string[] = []): Promise<ExternalRatingInfo | null> {
    return invoke("tmdb_search_rating", { title, apiKey, year: year ?? null, additionalQueries });
  },
  imdbSearchRating(title: string, apiKey: string, year?: number, additionalQueries: string[] = []): Promise<ExternalRatingInfo | null> {
    return invoke("imdb_search_rating", { title, apiKey, year: year ?? null, additionalQueries });
  },
  tmdbScrapeRating(title: string, year?: number, additionalQueries: string[] = []): Promise<ExternalRatingInfo | null> {
    return invoke("tmdb_scrape_rating", { title, year: year ?? null, additionalQueries });
  },
  imdbScrapeRating(title: string, year?: number, additionalQueries: string[] = []): Promise<ExternalRatingInfo | null> {
    return invoke("imdb_scrape_rating", { title, year: year ?? null, additionalQueries });
  },
};
