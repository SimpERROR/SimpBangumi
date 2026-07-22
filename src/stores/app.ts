import { reactive, ref } from "vue";

export type ThemeMode = "light" | "dark";
export type SubjectTypeFilter = 1 | 2 | 3 | 4 | 6 | "all";
export type CollectionTypeFilter = 1 | 2 | 3 | 4 | 5 | "all";
export type TitlePreference = "translated" | "original";

const theme = ref<ThemeMode>("light");
const loading = ref(false);
const error = ref("");
const offset = ref(0);
const total = ref<number | undefined>(undefined);
const subjectTypeFilter = ref<SubjectTypeFilter>("all");
const collectionTypeFilter = ref<CollectionTypeFilter>("all");
const titlePreference = ref<TitlePreference>("translated");
const toast = reactive({
  visible: false,
  message: "",
  type: "error" as "error" | "success" | "info",
});
const windowState = reactive({
  maximized: false,
  fullscreen: false,
});

// Live2D 看板娘
const live2dEnabled = ref(false);
const live2dResetPositionCounter = ref(0);
const live2dRefreshDialogCounter = ref(0);

// 详情页「回到顶部」按钮是否可见 → 看板娘需左移避让
const detailBackToTopVisible = ref(false);

// NSFW 互动
const nsfwInteractionEnabled = ref(true);
const nsfwWarningMessages = ref<string[]>([]);
const nsfwBrowsingMessages = ref<string[]>([]);
const nsfwExitMessages = ref<string[]>([]);
// NSFW 状态（由 Collections.vue 同步）
const nsfwWarningVisible = ref(false);
const currentDetailNsfw = ref(false);
// 用于触发「退出 NSFW」对话的计数器
const nsfwExitTriggerCounter = ref(0);
// 收藏状态保存成功 → 看板娘说话+表情
const collectionSaveSuccessCounter = ref(0);

// 更新选项
const checkUpdateOnStartup = ref(true);

// 收藏条目特殊标记
const MARK_BROADCAST_KEY = "bangumi.display.markBroadcastFollowed";
const MARK_BROADCAST_COMPLETE_KEY = "bangumi.display.markBroadcastFollowedInComplete";
const MARK_BROADCAST_COLLECTIONS_KEY = "bangumi.display.markBroadcastFollowedOnlyWhenFiltered";
const MARK_WATCHING_KEY = "bangumi.display.markWatching";
const MARK_WATCHING_COMPLETE_KEY = "bangumi.display.markWatchingInComplete";
const MARK_WATCHING_COLLECTIONS_KEY = "bangumi.display.markWatchingOnlyWhenFiltered";
const MARK_WISH_KEY = "bangumi.display.markWish";
const MARK_WISH_COMPLETE_KEY = "bangumi.display.markWishInComplete";
const MARK_WISH_COLLECTIONS_KEY = "bangumi.display.markWishInCollections";
const MARK_COLLECTED_KEY = "bangumi.display.markCollected";
const MARK_COLLECTED_COMPLETE_KEY = "bangumi.display.markCollectedInComplete";
const MARK_COLLECTED_COLLECTIONS_KEY = "bangumi.display.markCollectedInCollections";
const MARK_ONHOLD_KEY = "bangumi.display.markOnhold";
const MARK_ONHOLD_COMPLETE_KEY = "bangumi.display.markOnholdInComplete";
const MARK_ONHOLD_COLLECTIONS_KEY = "bangumi.display.markOnholdInCollections";
const MARK_DROPPED_KEY = "bangumi.display.markDropped";
const MARK_DROPPED_COMPLETE_KEY = "bangumi.display.markDroppedInComplete";
const MARK_DROPPED_COLLECTIONS_KEY = "bangumi.display.markDroppedInCollections";

function loadBool(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch { return fallback; }
}

function saveBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
}

const MARKER_ICON_ONLY_KEY = "bangumi.display.markerIconOnly";
const markerIconOnly = ref(loadBool(MARKER_ICON_ONLY_KEY, false));
function setMarkerIconOnly(v: boolean) { markerIconOnly.value = v; saveBool(MARKER_ICON_ONLY_KEY, v); }

