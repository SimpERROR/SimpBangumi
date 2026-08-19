<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { useBangumi } from "../composables/useBangumi";
import BbcodeSummary from "../components/BbcodeSummary.vue";
import BroadcastProgress from "../components/BroadcastProgress.vue";
import ScoreDebugPanel from "../components/ScoreDebugPanel.vue";
import { formatReadableDateTime } from "../utils/datetime";
import { autoLinkPlainText } from "../utils/autoLink";
import { matchAnimeToTenrai, getCachedMatch, searchTenraiForMatch, fetchMalAnimeFull, setManualMatch, isSuppressed, suppressBgmId, unsuppressBgmId, shouldConfirmMatch, confirmBgmId, type AnimeMatchInfo } from "../utils/animeMatch";
import { TenraiApi } from "../api/Tenrai";
import { isTimeMismatch } from "../utils/timeCheck";
import { analyzeRatingDistribution } from "../utils/ratingAnomaly";
import { analyzeCollectionDistribution, type CollectionBroadcastPhase } from "../utils/collectionDistributionAnalysis";
import { isFollowed, followSubject, unfollowSubject, useBroadcastNotify } from "../composables/useBroadcastNotify";
import {
  ratingComparisonConfig,
  fetchRatingComparison,
  computeRatingWeights,
  type PlatformRatingEntry,
  type ExternalPlatformId,
} from "../utils/ratingComparison";
import RatingComparisonModal from "../components/RatingComparisonModal.vue";
import bangumiMark from "../assets/bangumi.png";
import type {
  BangumiUser,
  CharacterDetail,
  CharacterPerson,
  Episode,
  MonoType,
  PersonDetail,
  RelatedCharacter,
  RelatedPerson,
  SubjectCommentInterestType,
  SubjectCollection,
  SubjectDetail,
  UserSubjectCollection,
} from "../api/bangumi";

const emit = defineEmits<{
  detailClosed: [];
}>();
const appStore = useAppStore();
const sessionStore = useSessionStore();
const dataStore = useDataStore();
const bangumi = useBangumi();
const currentUsername = computed(() => sessionStore.session.value?.user?.username ?? "");
const currentUserNickname = computed(() => sessionStore.session.value?.user?.nickname ?? "");

const collections = computed(() => dataStore.collections.value);

type GroupBlock = {
  key: string;
  label: string;
  items: SubjectCollection[];
};

type SubjectGroup = {
  key: string;
  label: string;
  blocks: GroupBlock[];
  total: number;
};

const SUBJECT_TYPE_ORDER = [1, 2, 3, 4, 6] as const;
const COLLECTION_TYPE_ORDER = [1, 3, 2, 4, 5] as const;

const SUBJECT_TYPE_LABEL: Record<number, string> = {
  1: "书籍",
  2: "动画",
  3: "音乐",
  4: "游戏",
  6: "三次元",
};

const COLLECTION_TYPE_LABEL: Record<number, string> = {
  1: "想看",
  2: "看过",
  3: "在看",
  4: "搁置",
  5: "抛弃",
};

const SUBJECT_TYPE_BOOK = 1;
const SUBJECT_TYPE_ANIME = 2;
const SUBJECT_TYPE_REAL = 6;

const EPISODE_TYPE_LABEL: Record<number, string> = {
  0: "本篇",
  1: "SP",
  2: "OP",
  3: "ED",
};

const EPISODE_TYPE_SHORT: Record<number, string> = {
  0: "EP",
  1: "SP",
  2: "OP",
  3: "ED",
};

const selectedSubjectType = computed({
  get: () => appStore.subjectTypeFilter.value,
  set: (value) => {
    appStore.subjectTypeFilter.value = value;
  },
});

const selectedCollectionType = computed({
  get: () => appStore.collectionTypeFilter.value,
  set: (value) => {
    appStore.collectionTypeFilter.value = value;
  },
});

const subjectTypeTabs = computed(() => {
  return [
    { key: "all" as const, label: "全部" },
    ...SUBJECT_TYPE_ORDER.map((type) => ({
      key: type,
      label: SUBJECT_TYPE_LABEL[type],
    })),
  ];
});

const collectionTypeTabs = computed(() => {
  return [
    { key: "all" as const, label: "全部" },
    ...COLLECTION_TYPE_ORDER.map((type) => ({
      key: type,
      label: COLLECTION_TYPE_LABEL[type],
    })),
  ];
});

const hasActiveFilter = computed(() => {
  return selectedSubjectType.value !== "all" || selectedCollectionType.value !== "all";
});

const groupedCollections = computed<SubjectGroup[]>(() => {
  const bySubject = new Map<number, SubjectCollection[]>();

  for (const item of collections.value) {
    const subjectType = item.subject?.type;
    const key = typeof subjectType === "number" ? subjectType : 0;
    const list = bySubject.get(key) ?? [];
    list.push(item);
    bySubject.set(key, list);
  }

  const subjectTypes = [
    ...SUBJECT_TYPE_ORDER,
    ...[...bySubject.keys()].filter((type) => !SUBJECT_TYPE_ORDER.includes(type as (typeof SUBJECT_TYPE_ORDER)[number])),
  ];

  return subjectTypes
    .filter((type) => (bySubject.get(type)?.length ?? 0) > 0)
    .map((subjectType) => {
      const subjectItems = bySubject.get(subjectType) ?? [];
      const byCollection = new Map<number, SubjectCollection[]>();

      for (const item of subjectItems) {
        const collectionType = typeof item.type === "number" ? item.type : 0;
        const list = byCollection.get(collectionType) ?? [];
        list.push(item);
        byCollection.set(collectionType, list);
      }

      const collectionTypes = [
        ...COLLECTION_TYPE_ORDER,
        ...[...byCollection.keys()].filter((type) => !COLLECTION_TYPE_ORDER.includes(type as (typeof COLLECTION_TYPE_ORDER)[number])),
      ];

      const blocks = collectionTypes
        .filter((type) => (byCollection.get(type)?.length ?? 0) > 0)
        .map((collectionType) => ({
          key: `collection-${collectionType}`,
          label: COLLECTION_TYPE_LABEL[collectionType] ?? `其他 (${collectionType})`,
          items: byCollection.get(collectionType) ?? [],
        }));

      return {
        key: `subject-${subjectType}`,
        label: SUBJECT_TYPE_LABEL[subjectType] ?? `其他 (${subjectType})`,
        blocks,
        total: subjectItems.length,
      };
    });
});

const NSFW_SUPPRESS_FOREVER_KEY = "bangumi.nsfw.warning.skip.forever";
const NSFW_SUPPRESS_UNTIL_KEY = "bangumi.nsfw.warning.skip.until";
const RATING_DIFF_EMPHASIS_KEY = "bangumi.detail.rating.diff.emphasis";
const COLLECTION_DIFF_EMPHASIS_KEY = "bangumi.detail.collection.diff.emphasis";

const detailOpen = ref(false);
const detailLoading = ref(false);
const detailLoadingProgress = ref(0);
const detailLoadingMessage = ref("正在准备详情...");
const detailError = ref("");
const detail = ref<SubjectDetail | null>(null);
const preDetailLoading = ref(false);
const detailTab = ref<"info" | "review">("info");
const detailPage = ref<"subject" | "person" | "character">("subject");
const monoDetailTab = ref<"info" | "review">("info");

// ── Detail tab indicator sliding animation ──
const detailTabsRef = ref<HTMLElement | null>(null);
const detailTabInfoRef = ref<HTMLElement | null>(null);
const detailTabReviewRef = ref<HTMLElement | null>(null);
const detailTabMyRef = ref<HTMLElement | null>(null);

const monoDetailTabsRef = ref<HTMLElement | null>(null);
const monoDetailTabInfoRef = ref<HTMLElement | null>(null);
const monoDetailTabReviewRef = ref<HTMLElement | null>(null);

const detailTabIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });
const monoDetailTabIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });

const detailTabRefMap: Record<string, typeof detailTabInfoRef> = {
  info: detailTabInfoRef,
  review: detailTabReviewRef,
  my: detailTabMyRef,
};

const monoDetailTabRefMap: Record<string, typeof monoDetailTabInfoRef> = {
  info: monoDetailTabInfoRef,
  review: monoDetailTabReviewRef,
};

function updateDetailTabIndicator() {
  const activeRef = detailTabRefMap[detailTab.value];
  const tabEl = activeRef?.value;
  const container = detailTabsRef.value;
  if (!tabEl || !container) return;
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();
  detailTabIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

function updateMonoDetailTabIndicator() {
  const activeRef = monoDetailTabRefMap[monoDetailTab.value];
  const tabEl = activeRef?.value;
  const container = monoDetailTabsRef.value;
  if (!tabEl || !container) return;
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();
  monoDetailTabIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

watch(detailTab, () => { nextTick(updateDetailTabIndicator); });
watch(monoDetailTab, () => { nextTick(updateMonoDetailTabIndicator); });
watch(detailPage, () => { nextTick(updateMonoDetailTabIndicator); });
watch(detailLoading, (loading) => {
  if (!loading && detail.value) {
    nextTick(() => {
      updateDetailTabIndicator();
      updateMonoDetailTabIndicator();
    });
  }
});
const imagePreviewUrl = ref("");
const imagePreviewTitle = ref("");
const detailContentRef = ref<HTMLElement | null>(null);
const subjectCommentBoxRef = ref<HTMLElement | null>(null);
const characterCommentBoxRef = ref<HTMLElement | null>(null);
const showDetailBackToTop = ref(false);
const relatedCharacters = ref<RelatedCharacter[]>([]);
const relatedCharactersError = ref("");
const relatedPersons = ref<RelatedPerson[]>([]);
const relatedPersonsError = ref("");
const commentLoading = ref(false);
const commentError = ref("");
const commentPage = ref(1);
const commentTotalPages = ref(1);
const commentHasNextPage = ref(false);
const commentInterestTab = ref<"all" | SubjectCommentInterestType>("all");
const comments = ref<Array<{
  id: string;
  userName: string;
  userLink: string;
  avatar: string;
  interestText: string;
  timeText: string;
  contentText: string;
}>>([]);
const personDetailLoading = ref(false);
const personDetailError = ref("");
const personDetail = ref<PersonDetail | null>(null);
const personCollected = ref<boolean | null>(null);
const personCollectionSaving = ref(false);
const characterDetailLoading = ref(false);
const characterDetailError = ref("");
const characterDetail = ref<CharacterDetail | null>(null);
const characterCollected = ref<boolean | null>(null);
const characterCollectionSaving = ref(false);
const characterRelatedPersons = ref<CharacterPerson[]>([]);
const characterRelatedPersonsLoading = ref(false);
const characterRelatedPersonsVisible = ref(6);
const monoOpenedFromSubject = ref(false);

watch(personDetailLoading, (loading) => {
  if (!loading && personDetail.value) {
    nextTick(updateMonoDetailTabIndicator);
  }
});
watch(characterDetailLoading, (loading) => {
  if (!loading && characterDetail.value) {
    nextTick(updateMonoDetailTabIndicator);
  }
});

const monoCommentLoading = ref(false);
const monoCommentError = ref("");
const monoCommentPage = ref(1);
const monoCommentTotalPages = ref(1);
const monoCommentSortOrder = ref<"asc" | "desc">("asc");
const MONO_COMMENT_PAGE_SIZE = 20;
const monoAllComments = ref<Array<{
  id: string;
  userName: string;
  userLink: string;
  avatar: string;
  interestText: string;
  timeText: string;
  contentText: string;
}>>([]);
const monoComments = ref<Array<{
  id: string;
  userName: string;
  userLink: string;
  avatar: string;
  interestText: string;
  timeText: string;
  contentText: string;
}>>([]);
const currentUserProfile = ref<BangumiUser | null>(null);

const imagePreviewVisible = computed(() => imagePreviewUrl.value.length > 0);

const collectionLoading = ref(false);
const collectionSaving = ref(false);
const collectionError = ref("");
const collectionSavedMessage = ref("");
const collectionUpdatedAt = ref("");
const savedCollectionType = ref(0);
interface SubjectIndexOption { id: number; title: string; description: string; total: number; }
const indexPickerOpen = ref(false);
const indexPickerLoading = ref(false);
const indexPickerError = ref("");
const indexPickerItems = ref<SubjectIndexOption[]>([]);
const indexPickerSavingId = ref<number | null>(null);
const episodeLoading = ref(false);
const episodeError = ref("");
const episodeSavingId = ref<number | null>(null);
const episodes = ref<Episode[]>([]);
const episodeTypeById = ref<Record<number, number>>({});
const episodePopoverPlacement = ref<
  Record<number, { horizontal: "left" | "center" | "right"; vertical: "up" | "down" }>
>({});

// ── Tenrai / broadcast match ──
const TenraiMatch = ref<AnimeMatchInfo | null>(null);
const TenraiMatchLoading = ref(false);
const TenraiMatchRefreshing = ref(false);
const TenraiMatchError = ref("");
const detailMoreMenuOpen = ref(false);
const detailMoreMenuRef = ref<HTMLElement | null>(null);

const DEBUG_SCORE_KEY = "bangumi.Tenrai.debugScore";
const TenraiDebugScore = ref(localStorage.getItem(DEBUG_SCORE_KEY) === "1");

// ── 标记系统 ──
function markerActive(m: typeof appStore.broadcastMarker) { return m.parent.value && (m.inCollections?.value ?? true); }
function markerColored(m: typeof appStore.broadcastMarker) { return markerActive(m) && !appStore.markerIconOnly.value; }

const broadcastMarkerActive = computed(() => markerActive(appStore.broadcastMarker));
const broadcastMarkerColored = computed(() => markerColored(appStore.broadcastMarker));
const wishMarkerActive = computed(() => markerActive(appStore.wishMarker));
const wishMarkerColored = computed(() => markerColored(appStore.wishMarker));
const watchingMarkerActive = computed(() => markerActive(appStore.watchingMarker));
const watchingMarkerColored = computed(() => markerColored(appStore.watchingMarker));
const collectedMarkerActive = computed(() => markerActive(appStore.collectedMarker));
const collectedMarkerColored = computed(() => markerColored(appStore.collectedMarker));
const onholdMarkerActive = computed(() => markerActive(appStore.onholdMarker));
const onholdMarkerColored = computed(() => markerColored(appStore.onholdMarker));
const droppedMarkerActive = computed(() => markerActive(appStore.droppedMarker));
const droppedMarkerColored = computed(() => markerColored(appStore.droppedMarker));

// "View matched Tenrai entry" dialog
const TenraiViewMatchDialog = reactive({
  visible: false,
});

// "Confirm auto-match" dialog
const TenraiConfirmDialog = reactive({
  visible: false,
});

function onDetailMoreMenuClickOutside(e: MouseEvent) {
  if (detailMoreMenuRef.value && !detailMoreMenuRef.value.contains(e.target as Node)) {
    detailMoreMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", onDetailMoreMenuClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onDetailMoreMenuClickOutside);
});

// ── Manual match dialog ──
const TenraiManualDialog = reactive({
  visible: false,
  query: "",
  searching: false,
  error: "",
  results: [] as import("../api/Tenrai").TenraiAnimeSearchItem[],
  selectedMalId: null as number | null,
  confirming: false,
  malIdInput: "",
  malIdLoading: false,
});

function openTenraiManualDialog() {
  detailMoreMenuOpen.value = false;
  TenraiManualDialog.visible = true;
  TenraiManualDialog.query = detail.value?.name ?? "";
  TenraiManualDialog.results = [];
  TenraiManualDialog.error = "";
  TenraiManualDialog.selectedMalId = null;
  TenraiManualDialog.confirming = false;
  TenraiManualDialog.malIdInput = "";
  // Auto-search with current anime name
  if (TenraiManualDialog.query) {
    searchTenraiManual();
  }
}

function closeTenraiManualDialog() {
  TenraiManualDialog.visible = false;
}

async function searchTenraiManual() {
  const q = TenraiManualDialog.query.trim();
  if (!q) {
    TenraiManualDialog.error = "请输入搜索关键词。";
    return;
  }
  TenraiManualDialog.searching = true;
  TenraiManualDialog.error = "";
  TenraiManualDialog.results = [];
  TenraiManualDialog.selectedMalId = null;

  try {
    const results = await searchTenraiForMatch(q, 12);
    TenraiManualDialog.results = results;
    if (results.length === 0) {
      TenraiManualDialog.error = "未找到匹配的 MAL 词条，请尝试其他关键词。";
    }
  } catch (e) {
    TenraiManualDialog.error = `搜索失败：${e instanceof Error ? e.message : String(e)}`;
  }
  TenraiManualDialog.searching = false;
}

function selectTenraiCandidate(malId: number) {
  TenraiManualDialog.selectedMalId = malId;
}

async function lookupByMalId() {
  const raw = TenraiManualDialog.malIdInput.trim();
  if (!raw) return;
  const malId = Number(raw);
  if (!Number.isFinite(malId) || malId <= 0 || !Number.isInteger(malId)) {
    TenraiManualDialog.error = "请输入有效的 MAL 编号（正整数）。";
    return;
  }

  TenraiManualDialog.malIdLoading = true;
  TenraiManualDialog.error = "";
  TenraiManualDialog.results = [];

  try {
    const response = await TenraiApi.getAnimeFull(malId);
    const fullData = response.data;
    if (!fullData) {
      TenraiManualDialog.error = `未找到 MAL #${malId} 的条目数据。`;
      TenraiManualDialog.malIdLoading = false;
      return;
    }
    // Show as single result so user can confirm
    TenraiManualDialog.results = [{
      mal_id: fullData.mal_id,
      url: fullData.url,
      title: fullData.title,
      title_english: fullData.title_english,
      title_japanese: fullData.title_japanese,
      type: fullData.type,
      episodes: fullData.episodes,
      status: fullData.status,
      aired: fullData.aired,
      duration: fullData.duration,
      score: fullData.score,
      synopsis: fullData.synopsis,
      images: fullData.images,
    }];
    TenraiManualDialog.selectedMalId = malId;
  } catch (e) {
    TenraiManualDialog.error = `查询失败：${e instanceof Error ? e.message : String(e)}`;
  }
  TenraiManualDialog.malIdLoading = false;
}

async function confirmTenraiManualMatch() {
  const malId = TenraiManualDialog.selectedMalId;
  const bgmId = detail.value?.id;
  if (!malId || !bgmId) return;

  TenraiManualDialog.confirming = true;
  TenraiManualDialog.error = "";

  try {
    const response = await TenraiApi.getAnimeFull(malId);
    const fullData = response.data;
    if (!fullData) {
      TenraiManualDialog.error = "获取 Tenrai 完整数据失败。";
      TenraiManualDialog.confirming = false;
      return;
    }
    const detailSource = "tenrai";
    setManualMatch(bgmId, {
      bgmId,
      malId,
      data: fullData,
      cachedAt: Date.now(),
      detailFetchedAt: Date.now(),
      detailSource,
      candidates: [],
    });
    TenraiMatch.value = { bgmId, malId, data: fullData, cachedAt: Date.now(), detailFetchedAt: Date.now(), detailSource, candidates: [] };
    TenraiMatchError.value = "";
    closeTenraiManualDialog();
  } catch (e) {
    TenraiManualDialog.error = `保存匹配失败：${e instanceof Error ? e.message : String(e)}`;
  }
  TenraiManualDialog.confirming = false;
}

const form = reactive({
  type: 0,
  rate: 0,
  ep_status: 0,
  vol_status: 0,
  private: false,
  comment: "",
  tagsInput: "",
});

const nsfwDialog = reactive({
  visible: false,
  pendingSubjectId: null as number | null,
});
const pendingNsfwDetail = ref<SubjectDetail | null>(null);
const selectedCollectionSnapshot = ref<SubjectCollection | null>(null);

const ratingOrder = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
let commentRequestToken = 0;
let monoCommentRequestToken = 0;

const commentTabs: Array<{ key: "all" | SubjectCommentInterestType; label: string }> = [
  { key: "all", label: "全部" },
  { key: "wishes", label: "想看" },
  { key: "doings", label: "在看" },
  { key: "collections", label: "看过" },
  { key: "dropped", label: "抛弃" },
  { key: "on_hold", label: "搁置" },
];

const canPrevCommentPage = computed(() => commentPage.value > 1);
const canNextCommentPage = computed(() => {
  if (commentTotalPages.value > 1) {
    return commentPage.value < commentTotalPages.value;
  }

  return commentHasNextPage.value;
});

const userShortComment = computed(() => form.comment.trim());
const formattedCollectionUpdatedAt = computed(() =>
  formatReadableDateTime(collectionUpdatedAt.value, { fallback: "" }),
);
const userProfileDisplayName = computed(() => {
  const user = currentUserProfile.value;
  return user?.nickname || user?.username || currentUserNickname.value || currentUsername.value || "当前用户";
});

const userProfileLink = computed(() => {
  const user = currentUserProfile.value;
  const username = (user?.username || currentUsername.value).trim();
  return username ? `https://bangumi.tv/user/${username}` : "";
});

const userProfileAvatar = computed(() => {
  const user = currentUserProfile.value;
  return parseBangumiUserAvatar(user?.avatar);
});

function readPersistedBool(key: string, fallback = false) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return fallback;
  }
}

function writePersistedBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore persistence failures in restricted environments
  }
}

const ratingDiffEmphasis = ref(readPersistedBool(RATING_DIFF_EMPHASIS_KEY));
const collectionDiffEmphasis = ref(readPersistedBool(COLLECTION_DIFF_EMPHASIS_KEY));

watch(ratingDiffEmphasis, (value) => {
  writePersistedBool(RATING_DIFF_EMPHASIS_KEY, value);
});

watch(collectionDiffEmphasis, (value) => {
  writePersistedBool(COLLECTION_DIFF_EMPHASIS_KEY, value);
});

const userCanEditCollection = computed(() => sessionStore.authenticated.value);

function preferredSubjectTitle(name?: string, nameCn?: string, fallback = "") {
  if (appStore.titlePreference.value === "original") {
    return name || nameCn || fallback;
  }

  return nameCn || name || fallback;
}

function notpreferredSubjectTitle(name?: string, nameCn?: string, fallback = "") {
  if (appStore.titlePreference.value === "original") {
    return nameCn || name || fallback;
  }

  return name || nameCn || fallback;
}

const detailTitle = computed(() => {
  if (detailPage.value === "person") {
    return personDetail.value?.name || "人物详情";
  }

  if (detailPage.value === "character") {
    return characterDetail.value?.name || "角色详情";
  }

  if (!detail.value) {
    return "";
  }

  return preferredSubjectTitle(detail.value.name, detail.value.name_cn, `Subject #${detail.value.id}`);
});

function toChartPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (value / total) * 100;
}

function formatChartPercent(percent: number) {
  return `${percent.toFixed(1)}%`;
}

/**
 * Range-stretch emphasis: maps [minNonZero, max] → [MIN_BAR, 100] linearly,
 * so the difference between any two bars visually fills the full width range.
 * Falls back to raw percent when the data range is too narrow to matter.
 */
function diffEmphasisWidth(percent: number, allPercents: number[]): number {
  if (percent <= 0) {
    return 0;
  }

  const nonZero = allPercents.filter((p) => p > 0);
  if (nonZero.length < 2) {
    return Math.max(percent, 0.8);
  }

  const min = Math.min(...nonZero);
  const max = Math.max(...nonZero);
  const range = max - min;

  if (range < 0.5) {
    return Math.max(percent, 0.8);
  }

  const MIN_BAR = 4;
  return MIN_BAR + ((percent - min) / range) * (100 - MIN_BAR);
}

const ratingRows = computed(() => {
  const count = detail.value?.rating.count ?? {};
  const values = ratingOrder.map((score) => Number(count[String(score)] ?? 0));
  const totalFromBuckets = values.reduce((sum, value) => sum + value, 0);
  const total = Math.max(Number(detail.value?.rating.total ?? 0), totalFromBuckets, 1);

  const percents = ratingOrder.map((score) =>
    toChartPercent(Number(count[String(score)] ?? 0), total),
  );

  return ratingOrder.map((score, i) => {
    const value = Number(count[String(score)] ?? 0);
    const percent = percents[i];
    return {
      score,
      value,
      width: ratingDiffEmphasis.value
        ? diffEmphasisWidth(percent, percents)
        : value > 0 ? Math.max(percent, 0.8) : 0,
      percent,
      percentLabel: formatChartPercent(percent),
    };
  });
});

const detailRatingScore = computed(() => {
  const score = Number(detail.value?.rating?.score ?? 0);
  return Number.isFinite(score) ? score : 0;
});

const ratingAnomalyAnalysis = computed(() => analyzeRatingDistribution({
  count: detail.value?.rating.count,
  total: detail.value?.rating.total,
  score: detail.value?.rating.score,
}, { broadcastPhase: collectionBroadcastPhase.value }));

const collectionBroadcastPhase = computed<CollectionBroadcastPhase | null>(() => {
  if (
    detail.value?.type !== 2
    || localStorage.getItem("bangumi.broadcast.disabled") === "1"
    || isSuppressed(detail.value.id)
    || isTimeMismatch()
  ) return null;

  const status = TenraiMatch.value?.data?.status;
  if (status === "Not yet aired") return "not-aired";
  if (status === "Currently Airing") return "airing";
  if (status === "Finished Airing") return "finished";
  return null;
});

const showPreReleaseRatingAdvice = computed(() =>
  detailPage.value === "subject"
  && detail.value?.type === 2
  && collectionBroadcastPhase.value === "not-aired"
  && appStore.showUsageAdvice.value,
);
const PRE_RELEASE_ADVICE_EXPANDED_KEY = "bangumi.display.preReleaseAdviceExpanded";
const preReleaseAdviceExpanded = ref(localStorage.getItem(PRE_RELEASE_ADVICE_EXPANDED_KEY) !== "0");
function togglePreReleaseAdvice() {
  preReleaseAdviceExpanded.value = !preReleaseAdviceExpanded.value;
  localStorage.setItem(PRE_RELEASE_ADVICE_EXPANDED_KEY, preReleaseAdviceExpanded.value ? "1" : "0");
}

// Estimate the current broadcast position from the matched airing date. This is deliberately
// coarse (weekly cadence) and is used to qualify retention signals, not to display an exact
// episode schedule.
const broadcastProgress = computed(() => {
  const data = TenraiMatch.value?.data;
  const totalEpisodes = Number(data?.episodes ?? detail.value?.eps ?? 0);
  const airedFrom = data?.aired?.from ? Date.parse(data.aired.from) : NaN;
  if (collectionBroadcastPhase.value !== "airing" || !Number.isFinite(airedFrom) || totalEpisodes <= 0) {
    return { currentEpisode: null, totalEpisodes: totalEpisodes > 0 ? totalEpisodes : null, ratio: null };
  }
  const elapsedWeeks = Math.max(0, (Date.now() - airedFrom) / (7 * 24 * 60 * 60 * 1000));
  const currentEpisode = Math.min(totalEpisodes, Math.max(1, Math.floor(elapsedWeeks) + 1));
  return { currentEpisode, totalEpisodes, ratio: currentEpisode / totalEpisodes };
});

