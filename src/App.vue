<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import TitleBar from "./components/TitleBar.vue";
import Pager from "./components/Pager.vue";
import CompleteView from "./views/Complete.vue";
import akariAvatar from "./assets/akari.png";
import {
  useAppStore,
  type CollectionTypeFilter,
  type SubjectTypeFilter,
  type TitlePreference,
  type ThemeMode,
} from "./stores/app";
import { useDataStore } from "./stores/data";
import { useSessionStore } from "./stores/session";
import { useBangumi } from "./composables/useBangumi";
import { useHome } from "./composables/useHome";
import { usePagination } from "./composables/usePagination";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Live2dModelInfo } from "./stores/app";
import LinkConfirmModal from "./components/LinkConfirmModal.vue";
import WorkersCommunicationModal from "./components/WorkersCommunicationModal.vue";
import ImageContextMenu from "./components/ImageContextMenu.vue";
import { checkTimeDrift, setTimeMismatch } from "./utils/timeCheck";
import { useLinkInterceptor } from "./composables/useLinkInterceptor";
import { useBroadcastNotify } from "./composables/useBroadcastNotify";

const loadCollectionsView = () => import("./views/Collections.vue");
const loadSettingsView = () => import("./views/Settings.vue");
const CollectionsView = defineAsyncComponent(loadCollectionsView);
const ScheduleView = defineAsyncComponent(() => import("./views/Schedule.vue"));
const SearchView = defineAsyncComponent(() => import("./views/Search.vue"));
const SettingsView = defineAsyncComponent(loadSettingsView);
const MyView = defineAsyncComponent(() => import("./views/My.vue"));
const LibraryView = defineAsyncComponent(() => import("./views/Library.vue"));
const Live2dCompanion = defineAsyncComponent(() => import("./components/Live2dCompanion.vue"));

function preloadAsyncViews() {
  const preloadTasks = [
    loadCollectionsView(),
    import("./views/Schedule.vue"),
    import("./views/Search.vue"),
    loadSettingsView(),
    import("./views/My.vue"),
    import("./views/Library.vue"),
    import("./components/Live2dCompanion.vue"),
  ];

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => {
      void Promise.allSettled(preloadTasks);
    });
    return;
  }

  setTimeout(() => {
    void Promise.allSettled(preloadTasks);
  }, 150);
}

const THEME_KEY = "bangumi.theme";
const SUBJECT_FILTER_KEY = "bangumi.filter.subjectType";
const COLLECTION_FILTER_KEY = "bangumi.filter.collectionType";
const TITLE_PREFERENCE_KEY = "bangumi.title.preference";
const LIVE2D_ENABLED_KEY = "bangumi.live2d.enabled";
const LIVE2D_OPERATION_LOCKED_KEY = "bangumi.live2d.operationLocked";
const LIVE2D_ACTIVE_MODEL_KEY = "bangumi.live2d.activeModel";
const LIVE2D_AUTO_SPEAK_KEY = "bangumi.live2d.autoSpeak";
const LIVE2D_AUTO_SPEAK_MIN_INTERVAL_KEY = "bangumi.live2d.autoSpeakMinInterval";
const LIVE2D_AUTO_SPEAK_MAX_INTERVAL_KEY = "bangumi.live2d.autoSpeakMaxInterval";
const NSFW_INTERACTION_ENABLED_KEY = "bangumi.live2d.nsfwInteractionEnabled";
const CHECK_UPDATE_KEY = "bangumi.update.checkOnStartup";

const THEME_OPTIONS: ThemeMode[] = ["light", "dark"];
const SUBJECT_FILTER_OPTIONS: SubjectTypeFilter[] = ["all", 1, 2, 3, 4, 6];
const COLLECTION_FILTER_OPTIONS: CollectionTypeFilter[] = ["all", 1, 2, 3, 4, 5];
const TITLE_PREFERENCE_OPTIONS: TitlePreference[] = ["translated", "original"];
const COOKIE_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const appStore = useAppStore();
const dataStore = useDataStore();
const sessionStore = useSessionStore();
const bangumi = useBangumi();
restorePersistedPreferences();
const pagination = usePagination({
  pageSize: 20,
  initialOffset: appStore.offset.value,
});
const home = useHome({ pagination });
useLinkInterceptor();
const broadcastNotify = useBroadcastNotify();

