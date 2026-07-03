import {
  bangumiApi,
  type AuthSession,
  type PageParams,
  type PagedResponse,
  type SubjectCollection,
  type TimelineItem,
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

  async function getTimeline(
    params: PageParams = {},
  ): Promise<ApiResult<PagedResponse<TimelineItem>>> {
    try {
      const response = await bangumiApi.getTimeline(params);
      return ok({
        ...response,
        data: response.data ?? [],
      });
    } catch (error) {
      return fail<PagedResponse<TimelineItem>>(error);
    }
  }

  async function getCollections(
    params: PageParams = {},
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

  return {
    getSession,
    getTimeline,
    getCollections,
  };
}
