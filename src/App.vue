<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from "vue";
import TitleBar from "./components/TitleBar.vue";
import Pager from "./components/Pager.vue";
import CompleteView from "./views/Complete.vue";
import CollectionsView from "./views/Collections.vue";
import ScheduleView from "./views/Schedule.vue";
import SearchView from "./views/Search.vue";
import SettingsView from "./views/Settings.vue";
import {
  useAppStore,
  type CollectionTypeFilter,
  type SubjectTypeFilter,
  type TitlePreference,
  type ThemeMode,
} from "./stores/app";
import { useSessionStore } from "./stores/session";
import { useBangumi } from "./composables/useBangumi";
import { useAuth } from "./composables/useAuth";
import { useHome } from "./composables/useHome";
import { usePagination } from "./composables/usePagination";
import { invoke } from "@tauri-apps/api/core";
import type { Live2dModelInfo } from "./stores/app";
import Live2dCompanion from "./components/Live2dCompanion.vue";
import { checkTimeDrift, setTimeMismatch } from "./utils/timeCheck";

type OnboardingReason = "first-launch" | "session-expired";

const ONBOARDING_SEEN_KEY = "bangumi.onboarding.seen";
const HAD_AUTHENTICATED_KEY = "bangumi.session.had-authenticated";
const THEME_KEY = "bangumi.theme";
const SUBJECT_FILTER_KEY = "bangumi.filter.subjectType";
const COLLECTION_FILTER_KEY = "bangumi.filter.collectionType";
const TITLE_PREFERENCE_KEY = "bangumi.title.preference";
const LIVE2D_ENABLED_KEY = "bangumi.live2d.enabled";
const LIVE2D_ACTIVE_MODEL_KEY = "bangumi.live2d.activeModel";
const LIVE2D_AUTO_SPEAK_KEY = "bangumi.live2d.autoSpeak";
const LIVE2D_AUTO_SPEAK_MIN_INTERVAL_KEY = "bangumi.live2d.autoSpeakMinInterval";
const LIVE2D_AUTO_SPEAK_MAX_INTERVAL_KEY = "bangumi.live2d.autoSpeakMaxInterval";
const NSFW_INTERACTION_ENABLED_KEY = "bangumi.live2d.nsfwInteractionEnabled";

const THEME_OPTIONS: ThemeMode[] = ["light", "dark"];
const SUBJECT_FILTER_OPTIONS: SubjectTypeFilter[] = ["all", 1, 2, 3, 4, 6];
const COLLECTION_FILTER_OPTIONS: CollectionTypeFilter[] = ["all", 1, 2, 3, 4, 5];
const TITLE_PREFERENCE_OPTIONS: TitlePreference[] = ["translated", "original"];
const COOKIE_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const appStore = useAppStore();
const sessionStore = useSessionStore();
const bangumi = useBangumi();
const auth = useAuth();
const pagination = usePagination({
  pageSize: 20,
  initialOffset: appStore.offset.value,
});
const home = useHome({ pagination });
const completeViewRef = ref<{
  refresh: () => Promise<void>;
} | null>(null);
const collectionsViewRef = ref<{
  openDetailBySubjectId: (subjectId: number) => Promise<void>;
} | null>(null);
const scheduleViewRef = ref<{
  refresh: () => Promise<void>;
} | null>(null);

const pageTitle = computed(() => "Subject Collections");
const activeHomeTab = ref<"complete" | "collections" | "schedule" | "search" | "settings">("complete");

// Tab indicator sliding animation
const tabsRef = ref<HTMLElement | null>(null);
const tabCompleteRef = ref<HTMLElement | null>(null);
const tabCollectionsRef = ref<HTMLElement | null>(null);
const tabScheduleRef = ref<HTMLElement | null>(null);
const tabSearchRef = ref<HTMLElement | null>(null);
const tabSettingsRef = ref<HTMLElement | null>(null);

const tabRefMap: Record<string, typeof tabCompleteRef> = {
  complete: tabCompleteRef,
  collections: tabCollectionsRef,
  schedule: tabScheduleRef,
  search: tabSearchRef,
  settings: tabSettingsRef,
};

const tabIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });

