import {
  bangumiApi,
  type AuthSession,
  type BangumiUser,
  type CharacterDetail,
  type Episode,
  type OAuthLoginStatus,
  type OAuthStartLoginRequest,
  type MonoType,
  type PersonDetail,
  type PagedResponse,
  type SubjectCommentInterestType,
  type SearchSubject,
  type RelatedCharacter,
  type RelatedPerson,
  type SubjectDetail,
  type SubjectEpisodesParams,
  type SubjectSearchParams,
  type SubjectCollectionParams,
  type SubjectCollection,
  type UserEpisodeCollection,
  type UserSubjectCollection,
  type UserSubjectEpisodeCollectionsParams,
  type UserSubjectCollectionModifyPayload,
  type CalendarDay,
  type WebCookieStatus,
  type WebCookieValidationStatus,
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

  async function getMe(): Promise<ApiResult<BangumiUser>> {
    try {
      return ok(await bangumiApi.getMe());
    } catch (error) {
      return fail<BangumiUser>(error);
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

  async function getSubjectRelatedCharacters(
    subjectId: number,
  ): Promise<ApiResult<RelatedCharacter[]>> {
    try {
      return ok(await bangumiApi.getSubjectRelatedCharacters(subjectId));
    } catch (error) {
      return fail<RelatedCharacter[]>(error);
    }
  }

  async function getSubjectRelatedPersons(
    subjectId: number,
  ): Promise<ApiResult<RelatedPerson[]>> {
    try {
      return ok(await bangumiApi.getSubjectRelatedPersons(subjectId));
    } catch (error) {
      return fail<RelatedPerson[]>(error);
    }
  }

  async function getPersonDetail(
    personId: number,
  ): Promise<ApiResult<PersonDetail>> {
    try {
      return ok(await bangumiApi.getPersonDetail(personId));
    } catch (error) {
      return fail<PersonDetail>(error);
    }
  }

  async function getCharacterDetail(
    characterId: number,
  ): Promise<ApiResult<CharacterDetail>> {
    try {
      return ok(await bangumiApi.getCharacterDetail(characterId));
    } catch (error) {
      return fail<CharacterDetail>(error);
    }
  }

  async function fetchSubjectCommentsPage(
    subjectId: number,
    interestType?: SubjectCommentInterestType,
    page = 1,
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.fetchSubjectCommentsPage(subjectId, interestType, page));
    } catch (error) {
      return fail<string>(error);
    }
  }

  async function fetchMonoCommentsPage(
    monoType: MonoType,
    monoId: number,
    page = 1,
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.fetchMonoCommentsPage(monoType, monoId, page));
    } catch (error) {
      return fail<string>(error);
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

  async function startOAuthLogin(
    request: OAuthStartLoginRequest = {},
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.startOAuthLogin(request));
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

  async function getWebCookieStatus(): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.getWebCookieStatus());
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function saveWebCookie(cookie: string): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.saveWebCookie(cookie));
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function clearWebCookie(): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.clearWebCookie());
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function refreshWebCookie(): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.refreshWebCookie());
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function validateWebCookie(): Promise<ApiResult<WebCookieValidationStatus>> {
    try {
      return ok(await bangumiApi.validateWebCookie());
    } catch (error) {
      return fail<WebCookieValidationStatus>(error);
    }
  }

  async function restoreWebCookieFromEmbeddedSession(): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.restoreWebCookieFromEmbeddedSession());
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function openEmbeddedWebLogin(): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.openEmbeddedWebLogin());
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function captureEmbeddedWebCookie(): Promise<ApiResult<WebCookieStatus>> {
    try {
      return ok(await bangumiApi.captureEmbeddedWebCookie());
    } catch (error) {
      return fail<WebCookieStatus>(error);
    }
  }

  async function getCalendar(): Promise<ApiResult<CalendarDay[]>> {
    try {
      return ok(await bangumiApi.getCalendar());
    } catch (error) {
      return fail<CalendarDay[]>(error);
    }
  }

  return {
    getSession,
    getMe,
    getCollections,
    loginWithPersonalAccessToken,
    startOAuthLogin,
    waitOAuthLoginResult,
    loginWithWorkerToken,
    logout,
    getWebCookieStatus,
    saveWebCookie,
    clearWebCookie,
    refreshWebCookie,
    validateWebCookie,
    restoreWebCookieFromEmbeddedSession,
    openEmbeddedWebLogin,
    captureEmbeddedWebCookie,
    getSubjectDetail,
    getPersonDetail,
    getCharacterDetail,
    fetchSubjectCommentsPage,
    fetchMonoCommentsPage,
    getSubjectRelatedCharacters,
    getSubjectRelatedPersons,
    getCurrentUserSubjectCollection,
    updateCurrentUserSubjectCollection,
    getEpisodesBySubject,
    getCurrentUserSubjectEpisodeCollections,
    updateCurrentUserEpisodeCollection,
    searchSubjects,
    getCalendar,
  };
}