const completeViewRef = ref<{
  refresh: () => Promise<void>;
} | null>(null);
const collectionsViewRef = ref<{
  openDetailBySubjectId: (subjectId: number) => Promise<void>;
  openPersonDetail: (personId: number) => Promise<void>;
  openCharacterDetail: (characterId: number) => Promise<void>;
} | null>(null);
const scheduleViewRef = ref<{
  refresh: () => Promise<void>;
} | null>(null);
const settingsViewRef = ref<{
  openWebLogin: () => void;
} | null>(null);
const libraryViewRef = ref<{
  refresh: () => Promise<void>;
  restoreIndexDetail: () => Promise<void>;
} | null>(null);

const pageTitle = computed(() => "Subject Collections");
type HomeTab = "complete" | "collections" | "schedule" | "search" | "more" | "my" | "settings";
type PrimaryHomeTab = Exclude<HomeTab, "my" | "settings">;
type CollectionSection = "subject" | "character" | "person" | "index";
const activeHomeTab = ref<HomeTab>("complete");
const collectionSection = ref<CollectionSection>("subject");
const collectionsViewLoaded = ref(false);
const libraryViewLoaded = ref(false);

// Tab indicator sliding animation
const tabsRef = ref<HTMLElement | null>(null);
const tabCompleteRef = ref<HTMLElement | null>(null);
const tabCollectionsRef = ref<HTMLElement | null>(null);
const tabScheduleRef = ref<HTMLElement | null>(null);
const tabSearchRef = ref<HTMLElement | null>(null);
const tabMoreRef = ref<HTMLElement | null>(null);
const collectionTabsRef = ref<HTMLElement | null>(null);
const collectionSubjectRef = ref<HTMLElement | null>(null);
const collectionCharacterRef = ref<HTMLElement | null>(null);
const collectionPersonRef = ref<HTMLElement | null>(null);
const collectionIndexRef = ref<HTMLElement | null>(null);

const tabRefMap: Record<PrimaryHomeTab, typeof tabCompleteRef> = {
  complete: tabCompleteRef,
  collections: tabCollectionsRef,
  schedule: tabScheduleRef,
  search: tabSearchRef,
  more: tabMoreRef,
};
const isPrimaryHomeTab = computed(() => activeHomeTab.value !== "my" && activeHomeTab.value !== "settings");
const canRefresh = computed(() => ["complete", "collections", "schedule"].includes(activeHomeTab.value));

const tabIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });
const collectionIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });

function updateTabIndicator() {
  if (!isPrimaryHomeTab.value) return;
  const activeRef = tabRefMap[activeHomeTab.value as PrimaryHomeTab];
  const tabEl = activeRef?.value;
  const container = tabsRef.value;
  if (!tabEl || !container) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();

  tabIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

function updateCollectionIndicator() {
  const container = collectionTabsRef.value;
  const tabMap: Record<CollectionSection, typeof collectionSubjectRef> = {
    subject: collectionSubjectRef,
    character: collectionCharacterRef,
    person: collectionPersonRef,
    index: collectionIndexRef,
  };
  const tabEl = tabMap[collectionSection.value].value;
  if (!container || !tabEl) return;
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();
  collectionIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

function updateTabIndicators() {
  updateTabIndicator();
  updateCollectionIndicator();
}

watch([activeHomeTab, collectionSection], () => {
  nextTick(updateTabIndicators);
});

const cookieAutoRefreshTimer = ref<number | null>(null);
const cookieInvalidToastShown = ref(false);

function parseAvatar(avatar: unknown): string {
  if (typeof avatar === "string") return absoluteBangumiUrl(avatar);
  if (!avatar || typeof avatar !== "object") return "";
  const record = avatar as Record<string, unknown>;
  for (const key of ["large", "medium", "small", "url"]) {
    if (typeof record[key] === "string" && record[key]) return absoluteBangumiUrl(record[key]);
  }
  return record.avatar && record.avatar !== avatar ? parseAvatar(record.avatar) : "";
}

function absoluteBangumiUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://bgm.tv${url}`;
  return url;
}

const accountAvatar = computed(() => parseAvatar(sessionStore.session.value?.user?.avatar) || akariAvatar);
const accountLabel = computed(() => {
  const user = sessionStore.session.value?.user;
  return user?.nickname || user?.username || "我的";
});

function handleAccountAvatarError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.dataset.fallback) return;
  image.dataset.fallback = "true";
  image.src = akariAvatar;
}