function updateTabIndicator() {
  const activeRef = tabRefMap[activeHomeTab.value];
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

watch(activeHomeTab, () => {
  nextTick(updateTabIndicator);
});

const patToken = ref("");
const sessionChecked = ref(false);
const oauth = reactive({
  authorizeUrl: "",
});
const cookieAutoRefreshTimer = ref<number | null>(null);
const cookieInvalidToastShown = ref(false);
const onboarding = reactive({
  visible: false,
  reason: "first-launch" as OnboardingReason,
  submitting: false,
  error: "",
});

const sessionText = computed(() => {
  if (!sessionStore.session.value) {
    return "读取登录状态中";
  }

  if (!sessionStore.authenticated.value) {
    return "未登录";
  }

  const user = sessionStore.session.value.user;
  return `已登录：${user?.nickname || user?.username || "Bangumi"}`;
});

const onboardingTitle = computed(() =>
  onboarding.reason === "first-launch" ? "欢迎使用 SimpBangumi" : "登录状态已失效",
);

const onboardingDescription = computed(() =>
  onboarding.reason === "first-launch"
    ? "推荐使用 OAuth 登录，也可以先跳过登录浏览基础界面。"
    : "检测到账号登录已失效，推荐使用 OAuth 重新登录，或暂时跳过。",
);

function hasSeenOnboarding() {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
}

function hadAuthenticatedBefore() {
  return localStorage.getItem(HAD_AUTHENTICATED_KEY) === "1";
}

function markOnboardingSeen() {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}

function markAuthenticatedOnce() {
  localStorage.setItem(HAD_AUTHENTICATED_KEY, "1");
}

function showOnboarding(reason: OnboardingReason) {
  onboarding.visible = true;
  onboarding.reason = reason;
  onboarding.error = "";
}

function evaluateOnboarding() {
  if (sessionStore.authenticated.value) {
    markAuthenticatedOnce();
    markOnboardingSeen();
    onboarding.visible = false;
    return;
  }

  if (!hasSeenOnboarding()) {
    showOnboarding("first-launch");
    return;
  }

  if (hadAuthenticatedBefore()) {
    showOnboarding("session-expired");
    return;
  }

  onboarding.visible = false;
}

async function handlePatLogin() {
  const token = patToken.value.trim();
  if (!token) {
    onboarding.error = "请输入 Personal Access Token。";
    return;
  }

  onboarding.submitting = true;
  onboarding.error = "";

  const loginResult = await bangumi.loginWithPersonalAccessToken(token);
  if (!loginResult.ok) {
    onboarding.error = loginResult.error;
    onboarding.submitting = false;
    return;
  }

  sessionStore.session.value = loginResult.data;
  patToken.value = "";
  markAuthenticatedOnce();
  markOnboardingSeen();
  onboarding.visible = false;
  await home.fetchHome();
  onboarding.submitting = false;
}

async function handleOAuthAutoLogin() {
  onboarding.submitting = true;
  onboarding.error = "";

  const startResult = await auth.startOAuthLogin(appStore.theme.value);

  if (!startResult.ok) {
    onboarding.error = startResult.error;
    onboarding.submitting = false;
    return;
  }

  oauth.authorizeUrl = startResult.data;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(startResult.data);
  } catch (error) {
    // Browser fallback: keep behavior working in non-Tauri preview/dev.
    const popup = window.open(startResult.data, "_blank", "noopener,noreferrer");
    if (!popup) {
      onboarding.error = "授权页未自动弹出，请点击下方链接手动打开。";
      onboarding.submitting = false;
      return;
    }
  }

  const loginResult = await auth.finishOAuthLogin();

  if (!loginResult.ok) {
    onboarding.error = loginResult.error;
    onboarding.submitting = false;
    return;
  }

  sessionStore.session.value = loginResult.data;
  markAuthenticatedOnce();
  markOnboardingSeen();
  onboarding.visible = false;
  await home.fetchHome();
  onboarding.submitting = false;
}

async function handleLogout() {
  const result = await bangumi.logout();
  if (!result.ok) {
    appStore.error.value = result.error;
    return;
  }

  sessionStore.session.value = result.data;
  sessionStore.oauthTokens.value = null;
  await home.fetchHome();
}

async function handleRefresh() {
  if (activeHomeTab.value === "complete") {
    await completeViewRef.value?.refresh();
    return;
  }

  if (activeHomeTab.value === "collections") {
    await home.refresh();
    return;
  }

  if (activeHomeTab.value === "schedule") {
    await scheduleViewRef.value?.refresh();
  }
}

async function activateHomeTab(tab: "complete" | "collections" | "schedule" | "search" | "settings") {
  activeHomeTab.value = tab;

  if (tab === "complete") {
    await nextTick();
    await completeViewRef.value?.refresh();
  }

  if (tab === "schedule") {
    await nextTick();
    await scheduleViewRef.value?.refresh();
  }
}

function continueWithoutLogin() {
  if (onboarding.reason === "first-launch") {
    markOnboardingSeen();
  }

  onboarding.visible = false;
}