const collectionDistributionAnalysis = computed(() => analyzeCollectionDistribution(
  detail.value?.collection,
  { broadcastPhase: collectionBroadcastPhase.value },
));

const overallOpinionOpen = ref(false);
const overallOpinionVariant = ref(0);
const overallOpinionOrbPosition = ref({ x: 0, y: 0 });
const overallOpinionFaceOffset = ref({ x: 0, y: 0 });
const overallOpinionOrbDrag = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: { x: number; y: number };
  startRect: DOMRect;
  moved: boolean;
} | null>(null);
const suppressOverallOpinionClick = ref(false);
const overallOpinionAvailable = computed(() =>
  appStore.overallWorkOpinionEnabled.value
  && appStore.ratingAnomalyDetectionEnabled.value
  && appStore.collectionDistributionAnalysisEnabled.value,
);

function overallOpinionOrbStyle() {
  const { x, y } = overallOpinionOrbPosition.value;
  return {
    '--overall-opinion-x': `${x}px`,
    '--overall-opinion-y': `${y}px`,
    '--overall-opinion-face-x': `${overallOpinionFaceOffset.value.x}px`,
    '--overall-opinion-face-y': `${overallOpinionFaceOffset.value.y}px`,
  };
}

function startOverallOpinionOrbDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  target.setPointerCapture?.(event.pointerId);
  overallOpinionOrbDrag.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPosition: { ...overallOpinionOrbPosition.value },
    startRect: target.getBoundingClientRect(),
    moved: false,
  };
}

function moveOverallOpinionOrb(event: PointerEvent) {
  const drag = overallOpinionOrbDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(deltaX, deltaY) < 3) return;
  drag.moved = true;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  overallOpinionFaceOffset.value = {
    x: Math.round(deltaX / distance * 3),
    y: Math.round(deltaY / distance * 3),
  };
  const margin = 8;
  const minDeltaX = margin - drag.startRect.left;
  const maxDeltaX = window.innerWidth - margin - drag.startRect.right;
  const minDeltaY = margin - drag.startRect.top;
  const maxDeltaY = window.innerHeight - margin - drag.startRect.bottom;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  overallOpinionOrbPosition.value = {
    x: drag.startPosition.x + clamp(deltaX, minDeltaX, maxDeltaX),
    y: drag.startPosition.y + clamp(deltaY, minDeltaY, maxDeltaY),
  };
}

function endOverallOpinionOrbDrag(event: PointerEvent) {
  const drag = overallOpinionOrbDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const target = event.currentTarget as HTMLElement | null;
  target?.releasePointerCapture?.(event.pointerId);
  suppressOverallOpinionClick.value = drag.moved;
  overallOpinionOrbDrag.value = null;
  overallOpinionFaceOffset.value = { x: 0, y: 0 };
}

function handleOverallOpinionOrbClick() {
  if (suppressOverallOpinionClick.value) {
    suppressOverallOpinionClick.value = false;
    return;
  }
  toggleOverallOpinion();
}

function achievementRank(percent: number): string {
  if (percent >= 100.5) return "SSS+";
  if (percent >= 100) return "SSS";
  if (percent >= 99.5) return "SS+";
  if (percent >= 99) return "SS";
  if (percent >= 98) return "S+";
  if (percent >= 97) return "S";
  if (percent >= 94) return "AAA";
  if (percent >= 90) return "AA";
  if (percent >= 80) return "A";
  if (percent >= 75) return "BBB";
  if (percent >= 70) return "BB";
  if (percent >= 60) return "B";
  if (percent >= 50) return "C";
  return "D";
}

const overallOpinionWaitingForBroadcast = computed(() =>
  detail.value?.type === 2
  && localStorage.getItem("bangumi.broadcast.disabled") !== "1"
  && !isSuppressed(detail.value.id)
  && !isTimeMismatch()
  && (TenraiMatchLoading.value || TenraiMatchRefreshing.value),
);
const generatedOverallOpinionAnalysis = computed(() => {
  const subject = detail.value;
  const rating = ratingAnomalyAnalysis.value;
  const collection = collectionDistributionAnalysis.value;
  const score = Number(subject?.rating?.score ?? 0);
  const total = Number(subject?.rating?.total ?? 0);
  const rank = Number(subject?.rating?.rank ?? 0);
  const collectionTotal = subject
    ? Number(subject.collection.wish ?? 0) + Number(subject.collection.collect ?? 0)
      + Number(subject.collection.doing ?? 0) + Number(subject.collection.on_hold ?? 0) + Number(subject.collection.dropped ?? 0)
    : 0;
  const isPreRelease = collectionBroadcastPhase.value === "not-aired";
  const ratingCounts = subject?.rating?.count ?? {};
  const highPreReleaseVotes = [8, 9, 10].reduce((sum, value) => sum + Number(ratingCounts[String(value)] ?? 0), 0);
  const lowPreReleaseVotes = [1, 2, 3].reduce((sum, value) => sum + Number(ratingCounts[String(value)] ?? 0), 0);
  const highPreReleaseShare = total > 0 ? highPreReleaseVotes / total : 0;
  const lowPreReleaseShare = total > 0 ? lowPreReleaseVotes / total : 0;
  const preReleaseWishCount = Number(subject?.collection.wish ?? 0);
  const hasPreReleaseSample = total >= 100 || preReleaseWishCount >= 100;
  const choose = (items: string[], offset: number) => items[(overallOpinionVariant.value + offset) % items.length];
  // This is a calibrated data value, not a personalised recommendation. Ordinary works retain a
  // stable linear scale, while the elite bonus only activates when a high score and a top rank
  // agree. That keeps 100% reachable without lifting every well-known work into SSS territory.
  const recommendationPercent = (() => {
    if (isPreRelease) {
      // Before release, rank and viewing outcomes do not describe the finished work. Treat wish
      // volume as anticipation, allow early ratings only a small influence, and reduce that
      // influence further when opposing extreme votes suggest expectation-driven score battles.
      const wishShare = collectionTotal > 0 ? preReleaseWishCount / collectionTotal : 0;
      const anticipationSample = Math.min(1, Math.log10(preReleaseWishCount + 1) / 4);
      const anticipationSignal = anticipationSample * (0.55 + wishShare * 0.45);
      const earlyRatingConfidence = total > 0
        ? Math.min(0.35, Math.log10(total + 1) / 4 * 0.35)
        : 0;
      const earlyScoreDirection = score > 0 ? Math.max(-1, Math.min(1, (score / 10 - 0.5) * 2)) : 0;
      const opposingExtremes = Math.min(1, Math.min(highPreReleaseShare, lowPreReleaseShare) * 4);
      const earlyRatingLift = earlyScoreDirection * 7 * earlyRatingConfidence * (1 - opposingExtremes * 0.75);
      const raw = 50 + anticipationSignal * 13 + earlyRatingLift;
      // An untested work cannot reach the top recommendation bands on anticipation alone.
      return Math.max(42, Math.min(69.9, raw));
    }
    // Insufficient samples should communicate uncertainty, not manufacture a
    // negative recommendation. Start at a neutral 50% and only allow a small
    // evidence-weighted drift when a score/rank or collection signal exists.
    const ratingConfidence = total > 0 ? Math.min(1, Math.log10(total + 1) / Math.log10(101)) : 0;
    const collectionConfidence = collectionTotal > 0 ? Math.min(1, Math.log10(collectionTotal + 1) / Math.log10(101)) : 0;
    if (rating.status === "insufficient" || collection.status === "insufficient") {
      const scoreSignal = score > 0 ? Math.min(1, Math.max(0, score / 10)) : null;
      const rankSignal = rank > 0 ? Math.min(1, Math.max(0, 1 - (rank - 1) / 10000)) : null;
      const availableSignals = [scoreSignal, rankSignal].filter((signal): signal is number => signal !== null);
      const ratingDirection = availableSignals.length
        ? availableSignals.reduce((sum, signal) => sum + signal, 0) / availableSignals.length - 0.5
        : 0;
      const collectionDirection = collection.status === "watch" ? 0.08 : 0;
      const confidence = Math.max(ratingConfidence, collectionConfidence * 0.65);
      return Math.max(0, Math.min(100, 50 + (ratingDirection + collectionDirection) * 100 * confidence * 0.6));
    }
    const scoreSignal = score > 0 ? Math.min(1, Math.max(0, score / 10)) : 0.5;
    const rankSignal = rank > 0 ? Math.min(1, Math.max(0, 1 - (rank - 1) / 10000)) : 0.5;
    const sampleSignal = Math.min(1, Math.log10(Math.max(total, 1)) / 4);
    const riskPenalty = (rating.status === "watch" ? 0.10 : 0)
      + (collection.status === "watch" ? 0.10 : 0);
    const base = (scoreSignal * 0.55 + rankSignal * 0.20 + sampleSignal * 0.25) * 101;
    const eliteScoreSignal = Math.min(1, Math.max(0, (score - 8.2) / 0.5));
    const eliteRankSignal = rank > 0 ? Math.min(1, Math.max(0, 1 - (rank - 1) / 1500)) : 0;
    // Calibrated against the observed EVA record (8.6 / rank 23 / 34k votes ~= 100.6%).
    // The hard cap remains reserved for near-perfect score/rank combinations.
    const eliteBonus = eliteScoreSignal * eliteRankSignal * 9.4;
    const penalties = riskPenalty * 101;
    const raw = Math.max(0, base + eliteBonus - penalties);
    // Avoid making every strong title look like a perfect score once it crosses 100%.
    return raw <= 100 ? raw : Math.min(101, 100 + (1 - Math.exp(-(raw - 100) * 1.5)));
  })();
  const rankTone = rank > 0
    ? rank <= 1000 ? "排名非常靠前"
      : rank <= 3000 ? "排名相对靠前"
        : rank <= 6000 ? "排名处于中段"
          : "排名相对靠后"
    : "排名信息暂缺";
  const scoreTone = total <= 0 && score <= 0
    ? "评分暂缺"
    : rank > 0
    ? rank <= 1000 ? "口碑很强"
      : rank <= 3000 ? "口碑稳健"
        : rank <= 6000 ? "评价中等"
          : "口碑偏弱"
    : score >= 8.5 ? "口碑很强" : score >= 7.5 ? "口碑稳健" : score >= 6.5 ? "评价中等" : "口碑偏弱";
  const fallbackAdvice = collection.profile.label.includes("弃坑") || collection.profile.label.includes("流失")
    ? "更适合先试读/试播几集，再决定是否投入。"
    : collection.profile.label.includes("完结") || collection.profile.label.includes("沉淀")
      ? "用户完成度不错，适合按完整作品来安排时间。"
      : "适合结合自己的题材偏好和时间成本判断，不必只看总分。";
  if (isPreRelease) {
    const titlePool = [
      "尚未开播，当前评分更像预期博弈",
      "提前评分活跃，暂不能视为真实口碑",
      "高分与压分可能同时存在，建议忽略当前排名",
      "开播前票型失真，分数只反映期待与立场",
      "作品尚未接受实际观看检验",
    ];
    const highShareLabel = `${(highPreReleaseShare * 100).toFixed(1)}%`;
    const lowShareLabel = `${(lowPreReleaseShare * 100).toFixed(1)}%`;
    const preReleaseSummaryPool = [
      `作品尚未开播，当前已有 ${total} 人评分，其中 8–10 分占 ${highShareLabel}，1–3 分占 ${lowShareLabel}。提前高分可能表达期待、原作情怀或品牌支持；极低分也可能包含对提前高分的反向制衡。两端动机都无法从票数本身证实，因此 ${score.toFixed(1)} 分和排名 #${rank || "-"} 不宜当作成片质量结论。`,
      `这组评分发生在正式观看条件尚不存在的阶段。高分票占比较高，说明期待情绪明显；同时出现的低分票既可能是真实反感，也可能是为了压制提前高分。现阶段更准确的说法是“评分立场分化”，而不是“作品口碑已经形成”。`,
      `开播前的 ${total} 份评分主要衡量观众预期，而非实际观感。${highPreReleaseVotes} 份 8–10 分提前抬高了均分，${lowPreReleaseVotes} 份 1–3 分又可能形成反向修正。当前总分和排名会被少量阵营化投票显著影响，参考价值有限。`,
      `目前的高排名建立在尚未开播的前提下，不能与已经播出并积累大量观后评分的作品直接比较。提前高分和反制性低分可能同时存在，均分只是两股预期力量暂时平衡后的结果。`,
    ];
    const preReleaseAdvicePool = [
      "建议先忽略当前均分与排名，等正式上映并积累一批观后评分后再判断。",
      "现阶段更值得参考的是制作阵容、预告完成度和原作基础，而不是提前评分。",
      "如果题材感兴趣，可以保留想看；是否投入时间最好等首批真实观众反馈出现后再决定。",
      "不必跟随高分建立过高预期，也不必因少量低分提前劝退，开播后的评分变化才更有信息量。",
      "可以把当前数据当作关注度和阵营情绪指标，但不要把它解释成质量认证。",
      "如果只是想了解热度，可以先加入想看；真正安排观看时间时，建议等开播后的前几集反馈。",
      "开播前不必急着做出取舍，先记录自己关注的制作信息，等实际内容出现后再重新评估。",
      "对提前评分保持低权重看待即可，首播后的评分人数和评论内容会更值得参考。",
      "可以先把它当作观察对象，等评分从预期投票转为观后投票后再决定是否追看。",
    ];
    const preReleaseAdvice = choose(preReleaseAdvicePool, 31);
    const preReleaseSummary = total > 0
      ? choose(preReleaseSummaryPool, 19)
      : `作品尚未开播，目前没有可读的提前评分；已有 ${preReleaseWishCount} 人标记想看。开播前参考值只描述期待热度，不用于推断成片质量。`;
      return {
        status: hasPreReleaseSample ? "watch" as const : "insufficient" as const,
        recommendationPercent,
        title: `${subject?.name_cn || subject?.name || "这部作品"}：${choose(titlePool, 11)}`,
      summary: `${preReleaseSummary} ${preReleaseAdvice}`,
      detail: `尚未开播 · 想看 ${preReleaseWishCount} 人 · 提前评分 ${total} 人 · 高分段 ${highPreReleaseVotes} 票 · 低分段 ${lowPreReleaseVotes} 票 · 当前排名不参与计算`,
      sections: [
        { label: "评分印象", text: total > 0 ? `8–10 分占 ${highShareLabel}，显示出明显的提前期待；但作品尚无正式观后样本，不能据此判断实际质量。` : "目前尚无提前评分，评分侧不提供正面或负面信号。" },
        { label: "反向压分", text: total > 0 ? `1–3 分占 ${lowShareLabel}。其中可能有真实负面预期，也可能有人试图抵消提前高分；仅凭分布无法确认具体动机。` : "尚无提前评分，因此也不存在可分析的高低分对冲现象。" },
        { label: "排名怎么读", text: rank > 0 ? `当前排名 #${rank} 会随少量新增评分快速波动，也无法与已播作品的成熟口碑公平比较，因此不参与开播前参考值计算。` : "排名信息暂缺；即使后续出现开播前排名，也不会参与开播前参考值计算。" },
        { label: "观看建议", text: `${preReleaseAdvice} 开播状态来自配信匹配结果，若匹配有误，应以作品实际播出信息为准。` },
      ],
    };
  }
  if (rating.status === "insufficient" || collection.status === "insufficient") {
    const insufficientAdvicePool = [
      "建议先用一两集确认题材和节奏是否合口味，暂时不要根据小样本下结论。",
      "可以先收藏观察，等评分和收藏样本增加后再重新查看综合判断。",
      "当前数据更适合辅助筛选，是否观看应优先取决于你的兴趣和可投入时间。",
      "如果作品本身很吸引你，可以低成本试播；若没有明确兴趣，等待更多反馈会更稳妥。",
      "样本量有限时，个人体验比排行榜和均分更有信息量，建议边看边决定。",
      "不必因为暂无评分直接劝退，也不必因少数高分建立过高预期。",
    ];
    const insufficientAdvice = choose(insufficientAdvicePool, 37);
    const insufficientSummary = total <= 0 && score <= 0
      ? `评分样本暂缺，当前不能判断稳定口碑；${rank > 0 ? `排名 #${rank} 也仅供参考` : "排名信息暂缺"}。`
      : `${scoreTone}（${score > 0 ? score.toFixed(1) : "暂无"} 分，${rank > 0 ? `排名 #${rank}` : "排名暂缺"}），但目前不足以把评分和用户去留连成可靠结论。`;
      return {
        status: "insufficient" as const,
        recommendationPercent,
        title: `${subject?.name_cn || subject?.name || "这部作品"}：样本还在积累`,
      summary: insufficientSummary,
      detail: `已有 ${total || 0} 份评分、${collectionTotal} 份收藏状态；${rankTone}；${fallbackAdvice}`,
      sections: [
        { label: "当前印象", text: total <= 0 && score <= 0 ? "评分侧尚未形成可读样本，不能把暂无评分解释为负面口碑。" : `评分侧目前只能确认${scoreTone}，还不能判断这是稳定口碑还是早期样本造成的印象。` },
        { label: "怎么读", text: `评分监测需要约 ${rating.sampleSize < 100 ? 100 : rating.sampleSize} 份以上样本，收藏监测需要约 ${collection.sampleSize < 100 ? 100 : collection.sampleSize} 份状态记录。${insufficientAdvice}` },
        { label: "观看建议", text: insufficientAdvice },
      ],
    };
  }
  const watch = rating.status === "watch" || collection.status === "watch";
  const scoreText = `${score > 0 ? score.toFixed(1) : "暂无"} 分，${rank > 0 ? `排名 #${rank}` : "排名暂缺"}，${total} 人参与`;
  const collectionCounts = subject?.collection;
  const startedCount = Number(collectionCounts?.collect ?? 0) + Number(collectionCounts?.doing ?? 0) + Number(collectionCounts?.on_hold ?? 0) + Number(collectionCounts?.dropped ?? 0);
  const decidedCount = Number(collectionCounts?.collect ?? 0) + Number(collectionCounts?.dropped ?? 0);
  const dropoutRate = decidedCount > 0 ? Number(collectionCounts?.dropped ?? 0) / decidedCount : 0;
  const droppedAmongStartedRate = startedCount > 0 ? Number(collectionCounts?.dropped ?? 0) / startedCount : 0;
  const airingProgressRatio = broadcastProgress.value.ratio;
  const airingProgressText = broadcastProgress.value.currentEpisode && broadcastProgress.value.totalEpisodes
    ? `约播至第 ${broadcastProgress.value.currentEpisode}/${broadcastProgress.value.totalEpisodes} 集`
    : "当前集数暂无法估算";
  const airingExitShareThreshold = airingProgressRatio !== null && airingProgressRatio >= 0.75
    ? 0.01
    : airingProgressRatio !== null && airingProgressRatio >= 0.4 ? 0.012 : 0.015;
  // 15-22% deserves a caution, but does not support a high-dropout claim.
  const moderateDropoutRisk = decidedCount >= 80 && Number(collectionCounts?.dropped ?? 0) >= 20
    && dropoutRate >= 0.15
    && (collectionBroadcastPhase.value !== "airing" || droppedAmongStartedRate >= 0.02);
  const hasCollectionDropoutSignal = collection.signals.some((signal) => signal.kind === "dropout");
  const airingEarlyExitRisk = collectionBroadcastPhase.value === "airing"
    && ((decidedCount >= 80 && Number(collectionCounts?.dropped ?? 0) >= 30
      && dropoutRate >= 0.3 && droppedAmongStartedRate >= airingExitShareThreshold)
      || hasCollectionDropoutSignal);
  const strongDropoutRisk = collection.signals.some((signal) => signal.kind === "outcome-split")
    || (hasCollectionDropoutSignal && (collectionBroadcastPhase.value !== "airing" || droppedAmongStartedRate >= 0.03));
  const selectiveRisk = strongDropoutRisk && (rating.signals.some((signal) => signal.kind === "polarization" || signal.kind === "extreme-skew") || rating.standardDeviation >= 1.9);
  const skewRiskText = rating.skewness <= -0.35
    ? `偏度 ${rating.skewness.toFixed(2)} 显示低分长尾明显`
    : rating.skewness >= 0.75
      ? `偏度 ${rating.skewness.toFixed(2)} 显示高分长尾明显，不能据此推断普遍认可`
      : `偏度 ${rating.skewness.toFixed(2)} 未显示明显的单侧长尾`;
  const topicHints = [...(subject?.tags ?? [])]
    .sort((first, second) => second.count - first.count)
    .slice(0, 4)
    .map((tag) => tag.name)
    .filter(Boolean);
  const topicHintText = topicHints.length ? `可优先核对“${topicHints.join("、")}”等标签是否符合你的接受范围。` : "可优先核对题材、表达尺度和叙事风格是否符合自己的接受范围。";
  const hasIsolatedSpike = rating.signals.some((signal) => signal.kind === "isolated-spike");
  const ratingCase = selectiveRisk ? "selective" : hasIsolatedSpike ? "spike" : rating.signals.length ? "disputed" : rank > 0 ? rank <= 3000 ? "strong" : rank > 6000 ? "weak" : "steady" : score < 6 ? "weak" : score >= 8 ? "strong" : "steady";
  const ratingPools: Record<string, string[]> = {
    weak: [`${scoreTone}（${scoreText}）。分布本身没有明显异常，说明偏低的评价来自较普遍的观感，而不是少数极端票拉低了均分。`, `目前评分只有 ${score.toFixed(1)} 分。票型相对自然，因此这个低分更像是观众整体认可度不足，而非异常评分造成的假象。`, `从 ${total} 份评分来看，作品的口碑基础偏弱。高低分没有异常聚集，现有均分具有一定参考价值。`, `评分端给出的信号并不乐观：均分偏低，同时分布平稳。这意味着问题更可能来自普遍体验，而不是某一批极端评价。`, `在 Bangumi 的整体排名中，这个位置说明作品确实落后于多数热门条目；好在评分结构正常，负面反馈具有一定普遍性。`, `它不是被少数低分拖累的作品，而是整体评分都没有形成足够的认可度。排名和分布一起看，低口碑结论比较稳固。`],
    strong: [`${scoreTone}（${scoreText}）。${rankTone}，评分围绕较高区间稳定聚集，当前认可度既高，也没有明显异常票型。`, `这部作品取得了 ${score.toFixed(1)} 分并排在前列，且分布较自然。高评价并非只靠少量满分票支撑，口碑基础相对扎实。`, `${total} 位评分者给出了较强的正面反馈，${rankTone}。现阶段看，分数、排名与评分结构能够互相印证。`, `排名已经进入 Bangumi 的前段，评分也没有明显失真迹象。对喜欢相关题材的观众来说，这是相对可靠的正向信号。`, `它同时拥有较高分数和靠前排名，说明认可度不只停留在小圈层。整体口碑有一定广度，也有稳定性。`],
    steady: [`${scoreTone}（${scoreText}）。${rankTone}，评分主要围绕主流意见展开，没有明显的极端分化或单侧异常。`, `当前均分为 ${score.toFixed(1)}，${rankTone}，票型也较为自然。它未必让所有人惊艳，但在 Bangumi 的整体作品中仍有稳定认可度。`, `从评分侧看，作品获得了相对稳定的反馈；分数和排名都没有显示口碑被少数极端评价显著扭曲。`, `这是一种“没有特别失望，也不一定人人惊艳”的口碑。排名处于相对正常的位置，评分结构也支持这种中性的判断。`, `分数与排名给出的信息比较一致：作品有明确受众，但还没有形成压倒性的共识。整体评价稳，不必过度拔高或贬低。`],
    disputed: [`${scoreTone}（${scoreText}），但评分结构并不平静。总分掩盖了观众之间的明显分歧，需要结合具体偏好理解。`, `平均分只能说明一部分情况：评分分布触发了异常或争议信号，不同观众对作品的接受度可能差异很大。`, `这部作品的均分具有迷惑性。比起分数高低，评分者为何形成分化更值得关注。`, `评分端存在值得留意的结构性信号，单看 ${score.toFixed(1)} 分容易忽略作品较强的受众筛选效应。`, `排名和均分未必能代表所有人的体验，当前数据更像是“有人很喜欢，也有人明确不买账”。`, `它的主要特征不是高或低，而是评价不够统一。选择观看前，最好先确认争议点是否触及自己的偏好。`],
    spike: [`${scoreText} 的整体分数偏正面，但评分集中在某一个具体分数档位，平均分需要结合票型解读。`, `当前评分为 ${score.toFixed(1)} 分，主要票数集中在单一档位；这更像是集中式打分习惯，不能直接等同于两极口碑。`, `评分分布出现单点尖峰，主流观感仍偏向 ${score >= 7 ? "认可" : "保留"}，但少量邻近档位不足使均分的细节信息变少。`],
    selective: [`${scoreText} 看起来不差，但评分分化与较高弃坑率同时出现，说明作品具有明显的受众筛选效应。`, `均分和热度掩盖了一项更重要的风险：一部分观众给出强烈负面评价，也直接停止了观看。`, `这部作品可能很容易吸引人点开，却未必容易留住人；${skewRiskText} 与 ${(dropoutRate * 100).toFixed(1)}% 的明确结局弃坑率相互印证。`, `排名不能完整描述这部作品。评分分化和用户退出同时存在，更像是“爱者能接受、厌者迅速离场”的强筛选型作品。`, `表面评分尚可，但负面反馈并非只停留在打分层面，它同时反映在真实的弃坑行为中。`],
  };
  const kinds = new Set(collection.signals.map((signal) => signal.kind));
  const collectionCase = strongDropoutRisk || moderateDropoutRisk ? "dropout" : airingEarlyExitRisk ? "early-exit" : kinds.has("dropout") ? "dropout" : kinds.has("on-hold") ? "onhold" : kinds.has("outcome-split") ? "split" : kinds.has("wish-backlog") ? "backlog" : kinds.has("active-surge") ? "active" : collection.profile.label.includes("完结") || collection.profile.label.includes("沉淀") ? "completed" : "neutral";
  const collectionPools: Record<string, string[]> = {
    active: ["收藏侧呈现追看热潮，不少用户仍在持续推进，作品目前具备较强的即时吸引力。", "在看用户占比较高，观众仍集中于观看过程；热度正在兑现，但最终完成表现尚未定型。", "收藏轨迹显示活跃追看，这通常意味着前中期具备留住观众的动力，不过暂时不能把追看直接等同于完结口碑。", "作品当前的主要反馈来自正在观看的人群，说明它能把兴趣转化为行动。后续完成率仍需要更多数据验证。", "从收藏状态看，观众没有停留在观望阶段，而是有相当一部分已经开始跟进。它的即时吸引力值得肯定。"],
    "early-exit": ["作品仍在放送，多数用户尚在观看，但已经出现一批明确退出者，可能存在前期受众门槛。", "追看仍是主流，同时已有可见的早期弃坑群体；这更适合视为门槛信号，而不是最终留存结论。", "当前观看结构尚未定型，不过开始后较快离开的用户已形成一定规模，前几集的适配度值得留意。"],
    dropout: ["明确结束观看的用户中，抛弃比例偏高，作品在实际体验中流失了不少观众。", "收藏数据暴露出较明显的退出倾向，部分用户开始后没有坚持到最后。", "相比想看或在看人数，更需要注意较高的弃坑表现；节奏、完成度或受众门槛可能影响了留存。", "收藏轨迹对作品的长期留存并不乐观，感兴趣的人不少，但真正坚持下来的人相对有限。", "用户从开始观看到明确放弃之间出现了明显损耗，这比单纯的低评分更能提示实际体验风险。"],
    onhold: ["搁置比例偏高，说明不少用户没有彻底放弃，但作品也不足以推动他们继续观看。", "收藏状态里积累了较多搁置用户，观看动力可能在中途减弱。", "用户更常选择暂停而非直接抛弃，这通常意味着作品并非完全不受认可，但持续吸引力有限。"],
    split: ["看完与抛弃两种结局同时突出，作品对不同受众产生了截然不同的体验。", "收藏结局明显分流：一部分人完整看完，另一部分人则中途退出。", "用户去向呈现两极结果，能否接受作品的表达方式可能比平均分更重要。"],
    backlog: ["想看人数明显多于实际开始的人数，关注度尚未充分转化为观看行动。", "作品积累了可观的观望人群，但真正开始体验的比例仍有限。", "收藏热度更多停留在想看阶段，目前还不能据此判断实际留存和完成表现。"],
    completed: ["收藏状态形成了不错的完成沉淀，开始体验的用户中有相当一部分坚持到了最后。", "用户完成表现较稳，作品不仅吸引人开始，也较能支撑完整体验。", "从收藏轨迹看，作品具备较好的长程留存，完整看完的人群占据明显位置。"],
    neutral: ["收藏状态没有出现突出的流失或积压信号，用户去向整体处在常规范围内。", "观众分布在不同观看阶段，目前没有哪一种负面状态异常集中。", "收藏轨迹相对平稳，实际投入表现与一般作品相比没有明显偏离。"],
  };
  const advicePools: Record<string, string[]> = {
    active: [
      "如果题材符合偏好，可以先看几集，再根据节奏和角色塑造决定是否继续。",
      "适合先用开篇内容判断契合度，不必过早把正在观看的人数当成最终质量结论。",
      "可以列入近期观看清单，但建议保留对后续展开和收尾表现的判断。",
      "喜欢参与讨论或边播边看的观众可以现在开始；更重视完整体验的人则可以稍后再看。",
      "不妨先设一个短期试看节点，确认作品的推进方式符合口味后再持续投入。",
      "现阶段更适合作为一部可以尝试的新作，而不是直接视为已经得到充分验证的佳作。",
      "如果时间有限，可以先关注几集后的评价变化，再决定是否加入长期观看计划。",
      "建议把题材吸引力和实际观看感受放在首位，后续表现仍需要时间检验。",
      "想参与当季讨论的话，现在切入正合适；如果不在意时效，等完整口碑形成后再看也不迟。",
      "追看热度说明开篇成功留住了一批观众，可以尝试，但不用因此预设后续一定稳定。",
      "可以先观察自己看完一集后是否会主动点开下一集，这比追看人数更能判断作品是否适合你。",
      "如果你不喜欢等待更新或担心后期发挥，先收藏并等播完会是更稳妥的选择。",
      "当前适合轻量尝试：先投入少量时间，确认角色、节奏和叙事方式都能接受后再追下去。",
      "边播边看的氛围是它眼下的优势之一；若你更看重结构完整性，可以把决定留到完结之后。",
      "不用急着在‘追’和‘不追’之间二选一，先体验开篇，再根据自己的期待调整观看节奏。",
      "热度可以作为开始观看的理由，却不该成为坚持看完的压力；不合口味时及时停下即可。",
      "如果喜欢边看边验证，可以把每周更新当作阶段性检查点，持续确认作品是否仍然符合预期。",
      "追看人数提供了开始的理由，但每集结束后的真实感受才是决定是否继续的主要依据。",
      "适合把它放进短周期观看计划，留出调整空间，避免单凭当前热度安排过多时间。",
    ],
    "early-exit": ["建议先看两到三集，重点确认节奏、表达方式和角色塑造是否符合偏好。", "可以尝试，但适合设置一个前期观察点；若很快失去观看动力，不必因追看热度勉强继续。", "放送期数据尚未定型，先用少量时间验证自己能否跨过作品的前期门槛。", "优先观察前几集是否能持续提供推进感，若需要反复催促自己观看就可以及时止损。", "把早期退出信号当作提醒而非定论，实际试播后的个人感受应当放在首位。", "若你能接受慢热或边播边调整，可以继续跟几集；否则等完结反馈更省时间。"],
    dropout: ["建议先试播或试读一小段，确认能接受节奏与表达后再投入完整时间。", "不妨降低预期并设置一个试看片段；如果前期已经缺乏吸引力，继续投入的回报可能有限。", "更适合谨慎尝试，而不是仅凭题材或宣传直接开始长线观看。", "如果时间成本较高，建议把它放在候选列表，先观察后续口碑是否改善。", "可以先查看弃坑反馈集中出现的阶段，确认问题是否正好触及你的敏感点。", "若决定尝试，给自己设一个明确的退出标准，不要因为已经投入时间而被迫看完。", "对这类高流失作品，短篇幅试播通常比一次性投入整季更合适。"],
    onhold: ["建议优先确认作品中段的节奏反馈，避免开始后长期搁置。", "可以分阶段体验；若前几集仍缺乏推进动力，就不必勉强继续。", "适合有耐心、能接受慢热展开的观众，时间有限时可暂缓。", "不妨给它设一个明确的继续观看节点，避免因为‘以后再看’而长期占用收藏位置。", "如果你经常被慢节奏劝退，建议先确认中段是否会出现明显转折再投入。", "可以安排连续的短时段观看，减少因间隔过久而重新进入状态的成本。", "搁置不等于否定，等有完整时间时再试一次；仍提不起兴趣就可以放下。"],
    split: ["建议先确认自己是否属于它的目标受众，再用几集内容验证，而不是依赖均分决策。", "这类作品更吃个人偏好，试播的参考价值会高于排行榜位置。", "可以优先查看题材、叙事风格和负面反馈是否触及自己的雷区。", "如果你对争议点不敏感，它可能值得尝试；反之则应先把风险点看清楚。", "先找与你口味相近的观众评价作参照，避免被单一极端好评或差评带偏。", "观看前列出自己最在意的两三个要素，再用实际内容逐项核对会更有效。", "争议越集中，越应该采用低成本试看的方式，而不是直接承诺看完整部。"],
    backlog: ["可以继续观望，等更多用户实际观看后再判断也不迟。", "若没有强烈题材兴趣，不妨等待收藏热度转化成更明确的完成反馈。", "现阶段更适合放在候选列表，而不是仅因想看人数多就立即投入。", "想看人数说明关注度不低，但还缺少体验后的反馈，等一轮数据沉淀会更稳妥。", "可以先关注开始观看人数和完成率何时上升，这比单纯的想看规模更有参考价值。", "若排片或时间安排宽松，等口碑样本扩大后再决定，机会成本通常更低。", "把它加入稍后查看清单即可，不需要因为热度积累而立刻开始。"],
    completed: [
      "如果题材符合偏好，可以相对放心地按完整作品安排时间。",
      "较好的完成表现降低了中途踩雷的风险，适合从头完整体验。",
      "收藏轨迹显示，开始观看的人大多愿意继续推进，适合想找一部完整投入的作品时优先考虑。",
      "作品不只是吸引用户点开，后续留存也比较扎实；如果你在意收尾质量，这是一项积极信号。",
      "从用户去向来看，它更适合集中安排时间观看，不太像那种开了头却很容易被搁置的作品。",
      "完成用户占据了较明确的位置，说明作品的整体节奏和收束能力能够支撑一部分观众走到最后。",
      "如果你希望减少中途弃坑的不确定性，这部作品的收藏反馈相对让人放心。",
      "它的优势更偏向长期留存而不是短期热度，适合按自己的节奏稳定看下去。",
      "如果你在意作品能否完整收束，当前完成数据可以作为优先尝试的正面参考。",
      "适合在有连续空闲时间时一次推进几集，完整体验更容易感受到它的节奏优势。",
      "完成反馈稳定并不意味着人人都会喜欢，仍建议先确认题材和表达方式与你的口味相符。",
    ],
    neutral: ["建议结合题材偏好和时间成本判断，不必只看总分。", "可以按常规方式试播几集，再依据自己的实际感受决定。", "现有群体数据没有给出强烈劝退或推荐信号，个人兴趣应当成为主要依据。", "它没有明显的群体性风险或额外加成，选择标准可以回到你自己的口味。", "如果正在寻找稳妥的下一部作品，可以把它和同题材条目横向比较后再排优先级。", "先确认单集时长、总集数和更新状态，时间成本合适时再安排观看。", "没有强信号时，先从最感兴趣的设定或角色入手，实际体验通常很快能给出答案。", "可以把综合评分当作筛选参考，最终决定交给自己的试看片段反馈。"],
  };
  const viewingAdvice = choose(advicePools[collectionCase], 29);
  const implicationPools: Record<string, string[]> = {
    dropout: [
      "这说明作品的曝光或开篇吸引力没有顺利转化为长期留存，热度不能抵消实际退出风险。",
      "相比有多少人点开，更值得关注的是开始之后有多少人选择离开；当前数据对持续吸引力并不乐观。",
      "均分可能仍由留下来的受众支撑，但退出行为提示作品对普通观众存在不低的门槛。",
      "高热度与高流失可以同时成立：前者说明它容易引起兴趣，后者说明实际体验会迅速筛掉一部分人。",
    ],
    active: ["当前数据更能证明作品具有即时吸引力，长期口碑仍要等待完成用户增加后再确认。", "追看人数是积极的过程信号，但尚不足以替代完结后的留存与评价。", "现阶段可以确认观众愿意继续跟进，最终评价是否稳定仍取决于后续展开。"],
    "early-exit": ["这说明作品能吸引不少人开始观看，但前期体验也在筛选受众；风险存在，却还不能外推为最终高流失。", "早期退出与持续追看同时存在，作品可能具有一定接受门槛，最终留存仍需等放送推进后判断。"],
    onhold: ["这种结构通常不是强烈反感，而是持续观看动力不足；中段体验比开篇吸引力更值得关注。", "观众没有大规模直接离开，却也缺少继续推进的动力，作品可能存在慢热或节奏阻力。"],
    split: ["这类数据更像明确的受众筛选，而不是所有人共享同一种观感。", "均分会把两种相反体验压成一个数字，实际选择应更多参考自己能否接受争议点。"],
    backlog: ["关注度已经形成，但还没有足够的实际体验数据验证作品能否留住观众。", "想看收藏反映的是兴趣而非质量，当前仍处于等待真实口碑落地的阶段。"],
    completed: ["评分与完成行为相互支持，说明认可不只停留在打分，也反映在完整体验上。", "较好的完成沉淀让当前口碑更有可信度，作品对已开始用户具备一定持续吸引力。"],
    neutral: ["评分与用户去向没有明显冲突，现阶段可以把它视为一部表现相对常规的作品。", "群体数据没有暴露突出风险，也没有给出压倒性的推荐理由。"],
  };
  const airingCaution = collectionBroadcastPhase.value === "airing" && collectionCase === "active";
  const reportSummary = `${choose(ratingPools[ratingCase], 7)} ${choose(collectionPools[collectionCase], 17)} ${airingCaution ? `作品仍在放送（${airingProgressText}），当前弃坑比例只覆盖已经作出明确结局的少数用户，不能外推为整体留存风险。` : collectionCase === "early-exit" ? `${choose(implicationPools[collectionCase], 23)} 当前进度为${airingProgressText}，后续集数仍可能改变留存结构。` : choose(implicationPools[collectionCase], 23)}`;
  const ratingMetrics = rating.metrics.map((metric) => `${metric.name}${metric.value}（${metric.label}）`).join("、");
  const collectionMetrics = collection.metrics.map((metric) => `${metric.name}${metric.value}（${metric.label}）`).join("、");
  const titlePools: Record<string, string[]> = {
    "strong-completed": ["排名靠前，完成反馈也不错", "口碑有位置，观众也愿意看完", "高认可度和完成沉淀互相印证"],
    "strong-active": ["排名靠前，当前追看热度很高", "口碑亮眼，正在观看的人也不少", "高分遇上活跃追看，热度正在兑现"],
    "strong-neutral": ["排名靠前，整体认可度较高", "口碑扎实，观众反馈相对一致", "评分与排名都给出积极信号"],
    "steady-completed": ["口碑稳健，完成反馈也较好", "评分平稳，完整体验的反馈不错", "排名和完成度都比较踏实"],
    "steady-active": ["评分平稳，当前仍有追看热度", "口碑稳定，观众正在持续跟进", "整体反馈稳，热度还在继续"],
    "spike-active": ["评分集中，当前追看仍在继续", "主流票型集中，放送期热度尚未沉淀", "单点评分尖峰，观众仍在持续跟进"],
    "steady-neutral": ["整体反馈比较稳定", "排名适中，口碑没有明显波动", "分数和观众反馈都处在常规范围"],
    "weak-dropout": ["口碑偏弱，观看留存需要谨慎", "评分靠后，弃坑反馈值得留意", "低分与用户流失指向同一个风险"],
    "weak-active": ["口碑偏弱，但当前仍有追看热度", "评分靠后，实时热度尚未转成稳定口碑", "低分之下仍有人追看，体验可能比较挑人"],
    "weak-neutral": ["排名靠后，整体认可度有限", "口碑偏弱，建议先确认个人偏好", "评分不高，但是否适合你仍取决于题材契合度"],
    "disputed-split": ["评价分化明显，观众结局也不一致", "评分有争议，适配人群可能比较明确", "总分之外，作品的受众分歧更值得注意"],
    "disputed-neutral": ["评分存在争议，不能只看平均分", "口碑分化，个人偏好会明显影响体验", "评价不够统一，建议先了解争议点"],
    "selective-dropout": ["均分尚可，但作品正在强烈筛选受众", "低分长尾与弃坑行为形成双重警告", "热度不低，实际留存却暴露明显风险", "有人留下高评，也有人迅速退出", "表面口碑无法掩盖较强的劝退效应"],
  };
  const titleKey = `${ratingCase}-${collectionCase}`;
  const titlePool = titlePools[titleKey] ?? (collectionCase === "early-exit"
    ? ["追看仍是主流，但已有早期退出迹象", "放送表现活跃，也存在一定前期门槛", "多数人仍在看，少量退出信号值得观察"]
    : watch
    ? ["有积极信号，也值得保留一点判断", "口碑与观众行为并不完全一致", "建议结合个人偏好再做决定"]
    : ["整体反馈比较稳定", "分数和收藏表现相对一致", "当前数据没有给出强烈风险信号"]);
  const opinionTitle = choose(titlePool, 43);
  return {
    status: watch ? "watch" as const : "clear" as const,
    recommendationPercent,
    title: `${subject?.name_cn || subject?.name || "这部作品"}：${opinionTitle}`,
    summary: reportSummary,
    detail: `评分 ${score > 0 ? score.toFixed(1) : "暂无"} / 10（${total} 人），${rating.profile.description} 收藏样本 ${collection.sampleSize} 份，${collection.profile.description}${collectionBroadcastPhase.value === "airing" ? ` 当前放送进度：${airingProgressText}。` : ""}`,
    sections: [
      { label: "评分印象", text: `${rating.profile.description} 当前评分为 ${score > 0 ? score.toFixed(1) : "暂无"} 分，${total} 人参与；关键指标为 ${ratingMetrics}。` },
      { label: "观众行为", text: collectionCase === "early-exit" ? `作品仍在放送（${airingProgressText}），已开始用户中 ${(Number(collectionCounts?.doing ?? 0) / Math.max(1, startedCount) * 100).toFixed(1)}% 仍处于观看中，同时已有 ${(droppedAmongStartedRate * 100).toFixed(1)}% 明确弃坑。后者提示前期可能存在门槛，但尚不能代表最终留存。关键指标为 ${collectionMetrics}。` : airingCaution ? `作品仍在放送（${airingProgressText}），已开始用户中 ${(Number(collectionCounts?.doing ?? 0) / Math.max(1, startedCount) * 100).toFixed(1)}% 仍处于观看中；明确结局弃坑率为 ${(dropoutRate * 100).toFixed(1)}%，仅代表已经结束观看的人群，不能与完结作品的留存直接比较。关键指标为 ${collectionMetrics}。` : moderateDropoutRisk ? `明确结局中的弃坑率为 ${(dropoutRate * 100).toFixed(1)}%，弃坑占全部已开始用户的 ${(droppedAmongStartedRate * 100).toFixed(1)}%。这属于需要留意的退出信号，但已开始用户中仍有较高比例完成。关键指标为 ${collectionMetrics}。` : `${collection.profile.description} 这通常意味着用户对作品的投入阶段并不完全一致。关键指标为 ${collectionMetrics}。` },
      { label: "需要留意", text: selectiveRisk ? `${skewRiskText}，同时明确结局弃坑率达到 ${(dropoutRate * 100).toFixed(1)}%。评分分化与实际退出指向同一风险，作品可能具有题材、表达或体验层面的较强受众门槛。${topicHintText} 标签只是线索，不能单独解释弃坑原因。` : collectionCase === "early-exit" ? `明确弃坑占全部已开始用户的 ${(droppedAmongStartedRate * 100).toFixed(1)}%，已构成早期退出迹象；但多数用户仍在追看，因此当前只能判断作品可能有一定前期门槛，不能判断最终高流失。${topicHintText}` : moderateDropoutRisk ? `明确结局弃坑率为 ${(dropoutRate * 100).toFixed(1)}%，高于常规水平但尚不足以单独证明强烈劝退；${rating.signals.length ? rating.signals.slice(0, 1).map((signal) => `${signal.title}：${signal.evidence}`).join("；") : "评分侧未发现与退出行为完全一致的异常信号。"}` : rating.signals.length ? rating.signals.slice(0, 2).map((signal) => `${signal.title}：${signal.evidence}`).join("；") : "评分分布没有触发明显的异常信号。" },
      { label: "观看建议", text: `${airingCaution ? "如果题材感兴趣，可以先看几集观察实际体验；不必根据放送期的明确结局弃坑率提前下结论。" : viewingAdvice} 这份报告描述的是群体数据，不会替代你对题材、节奏和制作风格的个人判断。` },
    ],
  };
});