async function populateSubjectCollectionMap() {
  if (!sessionStore.authenticated.value) return;
  try {
    for (const ct of [1, 2, 3, 4, 5]) {
      const result = await bangumi.getCollections({ limit: 100, offset: 0, type: ct });
      if (result.ok) dataStore.updateSubjectCollectionMap(result.data.data);
    }
  } catch { /* ignore */ }
}

async function handleAuthenticated() {
  await home.fetchHome();
  void populateSubjectCollectionMap();
}

async function handleLoggedOut() {
  await home.fetchHome();
}

async function openCookieSettings() {
  appStore.hideCookieSetupPrompt();
  activeHomeTab.value = "settings";
  await loadSettingsView();
  await nextTick();
  settingsViewRef.value?.openWebLogin();
}

async function handleRefresh() {
  if (activeHomeTab.value === "complete") {
    await completeViewRef.value?.refresh();
    return;
  }

  if (activeHomeTab.value === "collections") {
    if (collectionSection.value === "subject") {
      await home.refresh();
    } else {
      await libraryViewRef.value?.refresh();
    }
    return;
  }

  if (activeHomeTab.value === "schedule") {
    await scheduleViewRef.value?.refresh();
    return;
  }
}

async function activateHomeTab(tab: HomeTab) {
  activeHomeTab.value = tab;

  if (tab === "collections") {
    if (collectionSection.value === "subject") {
      collectionsViewLoaded.value = true;
    } else {
      libraryViewLoaded.value = true;
    }
  }

  if (tab === "complete") {
    await nextTick();
    await completeViewRef.value?.refresh();
  }

}

async function ensureCollectionsViewMounted() {
  collectionsViewLoaded.value = true;
  await loadCollectionsView();
  await nextTick();
}

async function handleSearchOpenSubject(subjectId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openDetailBySubjectId(subjectId);
}

async function handleSearchOpenCharacter(characterId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openCharacterDetail(characterId);
}

async function handleSearchOpenPerson(personId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openPersonDetail(personId);
}

async function handleLibraryOpenCharacter(characterId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openCharacterDetail(characterId);
}

async function handleLibraryOpenPerson(personId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openPersonDetail(personId);
}

async function handleLibraryOpenSubject(subjectId: number) {
  await ensureCollectionsViewMounted();
  await collectionsViewRef.value?.openDetailBySubjectId(subjectId);
}

async function handleSubjectDetailClosed() {
  await libraryViewRef.value?.restoreIndexDetail();
}