async function handleSearchOpenSubject(subjectId: number) {
  await nextTick();
  await collectionsViewRef.value?.openDetailBySubjectId(subjectId);
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

watch(
  [sessionChecked, () => sessionStore.authenticated.value],
  async ([checked, authenticated]) => {
    if (!checked || !authenticated || activeHomeTab.value !== "complete") {
      return;
    }

    await nextTick();
    await completeViewRef.value?.refresh();
  },
);

onMounted(() => {
  restorePersistedPreferences();
  setupPreferencePersistence();

  // 加载已导入的 Live2D 模型列表
  void (async () => {
    try {
      const models = await invoke<Live2dModelInfo[]>("list_live2d_models");
      appStore.live2dModels.value = models;
    } catch { /* ignore */ }
  })();

  void refreshWebCookieSilently();
  cookieAutoRefreshTimer.value = window.setInterval(() => {
    void refreshWebCookieSilently();
  }, COOKIE_AUTO_REFRESH_INTERVAL_MS);

  void home.fetchHome().then(async () => {
    sessionChecked.value = true;
    if (sessionStore.authenticated.value && activeHomeTab.value === "complete") {
      await nextTick();
      await completeViewRef.value?.refresh();
    }
    evaluateOnboarding();
  });

  nextTick(updateTabIndicator);
  window.addEventListener("resize", updateTabIndicator);

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
});

onUnmounted(() => {
  window.removeEventListener("resize", updateTabIndicator);
  if (cookieAutoRefreshTimer.value !== null) {
    window.clearInterval(cookieAutoRefreshTimer.value);
    cookieAutoRefreshTimer.value = null;
  }
});

watch(
  () => sessionStore.authenticated.value,
  () => {
    if (!sessionChecked.value) {
      return;
    }

    evaluateOnboarding();
  },
);
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
        <div class="session-actions">
          <div class="session">{{ sessionText }}</div>
          <button
            v-if="sessionStore.authenticated.value"
            class="secondary-button"
            type="button"
            @click="handleLogout"
          >
            退出登录
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
            ref="tabSettingsRef"
            class="tab"
            :class="{ 'is-active': activeHomeTab === 'settings' }"
            type="button"
            @click="activateHomeTab('settings')"
          >
            设置
          </button>
          <div
            class="tab-indicator"
            :style="tabIndicatorStyle"
          />
        </div>
        <button class="secondary-button" type="button" @click="handleRefresh">刷新</button>
      </section>

      <section v-if="onboarding.visible" class="onboarding">
        <div class="onboarding__panel">
          <p class="eyebrow">Getting Started</p>
          <h2>{{ onboardingTitle }}</h2>
          <p class="onboarding__description">{{ onboardingDescription }}</p>

          <h3 class="onboarding__section-title">OAuth 登录（推荐）</h3>

          <div class="onboarding__grid">
            <p class="onboarding__description">
              点击下方按钮后，应用会自动打开授权页面。
            </p>
          </div>

          <div class="onboarding__actions">
            <button
              class="primary-button"
              type="button"
              :disabled="onboarding.submitting"
              @click="handleOAuthAutoLogin"
            >
              {{ onboarding.submitting ? "等待授权完成..." : "一键 OAuth 登录" }}
            </button>
          </div>

          <a
            v-if="oauth.authorizeUrl"
            class="onboarding__link"
            :href="oauth.authorizeUrl"
            target="_blank"
            rel="noreferrer"
          >
            授权页未弹出？点击这里打开
          </a>

          <details class="onboarding__pat">
            <summary>使用 PAT 登录（备选）</summary>
            <label class="onboarding__label" for="pat-token">Personal Access Token</label>
            <input
              id="pat-token"
              v-model="patToken"
              class="onboarding__input"
              type="password"
              autocomplete="off"
              placeholder="粘贴你的 Bangumi PAT"
              :disabled="onboarding.submitting"
              @keydown.enter="handlePatLogin"
            />
            <button class="secondary-button onboarding__pat-button" type="button" :disabled="onboarding.submitting" @click="handlePatLogin">
              使用 PAT 登录
            </button>
          </details>

          <p v-if="onboarding.error" class="onboarding__error">{{ onboarding.error }}</p>

          <div class="onboarding__actions">
            <button class="secondary-button" type="button" :disabled="onboarding.submitting" @click="continueWithoutLogin">
              暂不登录
            </button>
          </div>
        </div>
      </section>

      <div class="view-host view-host--complete" :class="{ 'view-host--hidden': activeHomeTab !== 'complete' }">
        <CompleteView ref="completeViewRef" @open-subject="handleSearchOpenSubject" />
      </div>

      <div class="view-host" :class="{ 'view-host--hidden': activeHomeTab !== 'collections' }">
        <CollectionsView ref="collectionsViewRef" />
      </div>
      <div v-if="activeHomeTab === 'schedule'" class="view-host view-host--schedule">
        <ScheduleView ref="scheduleViewRef" @open-subject="handleSearchOpenSubject" />
      </div>
      <div v-if="activeHomeTab === 'search'" class="view-host view-host--search">
        <SearchView @open-subject="handleSearchOpenSubject" />
      </div>

      <div v-if="activeHomeTab === 'settings'" class="view-host view-host--settings">
        <SettingsView />
      </div>

      <Pager
        v-if="activeHomeTab === 'collections'"
        :page-index="home.currentPage.value"
        :prev-disabled="home.offset.value === 0 || home.loading.value"
        :next-disabled="home.isLastPage.value || home.loading.value"
        @prev="home.prevPage"
        @next="home.nextPage"
      />
    </main>

    <Live2dCompanion
      :visible="appStore.live2dEnabled.value"
      :model-url="appStore.live2dModels.value.find(m => m.name === appStore.live2dActiveModel.value)?.path ?? undefined"
      @model-error="appStore.showToast($event, 'error')"
    />
  </div>
</template>