// Keep an opinion stable for the lifetime of the current detail view. Broadcast matching finishes
// asynchronously and some copy has multiple equivalent variants; neither should rewrite an
// opinion the user has already opened.
const overallOpinionSnapshot = ref<typeof generatedOverallOpinionAnalysis.value | null>(null);
const overallOpinionAnalysis = computed(() => overallOpinionSnapshot.value ?? generatedOverallOpinionAnalysis.value);
const overallOpinionCompactSummary = computed(() => {
  const summary = overallOpinionAnalysis.value.summary.trim();
  const sentenceEnd = ["。", "！", "？"]
    .map((mark) => summary.indexOf(mark))
    .filter((index) => index >= 0)
    .sort((first, second) => first - second)[0];
  return sentenceEnd === undefined ? summary : summary.slice(0, sentenceEnd + 1);
});
const overallOpinionAdvice = computed(() =>
  overallOpinionAnalysis.value.sections.find((section) => section.label === "观看建议")
  ?? overallOpinionAnalysis.value.sections.at(-1),
);
const overallOpinionEvidenceSections = computed(() =>
  overallOpinionAnalysis.value.sections.filter((section) => section.label !== "观看建议"),
);
const overallOpinionCopied = ref(false);
let overallOpinionCopyTimer: number | null = null;
const overallOpinionStatus = computed(() =>
  overallOpinionWaitingForBroadcast.value ? "insufficient" : overallOpinionAnalysis.value.status,
);
const overallOpinionFaceChanging = ref(false);
let overallOpinionFaceChangeTimer: number | null = null;
watch(
  () => `${overallOpinionStatus.value}:${overallOpinionAnalysis.value.title}`,
  () => {
    overallOpinionFaceChanging.value = false;
    void nextTick(() => {
      overallOpinionFaceChanging.value = true;
      if (overallOpinionFaceChangeTimer !== null) window.clearTimeout(overallOpinionFaceChangeTimer);
      overallOpinionFaceChangeTimer = window.setTimeout(() => {
        overallOpinionFaceChanging.value = false;
        overallOpinionFaceChangeTimer = null;
      }, 560);
    });
  },
);
onUnmounted(() => {
  if (overallOpinionFaceChangeTimer !== null) window.clearTimeout(overallOpinionFaceChangeTimer);
});
const overallOpinionIsPreRelease = computed(() => collectionBroadcastPhase.value === "not-aired");
const overallOpinionRecommendationLabel = computed(() =>
  overallOpinionIsPreRelease.value ? "开播前参考值" : "数据推荐值",
);
const overallOpinionRecommendationText = computed(() =>
  overallOpinionStatus.value === "insufficient"
    ? "?????"
    : `${overallOpinionAnalysis.value.recommendationPercent.toFixed(4)}%`,
);
const overallOpinionAchievementRankText = computed(() =>
  overallOpinionStatus.value === "insufficient"
    ? "?????"
    : achievementRank(overallOpinionAnalysis.value.recommendationPercent),
);
const overallOpinionAchievementRankClass = computed(() => {
  const rank = overallOpinionAchievementRankText.value;
  if (rank.startsWith("SSS")) return "is-rank-sss";
  if (rank.startsWith("SS")) return "is-rank-ss";
  if (rank.startsWith("S")) return "is-rank-s";
  if (rank.startsWith("A")) return "is-rank-a";
  if (rank.startsWith("B")) return "is-rank-b";
  if (rank.startsWith("C")) return "is-rank-c";
  if (rank === "D") return "is-rank-d";
  return "is-rank-unknown";
});
const overallOpinionRecommendationBasis = computed(() => {
  if (overallOpinionStatus.value === "insufficient") return "当前样本不足，推荐值与等级暂不计算。";
  if (overallOpinionIsPreRelease.value) return "开播前参考值只反映想看热度和低权重的提前评分，排名不参与计算，并设置了等级上限；它不代表成片质量。";
  return "推荐值基于评分、排名、样本量及风险信号，不代表个人偏好。";
});

const overallOpinionCopyText = computed(() => {
  const report = overallOpinionAnalysis.value;
  const lines = [
    report.title,
    "",
    report.summary,
    "",
    `${overallOpinionRecommendationLabel.value}：${overallOpinionRecommendationText.value}（Achievement Rank：${overallOpinionAchievementRankText.value}）`,
    report.detail,
    "",
    ...report.sections.map((section) => `${section.label}\n${section.text}`),
  ];
  return lines.join("\n");
});

async function copyOverallOpinion() {
  if (overallOpinionWaitingForBroadcast.value) return;
  const text = overallOpinionCopyText.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    overallOpinionCopied.value = true;
    appStore.showToast("综合报告已复制到剪贴板", "success");
    if (overallOpinionCopyTimer !== null) window.clearTimeout(overallOpinionCopyTimer);
    overallOpinionCopyTimer = window.setTimeout(() => {
      overallOpinionCopied.value = false;
      overallOpinionCopyTimer = null;
    }, 1800);
  } catch {
    appStore.showToast("复制失败，请检查剪贴板权限", "error");
  }
}

function captureOverallOpinion() {
  if (overallOpinionSnapshot.value || overallOpinionWaitingForBroadcast.value) return;
  overallOpinionVariant.value = Math.floor(Math.random() * 1_000_000);
  overallOpinionSnapshot.value = generatedOverallOpinionAnalysis.value;
}

function toggleOverallOpinion() {
  if (!overallOpinionOpen.value) captureOverallOpinion();
  overallOpinionOpen.value = !overallOpinionOpen.value;
}

watch(overallOpinionWaitingForBroadcast, (waiting) => {
  if (!waiting && overallOpinionOpen.value) captureOverallOpinion();
});