function restorePersistedPreferences() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme && THEME_OPTIONS.includes(savedTheme as ThemeMode)) {
    appStore.theme.value = savedTheme as ThemeMode;
  }

  const savedSubjectFilter = localStorage.getItem(SUBJECT_FILTER_KEY);
  if (
    savedSubjectFilter &&
    SUBJECT_FILTER_OPTIONS.includes((savedSubjectFilter === "all" ? savedSubjectFilter : Number(savedSubjectFilter)) as SubjectTypeFilter)
  ) {
    appStore.subjectTypeFilter.value =
      savedSubjectFilter === "all"
        ? "all"
        : (Number(savedSubjectFilter) as SubjectTypeFilter);
  }

  const savedCollectionFilter = localStorage.getItem(COLLECTION_FILTER_KEY);
  if (
    savedCollectionFilter &&
    COLLECTION_FILTER_OPTIONS.includes((savedCollectionFilter === "all" ? savedCollectionFilter : Number(savedCollectionFilter)) as CollectionTypeFilter)
  ) {
    appStore.collectionTypeFilter.value =
      savedCollectionFilter === "all"
        ? "all"
        : (Number(savedCollectionFilter) as CollectionTypeFilter);
  }

  const savedTitlePreference = localStorage.getItem(TITLE_PREFERENCE_KEY);
  if (savedTitlePreference && TITLE_PREFERENCE_OPTIONS.includes(savedTitlePreference as TitlePreference)) {
    appStore.titlePreference.value = savedTitlePreference as TitlePreference;
  }

  const savedLive2dEnabled = localStorage.getItem(LIVE2D_ENABLED_KEY);
  if (savedLive2dEnabled === "true") {
    appStore.live2dEnabled.value = true;
  }

  const savedLive2dOperationLocked = localStorage.getItem(LIVE2D_OPERATION_LOCKED_KEY);
  if (savedLive2dOperationLocked === "true") {
    appStore.live2dOperationLocked.value = true;
  }

  const savedActiveModel = localStorage.getItem(LIVE2D_ACTIVE_MODEL_KEY);
  if (savedActiveModel) {
    appStore.live2dActiveModel.value = savedActiveModel;
  }

  const savedAutoSpeak = localStorage.getItem(LIVE2D_AUTO_SPEAK_KEY);
  if (savedAutoSpeak === "true") {
    appStore.live2dAutoSpeakEnabled.value = true;
  }

  const savedMinInterval = localStorage.getItem(LIVE2D_AUTO_SPEAK_MIN_INTERVAL_KEY);
  if (savedMinInterval) {
    const num = Number(savedMinInterval);
    if (num >= 5) {
      appStore.live2dAutoSpeakMinInterval.value = num;
    }
  }

  const savedMaxInterval = localStorage.getItem(LIVE2D_AUTO_SPEAK_MAX_INTERVAL_KEY);
  if (savedMaxInterval) {
    const num = Number(savedMaxInterval);
    if (num >= 5) {
      appStore.live2dAutoSpeakMaxInterval.value = num;
    }
  }

  const savedNsfwInteraction = localStorage.getItem(NSFW_INTERACTION_ENABLED_KEY);
  if (savedNsfwInteraction === "false") {
    appStore.nsfwInteractionEnabled.value = false;
  }

  const savedCheckUpdate = localStorage.getItem(CHECK_UPDATE_KEY);
  if (savedCheckUpdate === "false") {
    appStore.checkUpdateOnStartup.value = false;
  }
}

function setupPreferencePersistence() {
  watch(
    () => appStore.theme.value,
    (value) => {
      localStorage.setItem(THEME_KEY, value);
    },
  );

  watch(
    () => appStore.subjectTypeFilter.value,
    (value) => {
      localStorage.setItem(SUBJECT_FILTER_KEY, String(value));
    },
  );

  watch(
    () => appStore.collectionTypeFilter.value,
    (value) => {
      localStorage.setItem(COLLECTION_FILTER_KEY, String(value));
    },
  );

  watch(
    () => appStore.titlePreference.value,
    (value) => {
      localStorage.setItem(TITLE_PREFERENCE_KEY, value);
    },
  );

  watch(
    () => appStore.live2dEnabled.value,
    (value) => {
      localStorage.setItem(LIVE2D_ENABLED_KEY, String(value));
    },
  );

  watch(
    () => appStore.live2dOperationLocked.value,
    (value) => {
      localStorage.setItem(LIVE2D_OPERATION_LOCKED_KEY, String(value));
    },
  );

  watch(
    () => appStore.live2dActiveModel.value,
    (value) => {
      localStorage.setItem(LIVE2D_ACTIVE_MODEL_KEY, value);
    },
  );

  watch(
    () => appStore.live2dAutoSpeakEnabled.value,
    (value) => {
      localStorage.setItem(LIVE2D_AUTO_SPEAK_KEY, String(value));
    },
  );

  watch(
    () => appStore.live2dAutoSpeakMinInterval.value,
    (value) => {
      localStorage.setItem(LIVE2D_AUTO_SPEAK_MIN_INTERVAL_KEY, String(value));
    },
  );

  watch(
    () => appStore.live2dAutoSpeakMaxInterval.value,
    (value) => {
      localStorage.setItem(LIVE2D_AUTO_SPEAK_MAX_INTERVAL_KEY, String(value));
    },
  );

  watch(
    () => appStore.nsfwInteractionEnabled.value,
    (value) => {
      localStorage.setItem(NSFW_INTERACTION_ENABLED_KEY, String(value));
    },
  );

  watch(
    () => appStore.checkUpdateOnStartup.value,
    (value) => {
      localStorage.setItem(CHECK_UPDATE_KEY, String(value));
    },
  );
}

