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
  };
}
