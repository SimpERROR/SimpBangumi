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

export interface OAuthAuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  state?: string | null;
  scope?: string | null;
}

export interface OAuthExchangeRequest {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  code: string;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

export interface SubjectCollectionParams extends PageParams {
  username?: string;
  subject_type?: number;
  type?: number;
}

export interface TimelineParams extends PageParams {
  username?: string;
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

export interface TimelineItem {
  id?: number;
  type?: number | string;
  title?: string;
  content?: string;
  created_at?: string;
  user?: BangumiUser;
  subject?: SubjectCollection["subject"];
  [key: string]: unknown;
}

export class BangumiApiClient {
  getAuthSession(): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_auth_session");
  }

  loginWithPersonalAccessToken(token: string): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_login_with_pat", { token });
  }

  logout(): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_logout");
  }

  getOAuthAuthorizeUrl(request: OAuthAuthorizeRequest): Promise<string> {
    return invoke<{ url: string }>("bangumi_oauth_authorize_url", {
      request,
    }).then((response) => response.url);
  }

  exchangeOAuthCode(request: OAuthExchangeRequest): Promise<AuthSession> {
    return invoke<AuthSession>("bangumi_oauth_exchange_code", { request });
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

  async getTimeline(
    params: TimelineParams = {},
  ): Promise<PagedResponse<TimelineItem>> {
    const username = params.username ?? "-";
    const query = toQuery({
      limit: params.limit,
      offset: params.offset,
    });

    const response = await this.get<TimelineItem[] | PagedResponse<TimelineItem>>(
      `/v0/users/${encodeURIComponent(username)}/timeline`,
      query,
    );

    return Array.isArray(response)
      ? {
          data: response,
          limit: params.limit,
          offset: params.offset,
        }
      : response;
  }

  get<T = unknown>(
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    return invoke<T>("bangumi_api_get", {
      path,
      query: query ?? null,
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