const overallOpinionTitleParts = computed(() => {
  const title = overallOpinionAnalysis.value.title;
  const separator = title.indexOf("：");
  const subject = separator >= 0 ? title.slice(0, separator + 1) : "";
  const conclusion = separator >= 0 ? title.slice(separator + 1) : title;
  const emphasisCandidates: Array<{ text: string; tone: "positive" | "warning" | "neutral" }> = [
    { text: "高认可度", tone: "positive" }, { text: "认可度较高", tone: "positive" },
    { text: "完成反馈也不错", tone: "positive" }, { text: "愿意看完", tone: "positive" },
    { text: "互相印证", tone: "positive" }, { text: "追看热度很高", tone: "positive" },
    { text: "热度正在兑现", tone: "positive" }, { text: "持续跟进", tone: "positive" },
    { text: "比较稳定", tone: "positive" }, { text: "相对一致", tone: "positive" },
    { text: "没有明显波动", tone: "positive" }, { text: "没有给出强烈风险信号", tone: "positive" },
    { text: "需要谨慎", tone: "warning" }, { text: "值得留意", tone: "warning" },
    { text: "同一个风险", tone: "warning" }, { text: "整体认可度有限", tone: "warning" },
    { text: "比较挑人", tone: "warning" }, { text: "明显分化", tone: "warning" },
    { text: "受众分歧更值得注意", tone: "warning" }, { text: "不能只看平均分", tone: "warning" },
    { text: "先了解争议点", tone: "warning" }, { text: "忽略当前排名", tone: "warning" },
    { text: "并不完全一致", tone: "warning" }, { text: "预期博弈", tone: "warning" },
    { text: "真实口碑", tone: "neutral" }, { text: "期待与立场", tone: "neutral" },
    { text: "实际观看检验", tone: "neutral" }, { text: "保留一点判断", tone: "neutral" },
    { text: "先确认个人偏好", tone: "neutral" }, { text: "再做决定", tone: "neutral" },
    { text: "常规范围", tone: "neutral" }, { text: "仍有追看热度", tone: "neutral" },
    { text: "热度还在继续", tone: "neutral" },
    { text: "评分不高", tone: "warning" }, { text: "题材契合度", tone: "neutral" },
    { text: "口碑偏弱", tone: "warning" }, { text: "评分靠后", tone: "warning" },
    { text: "实时热度", tone: "neutral" }, { text: "稳定口碑", tone: "positive" },
    { text: "评价分化", tone: "warning" }, { text: "评分有争议", tone: "warning" },
    { text: "适配人群", tone: "neutral" }, { text: "个人偏好", tone: "neutral" },
    { text: "口碑亮眼", tone: "positive" }, { text: "评分平稳", tone: "positive" },
    { text: "口碑稳定", tone: "positive" }, { text: "完整体验", tone: "positive" },
  ];
  const match = emphasisCandidates.find((candidate) => conclusion.includes(candidate.text));
  if (!match) {
    const punctuationIndex = Math.max(conclusion.lastIndexOf("，"), conclusion.lastIndexOf("；"));
    const fallbackStart = punctuationIndex >= 0 ? punctuationIndex + 1 : Math.max(0, conclusion.length - 6);
    return {
      subject,
      lead: conclusion.slice(0, fallbackStart),
      emphasis: conclusion.slice(fallbackStart),
      suffix: "",
      tone: overallOpinionAnalysis.value.status === "watch" ? "warning" as const : "neutral" as const,
    };
  }
  const emphasis = match.text;
  const emphasisIndex = conclusion.indexOf(emphasis);
  return {
    subject,
    lead: conclusion.slice(0, emphasisIndex),
    emphasis,
    suffix: conclusion.slice(emphasisIndex + emphasis.length),
    tone: match.tone,
  };
});

const myRatingScore = computed(() => {
  const score = Number(form.rate ?? 0);
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(10, Math.max(0, score));
});

function detailRatingScoreLabel(score: number) {
  return score > 0 ? score.toFixed(1) : "暂无";
}

function ratingStarState(score: number, index: number) {
  const fill = ratingStarFill(score, index);
  if (fill >= 100) {
    return "is-full";
  }

  if (fill > 0) {
    return "is-half";
  }

  return "is-empty";
}

/** Return the exact fill percentage for a single star, preserving decimal ratings. */
function ratingStarFill(score: number, index: number) {
  return Math.min(100, Math.max(0, (score - index + 1) * 100));
}

function ratingStarStyle(score: number, index: number) {
  return { "--rating-star-fill": `${ratingStarFill(score, index)}%` };
}

function activeRatingStarState(index: number) {
  return ratingStarState(activeRatingScore.value, index);
}

function myRatingStarState(index: number) {
  return ratingStarState(myRatingScore.value, index);
}

const collectionRows = computed(() => {
  const collection = detail.value?.collection;
  if (!collection) {
    return [] as Array<{ label: string; value: number; width: number; percent: number; percentLabel: string }>;
  }

  const rows = [
    { label: "想看", value: Number(collection.wish ?? 0) },
    { label: "看过", value: Number(collection.collect ?? 0) },
    { label: "在看", value: Number(collection.doing ?? 0) },
    { label: "搁置", value: Number(collection.on_hold ?? 0) },
    { label: "抛弃", value: Number(collection.dropped ?? 0) },
  ];
  const total = Math.max(
    1,
    rows.reduce((sum, row) => sum + row.value, 0),
  );

  const percents = rows.map((row) => toChartPercent(row.value, total));

  return rows.map((row, i) => ({
    ...row,
    width: collectionDiffEmphasis.value
      ? diffEmphasisWidth(percents[i], percents)
      : row.value > 0 ? Math.max(percents[i], 0.8) : 0,
    percent: percents[i],
    percentLabel: formatChartPercent(percents[i]),
  }));
});

const subjectSupportsEpisodeProgress = computed(() => {
  const type = detail.value?.type;
  return type === SUBJECT_TYPE_ANIME || type === SUBJECT_TYPE_REAL;
});

const subjectSupportsVolumeProgress = computed(() => {
  return detail.value?.type === SUBJECT_TYPE_BOOK;
});

const showBookStats = computed(() => detail.value?.type === SUBJECT_TYPE_BOOK);
const showAnimeStats = computed(() => detail.value?.type === SUBJECT_TYPE_ANIME);
const subjectSupportsRatingComparison = computed(() => detail.value?.type === SUBJECT_TYPE_ANIME);

const canManageEpisodes = computed(() => {
  return userCanEditCollection.value && subjectSupportsEpisodeProgress.value;
});

const groupedEpisodes = computed(() => {
  const groups = new Map<number, Episode[]>();

  for (const episode of episodes.value) {
    const list = groups.get(episode.type) ?? [];
    list.push(episode);
    groups.set(episode.type, list);
  }

  return [0, 1, 2, 3]
    .filter((type) => (groups.get(type)?.length ?? 0) > 0)
    .map((type) => ({
      type,
      label: episodeTypeLabel(type),
      items: groups.get(type) ?? [],
    }));
});

function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.common || "";
}

function detailCover(images?: Record<string, string | undefined>) {
  return images?.large || images?.common || images?.medium || images?.small || "";
}

function commentAvatar(url?: string) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

function parseBangumiUserAvatar(avatar: unknown) {
  if (typeof avatar === "string") {
    return commentAvatar(absoluteBgmUrl(avatar));
  }

  if (!avatar || typeof avatar !== "object") {
    return "";
  }

  const record = avatar as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    return "";
  };

  const nestedAvatar = record.avatar;
  if (nestedAvatar && typeof nestedAvatar === "object") {
    const nested = nestedAvatar as Record<string, unknown>;
    const nestedUrl = ["large", "medium", "small", "common", "grid", "url"]
      .map((key) => nested[key])
      .find((value) => typeof value === "string" && value.trim()) as string | undefined;
    if (nestedUrl) {
      return commentAvatar(absoluteBgmUrl(nestedUrl));
    }
  }

  const picked = pick("large", "medium", "small", "common", "grid", "url");
  return commentAvatar(absoluteBgmUrl(picked));
}

async function loadMyselfProfile() {
  const fallback = sessionStore.session.value?.user ?? null;

  const result = await bangumi.getMe();
  if (!result.ok) {
    currentUserProfile.value = fallback;
    return;
  }

  currentUserProfile.value = result.data;
}

function personCover(images?: Record<string, string | undefined>) {
  return images?.large || images?.medium || images?.small || images?.grid || "";
}

function monoCover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.medium || images?.large || "";
}

function openImagePreview(url: string, title: string) {
  if (!url) {
    return;
  }

  imagePreviewUrl.value = url;
  imagePreviewTitle.value = title;
}

function closeImagePreview() {
  imagePreviewUrl.value = "";
  imagePreviewTitle.value = "";
}

function relationTitle(value?: string) {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : "-";
}

function characterRelationOrder(value?: string) {
  const relation = (value ?? "").trim();

  if (/主角|主役|主人公|主要角色/.test(relation)) {
    return 0;
  }

  if (/配角|次要角色/.test(relation)) {
    return 1;
  }

  if (/客串|客演/.test(relation)) {
    return 2;
  }

  return 3;
}

function staffRelationOrder(value?: string) {
  const relation = (value ?? "").trim();
  const compact = relation.replace(/\s+/g, "");

  if (/原作|原案|漫画原作|小说原作/.test(compact)) {
    return 0;
  }

  if (/(^|[\/／、,，+＋&＆|｜])(?:导演|監督|监督|总导演|总监督)(?=$|[\/／、,，+＋&＆|｜])/.test(compact)) {
    return 1;
  }

  if (/脚本|系列构成/.test(compact)) {
    return 2;
  }

  if (/分镜|絵コンテ/.test(compact)) {
    return 3;
  }

  return 4;
}

function actorNames(character: RelatedCharacter) {
  if (!character.actors?.length) {
    return "";
  }

  return character.actors
    .map((actor) => actor.name)
    .filter((name) => name && name.trim().length > 0)
    .join(" / ");
}

function personTypeLabel(type?: number) {
  if (type === 1) {
    return "个人";
  }

  if (type === 2) {
    return "公司";
  }

  if (type === 3) {
    return "组合";
  }

  return "其他";
}

function personCareerLabel(career: string) {
  const mapping: Record<string, string> = {
    producer: "制作人",
    mangaka: "漫画家",
    artist: "艺术家",
    seiyu: "声优",
    writer: "作家",
    illustrator: "插画家",
    actor: "演员",
  };

  return mapping[career] ?? career;
}

function personBirthLabel(person: PersonDetail) {
  const parts = [person.birth_year, person.birth_mon, person.birth_day].filter((item) => item !== undefined);
  if (parts.length === 0) {
    return "-";
  }

  return parts.join("-");
}

function characterTypeLabel(type?: number) {
  if (type === 1) {
    return "角色";
  }

  if (type === 2) {
    return "机体";
  }

  if (type === 3) {
    return "舰船";
  }

  if (type === 4) {
    return "组织";
  }

  return "其他";
}

function characterBirthLabel(character: CharacterDetail) {
  const parts = [character.birth_year, character.birth_mon, character.birth_day].filter((item) => item !== undefined);
  if (parts.length === 0) {
    return "-";
  }

  return parts.join("-");
}

function subjectTypeLabel(type?: number) {
  switch (type) {
    case 1:
      return "书籍";
    case 2:
      return "动画";
    case 3:
      return "音乐";
    case 4:
      return "游戏";
    case 6:
      return "三次元";
    default:
      return type ? `类型${type}` : "-";
  }
}

function resetPersonDetail() {
  personDetailLoading.value = false;
  personDetailError.value = "";
  personDetail.value = null;
  personCollected.value = null;
}

function resetCharacterDetail() {
  characterDetailLoading.value = false;
  characterDetailError.value = "";
  characterDetail.value = null;
  characterCollected.value = null;
  characterRelatedPersons.value = [];
  characterRelatedPersonsLoading.value = false;
  characterRelatedPersonsVisible.value = 6;
}

async function openPersonDetail(personId: number) {
  if (!personId) {
    return;
  }

  if (detailPage.value !== "person" && detailPage.value !== "character") {
    monoOpenedFromSubject.value = detailOpen.value && detailPage.value === "subject";
  }
  detailOpen.value = true;
  personDetailLoading.value = true;
  detailLoadingProgress.value = 5;
  detailLoadingMessage.value = "正在读取人物详情...";
  personDetailError.value = "";
  personDetail.value = null;
  detailPage.value = "person";
  monoDetailTab.value = "info";
  resetMonoComments();

  await nextTick();
  detailContentRef.value?.scrollTo({ top: 0, behavior: "auto" });

  const result = await bangumi.getPersonDetail(personId);
  if (!result.ok) {
    personDetailError.value = result.error;
    personDetailLoading.value = false;
    return;
  }

  personDetail.value = result.data;
  detailLoadingProgress.value = 100;
  detailLoadingMessage.value = "人物详情加载完成";
  personDetailLoading.value = false;
  if (sessionStore.authenticated.value) {
    const collectionResult = await bangumi.isPersonCollected(personId);
    if (collectionResult.ok) personCollected.value = collectionResult.data;
  }
}

async function openCharacterDetail(characterId: number) {
  if (!characterId) {
    return;
  }

  if (detailPage.value !== "person" && detailPage.value !== "character") {
    monoOpenedFromSubject.value = detailOpen.value && detailPage.value === "subject";
  }
  detailOpen.value = true;
  characterDetailLoading.value = true;
  detailLoadingProgress.value = 5;
  detailLoadingMessage.value = "正在读取角色详情...";
  characterDetailError.value = "";
  characterDetail.value = null;
  detailPage.value = "character";
  monoDetailTab.value = "info";
  resetMonoComments();

  await nextTick();
  detailContentRef.value?.scrollTo({ top: 0, behavior: "auto" });

  const result = await bangumi.getCharacterDetail(characterId);
  if (!result.ok) {
    characterDetailError.value = result.error;
    characterDetailLoading.value = false;
    return;
  }

  characterDetail.value = result.data;
  detailLoadingProgress.value = 70;
  detailLoadingMessage.value = "正在加载角色关联人物...";
  characterDetailLoading.value = false;
  if (sessionStore.authenticated.value) {
    const collectionResult = await bangumi.isCharacterCollected(characterId);
    if (collectionResult.ok) characterCollected.value = collectionResult.data;
  }

  // 加载关联人物
  characterRelatedPersonsLoading.value = true;
  characterRelatedPersons.value = [];
  const personsResult = await bangumi.getCharacterRelatedPersons(characterId);
  if (personsResult.ok) {
    characterRelatedPersons.value = personsResult.data;
  }

  characterRelatedPersonsLoading.value = false;
  detailLoadingProgress.value = 100;
  detailLoadingMessage.value = "角色详情加载完成";
}

async function togglePersonCollection() {
  if (!personDetail.value || personCollectionSaving.value || personCollected.value === null) return;
  const nextCollected = !personCollected.value;
  personCollectionSaving.value = true;
  const result = await bangumi.setPersonCollected(personDetail.value.id, nextCollected);
  personCollectionSaving.value = false;
  if (!result.ok) {
    appStore.showToast(`收藏操作失败：${result.error}`, "error");
    return;
  }
  personCollected.value = nextCollected;
  personDetail.value.stat.collects = Math.max(0, personDetail.value.stat.collects + (nextCollected ? 1 : -1));
  appStore.showToast(nextCollected ? "已收藏人物。" : "已取消收藏人物。", "success");
}

async function toggleCharacterCollection() {
  if (!characterDetail.value || characterCollectionSaving.value || characterCollected.value === null) return;
  const nextCollected = !characterCollected.value;
  characterCollectionSaving.value = true;
  const result = await bangumi.setCharacterCollected(characterDetail.value.id, nextCollected);
  characterCollectionSaving.value = false;
  if (!result.ok) {
    appStore.showToast(`收藏操作失败：${result.error}`, "error");
    return;
  }
  characterCollected.value = nextCollected;
  characterDetail.value.stat.collects = Math.max(0, characterDetail.value.stat.collects + (nextCollected ? 1 : -1));
  appStore.showToast(nextCollected ? "已收藏角色。" : "已取消收藏角色。", "success");
}

function parseSubjectIndexPage(html: string): SubjectIndexOption[] {
  if (!html.trim()) return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  const indexed = new Map<number, SubjectIndexOption>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/index/"]')) {
    const matchedId = link.getAttribute("href")?.match(/\/index\/(\d+)/)?.[1];
    if (!matchedId) continue;
    const id = Number(matchedId);
    const element = link.closest("li, article, .item, .index-item") || link.parentElement;
    if (!element) continue;
    const titleLink = Array.from(element.querySelectorAll<HTMLAnchorElement>(`a[href*="/index/${id}"]`)).find((candidate) => candidate.textContent?.trim());
    const title = titleLink?.textContent?.trim() || link.getAttribute("title")?.trim() || "";
    if (!title) continue;
    const numbers = Array.from(element.querySelectorAll<HTMLElement>(".stats .num, .num")).map((node) => Number(node.textContent?.trim())).filter(Number.isFinite);
    indexed.set(id, { id, title, description: element.querySelector(".desc, .description, .tip_j")?.textContent?.trim() || "", total: numbers.reduce((sum, value) => sum + value, 0) });
  }
  return [...indexed.values()];
}

async function openIndexPicker() {
  detailMoreMenuOpen.value = false;
  if (!sessionStore.authenticated.value || !currentUsername.value || indexPickerLoading.value) return;
  indexPickerOpen.value = true; indexPickerLoading.value = true; indexPickerError.value = ""; indexPickerItems.value = [];
  try {
    const items: SubjectIndexOption[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await bangumi.fetchUserIndicesPage(currentUsername.value, false, page);
      if (!result.ok) { indexPickerError.value = result.error; break; }
      items.push(...parseSubjectIndexPage(result.data));
      const document = new DOMParser().parseFromString(result.data, "text/html");
      const hasNext = Array.from(document.querySelectorAll<HTMLAnchorElement>('.page_inner a[href*="page="]')).some((link) => Number(new URL(link.href, "https://bangumi.tv").searchParams.get("page")) === page + 1);
      if (!hasNext) break;
    }
    indexPickerItems.value = [...new Map(items.map((item) => [item.id, item])).values()];
  } catch (error) { indexPickerError.value = error instanceof Error ? error.message : String(error); }
  finally { indexPickerLoading.value = false; }
}

function closeIndexPicker() { if (indexPickerSavingId.value === null) indexPickerOpen.value = false; }
async function addEntityToPickedIndex(indexId: number) {
  if (indexPickerSavingId.value !== null) return;
  const entityType = detailPage.value === "person" ? "person" : detailPage.value === "character" ? "character" : "subject";
  const entityId = entityType === "subject" ? detail.value?.id : entityType === "person" ? personDetail.value?.id : characterDetail.value?.id;
  if (!entityId) return;

  indexPickerSavingId.value = indexId;
  const result = entityType === "subject"
    ? await bangumi.addSubjectToIndex(indexId, { subject_id: entityId })
    : await bangumi.addIndexEntityViaWeb(indexId, entityType, entityId);
  indexPickerSavingId.value = null;
  if (!result.ok) { appStore.showToast(`加入目录失败：${result.error}`, "error"); return; }
  indexPickerOpen.value = false;
  appStore.showToast(`${entityType === "subject" ? "条目" : entityType === "person" ? "人物" : "角色"}已加入目录。`, "success");
}
function closePersonDetail() {
  if (!monoOpenedFromSubject.value) {
    closeDetail();
    return;
  }
  detailPage.value = "subject";
  monoDetailTab.value = "info";
  resetMonoComments();
}

function closeCharacterDetail() {
  if (!monoOpenedFromSubject.value) {
    closeDetail();
    return;
  }
  detailPage.value = "subject";
  monoDetailTab.value = "info";
  resetMonoComments();
}

function resetSubjectRelations() {
  relatedCharacters.value = [];
  relatedCharactersError.value = "";
  relatedPersons.value = [];
  relatedPersonsError.value = "";
}

function resetSubjectComments() {
  comments.value = [];
  commentError.value = "";
  commentLoading.value = false;
  commentPage.value = 1;
  commentTotalPages.value = 1;
  commentHasNextPage.value = false;
  commentInterestTab.value = "all";
  commentRequestToken += 1;
}

function resetMonoComments() {
  monoAllComments.value = [];
  monoComments.value = [];
  monoCommentError.value = "";
  monoCommentLoading.value = false;
  monoCommentPage.value = 1;
  monoCommentTotalPages.value = 1;
  monoCommentSortOrder.value = "asc";
  monoCommentRequestToken += 1;
}

function refreshMonoCommentsForCurrentPage() {
  const sorted = monoCommentSortOrder.value === "desc"
    ? [...monoAllComments.value].reverse()
    : monoAllComments.value;
  const start = (monoCommentPage.value - 1) * MONO_COMMENT_PAGE_SIZE;
  const end = start + MONO_COMMENT_PAGE_SIZE;
  monoComments.value = sorted.slice(start, end);
}

function setMonoCommentSortOrder(order: "asc" | "desc") {
  if (monoCommentSortOrder.value === order) {
    return;
  }

  monoCommentSortOrder.value = order;
  monoCommentPage.value = 1;
  refreshMonoCommentsForCurrentPage();
}

function parsePageNumberFromHref(href: string) {
  const match = href.match(/[?&]page=(\d+)/i);
  if (!match) {
    return 0;
  }

  return Number(match[1] ?? 0);
}

function absoluteBgmUrl(value?: string | null) {
  const url = (value ?? "").trim();
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    return `https://bangumi.tv${url}`;
  }

  return url;
}

function parseBackgroundImageUrl(styleText: string) {
  const match = styleText.match(/background-image\s*:\s*url\((['\"]?)(.*?)\1\)/i);
  return match?.[2] ?? "";
}

function extractCommentTextLines(container: ParentNode) {
  const textCandidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      ".reply_content, .message, .text_main, .comment, .item .text, p",
    ),
  )
    .map((el) => (el.textContent ?? "").trim())
    .filter((value) => value.length > 0);

  const normalized = textCandidates
    .filter((line) => !/^@\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(line))
    .filter((line) => !/^(想看|在看|看过|抛弃|搁置)$/.test(line))
    .filter((line) => !/^匿名用户$/.test(line));

  return normalized;
}

function extractTimeFromText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  const fullMatch = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/);
  if (fullMatch?.[1]) {
    return fullMatch[1];
  }

  const shortMatch = text.match(/(\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }

  return "";
}

function extractCommentTimeText(node: Element, rawTimeText: string) {
  const normalizedRaw = rawTimeText.replace(/^@\s*/, "").replace(/\s+/g, " ").trim();
  if (normalizedRaw) {
    return normalizedRaw;
  }

  const metaCandidates = [
    node.querySelector(".text p")?.textContent ?? "",
    node.querySelector(".text .tip")?.textContent ?? "",
    node.querySelector(".title .tip")?.textContent ?? "",
    node.querySelector("small")?.textContent ?? "",
  ];

  for (const candidate of metaCandidates) {
    const extracted = extractTimeFromText(candidate);
    if (extracted) {
      return extracted;
    }
  }

  const fromAllText = extractTimeFromText(node.textContent ?? "");
  if (fromAllText) {
    return fromAllText;
  }

  return "";
}

function parseSubjectCommentsHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const commentNodes = doc.querySelectorAll(
    "#comment_box > .item, #comment_box .item.clearit, #comment_list > .item, #comment_list .item.clearit, .comment_box > .item, #comment_list > .row_reply, #comment_list .row_reply, .comment-list .row_reply, .commentList .row_reply",
  );
  const items: Array<{
    id: string;
    userName: string;
    userLink: string;
    avatar: string;
    interestText: string;
    timeText: string;
    contentText: string;
  }> = [];

  commentNodes.forEach((node, index) => {
    const userAnchor = (node.querySelector(".text a.l")
      || node.querySelector("a.l[href*='/user/']")
      || node.querySelector("a[href*='/user/']")) as HTMLAnchorElement | null;

    const avatarImg = node.querySelector(".avatar img, img.avatar") as HTMLImageElement | null;
    const avatarSpan = node.querySelector(".avatar span[style*='background-image'], .avatarNeue[style*='background-image']") as HTMLElement | null;
    const interestNode = node.querySelector(".tip_j") as HTMLElement | null;
    const timeNode = node.querySelector("small.grey, .time") as HTMLElement | null;

    const textHost = (node.querySelector(".text") as HTMLElement | null) ?? node;
    const candidateLines = extractCommentTextLines(textHost);
    const userName = (userAnchor?.textContent ?? "匿名用户").trim() || "匿名用户";
    const interestText = (interestNode?.textContent ?? "").trim();
    const timeText = formatReadableDateTime(
      extractCommentTimeText(node, timeNode?.textContent ?? ""),
      { fallback: "" },
    );

    const filteredLines = candidateLines
      .filter((line) => line !== userName)
      .filter((line) => line !== interestText)
      .filter((line) => line !== timeText)
      .filter((line) => !line.includes(" · "));

    const contentText = (filteredLines[filteredLines.length - 1] ?? "").trim();
    if (!contentText) {
      return;
    }

    const avatarFromImg = avatarImg?.getAttribute("src")
      || avatarImg?.getAttribute("data-src")
      || avatarImg?.getAttribute("data-original")
      || "";
    const avatarFromStyle = avatarSpan ? parseBackgroundImageUrl(avatarSpan.getAttribute("style") ?? "") : "";

    items.push({
      id: node.id || `comment-${index + 1}`,
      userName,
      userLink: absoluteBgmUrl(userAnchor?.getAttribute("href")),
      avatar: commentAvatar(absoluteBgmUrl(avatarFromImg || avatarFromStyle)),
      interestText,
      timeText,
      contentText,
    });
  });

  const pageLinks = Array.from(doc.querySelectorAll(".page_inner a, .page_inner strong, .p a"));
  let maxPage = 1;
  for (const link of pageLinks) {
    if (link instanceof HTMLAnchorElement) {
      const num = parsePageNumberFromHref(link.getAttribute("href") ?? "");
      if (num > maxPage) {
        maxPage = num;
      }
    } else {
      const asNum = Number((link.textContent ?? "").trim());
      if (Number.isFinite(asNum) && asNum > maxPage) {
        maxPage = asNum;
      }
    }
  }

  const hasNext = !!doc.querySelector(".page_inner .p_cur + a, .page_inner .next, .p a.next")
    || /下一页|››|»/i.test((doc.querySelector(".page_inner, .p")?.textContent ?? ""));

  return {
    items,
    totalPages: Math.max(maxPage, 1),
    hasNext,
  };
}

async function loadSubjectComments() {
  if (!detail.value || detailPage.value !== "subject" || detailTab.value !== "review") {
    return;
  }

  const requestToken = commentRequestToken + 1;
  commentRequestToken = requestToken;
  commentLoading.value = true;
  commentError.value = "";

  const interestType = commentInterestTab.value === "all" ? undefined : commentInterestTab.value;
  const result = await bangumi.fetchSubjectCommentsPage(detail.value.id, interestType, commentPage.value);

  if (requestToken !== commentRequestToken) {
    return;
  }

  if (!result.ok) {
    commentError.value = result.error;
    commentLoading.value = false;
    comments.value = [];
    return;
  }

  const parsed = parseSubjectCommentsHtml(result.data);
  comments.value = parsed.items;
  commentTotalPages.value = parsed.totalPages;
  commentHasNextPage.value = parsed.hasNext;
  commentLoading.value = false;
}

function currentMonoCommentTarget(): { monoType: MonoType; monoId: number } | null {
  if (detailPage.value === "character") {
    const monoId = Number(characterDetail.value?.id ?? 0);
    if (monoId > 0) {
      return { monoType: "character", monoId };
    }
  }

  if (detailPage.value === "person") {
    const monoId = Number(personDetail.value?.id ?? 0);
    if (monoId > 0) {
      return { monoType: "person", monoId };
    }
  }

  return null;
}

const canPrevMonoCommentPage = computed(() => monoCommentPage.value > 1);
const canNextMonoCommentPage = computed(() => {
  return monoCommentPage.value < monoCommentTotalPages.value;
});

