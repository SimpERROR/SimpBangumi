import {
  bangumiApi,
  type AuthSession,
  type BangumiUser,
  type CharacterDetail,
  type CharacterPerson,
  type CharacterSearchParams,
  type Episode,
  type OAuthFinishStatus,
  type OAuthStartLoginRequest,
  type MonoType,
  type PersonCareer,
  type PersonDetail,
  type PersonSearchParams,
  type PagedResponse,
  type PageParams,
  type SubjectCommentInterestType,
  type SearchCharacter,
  type SearchPerson,
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
  type BangumiIndex,
  type IndexBasicInfo,
  type IndexSubject,
  type IndexSubjectAddInfo,
  type IndexSubjectEditInfo,
  type UserCharacterCollection,
  type UserPersonCollection,
} from "../api/bangumi";
import { useAppStore } from "../stores/app";

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
  const appStore = useAppStore();

  async function hasWebCookie(feature: string): Promise<boolean> {
    const status = await getWebCookieStatus();
    if (!status.ok || status.data.configured) {
      return true;
    }

    appStore.showCookieSetupPrompt(feature);
    return false;
  }

  function promptForMissingWebCookie(error: unknown, feature: string): boolean {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes("no saved bangumi web cookie")) {
      appStore.showCookieSetupPrompt(feature);
      return true;
    }
    return false;
  }

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

  async function getCharacterRelatedPersons(
    characterId: number,
  ): Promise<ApiResult<CharacterPerson[]>> {
    try {
      return ok(await bangumiApi.getCharacterRelatedPersons(characterId));
    } catch (error) {
      return fail<CharacterPerson[]>(error);
    }
  }

  async function getUserCharacterCollections(username?: string): Promise<ApiResult<PagedResponse<UserCharacterCollection>>> {
    try {
      const response = await bangumiApi.getUserCharacterCollections(username);
      return ok({ ...response, data: response.data ?? [] });
    } catch (error) {
      return fail<PagedResponse<UserCharacterCollection>>(error);
    }
  }

  async function isCharacterCollected(characterId: number): Promise<ApiResult<boolean>> {
    try {
      await bangumiApi.getUserCharacterCollection(characterId);
      return ok(true);
    } catch (error) {
      const message = getErrorMessage(error);
      return message.includes("404") ? ok(false) : fail<boolean>(error);
    }
  }

  async function setCharacterCollected(characterId: number, collected: boolean): Promise<ApiResult<null>> {
    try {
      return ok(collected
        ? await bangumiApi.collectCharacter(characterId)
        : await bangumiApi.uncollectCharacter(characterId));
    } catch (error) {
      if (promptForMissingWebCookie(error, "取消收藏角色（API 失败后的网页回退）")) {
        return fail<null>("取消收藏角色的 API 调用失败，网页回退需要 Bangumi 网页 Cookie。");
      }
      return fail<null>(error);
    }
  }

  async function getUserPersonCollections(username?: string): Promise<ApiResult<PagedResponse<UserPersonCollection>>> {
    try {
      const response = await bangumiApi.getUserPersonCollections(username);
      return ok({ ...response, data: response.data ?? [] });
    } catch (error) {
      return fail<PagedResponse<UserPersonCollection>>(error);
    }
  }

  async function isPersonCollected(personId: number): Promise<ApiResult<boolean>> {
    try {
      await bangumiApi.getUserPersonCollection(personId);
      return ok(true);
    } catch (error) {
      const message = getErrorMessage(error);
      return message.includes("404") ? ok(false) : fail<boolean>(error);
    }
  }

  async function setPersonCollected(personId: number, collected: boolean): Promise<ApiResult<null>> {
    try {
      return ok(collected
        ? await bangumiApi.collectPerson(personId)
        : await bangumiApi.uncollectPerson(personId));
    } catch (error) {
      if (promptForMissingWebCookie(error, "取消收藏人物（API 失败后的网页回退）")) {
        return fail<null>("取消收藏人物的 API 调用失败，网页回退需要 Bangumi 网页 Cookie。");
      }
      return fail<null>(error);
    }
  }

  async function createIndex(info: IndexBasicInfo): Promise<ApiResult<BangumiIndex>> {
    try {
      const created = await bangumiApi.createIndex();
      if (!info.title && !info.description) return ok(created);
      return ok(await bangumiApi.editIndex(created.id, info));
    } catch (error) {
      return fail<BangumiIndex>(error);
    }
  }

  async function getIndex(indexId: number): Promise<ApiResult<BangumiIndex>> {
    try {
      return ok(await bangumiApi.getIndex(indexId));
    } catch (error) {
      return fail<BangumiIndex>(error);
    }
  }

  async function editIndex(indexId: number, info: IndexBasicInfo): Promise<ApiResult<BangumiIndex>> {
    try {
      return ok(await bangumiApi.editIndex(indexId, info));
    } catch (error) {
      return fail<BangumiIndex>(error);
    }
  }

  async function deleteIndex(indexId: number): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.deleteIndex(indexId));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function getIndexSubjects(
    indexId: number,
    params: PageParams & { type?: number } = {},
  ): Promise<ApiResult<PagedResponse<IndexSubject>>> {
    try {
      const response = await bangumiApi.getIndexSubjects(indexId, params);
      return ok(Array.isArray(response)
        ? { data: response, total: response.length, limit: params.limit, offset: params.offset }
        : { ...response, data: response.data ?? [] });
    } catch (error) {
      return fail<PagedResponse<IndexSubject>>(error);
    }
  }

  async function addSubjectToIndex(indexId: number, info: IndexSubjectAddInfo): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.addSubjectToIndex(indexId, info));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function editIndexSubject(
    indexId: number,
    subjectId: number,
    info: IndexSubjectEditInfo,
  ): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.editIndexSubject(indexId, subjectId, info));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function deleteIndexSubject(indexId: number, subjectId: number): Promise<ApiResult<null>> {
    try {
      return ok(await bangumiApi.deleteIndexSubject(indexId, subjectId));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function setIndexCollected(indexId: number, collected: boolean): Promise<ApiResult<null>> {
    try {
      return ok(collected
        ? await bangumiApi.collectIndex(indexId)
        : await bangumiApi.uncollectIndex(indexId));
    } catch (error) {
      if (promptForMissingWebCookie(error, "取消收藏目录（API 失败后的网页回退）")) {
        return fail<null>("取消收藏目录的 API 调用失败，网页回退需要 Bangumi 网页 Cookie。");
      }
      return fail<null>(error);
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

  async function fetchUserIndicesPage(
    username: string,
    collected = false,
    page = 1,
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.fetchUserIndicesPage(username, collected, page));
    } catch (error) {
      return fail<string>(error);
    }
  }

  function isWebCookieExpiredError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    return message.includes("cookie")
      && (message.includes("expired") || message.includes("invalid") || message.includes("login"));
  }

  async function refreshWebCookieSilently(): Promise<boolean> {
    try {
      await bangumiApi.refreshWebCookie();
      return true;
    } catch {
      return false;
    }
  }

  async function fetchIndexPage(indexId: number): Promise<ApiResult<string>> {
    const feature = "查看目录内容";
    if (!await hasWebCookie(feature)) {
      return fail<string>("此功能需要先配置 Bangumi 网页 Cookie。");
    }
    await refreshWebCookieSilently();
    try {
      return ok(await bangumiApi.fetchIndexPage(indexId));
    } catch (error) {
      if (isWebCookieExpiredError(error) && await refreshWebCookieSilently()) {
        try {
          return ok(await bangumiApi.fetchIndexPage(indexId));
        } catch (retryError) {
          appStore.showCookieSetupPrompt(feature);
          return fail<string>(retryError);
        }
      }
      if (isWebCookieExpiredError(error)) appStore.showCookieSetupPrompt(feature);
      return fail<string>(error);
    }
  }

  async function fetchSubjectPage(subjectId: number): Promise<ApiResult<string>> {
    const feature = "查看条目详情";
    if (!await hasWebCookie(feature)) {
      return fail<string>("此功能需要先配置 Bangumi 网页 Cookie。");
    }
    try {
      return ok(await bangumiApi.fetchSubjectPage(subjectId));
    } catch (error) {
      if (isWebCookieExpiredError(error) && await refreshWebCookieSilently()) {
        try {
          return ok(await bangumiApi.fetchSubjectPage(subjectId));
        } catch (retryError) {
          appStore.showCookieSetupPrompt(feature);
          return fail<string>(retryError);
        }
      }
      if (isWebCookieExpiredError(error)) appStore.showCookieSetupPrompt(feature);
      return fail<string>(error);
    }
  }
  async function addIndexEntityViaWeb(
    indexId: number,
    entityType: "character" | "person",
    entityId: number,
  ): Promise<ApiResult<null>> {
    if (!await hasWebCookie(`将${entityType === "character" ? "角色" : "人物"}加入目录`)) {
      return fail<null>("此功能需要先配置 Bangumi 网页 Cookie。");
    }
    try {
      return ok(await bangumiApi.addIndexEntityViaWeb(indexId, entityType, entityId));
    } catch (error) {
      return fail<null>(error);
    }
  }

  async function fetchUserMonoCollectionsPage(
    username: string,
    monoType: MonoType,
    page = 1,
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.fetchUserMonoCollectionsPage(username, monoType, page));
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

  async function searchCharacters(
    keyword: string,
    params: CharacterSearchParams = {},
  ): Promise<ApiResult<PagedResponse<SearchCharacter>>> {
    try {
      const response = await bangumiApi.searchCharacters(keyword, params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<SearchCharacter>>(error);
    }
  }

  async function searchPersons(
    keyword: string,
    params: PersonSearchParams = {},
  ): Promise<ApiResult<PagedResponse<SearchPerson>>> {
    try {
      const response = await bangumiApi.searchPersons(keyword, params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<SearchPerson>>(error);
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

  async function finishOAuthLogin(): Promise<ApiResult<OAuthFinishStatus>> {
    try {
      return ok(await bangumiApi.finishOAuthLogin());
    } catch (error) {
      return fail<OAuthFinishStatus>(error);
    }
  }

  async function refreshOAuthSession(): Promise<ApiResult<AuthSession>> {
    try {
      return ok(await bangumiApi.refreshOAuthSession());
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

  async function fetchAnimeBrowserPage(
    sort: "trends" | "rank",
    page = 1,
  ): Promise<ApiResult<string>> {
    try {
      return ok(await bangumiApi.fetchAnimeBrowserPage(sort, page));
    } catch (error) {
      return fail<string>(error);
    }
  }

  return {
    getSession,
    getMe,
    getCollections,
    loginWithPersonalAccessToken,
    startOAuthLogin,
    finishOAuthLogin,
    refreshOAuthSession,
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
    getCharacterRelatedPersons,
    getUserCharacterCollections,
    isCharacterCollected,
    setCharacterCollected,
    getUserPersonCollections,
    isPersonCollected,
    setPersonCollected,
    createIndex,
    getIndex,
    editIndex,
    deleteIndex,
    getIndexSubjects,
    addSubjectToIndex,
    editIndexSubject,
    deleteIndexSubject,
    setIndexCollected,
    fetchSubjectCommentsPage,
    fetchMonoCommentsPage,
    fetchUserIndicesPage,
    fetchIndexPage,
    fetchSubjectPage,
    addIndexEntityViaWeb,
    fetchUserMonoCollectionsPage,
    getSubjectRelatedCharacters,
    getSubjectRelatedPersons,
    getCurrentUserSubjectCollection,
    updateCurrentUserSubjectCollection,
    getEpisodesBySubject,
    getCurrentUserSubjectEpisodeCollections,
    updateCurrentUserEpisodeCollection,
    searchSubjects,
    searchCharacters,
    searchPersons,
    getCalendar,
    fetchAnimeBrowserPage,
  };
}
