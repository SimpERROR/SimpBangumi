import { computed, watch } from "vue";
import type { ViewMode } from "../stores/app";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { useBangumi } from "./useBangumi";
import { usePagination, type PaginationController } from "./usePagination";

interface UseHomeOptions {
  pagination?: PaginationController;
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

  const isLastPage = computed(() => {
    if (appStore.total.value === undefined) {
      const currentItems =
        appStore.view.value === "timeline"
          ? dataStore.timeline.value.length
          : dataStore.collections.value.length;

      return currentItems < pagination.pageSize;
    }

    return pagination.offset.value + pagination.pageSize >= appStore.total.value;
  });

  async function fetchHome() {
    appStore.loading.value = true;
    appStore.error.value = "";

    const sessionResult = await bangumi.getSession();
    if (!sessionResult.ok) {
      appStore.error.value = sessionResult.error;
      sessionStore.session.value = null;
      appStore.loading.value = false;
      return;
    }

    sessionStore.session.value = sessionResult.data;

    if (!sessionResult.data.authenticated) {
      dataStore.timeline.value = [];
      dataStore.collections.value = [];
      appStore.total.value = undefined;
      appStore.loading.value = false;
      return;
    }

    if (appStore.view.value === "timeline") {
      const timelineResult = await bangumi.getTimeline({
        limit: pagination.pageSize,
        offset: pagination.offset.value,
      });

      if (!timelineResult.ok) {
        appStore.error.value = timelineResult.error;
        appStore.loading.value = false;
        return;
      }

      dataStore.timeline.value = timelineResult.data.data;
      appStore.total.value = timelineResult.data.total;
      appStore.loading.value = false;
      return;
    }

    const collectionsResult = await bangumi.getCollections({
      limit: pagination.pageSize,
      offset: pagination.offset.value,
    });

    if (!collectionsResult.ok) {
      appStore.error.value = collectionsResult.error;
      appStore.loading.value = false;
      return;
    }

    dataStore.collections.value = collectionsResult.data.data;
    appStore.total.value = collectionsResult.data.total;
    appStore.loading.value = false;
  }

  async function setView(view: ViewMode) {
    appStore.view.value = view;
    pagination.reset();
    await fetchHome();
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
    view: appStore.view,
    fetchHome,
    refresh,
    setView,
    nextPage,
    prevPage,
    pageSize: pagination.pageSize,
    offset: pagination.offset,
    currentPage: pagination.currentPage,
    isLastPage,
    resetPagination: pagination.reset,
  };
}