async function loadMonoComments() {
  if (monoDetailTab.value !== "review") {
    return;
  }

  const target = currentMonoCommentTarget();
  if (!target) {
    return;
  }

  const requestToken = monoCommentRequestToken + 1;
  monoCommentRequestToken = requestToken;
  monoCommentLoading.value = true;
  monoCommentError.value = "";

  const result = await bangumi.fetchMonoCommentsPage(target.monoType, target.monoId, 1);

  if (requestToken !== monoCommentRequestToken) {
    return;
  }

  if (!result.ok) {
    monoCommentError.value = result.error;
    monoCommentLoading.value = false;
    monoComments.value = [];
    return;
  }

  const parsed = parseSubjectCommentsHtml(result.data);
  monoAllComments.value = parsed.items;
  monoCommentTotalPages.value = Math.max(
    1,
    Math.ceil(monoAllComments.value.length / MONO_COMMENT_PAGE_SIZE),
  );
  monoCommentPage.value = 1;
  refreshMonoCommentsForCurrentPage();
  monoCommentLoading.value = false;
}

async function prevMonoCommentPage() {
  if (!canPrevMonoCommentPage.value) {
    return;
  }

  monoCommentPage.value -= 1;
  refreshMonoCommentsForCurrentPage();
  await scrollCommentBoxToTop(characterCommentBoxRef);
}

async function nextMonoCommentPage() {
  if (!canNextMonoCommentPage.value) {
    return;
  }

  monoCommentPage.value += 1;
  refreshMonoCommentsForCurrentPage();
  await scrollCommentBoxToTop(characterCommentBoxRef);
}

function setCommentInterestTab(tab: "all" | SubjectCommentInterestType) {
  if (commentInterestTab.value === tab) {
    return;
  }

  commentInterestTab.value = tab;
  commentPage.value = 1;
  void loadSubjectComments();
}

async function prevCommentPage() {
  if (!canPrevCommentPage.value) {
    return;
  }

  commentPage.value -= 1;
  await loadSubjectComments();
  await scrollCommentBoxToTop(subjectCommentBoxRef);
}

async function nextCommentPage() {
  if (!canNextCommentPage.value) {
    return;
  }

  commentPage.value += 1;
  await loadSubjectComments();
  await scrollCommentBoxToTop(subjectCommentBoxRef);
}