function isInvalidCookieError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("cookie")
    && (
      normalized.includes("无效")
      || normalized.includes("为空")
      || normalized.includes("失效")
      || normalized.includes("invalid")
      || normalized.includes("empty")
      || normalized.includes("expired")
    );
}

async function refreshWebCookieSilently() {
  const status = await bangumi.getWebCookieStatus();
  if (status.ok && !status.data.configured) {
    cookieInvalidToastShown.value = false;
    return;
  }

  const result = await bangumi.refreshWebCookie();
  if (result.ok) {
    cookieInvalidToastShown.value = false;
    return;
  }

  if (isInvalidCookieError(result.error)) {
    const restoreResult = await bangumi.restoreWebCookieFromEmbeddedSession();
    if (restoreResult.ok) {
      cookieInvalidToastShown.value = false;
      appStore.showToast("检测到保存的 Cookie 已失效，已从应用内网页登录会话自动恢复。", "success");
      return;
    }

    if (!cookieInvalidToastShown.value) {
      appStore.showToast("保存的 Cookie 已失效，且未能从应用内网页登录会话自动恢复，请在设置中重新获取。", "error");
      cookieInvalidToastShown.value = true;
    }
  }

  if (!result.ok) {
    // Ignore failures here to avoid interrupting normal app flow.
    return;
  }
}

watchEffect(() => {
  document.documentElement.dataset.theme = appStore.theme.value;
});

watch([activeHomeTab, collectionSection], ([tab, section]) => {
  if (tab !== "collections") return;
  if (section === "subject") {
    collectionsViewLoaded.value = true;
  } else {
    libraryViewLoaded.value = true;
  }
});

async function loadLive2dModels() {
  try {
    const models = await invoke<Live2dModelInfo[]>("list_live2d_models");
    appStore.live2dModels.value = models;
    if (!models.some((m) => m.name === appStore.live2dActiveModel.value)) {
      appStore.live2dActiveModel.value = models[0]?.name ?? "";
    }
  } catch { /* ignore */ }
}

watch(
  () => appStore.live2dEnabled.value,
  (enabled) => {
    if (enabled) void loadLive2dModels();
  },
  { immediate: true },
);

