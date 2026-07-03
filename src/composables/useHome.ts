import { computed, watch } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { useBangumi } from "./useBangumi";
import { usePagination, type PaginationController } from "./usePagination";

interface UseHomeOptions {
  pagination?: PaginationController;
}

function logInfo(message: string, extra?: Record<string, unknown>) {
  console.info("[home]", message, extra ?? {});
}

function logError(message: string, error: string, extra?: Record<string, unknown>) {
  console.error("[home]", message, {
    ...extra,
    error,
  });
}

export function useHome(options: UseHomeOptions = {}) {
  const appStore = useAppStore();
  const dataStore = useDataStore();
  const sessionStore = useSessionStore();
  const bangumi = useBangumi();
  const pagination =
    options.pagination ??
    usePagination({
      pageSize: 20,
      initialOffset: appStore.offset.value,
    });

  watch(
    pagination.offset,
    (value) => {
      if (appStore.offset.value !== value) {
        appStore.offset.value = value;
      }
    },
    { immediate: true },
  );

  watch(appStore.offset, (value) => {
    if (pagination.offset.value !== value) {
      pagination.setOffset(value);
    }
  });

  watch(
    [appStore.subjectTypeFilter, appStore.collectionTypeFilter],
    () => {
      pagination.reset();
      void fetchHome();
    },
    { immediate: false },
  );

  const isLastPage = computed(() => {
    if (appStore.total.value === undefined) {
      return dataStore.collections.value.length < pagination.pageSize;
    }

    return pagination.offset.value + pagination.pageSize >= appStore.total.value;
  });

  function handleAuthFailure(error: string) {
    if (!/(401|403|refresh token|stored oauth session|unauthorized)/i.test(error)) {
      return;
    }

    logError("clearing broken auth state after home request failure", error, {
      hasSession: Boolean(sessionStore.session.value),
      hasWorkerToken: Boolean(sessionStore.oauthTokens.value?.accessToken),
    });

    sessionStore.session.value = null;
    sessionStore.oauthTokens.value = null;
    dataStore.collections.value = [];
    appStore.total.value = undefined;
  }

  async function fetchHome() {
    logInfo("fetchHome start", {
      offset: pagination.offset.value,
      subjectTypeFilter: appStore.subjectTypeFilter.value,
      collectionTypeFilter: appStore.collectionTypeFilter.value,
    });
    appStore.loading.value = true;
    appStore.error.value = "";

    const sessionResult = await bangumi.getSession();
    if (!sessionResult.ok) {
      logError("failed to load auth session", sessionResult.error);
      appStore.error.value = sessionResult.error;
      sessionStore.session.value = null;
      appStore.loading.value = false;
      return;
    }

    sessionStore.session.value = sessionResult.data;
    const username = sessionResult.data.user?.username;
    logInfo("session restored", {
      authenticated: sessionResult.data.authenticated,
      source: sessionResult.data.source ?? null,
      username: username ?? null,
    });

    if (!sessionResult.data.authenticated) {
      logInfo("session unauthenticated, clearing home data");
      dataStore.collections.value = [];
      appStore.total.value = undefined;
      appStore.loading.value = false;
      return;
    }

    const collectionsResult = await bangumi.getCollections({
      limit: pagination.pageSize,
      offset: pagination.offset.value,
      username,
      subject_type:
        appStore.subjectTypeFilter.value === "all"
          ? undefined
          : appStore.subjectTypeFilter.value,
      type:
        appStore.collectionTypeFilter.value === "all"
          ? undefined
          : appStore.collectionTypeFilter.value,
    });

    if (!collectionsResult.ok) {
      logError("failed to load collections", collectionsResult.error, {
        offset: pagination.offset.value,
        username: username ?? null,
      });
      appStore.error.value = collectionsResult.error;
      handleAuthFailure(collectionsResult.error);
      appStore.loading.value = false;
      return;
    }

    dataStore.collections.value = collectionsResult.data.data;
    appStore.total.value = collectionsResult.data.total;
    logInfo("collections loaded", {
      count: collectionsResult.data.data.length,
      total: collectionsResult.data.total ?? null,
    });
    appStore.loading.value = false;
  }

  async function refresh() {
    await fetchHome();
  }

  async function nextPage() {
    pagination.nextPage();
    await fetchHome();
  }

  async function prevPage() {
    pagination.prevPage();
    await fetchHome();
  }

  return {
    loading: appStore.loading,
    error: appStore.error,
    fetchHome,
    refresh,
    nextPage,
    prevPage,
    pageSize: pagination.pageSize,
    offset: pagination.offset,
    currentPage: pagination.currentPage,
    isLastPage,
    resetPagination: pagination.reset,
  };
}