async function loadSubjectRelations(subjectId: number) {
  resetSubjectRelations();

  const [charactersResult, personsResult] = await Promise.all([
    bangumi.getSubjectRelatedCharacters(subjectId),
    bangumi.getSubjectRelatedPersons(subjectId),
  ]);

  if (charactersResult.ok) {
    relatedCharacters.value = [...(charactersResult.data ?? [])].sort((a, b) => {
      const diff = characterRelationOrder(a.relation) - characterRelationOrder(b.relation);
      if (diff !== 0) {
        return diff;
      }

      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
  } else {
    relatedCharactersError.value = charactersResult.error;
  }

  if (personsResult.ok) {
    relatedPersons.value = [...(personsResult.data ?? [])].sort((a, b) => {
      const diff = staffRelationOrder(a.relation) - staffRelationOrder(b.relation);
      if (diff !== 0) {
        return diff;
      }

      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
  } else {
    relatedPersonsError.value = personsResult.error;
  }
}

function isNsfwSuppressed() {
  if (localStorage.getItem(NSFW_SUPPRESS_FOREVER_KEY) === "1") {
    return true;
  }

  const until = Number(localStorage.getItem(NSFW_SUPPRESS_UNTIL_KEY) ?? "0");
  return Number.isFinite(until) && until > Date.now();
}

function setNsfwSuppressForever() {
  localStorage.setItem(NSFW_SUPPRESS_FOREVER_KEY, "1");
  localStorage.removeItem(NSFW_SUPPRESS_UNTIL_KEY);
}

function setNsfwSuppress24h() {
  const next = Date.now() + 24 * 60 * 60 * 1000;
  localStorage.setItem(NSFW_SUPPRESS_UNTIL_KEY, String(next));
}

function parseTagsInput(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isCollectionNotFound(error: string) {
  return /(404|not found|未收藏|不存在)/i.test(error);
}

function collectionFromSnapshot(snapshot: SubjectCollection | null, subjectId: number): UserSubjectCollection | null {
  if (!snapshot) {
    return null;
  }

  return {
    subject_id: subjectId,
    subject_type: snapshot.subject?.type ?? 2,
    rate: snapshot.rate ?? 0,
    type: snapshot.type ?? 0,
    comment: snapshot.comment,
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: snapshot.updated_at ?? "",
    private: snapshot.private ?? false,
  };
}

function fillCollectionForm(collection: UserSubjectCollection | null) {
  form.type = collection?.type ?? 0;
  savedCollectionType.value = form.type;
  form.rate = collection?.rate ?? 0;
  form.ep_status = collection?.ep_status ?? 0;
  form.vol_status = collection?.vol_status ?? 0;
  form.private = collection?.private ?? false;
  form.comment = collection?.comment ?? "";
  form.tagsInput = (collection?.tags ?? []).join(", ");
  collectionUpdatedAt.value = collection?.updated_at ?? "";
}

async function loadUserCollection(subjectId: number) {
  collectionLoading.value = true;
  collectionError.value = "";
  collectionSavedMessage.value = "";

  const fallback = collectionFromSnapshot(selectedCollectionSnapshot.value, subjectId);

  const result = await bangumi.getCurrentUserSubjectCollection(subjectId);

  if (!result.ok) {
    if (isCollectionNotFound(result.error)) {
      fillCollectionForm(fallback);
      collectionLoading.value = false;
      return;
    }

    collectionError.value = result.error;
    fillCollectionForm(fallback);
    collectionLoading.value = false;
    return;
  }

  fillCollectionForm(result.data);
  collectionLoading.value = false;
}

function episodeStatusLabel(type: number) {
  if (type === 1) {
    return "想看";
  }

  if (type === 2) {
    return "看过";
  }

  if (type === 3) {
    return "抛弃";
  }

  return "未收藏";
}

function episodeTypeLabel(type: number) {
  return EPISODE_TYPE_LABEL[type] ?? `类型 ${type}`;
}

function episodeTypeShort(type: number) {
  return EPISODE_TYPE_SHORT[type] ?? `T${type}`;
}

function episodeTypeClass(type: number) {
  if (type === 0) {
    return "is-main";
  }

  if (type === 1) {
    return "is-sp";
  }

  if (type === 2) {
    return "is-op";
  }

  if (type === 3) {
    return "is-ed";
  }

  return "is-other";
}

function episodeStatusClass(type: number) {
  if (type === 1) {
    return "is-wish";
  }

  if (type === 2) {
    return "is-done";
  }

  if (type === 3) {
    return "is-dropped";
  }

  return "is-none";
}

function episodeDisplayIndex(episode: Episode) {
  if (episode.type === 0) {
    return String(episode.ep ?? episode.sort ?? "-");
  }

  return String(episode.sort ?? "-");
}

function updateEpisodePopoverPlacement(episodeId: number, target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const popover = target.querySelector<HTMLElement>(".episode-popover");
  const popoverWidth = popover?.offsetWidth || 240;
  const popoverHeight = popover?.offsetHeight || 170;
  const gap = 8;
  const padding = 8;

  let horizontal: "left" | "center" | "right" = "center";
  const centeredLeft = rect.left + rect.width / 2 - popoverWidth / 2;
  const centeredRight = rect.left + rect.width / 2 + popoverWidth / 2;
  if (centeredLeft < padding) {
    horizontal = "left";
  } else if (centeredRight > window.innerWidth - padding) {
    horizontal = "right";
  }

  const titlebarOffset = 56;
  const upTop = rect.top - gap - popoverHeight;
  const vertical: "up" | "down" = upTop < titlebarOffset + padding ? "down" : "up";

  episodePopoverPlacement.value = {
    ...episodePopoverPlacement.value,
    [episodeId]: { horizontal, vertical },
  };
}

function onEpisodeHover(episodeId: number, event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  updateEpisodePopoverPlacement(episodeId, target);
}

function episodePopoverPlacementClass(episodeId: number) {
  const placement = episodePopoverPlacement.value[episodeId] ?? {
    horizontal: "center" as const,
    vertical: "up" as const,
  };

  return {
    "popover-left": placement.horizontal === "left",
    "popover-right": placement.horizontal === "right",
    "popover-down": placement.vertical === "down",
  };
}

function getEpisodeCollectionNotFound(error: string) {
  return /(404|not found|未收藏|不存在|subject not collected)/i.test(error);
}

function episodeStatusType(episodeId: number) {
  return episodeTypeById.value[episodeId] ?? 0;
}

async function loadEpisodesForDetail(subjectId: number) {
  episodes.value = [];
  episodeTypeById.value = {};
  episodeError.value = "";
  episodeLoading.value = false;

  if (!canManageEpisodes.value) {
    return;
  }

  episodeLoading.value = true;

  try {
    const [episodeResult, userEpisodeResult] = await Promise.all([
      bangumi.getEpisodesBySubject(subjectId, { limit: 200, offset: 0 }),
      bangumi.getCurrentUserSubjectEpisodeCollections(subjectId, {
        limit: 1000,
        offset: 0,
      }),
    ]);

    if (!episodeResult.ok) {
      episodeError.value = episodeResult.error;
      return;
    }

    episodes.value = [...episodeResult.data.data].sort((a, b) => {
      return Number(a.sort ?? 0) - Number(b.sort ?? 0);
    });

    if (userEpisodeResult.ok) {
      const mapping: Record<number, number> = {};
      for (const item of userEpisodeResult.data.data) {
        if (item.episode?.id) {
          mapping[item.episode.id] = Number(item.type ?? 0);
        }
      }

      episodeTypeById.value = mapping;
    } else if (!getEpisodeCollectionNotFound(userEpisodeResult.error)) {
      episodeError.value = userEpisodeResult.error;
    }
  } catch (error) {
    episodeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    episodeLoading.value = false;
  }
}

async function updateEpisodeStatus(episodeId: number, nextType: number) {
  if (!detail.value) {
    return;
  }

  const previousType = episodeStatusType(episodeId);
  episodeTypeById.value = {
    ...episodeTypeById.value,
    [episodeId]: nextType,
  };
  episodeSavingId.value = episodeId;
  episodeError.value = "";

  const result = await bangumi.updateCurrentUserEpisodeCollection(episodeId, nextType);
  if (!result.ok) {
    episodeTypeById.value = {
      ...episodeTypeById.value,
      [episodeId]: previousType,
    };
    episodeError.value = result.error;
    episodeSavingId.value = null;
    return;
  }

  if (subjectSupportsEpisodeProgress.value) {
    form.ep_status = Object.values(episodeTypeById.value).filter((type) => type === 2).length;
  }
  episodeSavingId.value = null;
  // 通知看板娘
  appStore.collectionSaveSuccessCounter.value++;
}

async function loadSubjectDetail(subjectId: number, prefetchedDetail?: SubjectDetail) {
  detailLoading.value = true;
  detailLoadingProgress.value = prefetchedDetail ? 25 : 5;
  detailLoadingMessage.value = prefetchedDetail ? "正在准备关联数据..." : "正在读取条目详情...";
  detailError.value = "";
  detail.value = prefetchedDetail ?? null;
  overallOpinionOpen.value = false;
  overallOpinionSnapshot.value = null;
  resetSubjectRelations();
  resetSubjectComments();
  resetPersonDetail();
  resetCharacterDetail();
  detailPage.value = "subject";
  detailTab.value = "info";
  showDetailBackToTop.value = false;

  await nextTick();
  detailContentRef.value?.scrollTo({ top: 0, behavior: "auto" });

  if (!prefetchedDetail) {
    const detailResult = await bangumi.getSubjectDetail(subjectId);

    if (!detailResult.ok) {
      detailError.value = detailResult.error;
      detailLoading.value = false;
      return;
    }

    detail.value = detailResult.data;
    detailLoadingProgress.value = 25;
    detailLoadingMessage.value = "正在加载关联数据...";
  }

  // 同步当前详情的 NSFW 状态到 store
  appStore.currentDetailNsfw.value = detail.value?.nsfw ?? false;

  const tasks: Array<Promise<unknown>> = [loadSubjectRelations(subjectId), loadEpisodesForDetail(subjectId)];

  if (userCanEditCollection.value) {
    tasks.push(loadUserCollection(subjectId));
  } else {
    fillCollectionForm(null);
    collectionError.value = "";
    collectionSavedMessage.value = "";
  }

  let completedTasks = 0;
  await Promise.all(tasks.map(async (task) => {
    await task;
    completedTasks += 1;
    detailLoadingProgress.value = 25 + Math.round((completedTasks / tasks.length) * 75);
    detailLoadingMessage.value = completedTasks === tasks.length ? "详情加载完成" : `正在加载详情数据（${completedTasks}/${tasks.length}）...`;
  }));

  detailLoading.value = false;

  // Trigger Tenrai broadcast match for anime subjects
  if (detail.value?.type === 2) {
    triggerTenraiMatch(detail.value.id, detail.value.name, detail.value.date, detail.value.images);
  }

  // Background, non-blocking multi-platform rating comparison fetch
  ratingCompareEntries.value = {};
  ratingCompareErrors.value = {};
  ratingCompareModalVisible.value = false;
  ratingViewMode.value = "bangumi";
  ratingCompareProgress.value = { completed: 0, total: 0 };
  if (detail.value && subjectSupportsRatingComparison.value && ratingComparisonConfig.enabled) {
    void triggerRatingComparison(detail.value.id, detail.value.name, detail.value.name_cn, detail.value.date, detail.value.eps);
  }
}

const ratingCompareEntries = ref<Partial<Record<ExternalPlatformId, PlatformRatingEntry | null>>>({});
const ratingCompareErrors = ref<Partial<Record<ExternalPlatformId, string>>>({});
const ratingCompareModalVisible = ref(false);
const ratingCompareLoading = ref(false);
const ratingCompareProgress = ref({ completed: 0, total: 0 });
const ratingViewMode = ref<"bangumi" | "aggregate">("bangumi");

async function triggerRatingComparison(bgmId: number, bgmName: string, bgmNameCn?: string, bgmAirDate?: string, bgmEpisodes?: number) {
  ratingCompareLoading.value = true;
  ratingCompareProgress.value = { completed: 0, total: ratingComparisonConfig.platforms.length };
  try {
    const cacheItem = await fetchRatingComparison(
      bgmId,
      bgmName,
      bgmNameCn,
      bgmAirDate,
      bgmEpisodes,
      (completed, total) => {
        if (detail.value?.id === bgmId) ratingCompareProgress.value = { completed, total };
      },
    );
    // Guard against the user having navigated to a different subject while this was in flight
    if (detail.value?.id === bgmId) {
      ratingCompareEntries.value = cacheItem.entries;
      ratingCompareErrors.value = cacheItem.errors;
      if (
        !ratingComparisonConfig.disableAutoSwitchToAggregate
        && Object.values(cacheItem.entries).some((entry) => !!entry)
      ) {
        ratingViewMode.value = "aggregate";
      }
    }
  } finally {
    if (detail.value?.id === bgmId) {
      ratingCompareLoading.value = false;
    }
  }
}

const ratingCompareResult = computed(() =>
  computeRatingWeights(detailRatingScore.value, ratingCompareEntries.value, ratingComparisonConfig.smartWeight),
);

const hasAggregateRating = computed(
  () => subjectSupportsRatingComparison.value
    && ratingComparisonConfig.enabled
    && Object.values(ratingCompareEntries.value).some((entry) => !!entry),
);

const activeRatingMode = computed(() =>
  ratingViewMode.value === "aggregate" && hasAggregateRating.value ? "aggregate" : "bangumi",
);
const activeRatingScore = computed(() =>
  activeRatingMode.value === "aggregate" ? ratingCompareResult.value.aggregateScore : detailRatingScore.value,
);
const activeRatingScoreText = computed(() => detailRatingScoreLabel(activeRatingScore.value));
const ratingScoreRollDirection = ref<"up" | "down">("up");
watch(activeRatingScore, (next, previous) => {
  if (next !== previous && next > 0 && previous > 0) {
    ratingScoreRollDirection.value = next >= previous ? "up" : "down";
  }
});
const activeRatingLabel = computed(() => activeRatingMode.value === "aggregate" ? "综合评分" : "Bangumi 评分");
const showAggregateRating = computed(() => activeRatingMode.value === "aggregate");

const showRatingCompareLoading = computed(
  () => subjectSupportsRatingComparison.value
    && ratingComparisonConfig.enabled
    && ratingCompareLoading.value
    && !showAggregateRating.value,
);
const ratingCompareProgressLabel = computed(() => {
  const { completed, total } = ratingCompareProgress.value;
  return total > 0 ? `正在获取其他平台评分（${completed}/${total}）…` : "正在获取其他平台评分…";
});
const ratingDifferenceLabel = computed(() => {
  if (!showAggregateRating.value || detailRatingScore.value <= 0 || ratingCompareResult.value.aggregateScore <= 0) return "不变";
  const difference = ratingCompareResult.value.aggregateScore - detailRatingScore.value;
  if (Math.abs(difference) < 0.005) return "不变";
  return `${difference > 0 ? "↑" : "↓"} ${Math.abs(difference).toFixed(2)}`;
});

watch(hasAggregateRating, (available) => {
  if (!available) ratingViewMode.value = "bangumi";
});

// Re-fetch if the user enables the feature (or adds platforms) while a subject is already open,
// so they don't need to reopen the subject page for the change to take effect.
watch(
  () => [ratingComparisonConfig.enabled, ratingComparisonConfig.platforms.join(",")],
  () => {
    if (detail.value && subjectSupportsRatingComparison.value && ratingComparisonConfig.enabled) {
      void triggerRatingComparison(detail.value.id, detail.value.name, detail.value.name_cn, detail.value.date, detail.value.eps);
    }
  },
);

async function triggerTenraiMatch(bgmId: number, bgmName: string, bgmAirDate?: string, bgmImages?: Record<string, string | undefined>) {
  // Respect global disable, user suppression, and time mismatch
  if (localStorage.getItem("bangumi.broadcast.disabled") === "1" || isSuppressed(bgmId) || isTimeMismatch()) {
    TenraiMatchLoading.value = false;
    TenraiMatchRefreshing.value = false;
    TenraiMatch.value = null;
    TenraiMatchError.value = "";
    return;
  }

  TenraiMatchLoading.value = true;
  TenraiMatchError.value = "";
  TenraiMatch.value = null;

  // Check cache first
  const cached = getCachedMatch(bgmId);
  const currentSource = localStorage.getItem("bangumi.broadcast.detailSource") || "tenrai";
  if (cached) {
    // Always re-fetch detail data on every page entry
    TenraiMatchRefreshing.value = true;
    const fresh = await fetchMalAnimeFull(cached.malId);
    TenraiMatchRefreshing.value = false;
    if (fresh) {
      TenraiMatch.value = { ...cached, data: fresh, cachedAt: Date.now(), detailFetchedAt: Date.now(), detailSource: currentSource };
      setManualMatch(bgmId, { ...cached, data: fresh, cachedAt: Date.now(), detailFetchedAt: Date.now(), detailSource: currentSource });
    } else {
      // Fetch failed — show cached data as fallback
      TenraiMatch.value = cached;
    }
    TenraiMatchLoading.value = false;
    return;
  }

  const match = await matchAnimeToTenrai(bgmId, bgmName, bgmAirDate, detail.value?.eps, bgmImages);
  if (match) {
    TenraiMatch.value = match;
    TenraiMatchError.value = "";

    // Prompt for manual confirmation if match is uncertain
    if (shouldConfirmMatch(match)) {
      TenraiConfirmDialog.visible = true;
    }
  } else {
    TenraiMatchError.value = "auto-fail";
  }
  TenraiMatchLoading.value = false;
}

function handleConfirmTenraiMatch() {
  const bgmId = detail.value?.id;
  if (!bgmId) return;
  confirmBgmId(bgmId);
  TenraiConfirmDialog.visible = false;
}

function handleSuppressTenraiForSubject() {
  const bgmId = detail.value?.id;
  if (!bgmId) return;
  suppressBgmId(bgmId);
  TenraiMatch.value = null;
  TenraiMatchLoading.value = false;
  TenraiMatchError.value = "";
  TenraiConfirmDialog.visible = false;
}

function handleEnableTenraiForSubject() {
  const bgmId = detail.value?.id;
  if (!bgmId) return;
  unsuppressBgmId(bgmId);
  // Re-trigger matching for this subject
  if (detail.value?.type === 2) {
    triggerTenraiMatch(bgmId, detail.value.name, detail.value.date, detail.value.images);
  }
}

// ── Broadcast notify follow/unfollow ──

const { notifyEnabled: broadcastNotifyEnabled } = useBroadcastNotify();

function handleToggleBroadcastFollow() {
  const bgmId = detail.value?.id;
  if (!bgmId) return;
  if (isFollowed(bgmId)) {
    unfollowSubject(bgmId);
  } else {
    const nameCn = detail.value?.name_cn || detail.value?.name || `Subject #${bgmId}`;
    const nameOriginal = detail.value?.name || "";
    const malId = TenraiMatch.value?.malId ?? 0;
    if (!TenraiMatch.value?.data || malId <= 0) {
      return;
    }
    const images = detail.value?.images;
    const coverUrl = images?.common || images?.medium || images?.large || images?.small;
    followSubject(bgmId, nameCn, nameOriginal, malId, coverUrl);
  }
  detailMoreMenuOpen.value = false;
}

function closeDetail() {
  const wasNsfw = appStore.currentDetailNsfw.value;
  detailOpen.value = false;
  showDetailBackToTop.value = false;
  appStore.detailBackToTopVisible.value = false;
  appStore.currentDetailNsfw.value = false;
  TenraiMatch.value = null;
  TenraiMatchLoading.value = false;
  TenraiMatchError.value = "";
  detailMoreMenuOpen.value = false;
  TenraiViewMatchDialog.visible = false;
  TenraiConfirmDialog.visible = false;
  closeImagePreview();
  resetPersonDetail();
  resetCharacterDetail();
  resetMonoComments();
  monoDetailTab.value = "info";
  detailPage.value = "subject";
  monoOpenedFromSubject.value = false;
  // 退出 NSFW 详情 → 触发看板娘对话
  if (wasNsfw) {
    appStore.nsfwExitTriggerCounter.value++;
  }
  emit("detailClosed");
}

watch([detailTab, detailPage, () => detail.value?.id], () => {
  if (detailTab.value !== "review" || detailPage.value !== "subject" || !detail.value?.id) {
    return;
  }

  void loadSubjectComments();

  if (sessionStore.authenticated.value) {
    void loadMyselfProfile();
  }
});

watch([monoDetailTab, detailPage, () => personDetail.value?.id, () => characterDetail.value?.id], () => {
  if (monoDetailTab.value !== "review") {
    return;
  }

  if (detailPage.value !== "person" && detailPage.value !== "character") {
    return;
  }

  monoCommentPage.value = 1;
  void loadMonoComments();
});

async function scrollCommentBoxToTop(commentBoxRef: typeof subjectCommentBoxRef) {
  await nextTick();

  const container = detailContentRef.value;
  const commentBox = commentBoxRef.value;
  if (!container || !commentBox) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const commentBoxRect = commentBox.getBoundingClientRect();
  const top = container.scrollTop + commentBoxRect.top - containerRect.top;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}
function onDetailScroll(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  showDetailBackToTop.value = target.scrollTop > 280;
}

// 同步「回到顶部」按钮可见性到 store，供 Live2D 看板娘避让
watch(showDetailBackToTop, (v) => {
  appStore.detailBackToTopVisible.value = v;
});

watch(detailOpen, (v) => {
  appStore.detailDrawerOpen.value = v;
});

function scrollDetailToTop() {
  detailContentRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

async function openDetail(collection: SubjectCollection) {
  const subjectId = collection.subject_id ?? 0;
  if (!subjectId) {
    return;
  }

  selectedCollectionSnapshot.value = collection;
  preDetailLoading.value = true;

  const detailResult = await bangumi.getSubjectDetail(subjectId);
  preDetailLoading.value = false;

  if (!detailResult.ok) {
    detailOpen.value = true;
    detailError.value = detailResult.error;
    detail.value = null;
    detailLoading.value = false;
    return;
  }

  if (detailResult.data.nsfw && !isNsfwSuppressed()) {
    nsfwDialog.visible = true;
    nsfwDialog.pendingSubjectId = subjectId;
    pendingNsfwDetail.value = detailResult.data;
    appStore.nsfwWarningVisible.value = true;
    return;
  }

  detailOpen.value = true;
  await loadSubjectDetail(subjectId, detailResult.data);
}

async function openDetailBySubjectId(subjectId: number) {
  if (!subjectId) {
    return;
  }

  await openDetail({ subject_id: subjectId });
}

async function continueNsfw(mode: "once" | "forever" | "24h") {
  const pendingSubjectId = nsfwDialog.pendingSubjectId;
  const prefetchedDetail = pendingNsfwDetail.value;
  nsfwDialog.visible = false;
  nsfwDialog.pendingSubjectId = null;
  pendingNsfwDetail.value = null;
  appStore.nsfwWarningVisible.value = false;

  if (!pendingSubjectId) {
    return;
  }

  if (mode === "forever") {
    setNsfwSuppressForever();
  } else if (mode === "24h") {
    setNsfwSuppress24h();
  }

  detailOpen.value = true;
  await loadSubjectDetail(pendingSubjectId, prefetchedDetail ?? undefined);
}

function cancelNsfw() {
  nsfwDialog.visible = false;
  nsfwDialog.pendingSubjectId = null;
  pendingNsfwDetail.value = null;
  appStore.nsfwWarningVisible.value = false;
  emit("detailClosed");
}

async function saveCollectionStatus() {
  if (!detail.value) {
    return;
  }

  collectionSaving.value = true;
  collectionError.value = "";
  collectionSavedMessage.value = "";

  const payload: Record<string, unknown> = {
    type: form.type,
    rate: form.rate,
    private: form.private,
    comment: form.comment.trim() || undefined,
    tags: parseTagsInput(form.tagsInput),
  };

  // Bangumi API only accepts ep_status / vol_status for book subjects.
  // For anime / real, ep_status is auto-computed from per-episode collection status.
  if (detail.value?.type === SUBJECT_TYPE_BOOK) {
    payload.vol_status = form.vol_status;
    payload.ep_status = form.ep_status;
  }

  const subjectId = detail.value.id;
  const shouldMarkAllEpisodesSeen =
    appStore.autoMarkEpisodesSeen.value &&
    subjectSupportsEpisodeProgress.value &&
    savedCollectionType.value !== 2 &&
    form.type === 2;
  const result = await bangumi.updateCurrentUserSubjectCollection(subjectId, payload);

  if (!result.ok) {
    collectionError.value = result.error;
    collectionSaving.value = false;
    return;
  }

  savedCollectionType.value = form.type;
  form.rate = payload.rate;

  if (shouldMarkAllEpisodesSeen) {
    if (episodes.value.length === 0 && !episodeLoading.value) {
      await loadEpisodesForDetail(subjectId);
    }

    const episodesToMark = episodes.value.filter((episode) => episodeStatusType(episode.id) !== 2);
    const results: Array<{
      episode: Episode;
      result: Awaited<ReturnType<typeof bangumi.updateCurrentUserEpisodeCollection>>;
    }> = [];
    const batchSize = 6;
    for (let offset = 0; offset < episodesToMark.length; offset += batchSize) {
      const batch = episodesToMark.slice(offset, offset + batchSize);
      results.push(...await Promise.all(
        batch.map(async (episode) => ({
          episode,
          result: await bangumi.updateCurrentUserEpisodeCollection(episode.id, 2),
        })),
      ));
    }
    const failed = results.filter(({ result: episodeResult }) => !episodeResult.ok);
    const nextTypes = { ...episodeTypeById.value };
    for (const { episode, result: episodeResult } of results) {
      if (episodeResult.ok) {
        nextTypes[episode.id] = 2;
      }
    }
    episodeTypeById.value = nextTypes;
    form.ep_status = Object.values(nextTypes).filter((type) => type === 2).length;

    if (failed.length > 0) {
      collectionSavedMessage.value = `收藏状态已更新；${failed.length} 集同步失败。`;
      episodeError.value = `${failed.length} 集未能标记为「看过」，请稍后重试。`;
    } else {
      collectionSavedMessage.value = `收藏状态已更新，已将 ${episodesToMark.length} 集标记为「看过」。`;
    }
  } else {
    collectionSavedMessage.value = "收藏状态已更新。";
  }

  collectionSaving.value = false;
  // 通知看板娘
  appStore.collectionSaveSuccessCounter.value++;
}

function formatInfoboxValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        const valueItem = item as { k?: unknown; v?: unknown };
        const v = typeof valueItem.v === "string" ? valueItem.v : "";
        const k = typeof valueItem.k === "string" ? valueItem.k : "";

        if (!v) {
          return "";
        }

        return k ? `${k}: ${v}` : v;
      })
      .filter((item) => item.length > 0)
      .join(" / ");
  }

  return String(value ?? "");
}

defineExpose({
  openDetailBySubjectId,
  openPersonDetail,
  openCharacterDetail,
});
</script>

<template>
  <section v-if="appStore.error.value" class="empty">加载失败：{{ appStore.error.value }}</section>
  <section v-else-if="!sessionStore.authenticated.value" class="empty">
    请先完成 Bangumi 登录。
  </section>
  <section v-else-if="appStore.loading.value" class="list">
    <article v-for="n in 5" :key="n" class="item is-loading">
      <div></div>
      <span></span>
    </article>
  </section>
  <section v-else class="collection-groups">
    <section class="filter-tabs">
      <div class="filter-tabs__group" role="tablist" aria-label="按条目类别筛选">
        <button
          v-for="tab in subjectTypeTabs"
          :key="`subject-${tab.key}`"
          class="filter-tab"
          :class="{ 'is-active': selectedSubjectType === tab.key }"
          type="button"
          @click="selectedSubjectType = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="filter-tabs__group" role="tablist" aria-label="按收藏状态筛选">
        <button
          v-for="tab in collectionTypeTabs"
          :key="`collection-${tab.key}`"
          class="filter-tab"
          :class="{ 'is-active': selectedCollectionType === tab.key }"
          type="button"
          @click="selectedCollectionType = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </section>

    <section v-if="groupedCollections.length === 0" class="empty">
      {{ hasActiveFilter ? "当前筛选下暂无收藏条目。" : "暂无收藏条目。" }}
    </section>

    <article v-for="subjectGroup in groupedCollections" :key="subjectGroup.key" class="subject-group">
      <header class="subject-group__header">
        <h2>{{ subjectGroup.label }}</h2>
        <span>{{ subjectGroup.total }} 条</span>
      </header>

      <section v-for="block in subjectGroup.blocks" :key="block.key" class="collection-block">
        <h3>{{ block.label }} · {{ block.items.length }}</h3>
        <div class="list">
          <button
            v-for="collection in block.items"
            :key="collection.subject_id ?? collection.updated_at ?? collection.comment"
            class="item item--button"
            type="button"
            @click="openDetail(collection)"
          >
            <div class="cover">
              <img v-if="cover(collection.subject?.images)" :src="cover(collection.subject?.images)" alt="" loading="lazy" />
              <span v-else>BG</span>
            </div>
            <div class="item__main">
              <h2 :class="{
                'broadcast-followed': broadcastMarkerColored && isFollowed(collection.subject_id ?? 0),
                'is-wish': wishMarkerColored && collection.type === 1,
                'is-collected': collectedMarkerColored && collection.type === 2,
                'is-watching': watchingMarkerColored && collection.type === 3,
                'is-onhold': onholdMarkerColored && collection.type === 4,
                'is-dropped': droppedMarkerColored && collection.type === 5,
              }">
                {{ preferredSubjectTitle(collection.subject?.name, collection.subject?.name_cn, `Subject #${collection.subject_id ?? ""}`) }}
                <svg v-if="broadcastMarkerActive && isFollowed(collection.subject_id ?? 0)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
                <svg v-if="wishMarkerActive && collection.type === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
                <svg v-if="collectedMarkerActive && collection.type === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
                <svg v-if="watchingMarkerActive && collection.type === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
                <svg v-if="onholdMarkerActive && collection.type === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
                <svg v-if="droppedMarkerActive && collection.type === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
              </h2>
            </div>
          </button>
        </div>
      </section>
    </article>
  </section>

  <div v-if="preDetailLoading" class="detail-loading-overlay" role="status" aria-live="polite">
    <div class="detail-loading-card">
      <span class="spinner" aria-hidden="true"></span>
      <p>正在获取条目详情...</p>
    </div>
  </div>

  <div v-if="nsfwDialog.visible" class="overlay" role="dialog" aria-modal="true" aria-label="NSFW 提示">
    <section class="modal">
      <h3>NSFW 内容提醒</h3>
      <p>这个条目被标记为 NSFW，继续前请确认你希望查看相关内容。</p>
      <div class="modal__actions">
        <button class="secondary-button" type="button" @click="cancelNsfw">返回</button>
        <button class="secondary-button" type="button" @click="continueNsfw('once')">继续访问</button>
        <button class="secondary-button" type="button" @click="continueNsfw('24h')">24h 内不再提示并继续</button>
        <button class="primary-button" type="button" @click="continueNsfw('forever')">此后不再提示并继续</button>
      </div>
    </section>
  </div>

  <!-- Tenrai manual match dialog -->
  <div v-if="TenraiManualDialog.visible" class="overlay" role="dialog" aria-modal="true" aria-label="匹配 Tenrai 词条" @click.self="closeTenraiManualDialog">
    <section class="modal Tenrai-match-dialog">
      <div class="Tenrai-match-dialog__header">
        <h3>匹配 MAL 词条</h3>
        <button class="secondary-button" type="button" @click="closeTenraiManualDialog">✕</button>
      </div>

      <p class="Tenrai-match-dialog__hint">
        通过匹配 MyAnimeList 词条获取配信时间等额外信息。
        <template v-if="TenraiMatch?.malId">当前匹配：MAL #{{ TenraiMatch.malId }}</template>
      </p>

      <!-- Search bar -->
      <form class="Tenrai-match-dialog__search" @submit.prevent="searchTenraiManual">
        <input
          v-model="TenraiManualDialog.query"
          class="onboarding__input"
          type="search"
          placeholder="输入英文/日文名搜索..."
          :disabled="TenraiManualDialog.searching || TenraiManualDialog.confirming"
        />
        <button
          class="primary-button"
          type="submit"
          :disabled="TenraiManualDialog.searching || TenraiManualDialog.confirming || !TenraiManualDialog.query.trim()"
        >
          {{ TenraiManualDialog.searching ? "搜索中..." : "搜索" }}
        </button>
      </form>

      <!-- MAL ID direct lookup -->
      <form class="Tenrai-match-dialog__search" @submit.prevent="lookupByMalId">
        <input
          v-model="TenraiManualDialog.malIdInput"
          class="onboarding__input"
          type="text"
          inputmode="numeric"
          placeholder="或直接输入 MAL 编号..."
          :disabled="TenraiManualDialog.malIdLoading || TenraiManualDialog.confirming"
        />
        <button
          class="secondary-button"
          type="submit"
          :disabled="TenraiManualDialog.malIdLoading || TenraiManualDialog.confirming || !TenraiManualDialog.malIdInput.trim()"
        >
          {{ TenraiManualDialog.malIdLoading ? "查询中..." : "查询" }}
        </button>
      </form>

      <p v-if="TenraiManualDialog.error" class="onboarding__error">{{ TenraiManualDialog.error }}</p>

      <!-- Results list -->
      <div v-if="TenraiManualDialog.results.length > 0" class="Tenrai-match-dialog__results">
        <button
          v-for="item in TenraiManualDialog.results"
          :key="item.mal_id"
          class="item item--button Tenrai-match-dialog__candidate"
          :class="{ 'is-selected': TenraiManualDialog.selectedMalId === item.mal_id }"
          type="button"
          :disabled="TenraiManualDialog.confirming"
          @click="selectTenraiCandidate(item.mal_id)"
        >
          <div class="cover">
            <img
              v-if="item.images?.jpg?.image_url"
              :src="item.images.jpg.image_url"
              alt=""
              loading="lazy"
            />
            <span v-else>MAL</span>
          </div>
          <div class="item__main">
            <h2>{{ item.title }}</h2>
            <p>
              <template v-if="item.title_english && item.title_english !== item.title">{{ item.title_english }} · </template>
              {{ item.type ?? "-" }}
              <template v-if="item.episodes"> · {{ item.episodes }}集</template>
              <template v-if="item.status"> · {{ item.status }}</template>
            </p>
            <p class="search-item__meta">
              MAL #{{ item.mal_id }}
              <template v-if="item.aired?.prop?.from?.year"> · {{ item.aired.prop.from.year }}</template>
              <template v-if="item.score"> · 评分 {{ item.score }}</template>
            </p>
          </div>
        </button>
      </div>

      <!-- Empty -->
      <p v-else-if="!TenraiManualDialog.searching && !TenraiManualDialog.error && TenraiManualDialog.query" class="schedule__empty">
        无搜索结果。
      </p>

      <!-- Actions -->
      <div class="modal__actions">
        <button class="secondary-button" type="button" @click="closeTenraiManualDialog">取消</button>
        <button
          class="primary-button"
          type="button"
          :disabled="!TenraiManualDialog.selectedMalId || TenraiManualDialog.confirming"
          @click="confirmTenraiManualMatch"
        >
          {{ TenraiManualDialog.confirming ? "保存中..." : "确认匹配" }}
        </button>
      </div>
    </section>
  </div>

  <!-- View matched MAL entry dialog -->
  <div v-if="TenraiViewMatchDialog.visible" class="overlay" role="dialog" aria-modal="true" aria-label="已匹配的 MAL 条目" @click.self="TenraiViewMatchDialog.visible = false">
    <section class="modal Tenrai-match-dialog">
      <div class="Tenrai-match-dialog__header">
        <h3>已匹配的 MAL 条目</h3>
        <button class="secondary-button" type="button" @click="TenraiViewMatchDialog.visible = false">✕</button>
      </div>

      <template v-if="TenraiMatch">
        <div class="Tenrai-view-match__info">
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">MAL ID</span>
            <a
              class="Tenrai-view-match__value Tenrai-view-match__link"
              :href="'https://myanimelist.net/anime/' + TenraiMatch.malId"
              target="_blank"
              rel="noopener noreferrer"
            >
              #{{ TenraiMatch.malId }} ↗
            </a>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">标题</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.title ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">英文标题</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.title_english ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">类型</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.type ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">状态</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.status ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">集数</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.episodes ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">放送时间</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.broadcast?.string ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">时长</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.duration ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">评分</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.data?.score ?? '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">匹配缓存时间</span>
            <span class="Tenrai-view-match__value">{{ new Date(TenraiMatch.cachedAt).toLocaleString('zh-CN') }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">详细数据更新</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.detailFetchedAt ? new Date(TenraiMatch.detailFetchedAt).toLocaleString('zh-CN') : '-' }}</span>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">详细数据来源</span>
            <span class="Tenrai-view-match__value">{{ TenraiMatch.detailSource === 'mal' ? 'MAL 官网爬取' : 'Tenrai API' }}</span>
          </div>
        </div>
      </template>
      <p v-else class="schedule__empty">暂无已匹配的 MAL 条目。</p>

      <div class="modal__actions">
        <button class="secondary-button" type="button" @click="TenraiViewMatchDialog.visible = false">关闭</button>
      </div>
    </section>
  </div>

  <!-- Confirm auto-match dialog -->
  <div v-if="TenraiConfirmDialog.visible" class="overlay" role="dialog" aria-modal="true" aria-label="确认自动匹配" @click.self="TenraiConfirmDialog.visible = false">
    <section class="modal Tenrai-match-dialog">
      <div class="Tenrai-match-dialog__header">
        <h3>请仔细确认！</h3>
        <button class="secondary-button" type="button" @click="TenraiConfirmDialog.visible = false">✕</button>
      </div>

      <p class="onboarding__description">
        自动匹配结果不确定，请确认以下匹配是否正确。
      </p>

      <template v-if="TenraiMatch">
        <div class="Tenrai-view-match__info">
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">BGM 条目</span>
            <a
              class="Tenrai-view-match__value Tenrai-view-match__link"
              :href="'https://bgm.tv/subject/' + (detail?.id ?? '')"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ detail?.name_cn || detail?.name || '-' }} ↗
            </a>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">匹配 MAL</span>
            <a
              class="Tenrai-view-match__value Tenrai-view-match__link"
              :href="'https://myanimelist.net/anime/' + TenraiMatch.malId"
              target="_blank"
              rel="noopener noreferrer"
            >
              #{{ TenraiMatch.malId }} — {{ TenraiMatch.data?.title ?? '-' }} ↗
            </a>
          </div>
          <div class="Tenrai-view-match__row">
            <span class="Tenrai-view-match__label">总得分</span>
            <span class="Tenrai-view-match__value">
              <strong>{{ TenraiMatch.candidates?.[0]?.score?.total ?? '-' }} 分</strong>
              <template v-if="TenraiMatch.candidates && TenraiMatch.candidates.length > 1">
                （#2: {{ TenraiMatch.candidates[1].score.total }} 分）
              </template>
            </span>
          </div>
        </div>
      </template>

      <div class="modal__actions">
        <button class="secondary-button" type="button" @click="TenraiConfirmDialog.visible = false">关闭</button>
        <button class="secondary-button" type="button" @click="handleSuppressTenraiForSubject()">此番剧关闭此功能</button>
        <button class="secondary-button" type="button" @click="TenraiConfirmDialog.visible = false; openTenraiManualDialog()">手动匹配</button>
        <button class="primary-button" type="button" @click="handleConfirmTenraiMatch()">确认匹配</button>
      </div>
    </section>
  </div>

  <Transition name="preview-zoom">
    <div
      v-if="imagePreviewVisible"
      class="image-preview-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="imagePreviewTitle || '图片预览'"
      @click.self="closeImagePreview"
    >
      <button class="secondary-button image-preview-overlay__close" type="button" @click="closeImagePreview">关闭</button>
      <img class="image-preview-overlay__image" :src="imagePreviewUrl" :alt="imagePreviewTitle || '图片预览'" />
    </div>
  </Transition>

  <Transition name="index-picker">
    <div v-if="indexPickerOpen" class="index-picker-overlay" role="dialog" aria-modal="true" aria-label="加入目录" @click.self="closeIndexPicker">
      <section class="index-picker-card">
        <header class="index-picker-card__header"><div><h3>加入目录</h3></div><button class="secondary-button" type="button" @click="closeIndexPicker">关闭</button></header>
        <p class="detail-muted">选择一个你创建的目录，将当前条目加入其中。</p>
        <div v-if="indexPickerLoading" class="index-picker-state"><span class="spinner" aria-hidden="true"></span>正在读取目录...</div>
        <p v-else-if="indexPickerError" class="onboarding__error">目录加载失败：{{ indexPickerError }}</p>
        <div v-else-if="indexPickerItems.length" class="index-picker-list"><button v-for="item in indexPickerItems" :key="item.id" class="index-picker-item" type="button" :disabled="indexPickerSavingId !== null" @click="addEntityToPickedIndex(item.id)"><span><strong>{{ item.title }}</strong><small>{{ item.total }} 个条目<span v-if="item.description"> · {{ item.description }}</span></small></span><span class="index-picker-item__action">{{ indexPickerSavingId === item.id ? "加入中..." : "加入" }}</span></button></div>
        <p v-else class="empty">暂无可用目录，请先在“收藏 → 目录”中创建。</p>
      </section>
    </div>
  </Transition>
  <Transition name="drawer">
    <div v-if="detailOpen" class="drawer-backdrop">
      <div class="drawer-overlay" @click="closeDetail"></div>
      <aside class="detail-drawer" :class="{ 'detail-drawer--opinion-open': overallOpinionOpen, 'detail-drawer--opinion-enabled': overallOpinionAvailable }" role="dialog" aria-modal="true" aria-label="条目详情">
    <header class="detail-drawer__header">
      <h2 :class="{
        'broadcast-followed': detailPage === 'subject' && appStore.broadcastMarker.parent.value && !appStore.markerIconOnly.value && isFollowed(detail?.id ?? 0),
        'is-wish': detailPage === 'subject' && appStore.wishMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 1,
        'is-collected': detailPage === 'subject' && appStore.collectedMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 2,
        'is-watching': detailPage === 'subject' && appStore.watchingMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 3,
        'is-onhold': detailPage === 'subject' && appStore.onholdMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 4,
        'is-dropped': detailPage === 'subject' && appStore.droppedMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 5,
      }">
        {{ detailTitle || "条目详情" }}
        <svg v-if="detailPage === 'subject' && appStore.broadcastMarker.parent.value && isFollowed(detail?.id ?? 0)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
        <svg v-if="detailPage === 'subject' && appStore.wishMarker.parent.value && !collectionLoading && form.type === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
        <svg v-if="detailPage === 'subject' && appStore.collectedMarker.parent.value && !collectionLoading && form.type === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
        <svg v-if="detailPage === 'subject' && appStore.watchingMarker.parent.value && !collectionLoading && form.type === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
        <svg v-if="detailPage === 'subject' && appStore.onholdMarker.parent.value && !collectionLoading && form.type === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
        <svg v-if="detailPage === 'subject' && appStore.droppedMarker.parent.value && !collectionLoading && form.type === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
      </h2>
      <div class="detail-drawer__header-actions">
        <!-- Tenrai match error indicator -->
        <button
          v-if="detailPage === 'subject' && detail?.type === 2 && TenraiMatchError === 'auto-fail' && !TenraiMatchLoading"
          class="detail-drawer__match-warning detail-drawer__match-warning--action"
          type="button"
          title="自动匹配失败，点击手动匹配"
          @click="openTenraiManualDialog()"
        >未匹配</button>
        <div ref="detailMoreMenuRef" class="detail-more-menu" :class="{ 'is-open': detailMoreMenuOpen }">
          <button
            class="secondary-button detail-more-menu__trigger"
            type="button"
            title="更多操作"
            @click.stop="detailMoreMenuOpen = !detailMoreMenuOpen"
          >
            …
          </button>
          <Transition name="detail-menu"><div v-if="detailMoreMenuOpen" class="detail-more-menu__dropdown">
            <button v-if="sessionStore.authenticated.value && ['subject', 'person', 'character'].includes(detailPage)" class="detail-more-menu__item" type="button" @click="openIndexPicker">加入目录</button>
            <template v-if="detailPage === 'subject' && detail?.type === 2">
              <button
                class="detail-more-menu__item"
                type="button"
                @click="openTenraiManualDialog()"
              >
                匹配 MAL 词条
              </button>
              <button
                v-if="TenraiMatch"
                class="detail-more-menu__item"
                type="button"
                @click="detailMoreMenuOpen = false; TenraiViewMatchDialog.visible = true"
              >
                查看已匹配的 MAL 条目
              </button>
              <button
                class="detail-more-menu__item"
                type="button"
                @click="detailMoreMenuOpen = false; isSuppressed(detail.id) ? handleEnableTenraiForSubject() : handleSuppressTenraiForSubject()"
              >
                {{ isSuppressed(detail.id) ? '为此番剧开启配信跟踪' : '为此番剧关闭配信跟踪' }}
              </button>
              <button
                v-if="broadcastNotifyEnabled && TenraiMatch?.data && TenraiMatch.malId > 0"
                class="detail-more-menu__item"
                type="button"
                @click="handleToggleBroadcastFollow()"
              >
                {{ isFollowed(detail.id) ? '取消关注配信情况' : '关注配信情况' }}
              </button>
            </template>
            <span v-else-if="!['subject', 'person', 'character'].includes(detailPage)" class="detail-more-menu__empty">此条目无可用选项。</span>
          </div></Transition>
        </div>
        <button class="secondary-button" type="button" @click="closeDetail">关闭</button>
      </div>
    </header>

    <section v-if="detailLoading || personDetailLoading || characterDetailLoading" class="detail-loading-state" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <div class="detail-loading-progress">
        <div class="detail-loading-progress__label"><span>{{ detailLoadingMessage }}</span><strong>{{ detailLoadingProgress }}%</strong></div>
        <div class="detail-loading-progress__track"><div class="detail-loading-progress__bar" :style="{ width: `${detailLoadingProgress}%` }" /></div>
      </div>
    </section>
    <section v-else-if="detailError" class="empty">详情加载失败：{{ detailError }}</section>
    <section v-else-if="personDetailError" class="empty">人物详情加载失败：{{ personDetailError }}</section>
    <section v-else-if="characterDetailError" class="empty">角色详情加载失败：{{ characterDetailError }}</section>
    <section v-else-if="detail || detailPage !== 'subject'" ref="detailContentRef" class="detail-content" @scroll.passive="onDetailScroll">
      <article v-if="detailPage === 'subject'" class="detail-hero">
        <div class="detail-hero__cover">
          <img
            v-if="detailCover(detail.images)"
            class="zoomable-cover"
            :src="detailCover(detail.images)"
            alt=""
            loading="lazy"
            @click="openImagePreview(detailCover(detail.images), preferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`))"
          />
          <span v-else>BG</span>
        </div>
        <div class="detail-hero__titles">
          <h3 :class="{
            'broadcast-followed': appStore.broadcastMarker.parent.value && !appStore.markerIconOnly.value && isFollowed(detail.id ?? 0),
            'is-wish': appStore.wishMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 1,
            'is-collected': appStore.collectedMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 2,
            'is-watching': appStore.watchingMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 3,
            'is-onhold': appStore.onholdMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 4,
            'is-dropped': appStore.droppedMarker.parent.value && !appStore.markerIconOnly.value && !collectionLoading && form.type === 5,
          }">
            {{ preferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}
            <svg v-if="appStore.broadcastMarker.parent.value && isFollowed(detail.id ?? 0)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
            <svg v-if="appStore.wishMarker.parent.value && !collectionLoading && form.type === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
            <svg v-if="appStore.collectedMarker.parent.value && !collectionLoading && form.type === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
            <svg v-if="appStore.watchingMarker.parent.value && !collectionLoading && form.type === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
            <svg v-if="appStore.onholdMarker.parent.value && !collectionLoading && form.type === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
            <svg v-if="appStore.droppedMarker.parent.value && !collectionLoading && form.type === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
          </h3>
          <p>{{ notpreferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}</p>
        </div>
      </article>

      <!-- Time mismatch warning (disables broadcast tracking) -->
      <div v-if="detailPage === 'subject' && detail?.type === 2 && isTimeMismatch()" class="broadcast-banner broadcast--not-aired">
        <svg class="broadcast-banner__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true">
          <path d="M432 423.8C471.1 391.5 496 342.7 496 288C496 190.8 417.2 112 320 112C222.8 112 144 190.8 144 288C144 342.7 168.9 391.5 208 423.8C208.4 441.4 211.2 464.2 214.4 485.6C144 447.9 96 373.5 96 288C96 164.3 196.3 64 320 64C443.7 64 544 164.3 544 288C544 373.6 496 447.9 425.5 485.6C428.8 464.2 431.5 441.4 431.9 423.8zM418 370.4C409.7 357.8 398.8 348.8 387.6 342.6C385.5 341.5 383.4 340.4 381.3 339.4C393 325.5 400.1 307.5 400.1 287.9C400.1 243.7 364.3 207.9 320.1 207.9C275.9 207.9 240.1 243.7 240.1 287.9C240.1 307.5 247.2 325.5 258.9 339.4C256.8 340.4 254.7 341.4 252.6 342.6C241.4 348.8 230.5 357.8 222.2 370.4C203.4 348.1 192.1 319.4 192.1 288C192.1 217.3 249.4 160 320.1 160C390.8 160 448.1 217.3 448.1 288C448.1 319.4 436.8 348.2 418 370.4zM320 376C352.9 376 384 384.6 384 419.8C384 452.8 371.1 523.9 363.4 552.7C358.3 571.7 338.9 576.1 320 576.1C301.1 576.1 281.8 571.7 276.6 552.7C268.8 524.2 256 453 256 419.9C256 384.8 287.1 376.1 320 376.1zM320 248C342.1 248 360 265.9 360 288C360 310.1 342.1 328 320 328C297.9 328 280 310.1 280 288C280 265.9 297.9 248 320 248z"/>
        </svg>
        <div class="broadcast-banner__text">
          <p class="broadcast-banner__title">机器时间有误！</p>
          <p class="broadcast-banner__sub">请检查你的机器时间，随后重启应用。配信跟踪已禁用。</p>
        </div>
      </div>

      <BroadcastProgress
        v-if="detailPage === 'subject' && detail?.type === 2 && TenraiMatchError !== 'auto-fail' && !isTimeMismatch()"
        :Tenrai-data="TenraiMatch?.data ?? null"
        :loading="TenraiMatchLoading"
        :refreshing="TenraiMatchRefreshing"
      />

      <!-- Auto-match failed prompt -->
      <div v-if="detailPage === 'subject' && detail?.type === 2 && TenraiMatchError === 'auto-fail' && !isTimeMismatch()" class="broadcast-banner broadcast--not-aired">
        <svg class="broadcast-banner__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true">
          <path d="M432 423.8C471.1 391.5 496 342.7 496 288C496 190.8 417.2 112 320 112C222.8 112 144 190.8 144 288C144 342.7 168.9 391.5 208 423.8C208.4 441.4 211.2 464.2 214.4 485.6C144 447.9 96 373.5 96 288C96 164.3 196.3 64 320 64C443.7 64 544 164.3 544 288C544 373.6 496 447.9 425.5 485.6C428.8 464.2 431.5 441.4 431.9 423.8zM418 370.4C409.7 357.8 398.8 348.8 387.6 342.6C385.5 341.5 383.4 340.4 381.3 339.4C393 325.5 400.1 307.5 400.1 287.9C400.1 243.7 364.3 207.9 320.1 207.9C275.9 207.9 240.1 243.7 240.1 287.9C240.1 307.5 247.2 325.5 258.9 339.4C256.8 340.4 254.7 341.4 252.6 342.6C241.4 348.8 230.5 357.8 222.2 370.4C203.4 348.1 192.1 319.4 192.1 288C192.1 217.3 249.4 160 320.1 160C390.8 160 448.1 217.3 448.1 288C448.1 319.4 436.8 348.2 418 370.4zM320 376C352.9 376 384 384.6 384 419.8C384 452.8 371.1 523.9 363.4 552.7C358.3 571.7 338.9 576.1 320 576.1C301.1 576.1 281.8 571.7 276.6 552.7C268.8 524.2 256 453 256 419.9C256 384.8 287.1 376.1 320 376.1zM320 248C342.1 248 360 265.9 360 288C360 310.1 342.1 328 320 328C297.9 328 280 310.1 280 288C280 265.9 297.9 248 320 248z"/>
        </svg>
        <div class="broadcast-banner__text">
          <p class="broadcast-banner__title">自动匹配失败</p>
          <p class="broadcast-banner__sub">无法自动匹配 MAL 配信信息。</p>
        </div>
        <div class="broadcast-banner__actions">
          <button class="secondary-button" type="button" @click="isSuppressed(detail.id) ? handleEnableTenraiForSubject() : handleSuppressTenraiForSubject()">{{ isSuppressed(detail.id) ? '为此番剧开启' : '为此番剧关闭' }}</button>
          <button class="secondary-button" type="button" @click="openTenraiManualDialog()">手动匹配</button>
        </div>
      </div>

      <section v-if="detailPage === 'subject'" ref="detailTabsRef" class="detail-tabs" role="tablist" aria-label="详情分类">
        <button
          ref="detailTabInfoRef"
          class="detail-tabs__tab"
          :class="{ 'is-active': detailTab === 'info' }"
          type="button"
          role="tab"
          :aria-selected="detailTab === 'info'"
          aria-controls="detail-panel-info"
          @click="detailTab = 'info'"
        >
          信息
        </button>
        <button
          ref="detailTabReviewRef"
          class="detail-tabs__tab"
          :class="{ 'is-active': detailTab === 'review' }"
          type="button"
          role="tab"
          :aria-selected="detailTab === 'review'"
          aria-controls="detail-panel-review"
          @click="detailTab = 'review'"
        >
          评价
        </button>
        <button
          ref="detailTabMyRef"
          class="detail-tabs__tab"
          :class="{ 'is-active': detailTab === 'my' }"
          type="button"
          role="tab"
          :aria-selected="detailTab === 'my'"
          aria-controls="detail-panel-my"
          @click="detailTab = 'my'"
        >
          我的
        </button>
        <div class="detail-tabs__indicator" :style="detailTabIndicatorStyle" />
      </section>

      <template v-if="detailPage === 'subject' && detailTab === 'info'">
        <article id="detail-panel-info" class="detail-section" role="tabpanel">
          <h4>简介</h4>
          <BbcodeSummary :content="detail.summary" />
        </article>

        <article class="detail-section">
          <h4>角色</h4>
          <p v-if="relatedCharactersError" class="onboarding__error">{{ relatedCharactersError }}</p>
          <div v-else-if="relatedCharacters.length > 0" class="relation-list">
            <article
              v-for="character in relatedCharacters"
              :key="`character-${character.id}-${character.relation}`"
              class="relation-item relation-item--button"
              role="button"
              tabindex="0"
              @click="openCharacterDetail(character.id)"
              @keydown.enter.prevent="openCharacterDetail(character.id)"
              @keydown.space.prevent="openCharacterDetail(character.id)"
            >
              <div class="relation-item__cover">
                <img v-if="monoCover(character.images)" :src="monoCover(character.images)" alt="" loading="lazy" />
                <span v-else>BG</span>
              </div>
              <div class="relation-item__main">
                <h5>{{ character.name || `Character #${character.id}` }}</h5>
                <p class="detail-muted">关系：{{ relationTitle(character.relation) }}</p>
                <div v-if="character.actors?.length" class="relation-actors">
                  <button
                    v-for="actor in character.actors"
                    :key="`actor-${character.id}-${actor.id}`"
                    class="relation-actor-chip"
                    type="button"
                    @click.stop="openPersonDetail(actor.id)"
                  >
                    CV: {{ actor.name }}
                  </button>
                </div>
                <p v-else-if="actorNames(character)" class="detail-muted">声优：{{ actorNames(character) }}</p>
              </div>
            </article>
          </div>
          <p v-else class="detail-muted">暂无相关角色。</p>
        </article>

        <article class="detail-section">
          <h4>Staff</h4>
          <p v-if="relatedPersonsError" class="onboarding__error">{{ relatedPersonsError }}</p>
          <div v-else-if="relatedPersons.length > 0" class="relation-list">
            <article
              v-for="person in relatedPersons"
              :key="`person-${person.id}-${person.relation}-${person.eps}`"
              class="relation-item relation-item--button"
              role="button"
              tabindex="0"
              @click="openPersonDetail(person.id)"
              @keydown.enter.prevent="openPersonDetail(person.id)"
              @keydown.space.prevent="openPersonDetail(person.id)"
            >
              <div class="relation-item__cover">
                <img v-if="monoCover(person.images)" :src="monoCover(person.images)" alt="" loading="lazy" />
                <span v-else>BG</span>
              </div>
              <div class="relation-item__main">
                <h5>{{ person.name || `Person #${person.id}` }}</h5>
                <p class="detail-muted">关系：{{ relationTitle(person.relation) }}</p>
                <p v-if="person.eps" class="detail-muted">参与：{{ person.eps }}</p>
                <p v-if="person.career?.length" class="detail-muted">职业：{{ person.career.join(" / ") }}</p>
              </div>
            </article>
          </div>
          <p v-else class="detail-muted">暂无相关 staff。</p>
        </article>

        <article class="detail-section">
          <h4>其他详细信息</h4>
          <dl class="detail-grid">
            <div><dt>ID</dt><dd>{{ detail.id }}</dd></div>
            <div><dt>类型</dt><dd>{{ SUBJECT_TYPE_LABEL[detail.type] || detail.type }}</dd></div>
            <div><dt>系列条目</dt><dd>{{ detail.series ? "是" : "否" }}</dd></div>
            <div><dt>NSFW</dt><dd>{{ detail.nsfw ? "是" : "否" }}</dd></div>
            <div><dt>锁定</dt><dd>{{ detail.locked ? "是" : "否" }}</dd></div>
            <div><dt>日期</dt><dd>{{ formatReadableDateTime(detail.date) }}</dd></div>
            <div><dt>平台</dt><dd>{{ detail.platform || "-" }}</dd></div>
            <div v-if="showBookStats"><dt>册数</dt><dd>{{ detail.volumes }}</dd></div>
            <div v-if="showBookStats"><dt>总章节数</dt><dd>{{ detail.total_episodes }}</dd></div>
            <div v-if="showAnimeStats"><dt>话数</dt><dd>{{ detail.eps }}</dd></div>
          </dl>

          <div class="tags-row">
            <h5>Tags</h5>
            <div class="tags-strip" v-if="detail.tags.length > 0">
              <span v-for="tag in detail.tags" :key="`${tag.name}-${tag.count}`" class="tag-chip">{{ tag.name }} · {{ tag.count }}</span>
            </div>
            <p v-else class="detail-muted">暂无 tags</p>
          </div>

          <div class="tags-row">
            <h5>Meta Tags</h5>
            <div class="tags-strip" v-if="detail.meta_tags.length > 0">
              <span v-for="tag in detail.meta_tags" :key="tag" class="tag-chip tag-chip--meta">{{ tag }}</span>
            </div>
            <p v-else class="detail-muted">暂无 meta tags</p>
          </div>

          <div class="infobox" v-if="detail.infobox?.length">
            <h5>Infobox</h5>
            <dl>
              <div v-for="item in detail.infobox" :key="item.key">
                <dt>{{ item.key }}</dt>
                <dd>{{ formatInfoboxValue(item.value) }}</dd>
              </div>
            </dl>
          </div>
        </article>
      </template>

      <template v-if="detailPage === 'subject' && detailTab === 'review'">
        <article class="detail-section">
          <div v-if="overallOpinionAvailable" class="overall-opinion overall-opinion--review">
            <button
              type="button"
              class="overall-opinion__orb"
              :class="[`is-${overallOpinionStatus}`, { 'is-dragging': overallOpinionOrbDrag, 'is-open': overallOpinionOpen, 'is-changing': overallOpinionFaceChanging }]"
              :style="overallOpinionOrbStyle()"
              :aria-expanded="overallOpinionOpen"
              aria-controls="overall-opinion-panel"
              aria-label="打开作品总体看法"
              @pointerdown="startOverallOpinionOrbDrag"
              @pointermove="moveOverallOpinionOrb"
              @pointerup="endOverallOpinionOrbDrag"
              @pointercancel="endOverallOpinionOrbDrag"
              @click="handleOverallOpinionOrbClick"
            >
              <span class="overall-opinion__face" aria-hidden="true">
                <span class="overall-opinion__face-eyes"><i></i><i></i></span>
                <span class="overall-opinion__face-mouth"></span>
              </span>
            </button>
            <Transition name="overall-opinion-panel">
            <section v-if="overallOpinionOpen" id="overall-opinion-panel" class="overall-opinion__panel" :class="`is-${overallOpinionStatus}`" :style="overallOpinionOrbStyle()" aria-live="polite" :aria-busy="overallOpinionWaitingForBroadcast">
              <div class="overall-opinion__panel-head">
                <div class="overall-opinion__panel-topline">
                  <span class="overall-opinion__eyebrow">实验室 · 综合解读</span>
                  <div class="overall-opinion__panel-actions">
                    <button v-if="!overallOpinionWaitingForBroadcast" type="button" class="overall-opinion__copy" :aria-label="overallOpinionCopied ? '已复制综合报告' : '复制综合报告'" :title="overallOpinionCopied ? '已复制' : '复制综合报告'" @click="copyOverallOpinion">
                      <span aria-hidden="true">{{ overallOpinionCopied ? '✓' : '⧉' }}</span><span>{{ overallOpinionCopied ? '已复制' : '复制报告' }}</span>
                    </button>
                    <button type="button" class="overall-opinion__close" aria-label="关闭总体看法" @click="overallOpinionOpen = false">×</button>
                  </div>
                </div>
                <h5 v-if="overallOpinionWaitingForBroadcast">正在准备综合评价</h5>
                <h5 v-else :title="overallOpinionAnalysis.title">
                  <span class="overall-opinion__title-subject">{{ overallOpinionTitleParts.subject }}</span><span>{{ overallOpinionTitleParts.lead }}</span><span v-if="overallOpinionTitleParts.emphasis" class="overall-opinion__title-emphasis" :class="`is-${overallOpinionTitleParts.tone}`">{{ overallOpinionTitleParts.emphasis }}</span><span>{{ overallOpinionTitleParts.suffix }}</span>
                </h5>
              </div>
              <template v-if="overallOpinionWaitingForBroadcast">
                <p>报告正在等待配信跟踪返回更多信息，完成后将自动生成。</p>
                <small>正在核对作品的开播状态，以避免基于不完整信息给出评价。</small>
              </template>
              <template v-else>
                <p>{{ overallOpinionCompactSummary }}</p>
                <div class="overall-opinion__recommendation" aria-label="客观数据推荐值">
                  <div class="overall-opinion__recommendation-metric">
                    <span>{{ overallOpinionRecommendationLabel }}</span>
                    <strong class="overall-opinion__recommendation-value">{{ overallOpinionRecommendationText }}</strong>
                  </div>
                  <div class="overall-opinion__recommendation-metric">
                    <span>Achievement Rank</span>
                    <strong class="overall-opinion__recommendation-rank" :class="overallOpinionAchievementRankClass">{{ overallOpinionAchievementRankText }}</strong>
                  </div>
                </div>
                <div v-if="overallOpinionAdvice" class="overall-opinion__advice">
                  <strong>{{ overallOpinionAdvice.label }}</strong>
                  <p>{{ overallOpinionAdvice.text }}</p>
                </div>
                <details class="overall-opinion__evidence">
                  <summary>分析依据</summary>
                  <div class="overall-opinion__evidence-body">
                    <p v-if="overallOpinionCompactSummary !== overallOpinionAnalysis.summary">{{ overallOpinionAnalysis.summary }}</p>
                    <small>{{ overallOpinionAnalysis.detail }}；{{ overallOpinionRecommendationBasis }}</small>
                    <div class="overall-opinion__sections">
                      <div v-for="section in overallOpinionEvidenceSections" :key="section.label" class="overall-opinion__section">
                        <strong>{{ section.label }}</strong>
                        <p>{{ section.text }}</p>
                      </div>
                    </div>
                  </div>
                </details>
              </template>
            </section>
            </Transition>
          </div>
          <div class="rating-overview">
            <div class="rating-overview__left">
              <div class="rating-overview__header">
                <p class="rating-overview__title">
                  <span class="rating-title-slot" :class="{ 'is-aggregate': showAggregateRating }">
                    <Transition name="rating-title" mode="out-in">
                      <span :key="showAggregateRating ? 'aggregate-title' : 'bangumi-title'">
                        {{ showAggregateRating ? "综合评分" : "Bangumi 评分" }}
                      </span>
                    </Transition>
                  </span>
                  <span v-if="showRatingCompareLoading" class="rating-overview__loading-hint">{{ ratingCompareProgressLabel }}</span>
                  <button
                    v-if="showAggregateRating"
                    type="button"
                    class="rating-overview__detail-btn"
                    @click="ratingCompareModalVisible = true"
                  >
                    查看详细分析
                  </button>
                </p>
                <span v-if="subjectSupportsRatingComparison && ratingComparisonConfig.enabled" class="rating-mode-switch" role="tablist" aria-label="评分视图">
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="activeRatingMode === 'bangumi'"
                    :class="{ 'is-active': activeRatingMode === 'bangumi' }"
                    @click="ratingViewMode = 'bangumi'"
                  >
                    Bangumi
                  </button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="activeRatingMode === 'aggregate'"
                    :disabled="!hasAggregateRating"
                    :class="{ 'is-active': activeRatingMode === 'aggregate', 'is-pending': !hasAggregateRating && showRatingCompareLoading }"
                    @click="ratingViewMode = 'aggregate'"
                  >
                    综合
                  </button>
                </span>
              </div>
              <div class="rating-overview__score-row">
                <div class="rating-overview__score-summary">
                  <p class="rating-overview__score" aria-live="polite">
                    <span class="rating-overview__score-digits" :class="`is-${ratingScoreRollDirection}`" aria-hidden="true">
                      <span
                        v-for="(character, index) in activeRatingScoreText.split('')"
                        :key="index"
                        class="rating-overview__score-slot"
                        :class="{ 'is-separator': character === '.', 'is-placeholder': activeRatingScoreText === '暂无' }"
                      >
                        <Transition :name="`rating-score-roll-${ratingScoreRollDirection}`" mode="out-in">
                          <span :key="character" class="rating-overview__score-character">{{ character }}</span>
                        </Transition>
                      </span>
                    </span>
                    <span class="rating-overview__meta">{{ activeRatingScore > 0 ? `/ 10` : "" }}</span>
                  </p>
                  <Transition name="rating-extra">
                    <span
                      v-if="showAggregateRating"
                      class="rating-overview__difference"
                      :class="{ 'is-positive': ratingDifferenceLabel.startsWith('↑'), 'is-negative': ratingDifferenceLabel.startsWith('↓') }"
                      :aria-label="ratingDifferenceLabel === '不变' ? '与 Bangumi 评分相同，没有变化' : `与 Bangumi 相差 ${ratingDifferenceLabel}`"
                    >{{ ratingDifferenceLabel }}</span>
                  </Transition>
                </div>
                <div class="rating-stars" role="img" :aria-label="`${activeRatingLabel} ${detailRatingScoreLabel(activeRatingScore)} 分（满分 10 分）`">
                  <span
                    v-for="index in 10"
                    :key="`site-${index}`"
                    class="rating-star"
                    :class="activeRatingStarState(index)"
                    :style="ratingStarStyle(activeRatingScore, index)"
                    aria-hidden="true"
                  >
                    ★
                  </span>
                </div>
              </div>
              <p class="rating-overview__rank">
                <span class="rating-source-slot" :class="{ 'is-visible': showAggregateRating }">
                  <img v-if="showAggregateRating" class="rating-source-icon" :src="bangumiMark" title="Bangumi 数据" alt="Bangumi 数据" />
                </span><span>排名 #{{ detail.rating.rank || "-" }}</span>
              </p>
              <p class="rating-overview__total">
                <span class="rating-source-slot" :class="{ 'is-visible': showAggregateRating }">
                  <img v-if="showAggregateRating" class="rating-source-icon" :src="bangumiMark" title="Bangumi 数据" alt="Bangumi 数据" />
                </span><span>{{ detail.rating.total || 0 }} 人评分</span>
              </p>
            </div>

            <div class="rating-overview__right">
              <div class="rating-overview__header">
                <p class="rating-overview__title">我的评分</p>
              </div>
              <div class="rating-overview__score-row">
                <p class="rating-overview__score">
                  {{ userCanEditCollection ? detailRatingScoreLabel(myRatingScore) : "未登录" }}
                  <span class="rating-overview__meta">{{ userCanEditCollection && myRatingScore > 0 ? `/ 10` : "" }}</span>
                </p>
                <div
                  class="rating-stars"
                  role="img"
                  :aria-label="`个人评分 ${userCanEditCollection ? detailRatingScoreLabel(myRatingScore) : '未登录'}（满分 10 分）`"
                >
                  <span
                    v-for="index in 10"
                    :key="`mine-${index}`"
                    class="rating-star"
                    :class="myRatingStarState(index)"
                    :style="ratingStarStyle(myRatingScore, index)"
                    aria-hidden="true"
                  >
                    ★
                  </span>
                </div>
              </div>
              <p class="rating-overview__hint" v-if="!userCanEditCollection">登录后可显示并编辑个人评分</p>
              <p class="rating-overview__hint" v-else-if="myRatingScore <= 0">你还没有给这个条目评分</p>
              <p class="rating-overview__hint" v-else>你给此条目的评价。你能在「我的」修改此评分。</p>
            </div>
          </div>

          <div class="collection-overview">
            <article class="collection-overview__item">
              <span class="collection-overview__label">想看</span>
              <strong class="collection-overview__value">{{ detail.collection.wish }}</strong>
            </article>
            <article class="collection-overview__item">
              <span class="collection-overview__label">看过</span>
              <strong class="collection-overview__value">{{ detail.collection.collect }}</strong>
            </article>
            <article class="collection-overview__item">
              <span class="collection-overview__label">在看</span>
              <strong class="collection-overview__value">{{ detail.collection.doing }}</strong>
            </article>
            <article class="collection-overview__item">
              <span class="collection-overview__label">搁置</span>
              <strong class="collection-overview__value">{{ detail.collection.on_hold }}</strong>
            </article>
            <article class="collection-overview__item">
              <span class="collection-overview__label">抛弃</span>
              <strong class="collection-overview__value">{{ detail.collection.dropped }}</strong>
            </article>
          </div>

          <div class="chart-group">
            <div class="chart-block">
              <div class="chart-block__header">
                <h5>评分分布</h5>
                <label class="chart-toggle" aria-label="评分分布差异增强">
                  <input v-model="ratingDiffEmphasis" class="chart-toggle__input" type="checkbox" />
                  <span class="chart-toggle__track" aria-hidden="true">
                    <span class="chart-toggle__thumb"></span>
                  </span>
                  <span class="chart-toggle__text">差异增强</span>
                </label>
              </div>
              <ul class="chart-list">
                <li
                  v-for="(row, index) in ratingRows"
                  :key="row.score"
                  class="chart-item"
                  :style="{ '--chart-index': index }"
                >
                  <span class="chart-item__label">{{ row.score }} 分</span>
                  <div class="chart-item__bar">
                    <span class="chart-item__fill" :style="{ width: `${row.width}%` }"></span>
                  </div>
                  <div class="chart-item__value">
                    <strong>{{ row.value }}</strong>
                    <span>{{ row.percentLabel }}</span>
                  </div>
                </li>
              </ul>
              <section
                v-if="appStore.ratingAnomalyDetectionEnabled.value"
                class="rating-anomaly"
                :class="`is-${ratingAnomalyAnalysis.status}`"
                aria-live="polite"
              >
                <div class="rating-anomaly__header">
                  <span class="rating-anomaly__status" aria-hidden="true">{{ ratingAnomalyAnalysis.status === 'watch' ? '!' : ratingAnomalyAnalysis.status === 'clear' ? '✓' : '…' }}</span>
                  <div>
                    <h6>评分异常监测 <small>实验性</small></h6>
                    <p>{{ ratingAnomalyAnalysis.summary }}</p>
                  </div>
                </div>
                <div v-if="ratingAnomalyAnalysis.status !== 'insufficient'" class="rating-anomaly__profile">
                  <span>分布画像</span>
                  <strong>{{ ratingAnomalyAnalysis.profile.label }}</strong>
                  <p>{{ ratingAnomalyAnalysis.profile.description }}</p>
                </div>
                <div v-if="ratingAnomalyAnalysis.status !== 'insufficient'" class="rating-anomaly__metrics" aria-label="评分分布统计指标">
                  <article v-for="metric in ratingAnomalyAnalysis.metrics" :key="metric.key">
                    <span>{{ metric.name }}</span>
                    <strong>{{ metric.value }} · {{ metric.label }}</strong>
                    <small>{{ metric.explanation }}</small>
                  </article>
                </div>
                <ul v-if="ratingAnomalyAnalysis.signals.length" class="rating-anomaly__signals">
                  <li v-for="signal in ratingAnomalyAnalysis.signals" :key="signal.kind">
                    <div>
                      <strong>{{ signal.title }}</strong>
                      <span>置信度 {{ signal.confidence }}</span>
                    </div>
                    <p>{{ signal.summary }}</p>
                    <small>{{ signal.evidence }}</small>
                  </li>
                </ul>
              </section>
            </div>

            <div class="chart-block">
              <div class="chart-block__header">
                <h5>收藏状态分布</h5>
                <label class="chart-toggle" aria-label="收藏状态分布差异增强">
                  <input v-model="collectionDiffEmphasis" class="chart-toggle__input" type="checkbox" />
                  <span class="chart-toggle__track" aria-hidden="true">
                    <span class="chart-toggle__thumb"></span>
                  </span>
                  <span class="chart-toggle__text">差异增强</span>
                </label>
              </div>
              <ul class="chart-list">
                <li
                  v-for="(row, index) in collectionRows"
                  :key="row.label"
                  class="chart-item"
                  :style="{ '--chart-index': index }"
                >
                  <span class="chart-item__label">{{ row.label }}</span>
                  <div class="chart-item__bar">
                    <span class="chart-item__fill chart-item__fill--collection" :style="{ width: `${row.width}%` }"></span>
                  </div>
                  <div class="chart-item__value">
                    <strong>{{ row.value }}</strong>
                    <span>{{ row.percentLabel }}</span>
                  </div>
                </li>
              </ul>
              <section
                v-if="appStore.collectionDistributionAnalysisEnabled.value"
                class="rating-anomaly collection-anomaly"
                :class="`is-${collectionDistributionAnalysis.status}`"
                aria-live="polite"
              >
                <div class="rating-anomaly__header">
                  <span class="rating-anomaly__status" aria-hidden="true">{{ collectionDistributionAnalysis.status === 'watch' ? '!' : collectionDistributionAnalysis.status === 'clear' ? '✓' : '…' }}</span>
                  <div>
                    <h6>收藏状态分析 <small>实验性</small></h6>
                    <p>{{ collectionDistributionAnalysis.summary }}</p>
                  </div>
                </div>
                <div v-if="collectionDistributionAnalysis.status !== 'insufficient'" class="rating-anomaly__profile">
                  <span>状态画像</span>
                  <strong>{{ collectionDistributionAnalysis.profile.label }}</strong>
                  <p>{{ collectionDistributionAnalysis.profile.description }}</p>
                </div>
                <div v-if="collectionDistributionAnalysis.status !== 'insufficient'" class="rating-anomaly__metrics" aria-label="收藏状态统计指标">
                  <article v-for="metric in collectionDistributionAnalysis.metrics" :key="metric.key">
                    <span>{{ metric.name }}</span>
                    <strong>{{ metric.value }} · {{ metric.label }}</strong>
                    <small>{{ metric.explanation }}</small>
                  </article>
                </div>
                <ul v-if="collectionDistributionAnalysis.signals.length" class="rating-anomaly__signals">
                  <li v-for="signal in collectionDistributionAnalysis.signals" :key="signal.kind">
                    <div>
                      <strong>{{ signal.title }}</strong>
                      <span>置信度 {{ signal.confidence }}</span>
                    </div>
                    <p>{{ signal.summary }}</p>
                    <small>{{ signal.evidence }}</small>
                  </li>
                </ul>
              </section>
            </div>
          </div>


          <article class="comment-box" v-if="userShortComment">
            <div class="comment-box__header">
              <h5>用户简评</h5>
            </div>
            <article class="comment-item">
              <div class="comment-item__avatar">
                <img v-if="userProfileAvatar" :src="userProfileAvatar" alt="" loading="lazy" />
                <span v-else>{{ userProfileDisplayName.slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="comment-item__main">
                <p class="comment-item__meta">
                  <a v-if="userProfileLink" class="onboarding__link" :href="userProfileLink" target="_blank" rel="noreferrer">{{ userProfileDisplayName }}</a>
                  <span v-else>{{ userProfileDisplayName }}</span>
                  <span v-if="formattedCollectionUpdatedAt"> · {{ formattedCollectionUpdatedAt }}</span>
                  <span v-if="userShortComment"> · 这是你为此条目撰写的简评，将出现在吐槽箱中。你可以在「我的」中修改。</span>
                </p>
                <p class="comment-item__content" v-html="autoLinkPlainText(userShortComment || '你还没有写简评。')"></p>
              </div>
            </article>
          </article>

          <article ref="subjectCommentBoxRef" class="comment-box">
            <div class="comment-box__header">
              <h5>吐槽箱</h5>
              <a
                v-if="detail"
                class="onboarding__link"
                :href="`https://bangumi.tv/subject/${detail.id}/comments`"
                target="_blank"
                rel="noreferrer"
              >
                在网页中查看
              </a>
            </div>

            <div class="comment-tabs" role="tablist" aria-label="吐槽筛选">
              <button
                v-for="tab in commentTabs"
                :key="`comment-tab-${tab.key}`"
                class="filter-tab"
                :class="{ 'is-active': commentInterestTab === tab.key }"
                type="button"
                @click="setCommentInterestTab(tab.key)"
              >
                {{ tab.label }}
              </button>
            </div>

            <p v-if="commentLoading" class="detail-muted">正在加载吐槽... （可能较久）</p>
            <p v-else-if="commentError" class="onboarding__error">{{ commentError }}</p>
            <p v-else-if="comments.length === 0" class="detail-muted">暂无吐槽内容。</p>

            <div v-else class="comment-list">
              <article v-for="item in comments" :key="item.id" class="comment-item">
                <div class="comment-item__avatar">
                  <img v-if="item.avatar" :src="item.avatar" alt="" loading="lazy" />
                  <span v-else>U</span>
                </div>
                <div class="comment-item__main">
                  <p class="comment-item__meta">
                    <a v-if="item.userLink" class="onboarding__link" :href="item.userLink" target="_blank" rel="noreferrer">{{ item.userName }}</a>
                    <span v-else>{{ item.userName }}</span>
                    <span v-if="item.interestText"> · {{ item.interestText }}</span>
                    <span v-if="item.timeText"> · {{ formatReadableDateTime(item.timeText, { fallback: "" }) }}</span>
                  </p>
                  <p class="comment-item__content" v-html="autoLinkPlainText(item.contentText)"></p>
                </div>
              </article>
            </div>

            <div class="comment-pager">
              <button class="secondary-button" type="button" :disabled="!canPrevCommentPage || commentLoading" @click="prevCommentPage">
                上一页
              </button>
              <span class="detail-muted">第 {{ commentPage }} 页 / {{ commentTotalPages }}</span>
              <button class="secondary-button" type="button" :disabled="!canNextCommentPage || commentLoading" @click="nextCommentPage">
                下一页
              </button>
            </div>
          </article>
        </article>

      </template>

      <template v-if="detailPage === 'subject' && detailTab === 'my'">
        <article id="detail-panel-review" class="detail-section detail-section--my" role="tabpanel">
          <header class="my-panel__header">
            <div class="my-panel__title-row">
              <h4>我的收藏</h4>
              <span v-if="formattedCollectionUpdatedAt" class="my-panel__update-badge" title="最近更新">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {{ formattedCollectionUpdatedAt }}
              </span>
            </div>
          </header>

          <aside v-if="showPreReleaseRatingAdvice" class="my-advice-banner" role="note">
            <div class="my-advice-banner__icon" aria-hidden="true">!</div>
            <div class="my-advice-banner__content">
              <div class="my-advice-banner__head">
                <p class="my-advice-banner__title">SimpBangumi 不建议在作品尚未开播的情况下对其评分。</p>
                <button
                  class="my-advice-banner__toggle"
                  type="button"
                  :aria-expanded="preReleaseAdviceExpanded"
                  @click="togglePreReleaseAdvice"
                >
                  {{ preReleaseAdviceExpanded ? '收起' : '展开' }}
                </button>
              </div>
              <Transition name="advice-expand">
                <div v-if="preReleaseAdviceExpanded" class="my-advice-banner__details">
                  <p class="my-advice-banner__text">
                    这可能影响评分参考性，还会对其他用户造成困扰，导致对作品的误解或争议。<br>
                    如果只是期待作品，建议使用「想看」表达。作为社区一员，我们感谢您对社区环境做出的贡献！
                  </p>
                  <p class="my-advice-banner__source">
                    当然，您仍然可以评分。毕竟这只是我们的友善建议，不是 Bangumi 官方提出的限制。<br>
                    数据来源自「配信跟踪（Beta）」，请以实际番组播出情况为准。
                  </p>
                </div>
              </Transition>
            </div>
          </aside>

          <p v-if="!userCanEditCollection" class="my-panel__login-hint">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            请先登录后查看和修改你的收藏状态。
          </p>

          <template v-else>
            <div v-if="collectionLoading" class="my-panel__loading">
              <span class="my-panel__spinner"></span>
              正在读取你的收藏状态...
            </div>

            <div class="detail-form my-collection-form">
              <!-- 状态 & 评分 卡片 -->
              <div class="my-form-card">
                <div class="my-form-card__header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/></svg>
                  <span>状态与评分</span>
                </div>
                <div class="my-form-card__body">
                  <div class="my-form-row my-form-row--split">
                    <label class="my-form-field">
                      <span class="my-form-field__label">收藏状态</span>
                      <div class="my-select-wrapper">
                        <select
                          v-model.number="form.type"
                          :disabled="collectionSaving || collectionLoading"
                          class="my-form-field__select"
                        >
                          <option :value="1">想看</option>
                          <option :value="2">看过</option>
                          <option :value="3">在看</option>
                          <option :value="4">搁置</option>
                          <option :value="5">抛弃</option>
                        </select>
                      </div>
                    </label>

                    <label class="my-form-field">
                      <span class="my-form-field__label">我的评分</span>
                      <div class="my-rating-input">
                        <input
                          v-model.number="form.rate"
                          type="range"
                          min="0"
                          max="10"
                          step="1"
                          :disabled="collectionSaving || collectionLoading"
                          class="my-rating-slider"
                        />
                        <span class="my-rating-value" :class="{ 'is-rated': form.rate > 0 }">
                          {{ form.rate > 0 ? form.rate : '—' }}
                        </span>
                      </div>
                    </label>
                  </div>

                  <!-- 进度只读展示 -->
                  <div v-if="subjectSupportsEpisodeProgress || subjectSupportsVolumeProgress" class="my-progress-row">
                    <div v-if="subjectSupportsEpisodeProgress" class="my-progress-chip" title="剧集完成度由逐集管理自动计算">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      <span>剧集进度</span>
                      <strong>{{ form.ep_status }} / {{ detail?.eps || '?' }}</strong>
                    </div>
                    <div v-if="subjectSupportsVolumeProgress" class="my-progress-chip">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                      <span>册数进度</span>
                      <strong>{{ form.vol_status }} / {{ detail?.volumes || '?' }}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 标签 & 隐私 卡片 -->
              <div class="my-form-card">
                <div class="my-form-card__header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  <span>标签与隐私</span>
                </div>
                <div class="my-form-card__body">
                  <label class="my-form-field">
                    <span class="my-form-field__label">标签</span>
                    <input
                      v-model="form.tagsInput"
                      type="text"
                      :disabled="collectionSaving || collectionLoading"
                      placeholder="用英文逗号分隔，如：补番, 童年"
                      class="my-form-field__input"
                    />
                  </label>

                  <label class="my-form-field my-form-field--inline">
                    <span class="my-form-field__label">隐私设置</span>
                    <label class="my-toggle">
                      <input v-model="form.private" type="checkbox" :disabled="collectionSaving || collectionLoading" />
                      <span class="my-toggle__track">
                        <span class="my-toggle__thumb"></span>
                      </span>
                      <span class="my-toggle__label">仅自己可见</span>
                    </label>
                  </label>
                </div>
              </div>

              <!-- 简评 卡片 -->
              <div class="my-form-card">
                <div class="my-form-card__header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span>简评</span>
                  <span class="my-form-card__hint">（将出现在吐槽箱中）</span>
                </div>
                <div class="my-form-card__body">
                  <textarea
                    v-model="form.comment"
                    rows="3"
                    :disabled="collectionSaving || collectionLoading"
                    placeholder="写下你对这部作品的感想..."
                    class="my-form-field__textarea"
                  ></textarea>
                  <p v-if="appStore.showUsageAdvice.value" class="my-form-advice">
                    与社区互动时，建议遵守
                    <a href="https://bangumi.tv/about/guideline" target="_blank" rel="noopener noreferrer"> Bangumi 社区指导原则</a>。
                  </p>
                </div>
              </div>

              <!-- 操作区 -->
              <div class="my-form-actions">
                <button
                  class="my-save-button"
                  type="button"
                  :disabled="collectionSaving || collectionLoading"
                  @click="saveCollectionStatus"
                >
                  <svg v-if="!collectionSaving" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  <span v-if="collectionSaving" class="my-panel__spinner my-panel__spinner--small"></span>
                  {{ collectionSaving ? "保存中..." : "保存收藏" }}
                </button>
                <transition name="my-fade-up">
                  <span v-if="collectionSavedMessage" class="my-save-success">{{ collectionSavedMessage }}</span>
                </transition>
              </div>
              <transition name="my-fade-up">
                <p v-if="collectionError" class="my-form-error">{{ collectionError }}</p>
              </transition>
            </div>

            <!-- 逐集管理 -->
            <div v-if="canManageEpisodes" class="episode-manager">
              <div class="episode-manager__header">
                <h5>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  逐集完成管理
                </h5>
                <span class="episode-manager__hint">点击方格切换完成状态，自动同步剧集进度</span>
              </div>
              <p v-if="episodeLoading && episodes.length === 0" class="detail-muted">正在加载章节列表...</p>
              <p v-if="episodeError" class="onboarding__error">{{ episodeError }}</p>

              <div v-if="episodes.length > 0" class="episode-groups">
                <section v-for="group in groupedEpisodes" :key="group.type" class="episode-group">
                  <div class="episode-group__title">
                    <span class="episode-group__label">{{ group.label }}</span>
                    <span class="episode-group__count">{{ group.items.length }} 集</span>
                  </div>
                  <div class="episode-grid">
                    <article
                      v-for="episode in group.items"
                      :key="episode.id"
                      class="episode-cell"
                      :class="[
                        episodeTypeClass(episode.type),
                        episodeStatusClass(episodeStatusType(episode.id)),
                        episodePopoverPlacementClass(episode.id),
                        { 'is-saving': episodeSavingId === episode.id },
                      ]"
                      tabindex="0"
                      @mouseenter="onEpisodeHover(episode.id, $event)"
                      @focusin="onEpisodeHover(episode.id, $event)"
                    >
                      <span class="episode-cell__type">{{ episodeTypeShort(episode.type) }}</span>
                      <strong class="episode-cell__index">{{ episodeDisplayIndex(episode) }}</strong>

                      <section class="episode-popover">
                        <p class="episode-popover__title">{{ preferredSubjectTitle(episode.name, episode.name_cn, "未命名章节") }}</p>
                        <p class="episode-popover__meta">{{ notpreferredSubjectTitle(episode.name, episode.name_cn, "未命名章节") }}</p>
                        <p class="episode-popover__meta">类型：{{ episodeTypeLabel(episode.type) }}</p>
                        <p class="episode-popover__meta" v-if="episode.type === 0">集数：EP {{ episode.ep ?? episode.sort }}</p>
                        <p class="episode-popover__meta" v-else>序号：{{ episode.sort }}（非本篇，ep 无意义）</p>

                        <label class="episode-popover__control">
                          收藏状态
                          <select
                            :value="episodeStatusType(episode.id)"
                            :disabled="episodeSavingId === episode.id"
                            @change="updateEpisodeStatus(episode.id, Number(($event.target as HTMLSelectElement).value))"
                          >
                            <option :value="0">未看</option>
                            <option :value="2">看过</option>
                          </select>
                        </label>
                      </section>
                    </article>
                  </div>
                </section>
              </div>
            </div>
          </template>
        </article>
      </template>


      <template v-if="detailPage === 'person'">
        <article class="detail-section person-detail-panel">
          <div class="person-detail-panel__header">
            <h4>人物详情</h4>
            <button class="secondary-button" type="button" @click="closePersonDetail">返回条目详情</button>
          </div>

          <p v-if="personDetailLoading" class="detail-muted">人物详情加载中...</p>
          <p v-else-if="personDetailError" class="onboarding__error">{{ personDetailError }}</p>

          <template v-else-if="personDetail">
            <article class="person-hero">
              <div class="person-hero__cover">
                <img
                  v-if="personCover(personDetail.images)"
                  class="zoomable-cover"
                  :src="personCover(personDetail.images)"
                  alt=""
                  loading="lazy"
                  @click="openImagePreview(personCover(personDetail.images), personDetail.name || `Person #${personDetail.id}`)"
                />
                <span v-else>BG</span>
              </div>
              <div class="person-hero__main">
                <h5>{{ personDetail.name || `Person #${personDetail.id}` }}</h5>
                <p class="detail-muted">{{ personTypeLabel(personDetail.type) }}</p>
                <div class="tags-strip" v-if="personDetail.career?.length">
                  <span v-for="career in personDetail.career" :key="career" class="tag-chip tag-chip--meta">{{ personCareerLabel(career) }}</span>
                </div>
                <button
                  v-if="sessionStore.authenticated.value"
                  class="primary-button entity-collection-button"
                  type="button"
                  :disabled="personCollectionSaving || personCollected === null"
                  @click="togglePersonCollection"
                >
                  {{ personCollectionSaving ? "保存中..." : personCollected ? "取消收藏" : "收藏人物" }}
                </button>
              </div>
            </article>

            <section ref="monoDetailTabsRef" class="detail-tabs" role="tablist" aria-label="人物详情分类">
              <button
                ref="monoDetailTabInfoRef"
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'info' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'info'"
                @click="monoDetailTab = 'info'"
              >
                信息
              </button>
              <button
                ref="monoDetailTabReviewRef"
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'review' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'review'"
                @click="monoDetailTab = 'review'"
              >
                评论
              </button>
              <div class="detail-tabs__indicator" :style="monoDetailTabIndicatorStyle" />
            </section>

            <template v-if="monoDetailTab === 'info'">
              <BbcodeSummary :content="personDetail.summary" />

              <dl class="detail-grid">
                <div><dt>ID</dt><dd>{{ personDetail.id }}</dd></div>
                <div><dt>类型</dt><dd>{{ personTypeLabel(personDetail.type) }}</dd></div>
                <div><dt>性别</dt><dd>{{ personDetail.gender || "-" }}</dd></div>
                <div><dt>生日</dt><dd>{{ personBirthLabel(personDetail) }}</dd></div>
                <div><dt>收藏数</dt><dd>{{ personDetail.stat.collects }}</dd></div>
                <div><dt>评论数</dt><dd>{{ personDetail.stat.comments }}</dd></div>
                <div><dt>最近更新</dt><dd>{{ formatReadableDateTime(personDetail.last_modified) }}</dd></div>
                <div><dt>锁定</dt><dd>{{ personDetail.locked ? "是" : "否" }}</dd></div>
              </dl>

              <div class="infobox" v-if="personDetail.infobox?.length">
                <h5>Infobox</h5>
                <dl>
                  <div v-for="item in personDetail.infobox" :key="item.key">
                    <dt>{{ item.key }}</dt>
                    <dd>{{ formatInfoboxValue(item.value) }}</dd>
                  </div>
                </dl>
              </div>
            </template>

            <template v-if="monoDetailTab === 'review'">
              <article class="comment-box">
                <div class="comment-box__header">
                  <h5>评论</h5>
                  <a
                    class="onboarding__link"
                    :href="`https://bangumi.tv/person/${personDetail.id}`"
                    target="_blank"
                    rel="noreferrer"
                  >
                    在网页中查看
                  </a>
                </div>

                <div class="comment-tabs" role="tablist" aria-label="人物评论排序">
                  <button
                    class="filter-tab"
                    :class="{ 'is-active': monoCommentSortOrder === 'asc' }"
                    type="button"
                    @click="setMonoCommentSortOrder('asc')"
                  >
                    从旧到新
                  </button>
                  <button
                    class="filter-tab"
                    :class="{ 'is-active': monoCommentSortOrder === 'desc' }"
                    type="button"
                    @click="setMonoCommentSortOrder('desc')"
                  >
                    从新到旧
                  </button>
                </div>

                <p v-if="monoCommentLoading" class="detail-muted">正在加载评论...（可能较久）</p>
                <p v-else-if="monoCommentError" class="onboarding__error">{{ monoCommentError }}</p>
                <p v-else-if="monoComments.length === 0" class="detail-muted">暂无评论内容。</p>

                <div v-else class="comment-list">
                  <article v-for="item in monoComments" :key="item.id" class="comment-item">
                    <div class="comment-item__avatar">
                      <img v-if="item.avatar" :src="item.avatar" alt="" loading="lazy" />
                      <span v-else>U</span>
                    </div>
                    <div class="comment-item__main">
                      <p class="comment-item__meta">
                        <a v-if="item.userLink" class="onboarding__link" :href="item.userLink" target="_blank" rel="noreferrer">{{ item.userName }}</a>
                        <span v-else>{{ item.userName }}</span>
                        <span v-if="item.interestText"> · {{ item.interestText }}</span>
                        <span v-if="item.timeText"> · {{ formatReadableDateTime(item.timeText, { fallback: "" }) }}</span>
                      </p>
                      <p class="comment-item__content" v-html="autoLinkPlainText(item.contentText)"></p>
                    </div>
                  </article>
                </div>

                <div class="comment-pager">
                  <button class="secondary-button" type="button" :disabled="!canPrevMonoCommentPage || monoCommentLoading" @click="prevMonoCommentPage">
                    上一页
                  </button>
                  <span class="detail-muted">第 {{ monoCommentPage }} 页 / {{ monoCommentTotalPages }}</span>
                  <button class="secondary-button" type="button" :disabled="!canNextMonoCommentPage || monoCommentLoading" @click="nextMonoCommentPage">
                    下一页
                  </button>
                </div>
              </article>
            </template>
          </template>
        </article>
      </template>

      <template v-if="detailPage === 'character'">
        <article class="detail-section person-detail-panel">
          <div class="person-detail-panel__header">
            <h4>角色详情</h4>
            <button class="secondary-button" type="button" @click="closeCharacterDetail">返回条目详情</button>
          </div>

          <p v-if="characterDetailLoading" class="detail-muted">角色详情加载中...</p>
          <p v-else-if="characterDetailError" class="onboarding__error">{{ characterDetailError }}</p>

          <template v-else-if="characterDetail">
            <article class="person-hero">
              <div class="person-hero__cover">
                <img
                  v-if="personCover(characterDetail.images)"
                  class="zoomable-cover"
                  :src="personCover(characterDetail.images)"
                  alt=""
                  loading="lazy"
                  @click="openImagePreview(personCover(characterDetail.images), characterDetail.name || `Character #${characterDetail.id}`)"
                />
                <span v-else>BG</span>
              </div>
              <div class="person-hero__main">
                <h5>{{ characterDetail.name || `Character #${characterDetail.id}` }}</h5>
                <p class="detail-muted">{{ characterTypeLabel(characterDetail.type) }}</p>
                <button
                  v-if="sessionStore.authenticated.value"
                  class="primary-button entity-collection-button"
                  type="button"
                  :disabled="characterCollectionSaving || characterCollected === null"
                  @click="toggleCharacterCollection"
                >
                  {{ characterCollectionSaving ? "保存中..." : characterCollected ? "取消收藏" : "收藏角色" }}
                </button>
              </div>
            </article>

            <section ref="monoDetailTabsRef" class="detail-tabs" role="tablist" aria-label="角色详情分类">
              <button
                ref="monoDetailTabInfoRef"
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'info' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'info'"
                @click="monoDetailTab = 'info'"
              >
                信息
              </button>
              <button
                ref="monoDetailTabReviewRef"
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'review' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'review'"
                @click="monoDetailTab = 'review'"
              >
                评论
              </button>
              <div class="detail-tabs__indicator" :style="monoDetailTabIndicatorStyle" />
            </section>

            <template v-if="monoDetailTab === 'info'">
              <BbcodeSummary :content="characterDetail.summary" />

              <dl class="detail-grid">
                <div><dt>ID</dt><dd>{{ characterDetail.id }}</dd></div>
                <div><dt>类型</dt><dd>{{ characterTypeLabel(characterDetail.type) }}</dd></div>
                <div><dt>性别</dt><dd>{{ characterDetail.gender || "-" }}</dd></div>
                <div><dt>生日</dt><dd>{{ characterBirthLabel(characterDetail) }}</dd></div>
                <div><dt>收藏数</dt><dd>{{ characterDetail.stat.collects }}</dd></div>
                <div><dt>评论数</dt><dd>{{ characterDetail.stat.comments }}</dd></div>
                <div><dt>锁定</dt><dd>{{ characterDetail.locked ? "是" : "否" }}</dd></div>
              </dl>

              <div>
                <h5>关联人物</h5>
                <p v-if="characterRelatedPersonsLoading" class="detail-muted">加载中...</p>
                <p v-else-if="characterRelatedPersons.length === 0" class="detail-muted">暂无关联人物</p>
                <template v-else>
                  <ul class="related-person-list">
                    <li
                      v-for="item in characterRelatedPersons.slice(0, characterRelatedPersonsVisible)"
                      :key="`${item.id}-${item.subject_id}`"
                      class="related-person-card related-person-card--button"
                      role="button"
                      tabindex="0"
                      @click="openPersonDetail(item.id)"
                      @keydown.enter.prevent="openPersonDetail(item.id)"
                      @keydown.space.prevent="openPersonDetail(item.id)"
                    >
                      <img
                        v-if="personCover(item.images)"
                        :src="personCover(item.images)"
                        alt=""
                        loading="lazy"
                        class="related-person-card__avatar"
                      />
                      <span v-else class="related-person-card__avatar related-person-card__avatar--placeholder">BG</span>
                      <div class="related-person-card__info">
                        <span class="related-person-card__name">{{ item.name }}</span>
                        <span class="related-person-card__staff" v-if="item.staff">{{ item.staff }}</span>
                        <span class="related-person-card__subject">
                          {{ item.subject_name_cn || item.subject_name }}
                          <span class="tag-chip tag-chip--meta">{{ subjectTypeLabel(item.subject_type) }}</span>
                        </span>
                      </div>
                    </li>
                  </ul>
                  <button
                    v-if="characterRelatedPersonsVisible < characterRelatedPersons.length"
                    class="secondary-button"
                    type="button"
                    style="margin-top:8px;width:100%"
                    @click="characterRelatedPersonsVisible += 6"
                  >
                    加载更多（剩余 {{ characterRelatedPersons.length - characterRelatedPersonsVisible }} 名）
                  </button>
                </template>
              </div>

              <div class="infobox" v-if="characterDetail.infobox?.length">
                <h5>Infobox</h5>
                <dl>
                  <div v-for="item in characterDetail.infobox" :key="item.key">
                    <dt>{{ item.key }}</dt>
                    <dd>{{ formatInfoboxValue(item.value) }}</dd>
                  </div>
                </dl>
              </div>
            </template>

            <template v-if="monoDetailTab === 'review'">
              <article ref="characterCommentBoxRef" class="comment-box">
                <div class="comment-box__header">
                  <h5>评论</h5>
                  <a
                    class="onboarding__link"
                    :href="`https://bangumi.tv/character/${characterDetail.id}`"
                    target="_blank"
                    rel="noreferrer"
                  >
                    在网页中查看
                  </a>
                </div>

                <div class="comment-tabs" role="tablist" aria-label="角色评论排序">
                  <button
                    class="filter-tab"
                    :class="{ 'is-active': monoCommentSortOrder === 'asc' }"
                    type="button"
                    @click="setMonoCommentSortOrder('asc')"
                  >
                    从旧到新
                  </button>
                  <button
                    class="filter-tab"
                    :class="{ 'is-active': monoCommentSortOrder === 'desc' }"
                    type="button"
                    @click="setMonoCommentSortOrder('desc')"
                  >
                    从新到旧
                  </button>
                </div>

                <p v-if="monoCommentLoading" class="detail-muted">正在加载评论...（可能较久）</p>
                <p v-else-if="monoCommentError" class="onboarding__error">{{ monoCommentError }}</p>
                <p v-else-if="monoComments.length === 0" class="detail-muted">暂无评论内容。</p>

                <div v-else class="comment-list">
                  <article v-for="item in monoComments" :key="item.id" class="comment-item">
                    <div class="comment-item__avatar">
                      <img v-if="item.avatar" :src="item.avatar" alt="" loading="lazy" />
                      <span v-else>U</span>
                    </div>
                    <div class="comment-item__main">
                      <p class="comment-item__meta">
                        <a v-if="item.userLink" class="onboarding__link" :href="item.userLink" target="_blank" rel="noreferrer">{{ item.userName }}</a>
                        <span v-else>{{ item.userName }}</span>
                        <span v-if="item.interestText"> · {{ item.interestText }}</span>
                        <span v-if="item.timeText"> · {{ formatReadableDateTime(item.timeText, { fallback: "" }) }}</span>
                      </p>
                      <p class="comment-item__content" v-html="autoLinkPlainText(item.contentText)"></p>
                    </div>
                  </article>
                </div>

                <div class="comment-pager">
                  <button class="secondary-button" type="button" :disabled="!canPrevMonoCommentPage || monoCommentLoading" @click="prevMonoCommentPage">
                    上一页
                  </button>
                  <span class="detail-muted">第 {{ monoCommentPage }} 页 / {{ monoCommentTotalPages }}</span>
                  <button class="secondary-button" type="button" :disabled="!canNextMonoCommentPage || monoCommentLoading" @click="nextMonoCommentPage">
                    下一页
                  </button>
                </div>
              </article>
            </template>
          </template>
        </article>
      </template>

      <button
        v-show="showDetailBackToTop"
        class="detail-back-top"
        type="button"
        aria-label="回到详情顶部"
        @click="scrollDetailToTop"
      >
        回到顶部
      </button>
    </section>

    <ScoreDebugPanel
      v-if="TenraiDebugScore && TenraiMatch?.candidates && TenraiMatch.candidates.length > 0"
      :candidates="TenraiMatch.candidates"
      :bgm-name="detail?.name ?? ''"
    />

    <RatingComparisonModal
      v-if="detail"
      :visible="ratingCompareModalVisible"
      :bangumi-score="detailRatingScore"
      :loading="ratingCompareLoading"
      :entries="ratingCompareEntries"
      :errors="ratingCompareErrors"
      @close="ratingCompareModalVisible = false"
    />
  </aside>
    </div>
  </Transition>
</template>