onMounted(() => {
  setupPreferencePersistence();
  preloadAsyncViews();

  void refreshWebCookieSilently();
  cookieAutoRefreshTimer.value = window.setInterval(() => {
    void refreshWebCookieSilently();
  }, COOKIE_AUTO_REFRESH_INTERVAL_MS);

  void home.fetchHome().then(() => {
    void populateSubjectCollectionMap();
  });

  nextTick(updateTabIndicators);
  window.addEventListener("resize", updateTabIndicators);

  // Check system clock against network time
  void checkTimeDrift().then((result) => {
    if (result && !result.ok) {
      console.log(`[timeCheck] clock mismatch detected — disabling broadcast tracking`);
      setTimeMismatch(true);
      appStore.showToast("机器时间有误！请检查你的机器时间，随后重启应用。", "error", 10_000);
    } else if (result?.ok) {
      console.log(`[timeCheck] clock OK`);
      setTimeMismatch(false);
    }
  });

  // GitHub 版本更新检查（仅在开关启用时）
  if (appStore.checkUpdateOnStartup.value) {
    void invoke<{ has_update: boolean; current_version: string; latest_version: string; release_url: string; release_notes: string }>("check_github_update")
      .then((result) => {
        if (result.has_update) {
          console.log(`[update] New version available: ${result.latest_version} (current: ${result.current_version})`);
          appStore.showToast(
            `发现新版本 v${result.latest_version}（当前 v${result.current_version}）。请前往 GitHub 下载更新。`,
            "info",
            8000
          );
        } else {
          console.log(`[update] Already up to date (${result.current_version})`);
        }
      })
      .catch((err) => {
        console.warn("[update] Update check failed:", err);
      });
  }

  // Start broadcast notification system if enabled
  if (localStorage.getItem("bangumi.broadcast.notifyEnabled") === "1") {
    broadcastNotify.startBroadcastNotify();
  }

  // Close notification window when main window is about to close.
  // Fire-and-forget — don't await, so the close isn't delayed.
  void getCurrentWindow().onCloseRequested(() => {
    broadcastNotify.stopBroadcastNotify();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", updateTabIndicators);
  if (cookieAutoRefreshTimer.value !== null) {
    window.clearInterval(cookieAutoRefreshTimer.value);
    cookieAutoRefreshTimer.value = null;
  }
  broadcastNotify.stopBroadcastNotify();
});

</script>

<template>
  <div class="window">
    <Transition name="toast-slide">
      <aside
        v-if="appStore.toast.visible"
        class="app-toast"
        :class="`app-toast--${appStore.toast.type}`"
        role="status"
        aria-live="polite"
      >
        <p>{{ appStore.toast.message }}</p>
      </aside>
    </Transition>

    <TitleBar />

    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Home</p>
          <h1>SimpBangumi</h1>
        </div>
        <div class="header-actions">
          <button
            class="header-action-button account-button"
            :class="{ 'is-active': activeHomeTab === 'my' }"
            type="button"
            :title="accountLabel"
            :aria-label="`打开${accountLabel}`"
            @click="activateHomeTab('my')"
          >
            <img class="account-avatar" :src="accountAvatar" alt="" @error="handleAccountAvatarError" />
          </button>
          <button
            class="header-action-button settings-button"
            :class="{ 'is-active': activeHomeTab === 'settings' }"
            type="button"
            title="设置"
            aria-label="打开设置"
            @click="activateHomeTab('settings')"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.11.38.32.73.6 1 .29.29.68.43 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" />
            </svg>
          </button>
        </div>
      </section>

      <section class="toolbar">
        <div ref="tabsRef" class="tabs" aria-label="首页视图">
          <button
            ref="tabCompleteRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'complete' }"
            type="button"
            @click="activateHomeTab('complete')"
          >
            完成
          </button>
          <button
            ref="tabCollectionsRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'collections' }"
            type="button"
            @click="activateHomeTab('collections')"
          >
            收藏
          </button>
          <button
            ref="tabScheduleRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'schedule' }"
            type="button"
            @click="activateHomeTab('schedule')"
          >
            排期
          </button>
          <button
            ref="tabSearchRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'search' }"
            type="button"
            @click="activateHomeTab('search')"
          >
            搜索
          </button>
          <button
            ref="tabMoreRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'more' }"
            type="button"
            @click="activateHomeTab('more')"
          >
            更多
          </button>
          <div
            v-if="isPrimaryHomeTab"
            class="tab-indicator"
            :style="tabIndicatorStyle"
          />
        </div>
        <button v-if="canRefresh" class="secondary-button" type="button" @click="handleRefresh">刷新</button>
      </section>

      <nav v-if="activeHomeTab === 'collections'" ref="collectionTabsRef" class="collection-sections" aria-label="收藏类型">
        <button ref="collectionSubjectRef" class="tab" :class="{ 'is-active': collectionSection === 'subject' }" type="button" @click="collectionSection = 'subject'">条目</button>
        <button ref="collectionCharacterRef" class="tab" :class="{ 'is-active': collectionSection === 'character' }" type="button" @click="collectionSection = 'character'">角色</button>
        <button ref="collectionPersonRef" class="tab" :class="{ 'is-active': collectionSection === 'person' }" type="button" @click="collectionSection = 'person'">人物</button>
        <button ref="collectionIndexRef" class="tab" :class="{ 'is-active': collectionSection === 'index' }" type="button" @click="collectionSection = 'index'">目录</button>
        <div class="tab-indicator" :style="collectionIndicatorStyle" />
      </nav>

      <div class="view-host view-host--complete" :class="{ 'view-host--hidden': activeHomeTab !== 'complete' }">
        <CompleteView ref="completeViewRef" @open-subject="handleSearchOpenSubject" />
      </div>

      <div class="view-host" :class="{ 'view-host--hidden': activeHomeTab !== 'collections' || collectionSection !== 'subject' }">
        <CollectionsView v-if="collectionsViewLoaded" ref="collectionsViewRef" @detail-closed="handleSubjectDetailClosed" />
      </div>
      <div v-if="activeHomeTab === 'schedule'" class="view-host view-host--schedule">
        <ScheduleView ref="scheduleViewRef" @open-subject="handleSearchOpenSubject" />
      </div>
      <div v-if="activeHomeTab === 'search'" class="view-host view-host--search">
        <SearchView
          @open-subject="handleSearchOpenSubject"
          @open-character="handleSearchOpenCharacter"
          @open-person="handleSearchOpenPerson"
        />
      </div>

      <div v-if="activeHomeTab === 'more'" class="view-host view-host--more">
        <section class="coming-soon">
          <p class="coming-soon__subtitle">敬请期待……</p>
        </section>
      </div>

      <div v-if="activeHomeTab === 'my'" class="view-host view-host--my">
        <MyView @authenticated="handleAuthenticated" @logged-out="handleLoggedOut" @open-cookie-settings="openCookieSettings" />
      </div>

      <div
        v-if="libraryViewLoaded"
        class="view-host view-host--library"
        :class="{ 'view-host--hidden': activeHomeTab !== 'collections' || collectionSection === 'subject' }"
      >
        <LibraryView
          ref="libraryViewRef"
          :active-tab="collectionSection === 'subject' ? 'character' : collectionSection"
          :show-tabs="false"
          @open-subject="handleLibraryOpenSubject"
          @open-character="handleLibraryOpenCharacter"
          @open-person="handleLibraryOpenPerson"
        />
      </div>

      <div v-if="activeHomeTab === 'settings'" class="view-host view-host--settings">
        <SettingsView ref="settingsViewRef" />
      </div>

      <Pager
        v-if="activeHomeTab === 'collections' && collectionSection === 'subject'"
        :page-index="home.currentPage.value"
        :prev-disabled="home.offset.value === 0 || home.loading.value"
        :next-disabled="home.isLastPage.value || home.loading.value"
        @prev="home.prevPage"
        @next="home.nextPage"
      />
    </main>

    <Live2dCompanion
      v-if="appStore.live2dEnabled.value"
      :visible="appStore.live2dEnabled.value"
      :model-url="appStore.live2dModels.value.find(m => m.name === appStore.live2dActiveModel.value)?.path ?? undefined"
      :pointer-through="appStore.detailDrawerOpen.value"
      @model-error="appStore.showToast($event, 'error')"
    />

    <LinkConfirmModal />
    <WorkersCommunicationModal v-if="appStore.workersCommunicating.value" />
    <ImageContextMenu
      @saved="appStore.showToast($event, 'success')"
      @error="appStore.showToast($event, 'error')"
    />
    <Transition name="link-confirm">
      <div
        v-if="appStore.cookieSetupPrompt.visible"
        class="overlay cookie-setup-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-setup-title"
        @click.self="appStore.hideCookieSetupPrompt"
      >
        <section class="modal cookie-setup-modal">
          <template v-if="appStore.cookieSetupPrompt.feature.includes('API 失败后的网页回退')">
            <h3 id="cookie-setup-title">API 不可用，需要网页回退</h3>
            <p>“{{ appStore.cookieSetupPrompt.feature }}”会优先使用 Bangumi API。由于 API 调用失败，应用现在需要改用网页回退；只有这种回退方式需要 Bangumi 网页登录 Cookie。OAuth 登录和条目收藏等核心功能不受影响。</p>
          </template>
          <template v-else>
            <h3 id="cookie-setup-title">此功能需要网页登录 Cookie</h3>
            <p>“{{ appStore.cookieSetupPrompt.feature }}”属于网页扩展功能，需要使用你的 Bangumi 网页登录状态。OAuth 登录和条目收藏等核心功能不受影响。</p>
          </template>
          <p>可前往“设置 → 网页登录与 Cookie”，在应用内登录后自动获取。</p>
          <div class="modal__actions">
            <button class="secondary-button" type="button" @click="appStore.hideCookieSetupPrompt">暂不使用</button>
            <button class="primary-button" type="button" @click="openCookieSettings">前往设置</button>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>
