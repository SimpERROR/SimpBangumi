import { invoke } from "@tauri-apps/api/core";

export type TokenSource = "personal_access_token" | "oauth";

export interface BangumiUser {
  id: number;
  username: string;
  nickname: string;
  sign?: string | null;
  avatar: unknown;
}

export interface AuthSession {
  authenticated: boolean;
  source?: TokenSource | null;
  scope?: string | null;
  expires_at?: number | null;
  user?: BangumiUser | null;
}

export interface OAuthExchangeCodeRequest {
  code: string;
}

export interface OAuthLoginStatus {
  completed: boolean;
  code?: string | null;
  error?: string | null;
}

export interface WorkerOAuthTokenRequest {
  access_token: string;
  refresh_token?: string | null;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

export interface SubjectEpisodesParams extends PageParams {
  type?: number;
}

export interface UserSubjectEpisodeCollectionsParams extends PageParams {
  episode_type?: number;
}

export interface SubjectCollectionParams extends PageParams {
  username?: string;
  subject_type?: number;
  type?: number;
}

export interface SubjectSearchParams extends PageParams {
  subject_types?: number[];
  tags?: string[];
  air_date?: string[];
  rating?: string[];
  rating_count?: string[];
  rank?: string[];
  nsfw?: boolean;
  sort?: "match" | "heat" | "rank" | "score";
}

export interface PagedResponse<T> {
  total?: number;
  limit?: number;
  offset?: number;
  data: T[];
}

export interface SubjectCollection {
  subject_id?: number;
  subject?: {
    id?: number;
    name?: string;
    name_cn?: string;
    images?: Record<string, string | undefined>;
    date?: string;
    type?: number;
  };
  type?: number;
  rate?: number;
  comment?: string;
  updated_at?: string;
  private?: boolean;
}

export interface SubjectTag {
  name: string;
  count: number;
}

export interface SubjectRating {
  rank: number;
  total: number;
  count: Record<string, number>;
  score: number;
}

export interface SubjectDetail {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  summary: string;
  series: boolean;
  nsfw: boolean;
  locked: boolean;
  date?: string;
  platform?: string;
  images: Record<string, string | undefined>;
  infobox?: Array<{
    key: string;
    value: unknown;
  }>;
  volumes: number;
  eps: number;
  total_episodes: number;
  rating: SubjectRating;
  collection: {
    wish: number;
    collect: number;
    doing: number;
    on_hold: number;
    dropped: number;
  };
  meta_tags: string[];
  tags: SubjectTag[];
}

export interface UserSubjectCollection {
  subject_id: number;
  subject_type: number;
  rate: number;
  type: number;
  comment?: string;
  tags: string[];
  ep_status: number;
  vol_status: number;
  updated_at: string;
  private: boolean;
}

export interface UserSubjectCollectionModifyPayload {
  type?: number;
  rate?: number;
  ep_status?: number;
  vol_status?: number;
  comment?: string;
  private?: boolean;
  tags?: string[];
}

export interface Episode {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  sort: number;
  ep?: number;
  airdate?: string;
}

export interface UserEpisodeCollection {
  episode: Episode;
  type: number;
  updated_at: number;
}

export interface SearchSubject {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  short_summary?: string;
  date?: string;
  images?: Record<string, string | undefined>;
  score?: number;
  rank?: number;
  eps?: number;
  volumes?: number;
  collection_total?: number;
  tags?: SubjectTag[];
}

export class BangumiApiClient {
  getAuthSession(): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_auth_session");
  }

  loginWithPersonalAccessToken(token: string): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_login_with_pat", { token });
  }

  loginWithWorkerToken(request: WorkerOAuthTokenRequest): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_login_with_worker_token", { request });
  }

  logout(): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_logout");
  }

  startOAuthLogin(): Promise<string> {
    return invoke<{ url: string }>("bangumi_oauth_start_login", {
    }).then((response) => response.url);
  }

  waitOAuthLoginResult(): Promise<OAuthLoginStatus> {
    return invoke<OAuthLoginStatus>("bangumi_oauth_wait_login_result");
  }

  getMe(): Promise<BangumiUser> {
    return invoke<BangumiUser>("bangumi_get_me");
  }

  async getSubjectCollections(
    params: SubjectCollectionParams = {},
  ): Promise<PagedResponse<SubjectCollection>> {
    const username = params.username ?? "-";
    const query = toQuery({
      limit: params.limit,
      offset: params.offset,
      subject_type: params.subject_type,
      type: params.type,
    });

    return this.get<PagedResponse<SubjectCollection>>(
      `/v0/users/${encodeURIComponent(username)}/collections`,
      query,
    );
  }

  getSubjectDetail(subjectId: number): Promise<SubjectDetail> {
    return this.get<SubjectDetail>(`/v0/subjects/${subjectId}`);
  }

  getCurrentUserSubjectCollection(subjectId: number): Promise<UserSubjectCollection> {
    return this.get<UserSubjectCollection>(`/v0/users/-/collections/${subjectId}`);
  }

  updateCurrentUserSubjectCollection(
    subjectId: number,
    payload: UserSubjectCollectionModifyPayload,
  ): Promise<null> {
    return this.request<null>("POST", `/v0/users/-/collections/${subjectId}`, undefined, payload);
  }

  getEpisodesBySubject(
    subjectId: number,
    params: SubjectEpisodesParams = {},
  ): Promise<PagedResponse<Episode>> {
    const query = toQuery({
      subject_id: subjectId,
      type: params.type,
      limit: params.limit,
      offset: params.offset,
    });

    return this.get<PagedResponse<Episode>>("/v0/episodes", query);
  }

  getCurrentUserSubjectEpisodeCollections(
    subjectId: number,
    params: UserSubjectEpisodeCollectionsParams = {},
  ): Promise<PagedResponse<UserEpisodeCollection>> {
    const query = toQuery({
      limit: params.limit,
      offset: params.offset,
      episode_type: params.episode_type,
    });

    return this.get<PagedResponse<UserEpisodeCollection>>(
      `/v0/users/-/collections/${subjectId}/episodes`,
      query,
    );
  }

  updateCurrentUserEpisodeCollection(
    episodeId: number,
    type: number,
  ): Promise<null> {
    return this.request<null>(
      "PUT",
      `/v0/users/-/collections/-/episodes/${episodeId}`,
      undefined,
      { type },
    );
  }

  searchSubjects(
    keyword: string,
    params: SubjectSearchParams = {},
  ): Promise<PagedResponse<SearchSubject>> {
    const query = toQuery({
      limit: params.limit,
      offset: params.offset,
    });

    const body = {
      keyword,
      sort: params.sort ?? "match",
      filter: {
        type: params.subject_types?.length ? params.subject_types : undefined,
        tag: params.tags?.length ? params.tags : undefined,
        air_date: params.air_date?.length ? params.air_date : undefined,
        rating: params.rating?.length ? params.rating : undefined,
        rating_count: params.rating_count?.length ? params.rating_count : undefined,
        rank: params.rank?.length ? params.rank : undefined,
        nsfw: params.nsfw ? true : undefined,
      },
    };

    return this.request<PagedResponse<SearchSubject>>(
      "POST",
      "/v0/search/subjects",
      query,
      body,
    );
  }

  get<T = unknown>(
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    return invoke<T>("bangumi_api_request", {
      method,
      path,
      query: query ?? null,
      body: body ?? null,
    });
  }
}

export const bangumiApi = new BangumiApiClient();

function toQuery(
  values: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .filter((entry): entry is [string, string | number | boolean] => {
        return entry[1] !== undefined;
      })
      .map(([key, value]) => [key, String(value)]),
  );
}