interface MarkerGroup {
  parent: ReturnType<typeof ref<boolean>>;
  inComplete: ReturnType<typeof ref<boolean>>;
  inCollections: ReturnType<typeof ref<boolean>>;
  setParent: (v: boolean) => void;
  setInComplete: (v: boolean) => void;
  setInCollections: (v: boolean) => void;
}

function markerGroup(parentKey: string, completeKey: string, collectionsKey: string, defaultParent: boolean): MarkerGroup {
  const parent = ref(loadBool(parentKey, defaultParent));
  const inComplete = ref(loadBool(completeKey, false));
  const inCollections = ref(loadBool(collectionsKey, false));
  return {
    parent,
    inComplete,
    inCollections,
    setParent: (v: boolean) => { parent.value = v; saveBool(parentKey, v); },
    setInComplete: (v: boolean) => { inComplete.value = v; saveBool(completeKey, v); },
    setInCollections: (v: boolean) => { inCollections.value = v; saveBool(collectionsKey, v); },
  };
}

const broadcastMarker = markerGroup(MARK_BROADCAST_KEY, MARK_BROADCAST_COMPLETE_KEY, MARK_BROADCAST_COLLECTIONS_KEY, true);
const watchingMarker = markerGroup(MARK_WATCHING_KEY, MARK_WATCHING_COMPLETE_KEY, MARK_WATCHING_COLLECTIONS_KEY, true);
const wishMarker = markerGroup(MARK_WISH_KEY, MARK_WISH_COMPLETE_KEY, MARK_WISH_COLLECTIONS_KEY, true);
const collectedMarker = markerGroup(MARK_COLLECTED_KEY, MARK_COLLECTED_COMPLETE_KEY, MARK_COLLECTED_COLLECTIONS_KEY, true);
const onholdMarker = markerGroup(MARK_ONHOLD_KEY, MARK_ONHOLD_COMPLETE_KEY, MARK_ONHOLD_COLLECTIONS_KEY, true);
const droppedMarker = markerGroup(MARK_DROPPED_KEY, MARK_DROPPED_COMPLETE_KEY, MARK_DROPPED_COLLECTIONS_KEY, true);

// OAuth Workers 通信全屏弹窗
const workersCommunicating = ref(false);

export interface Live2dModelInfo {
  name: string;
  path: string;
}

const live2dModels = ref<Live2dModelInfo[]>([]);
const live2dActiveModel = ref("");

// Live2D 对话框
const live2dDialogMessages = ref<string[]>([]);
const live2dAutoSpeakEnabled = ref(false);
const live2dAutoSpeakMinInterval = ref(10);  // 最小间隔（秒）
const live2dAutoSpeakMaxInterval = ref(60);  // 最大间隔（秒）

let toastTimer: number | null = null;

function showToast(message: string, type: "error" | "success" | "info" = "info", durationMs = 3600) {
  toast.message = message;
  toast.type = type;
  toast.visible = true;

  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }

  toastTimer = window.setTimeout(() => {
    toast.visible = false;
    toastTimer = null;
  }, durationMs);
}

function hideToast() {
  toast.visible = false;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
}

export function useAppStore() {
  return {
    theme,
    loading,
    error,
    offset,
    total,
    subjectTypeFilter,
    collectionTypeFilter,
    titlePreference,
    toast,
    showToast,
    hideToast,
    window: windowState,
    live2dEnabled,
    live2dResetPositionCounter,
    live2dRefreshDialogCounter,
    detailBackToTopVisible,
    nsfwInteractionEnabled,
    nsfwWarningMessages,
    nsfwBrowsingMessages,
    nsfwExitMessages,
    nsfwWarningVisible,
    currentDetailNsfw,
    nsfwExitTriggerCounter,
    collectionSaveSuccessCounter,
    live2dModels,
    live2dActiveModel,
    live2dDialogMessages,
    live2dAutoSpeakEnabled,
    live2dAutoSpeakMinInterval,
    live2dAutoSpeakMaxInterval,
    checkUpdateOnStartup,
    workersCommunicating,
    // marker groups
    broadcastMarker,
    watchingMarker,
    wishMarker,
    collectedMarker,
    onholdMarker,
    droppedMarker,
    markerIconOnly,
    setMarkerIconOnly,
  };
}
