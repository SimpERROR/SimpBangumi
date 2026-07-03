import {
  bangumiApi,
  type AuthSession,
  type Episode,
  type OAuthLoginStatus,
  type PagedResponse,
  type SearchSubject,
  type SubjectDetail,
  type SubjectEpisodesParams,
  type SubjectSearchParams,
  type SubjectCollectionParams,
  type SubjectCollection,
  type UserEpisodeCollection,
  type UserSubjectCollection,
  type UserSubjectEpisodeCollectionsParams,
  type UserSubjectCollectionModifyPayload,
  type WorkerOAuthTokenRequest,
} from "../api/bangumi";

export type ApiResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: string };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, error: null };
}

function fail<T>(error: unknown): ApiResult<T> {
  return { ok: false, data: null, error: getErrorMessage(error) };
}

export function useBangumi() {
  async function getSession(): Promise<ApiResult<AuthSession>> {
    try {
      return ok(await bangumiApi.getAuthSession());
    } catch (error) {
      return fail<AuthSession>(error);
    }
  }

  async function getCollections(
    params: SubjectCollectionParams = {},
  ): Promise<ApiResult<PagedResponse<SubjectCollection>>> {
    try {
      const response = await bangumiApi.getSubjectCollections(params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<SubjectCollection>>(error);
    }
  }

  async function loginWithPersonalAccessToken(
    token: string,
  ): Promise<ApiResult<AuthSession>> {
    try {
      return ok(await bangumiApi.loginWithPersonalAccessToken(token));
    } catch (error) {
      return fail<AuthSession>(error);
    }
  }

  async function getSubjectDetail(
    subjectId: number,
  ): Promise<ApiResult<SubjectDetail>> {
    try {
      return ok(await bangumiApi.getSubjectDetail(subjectId));
    } catch (error) {
      return fail<SubjectDetail>(error);
    }
  }

  async function getCurrentUserSubjectCollection(
    subjectId: number,
  ): Promise<ApiResult<UserSubjectCollection>> {
    try {
      return ok(await bangumiApi.getCurrentUserSubjectCollection(subjectId));
    } catch (error) {
      return fail<UserSubjectCollection>(error);
    }
  }

  async function updateCurrentUserSubjectCollection(
    subjectId: number,
    payload: UserSubjectCollectionModifyPayload,
  ): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.updateCurrentUserSubjectCollection(subjectId, payload));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function getEpisodesBySubject(
    subjectId: number,
    params: SubjectEpisodesParams = {},
  ): Promise<ApiResult<PagedResponse<Episode>>> {
    try {
      const response = await bangumiApi.getEpisodesBySubject(subjectId, params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<Episode>>(error);
    }
  }

  async function getCurrentUserSubjectEpisodeCollections(
    subjectId: number,
    params: UserSubjectEpisodeCollectionsParams = {},
  ): Promise<ApiResult<PagedResponse<UserEpisodeCollection>>> {
    try {
      const response = await bangumiApi.getCurrentUserSubjectEpisodeCollections(subjectId, params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<UserEpisodeCollection>>(error);
    }
  }

  async function updateCurrentUserEpisodeCollection(
    episodeId: number,
    type: number,
  ): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.updateCurrentUserEpisodeCollection(episodeId, type));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function searchSubjects(
    keyword: string,
    params: SubjectSearchParams = {},
  ): Promise<ApiResult<PagedResponse<SearchSubject>>> {
    try {
      const response = await bangumiApi.searchSubjects(keyword, params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<SearchSubject>>(error);
    }
  }

  async function startOAuthLogin(): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.startOAuthLogin());
    } catch (error) {
      return fail<string>(error);
    }
  }

  async function waitOAuthLoginResult(): Promise<ApiResult<OAuthLoginStatus>> {
    try {
      return ok(await bangumiApi.waitOAuthLoginResult());
    } catch (error) {
      return fail<OAuthLoginStatus>(error);
    }
  }

  async function loginWithWorkerToken(
    request: WorkerOAuthTokenRequest,
  ): Promise<ApiResult<AuthSession>> {
    try {
      return ok(await bangumiApi.loginWithWorkerToken(request));
    } catch (error) {
      return fail<AuthSession>(error);
    }
  }

  async function logout(): Promise<ApiResult<AuthSession>> {
    try {
      return ok(await bangumiApi.logout());
    } catch (error) {
      return fail<AuthSession>(error);
    }
  }

  return {
    getSession,
    getCollections,
    loginWithPersonalAccessToken,
    startOAuthLogin,
    waitOAuthLoginResult,
    loginWithWorkerToken,
    logout,
    getSubjectDetail,
    getCurrentUserSubjectCollection,
    updateCurrentUserSubjectCollection,
    getEpisodesBySubject,
    getCurrentUserSubjectEpisodeCollections,
    updateCurrentUserEpisodeCollection,
    searchSubjects,
  };
}
