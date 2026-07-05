<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { useBangumi } from "../composables/useBangumi";
import BbcodeSummary from "../components/BbcodeSummary.vue";
import { formatReadableDateTime } from "../utils/datetime";
import type {
  BangumiUser,
  CharacterDetail,
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
const detailError = ref("");
const detail = ref<SubjectDetail | null>(null);
const preDetailLoading = ref(false);
const detailTab = ref<"info" | "review">("info");
const detailPage = ref<"subject" | "person" | "character">("subject");
const monoDetailTab = ref<"info" | "review">("info");
const detailContentRef = ref<HTMLElement | null>(null);
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
const characterDetailLoading = ref(false);
const characterDetailError = ref("");
const characterDetail = ref<CharacterDetail | null>(null);
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

const collectionLoading = ref(false);
const collectionSaving = ref(false);
const collectionError = ref("");
const collectionSavedMessage = ref("");
const collectionUpdatedAt = ref("");
const episodeLoading = ref(false);
const episodeError = ref("");
const episodeSavingId = ref<number | null>(null);
const episodes = ref<Episode[]>([]);
const episodeTypeById = ref<Record<number, number>>({});
const episodePopoverPlacement = ref<
  Record<number, { horizontal: "left" | "center" | "right"; vertical: "up" | "down" }>
>({});

const form = reactive({
  type: 2,
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
  if (score >= index) {
    return "is-full";
  }

  if (score >= index - 0.5) {
    return "is-half";
  }

  return "is-empty";
}

function detailRatingStarState(index: number) {
  return ratingStarState(detailRatingScore.value, index);
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

function resetPersonDetail() {
  personDetailLoading.value = false;
  personDetailError.value = "";
  personDetail.value = null;
}

function resetCharacterDetail() {
  characterDetailLoading.value = false;
  characterDetailError.value = "";
  characterDetail.value = null;
}

async function openPersonDetail(personId: number) {
  if (!personId) {
    return;
  }

  personDetailLoading.value = true;
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
  personDetailLoading.value = false;
}

async function openCharacterDetail(characterId: number) {
  if (!characterId) {
    return;
  }

  characterDetailLoading.value = true;
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
  characterDetailLoading.value = false;
}

function closePersonDetail() {
  detailPage.value = "subject";
  monoDetailTab.value = "info";
  resetMonoComments();
}

function closeCharacterDetail() {
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

function prevMonoCommentPage() {
  if (!canPrevMonoCommentPage.value) {
    return;
  }

  monoCommentPage.value -= 1;
  refreshMonoCommentsForCurrentPage();
}

function nextMonoCommentPage() {
  if (!canNextMonoCommentPage.value) {
    return;
  }

  monoCommentPage.value += 1;
  refreshMonoCommentsForCurrentPage();
}

function setCommentInterestTab(tab: "all" | SubjectCommentInterestType) {
  if (commentInterestTab.value === tab) {
    return;
  }

  commentInterestTab.value = tab;
  commentPage.value = 1;
  void loadSubjectComments();
}

function prevCommentPage() {
  if (!canPrevCommentPage.value) {
    return;
  }

  commentPage.value -= 1;
  void loadSubjectComments();
}

function nextCommentPage() {
  if (!canNextCommentPage.value) {
    return;
  }

  commentPage.value += 1;
  void loadSubjectComments();
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
    type: snapshot.type ?? 2,
    comment: snapshot.comment,
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: snapshot.updated_at ?? "",
    private: snapshot.private ?? false,
  };
}

function fillCollectionForm(collection: UserSubjectCollection | null) {
  form.type = collection?.type ?? 2;
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
}

async function loadSubjectDetail(subjectId: number, prefetchedDetail?: SubjectDetail) {
  detailLoading.value = true;
  detailError.value = "";
  detail.value = prefetchedDetail ?? null;
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
  }

  const tasks: Array<Promise<unknown>> = [loadSubjectRelations(subjectId), loadEpisodesForDetail(subjectId)];

  if (userCanEditCollection.value) {
    tasks.push(loadUserCollection(subjectId));
  } else {
    fillCollectionForm(null);
    collectionError.value = "";
    collectionSavedMessage.value = "";
  }

  await Promise.all(tasks);

  detailLoading.value = false;
}

function closeDetail() {
  detailOpen.value = false;
  showDetailBackToTop.value = false;
  resetPersonDetail();
  resetCharacterDetail();
  resetMonoComments();
  monoDetailTab.value = "info";
  detailPage.value = "subject";
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

function onDetailScroll(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  showDetailBackToTop.value = target.scrollTop > 280;
}

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
}

async function saveCollectionStatus() {
  if (!detail.value) {
    return;
  }

  collectionSaving.value = true;
  collectionError.value = "";
  collectionSavedMessage.value = "";

  const payload = {
    type: form.type,
    rate: form.rate,
    vol_status: subjectSupportsVolumeProgress.value ? form.vol_status : undefined,
    ep_status: subjectSupportsVolumeProgress.value ? form.ep_status : undefined,
    private: form.private,
    comment: form.comment.trim() || undefined,
    tags: parseTagsInput(form.tagsInput),
  };

  const result = await bangumi.updateCurrentUserSubjectCollection(detail.value.id, payload);

  if (!result.ok) {
    collectionError.value = result.error;
    collectionSaving.value = false;
    return;
  }

  collectionSavedMessage.value = "收藏状态已更新。";
  form.rate = payload.rate;
  collectionSaving.value = false;
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
              <h2>
                {{ preferredSubjectTitle(collection.subject?.name, collection.subject?.name_cn, `Subject #${collection.subject_id ?? ""}`) }}
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

  <div class="drawer-overlay" :class="{ 'is-open': detailOpen }" @click="closeDetail"></div>
  <aside class="detail-drawer" :class="{ 'is-open': detailOpen }" role="dialog" aria-modal="true" aria-label="条目详情">
    <header class="detail-drawer__header">
      <h2>{{ detailTitle || "条目详情" }}</h2>
      <button class="secondary-button" type="button" @click="closeDetail">关闭</button>
    </header>

    <section v-if="detailLoading" class="empty">详情加载中...</section>
    <section v-else-if="detailError" class="empty">详情加载失败：{{ detailError }}</section>
    <section v-else-if="detail" ref="detailContentRef" class="detail-content" @scroll.passive="onDetailScroll">
      <article v-if="detailPage === 'subject'" class="detail-hero">
        <div class="detail-hero__cover">
          <img v-if="detailCover(detail.images)" :src="detailCover(detail.images)" alt="" loading="lazy" />
          <span v-else>BG</span>
        </div>
        <div class="detail-hero__titles">
          <h3>{{ preferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}</h3>
          <p>{{ notpreferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}</p>
        </div>
      </article>

      <section v-if="detailPage === 'subject'" class="detail-tabs" role="tablist" aria-label="详情分类">
        <button
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
          <div class="rating-overview">
            <div class="rating-overview__left">
              <p class="rating-overview__title">Bangumi 评分</p>
              <div class="rating-overview__score-row">
                <p class="rating-overview__score">{{ detailRatingScoreLabel(detailRatingScore) }} <span class="rating-overview__meta">{{ detailRatingScore > 0 ? `/ 10` : "" }}</span></p>
                <div class="rating-stars" role="img" :aria-label="`站内评分 ${detailRatingScoreLabel(detailRatingScore)} 分（满分 10 分）`">
                  <span
                    v-for="index in 10"
                    :key="`site-${index}`"
                    class="rating-star"
                    :class="detailRatingStarState(index)"
                    aria-hidden="true"
                  >
                    ★
                  </span>
                </div>
              </div>
              <p class="rating-overview__rank">排名 #{{ detail.rating.rank || "-" }}</p>
              <p class="rating-overview__total">{{ detail.rating.total || 0 }} 人评分</p>
            </div>

            <div class="rating-overview__right">
              <p class="rating-overview__title">我的评分</p>
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
                <p class="comment-item__content">{{ userShortComment || "你还没有写简评。" }}</p>
              </div>
            </article>
          </article>

          <article class="comment-box">
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
                  <p class="comment-item__content">{{ item.contentText }}</p>
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
        <article id="detail-panel-review" class="detail-section" role="tabpanel">
          <h4>用户的收藏与完成状态</h4>
          <p v-if="!userCanEditCollection">请先登录后查看和修改你的收藏状态。</p>
          <template v-else>
            <p v-if="collectionLoading">正在读取你的收藏状态...</p>
            <p v-else-if="formattedCollectionUpdatedAt" class="detail-muted">最近更新：{{ formattedCollectionUpdatedAt }}</p>
            <p v-else class="detail-muted">该条目尚未收藏，保存后会自动创建收藏记录。</p>

            <div class="detail-form">
              <label>
                收藏状态
                <select v-model.number="form.type" :disabled="collectionSaving || collectionLoading">
                  <option :value="1">想看</option>
                  <option :value="2">看过</option>
                  <option :value="3">在看</option>
                  <option :value="4">搁置</option>
                  <option :value="5">抛弃</option>
                </select>
              </label>

              <label>
                评分 (0-10)
                <input v-model.number="form.rate" type="number" min="0" max="10" :disabled="collectionSaving || collectionLoading" />
              </label>

              <label>
                剧集完成度 (ep_status)
                <input v-model.number="form.ep_status" type="number" min="0" :disabled="collectionSaving || collectionLoading" />
              </label>

              <label v-if="subjectSupportsVolumeProgress">
                册数完成度 (vol_status)
                <input v-model.number="form.vol_status" type="number" min="0" :disabled="collectionSaving || collectionLoading" />
              </label>

              <label>
                标签（英文逗号分隔）
                <input v-model="form.tagsInput" type="text" :disabled="collectionSaving || collectionLoading" placeholder="例如：补番, 童年" />
              </label>

              <label>
                简评
                <textarea v-model="form.comment" rows="3" :disabled="collectionSaving || collectionLoading"></textarea>
              </label>

              <label class="detail-form__switch">
                <input v-model="form.private" type="checkbox" :disabled="collectionSaving || collectionLoading" />
                仅自己可见
              </label>

              <div class="detail-form__actions">
                <button class="primary-button" type="button" :disabled="collectionSaving || collectionLoading" @click="saveCollectionStatus">
                  {{ collectionSaving ? "保存中..." : "保存收藏状态" }}
                </button>
                <span v-if="collectionSavedMessage" class="detail-success">{{ collectionSavedMessage }}</span>
              </div>
              <p v-if="collectionError" class="onboarding__error">{{ collectionError }}</p>

              <div v-if="canManageEpisodes" class="episode-manager">
                <h5>逐集完成管理</h5>
                <p class="detail-muted">点击章节方格固定弹层。</p>
                <p v-if="episodeLoading && episodes.length === 0" class="detail-muted">正在加载章节列表...</p>
                <p v-if="episodeError" class="onboarding__error">{{ episodeError }}</p>

                <div v-if="episodes.length > 0" class="episode-groups">
                  <section v-for="group in groupedEpisodes" :key="group.type" class="episode-group">
                    <h6>{{ group.label }} · {{ group.items.length }}</h6>
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
                <img v-if="personCover(personDetail.images)" :src="personCover(personDetail.images)" alt="" loading="lazy" />
                <span v-else>BG</span>
              </div>
              <div class="person-hero__main">
                <h5>{{ personDetail.name || `Person #${personDetail.id}` }}</h5>
                <p class="detail-muted">{{ personTypeLabel(personDetail.type) }}</p>
                <div class="tags-strip" v-if="personDetail.career?.length">
                  <span v-for="career in personDetail.career" :key="career" class="tag-chip tag-chip--meta">{{ personCareerLabel(career) }}</span>
                </div>
              </div>
            </article>

            <section class="detail-tabs" role="tablist" aria-label="人物详情分类">
              <button
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
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'review' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'review'"
                @click="monoDetailTab = 'review'"
              >
                评论
              </button>
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
                      <p class="comment-item__content">{{ item.contentText }}</p>
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
                <img v-if="personCover(characterDetail.images)" :src="personCover(characterDetail.images)" alt="" loading="lazy" />
                <span v-else>BG</span>
              </div>
              <div class="person-hero__main">
                <h5>{{ characterDetail.name || `Character #${characterDetail.id}` }}</h5>
                <p class="detail-muted">{{ characterTypeLabel(characterDetail.type) }}</p>
              </div>
            </article>

            <section class="detail-tabs" role="tablist" aria-label="角色详情分类">
              <button
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
                class="detail-tabs__tab"
                :class="{ 'is-active': monoDetailTab === 'review' }"
                type="button"
                role="tab"
                :aria-selected="monoDetailTab === 'review'"
                @click="monoDetailTab = 'review'"
              >
                评论
              </button>
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
              <article class="comment-box">
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
                      <p class="comment-item__content">{{ item.contentText }}</p>
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
  </aside>
</template>
