<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Pager from "../components/Pager.vue";
import { useBangumi } from "../composables/useBangumi";
import { usePagination } from "../composables/usePagination";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { isFollowed } from "../composables/useBroadcastNotify";
import type { Episode, SubjectCollection } from "../api/bangumi";
import type { SubjectTypeFilter } from "../stores/app";

const emit = defineEmits<{
  openSubject: [subjectId: number];
}>();

type SubjectGroup = {
  key: string;
  label: string;
  items: SubjectCollection[];
  total: number;
};

type EpisodeState = {
  episodes: Episode[];
  episodeTypeById: Record<number, number>;
  episodeLoading: boolean;
  episodeError: string;
  episodeSavingId: number | null;
  episodePopoverPlacement: Record<number, { horizontal: "left" | "center" | "right"; vertical: "up" | "down" }>;
};

const SUBJECT_TYPE_ORDER = [1, 2, 3, 4, 6] as const;
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

const COMPLETE_SUBJECT_FILTER_KEY = "bangumi.complete.subjectTypeFilter";

function restoreSubjectTypeFilter(): SubjectTypeFilter {
  const saved = localStorage.getItem(COMPLETE_SUBJECT_FILTER_KEY);
  if (!saved || saved === "all") {
    return "all";
  }

  const parsed = Number(saved);
  if ([1, 2, 3, 4, 6].includes(parsed)) {
    return parsed as SubjectTypeFilter;
  }

  return "all";
}

const bangumi = useBangumi();
const appStore = useAppStore();
const dataStore = useDataStore();
const sessionStore = useSessionStore();
const pagination = usePagination({ pageSize: 12 });
const currentUsername = computed(() => sessionStore.session.value?.user?.username ?? "");

const subjectTypeFilter = ref<SubjectTypeFilter>(restoreSubjectTypeFilter());
const loading = ref(false);
const error = ref("");
const total = ref<number | undefined>(undefined);
const collections = ref<SubjectCollection[]>([]);
const episodeStates = ref<Record<number, EpisodeState>>({});
const episodeLoadTokens = ref<Record<number, number>>({});

let requestToken = 0;

const currentPage = computed(() => pagination.currentPage.value);
const hasActiveFilter = computed(() => subjectTypeFilter.value !== "all");
const isLastPage = computed(() => {
  if (total.value === undefined) {
    return collections.value.length < pagination.pageSize;
  }

  return pagination.offset.value + pagination.pageSize >= total.value;
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
    .map((subjectType) => ({
      key: `subject-${subjectType}`,
      label: SUBJECT_TYPE_LABEL[subjectType] ?? `其他 (${subjectType})`,
      items: bySubject.get(subjectType) ?? [],
      total: bySubject.get(subjectType)?.length ?? 0,
    }));
});

watch(
  [() => sessionStore.authenticated.value, currentUsername],
  ([authenticated]) => {
    if (!authenticated) {
      collections.value = [];
      total.value = undefined;
      episodeStates.value = {};
      episodeLoadTokens.value = {};
      loading.value = false;
      error.value = "";
      return;
    }

    void fetchInProgressCollections();
  },
  { immediate: true },
);

watch([subjectTypeFilter, pagination.offset], () => {
  if (!sessionStore.authenticated.value) {
    return;
  }

  void fetchInProgressCollections();
});

watch(subjectTypeFilter, (value) => {
  localStorage.setItem(COMPLETE_SUBJECT_FILTER_KEY, String(value));
  pagination.reset();
});

function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.common || "";
}

function subjectTypeLabel(type?: number) {
  return typeof type === "number" ? SUBJECT_TYPE_LABEL[type] ?? `其他 (${type})` : "-";
}

function collectionTypeLabel(type?: number) {
  return typeof type === "number" ? COLLECTION_TYPE_LABEL[type] ?? `其他 (${type})` : "-";
}

function supportsEpisodeProgress(collection: SubjectCollection) {
  return collection.subject?.type === SUBJECT_TYPE_ANIME || collection.subject?.type === SUBJECT_TYPE_REAL;
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

function groupedEpisodes(episodes: Episode[]) {
  const groups = new Map<number, Episode[]>();

  for (const episode of episodes) {
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
}

function getEpisodeCollectionNotFound(errorMessage: string) {
  return /(404|not found|未收藏|不存在|subject not collected)/i.test(errorMessage);
}

function ensureEpisodeState(subjectId: number): EpisodeState {
  const existing = episodeStates.value[subjectId];
  if (existing) {
    return existing;
  }

  const nextState: EpisodeState = {
    episodes: [],
    episodeTypeById: {},
    episodeLoading: false,
    episodeError: "",
    episodeSavingId: null,
    episodePopoverPlacement: {},
  };

  episodeStates.value = {
    ...episodeStates.value,
    [subjectId]: nextState,
  };

  return nextState;
}

function nextEpisodeLoadToken(subjectId: number) {
  const token = (episodeLoadTokens.value[subjectId] ?? 0) + 1;
  episodeLoadTokens.value = {
    ...episodeLoadTokens.value,
    [subjectId]: token,
  };

  return token;
}

function episodeStatusType(subjectId: number, episodeId: number) {
  return episodeStates.value[subjectId]?.episodeTypeById[episodeId] ?? 0;
}

function updateEpisodePopoverPlacement(subjectId: number, episodeId: number, target: HTMLElement) {
  const state = ensureEpisodeState(subjectId);
  const rect = target.getBoundingClientRect();
  const popover = target.querySelector<HTMLElement>(".episode-popover");
  const popoverWidth = popover?.offsetWidth || 240;
  const popoverHeight = popover?.offsetHeight || 190;
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

  const upTop = rect.top - gap - popoverHeight;
  const vertical: "up" | "down" = upTop < padding ? "down" : "up";

  state.episodePopoverPlacement = {
    ...state.episodePopoverPlacement,
    [episodeId]: { horizontal, vertical },
  };
}

function onEpisodeHover(subjectId: number, episodeId: number, event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  updateEpisodePopoverPlacement(subjectId, episodeId, target);
}

function episodePopoverPlacementClass(subjectId: number, episodeId: number) {
  const placement = episodeStates.value[subjectId]?.episodePopoverPlacement[episodeId] ?? {
    horizontal: "center" as const,
    vertical: "up" as const,
  };

  return {
    "popover-left": placement.horizontal === "left",
    "popover-right": placement.horizontal === "right",
    "popover-down": placement.vertical === "down",
  };
}

function openSubject(subjectId?: number) {
  if (!subjectId) {
    return;
  }

  emit("openSubject", subjectId);
}

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

async function loadEpisodeState(subjectId: number) {
  const state = ensureEpisodeState(subjectId);
  const loadToken = nextEpisodeLoadToken(subjectId);
  state.episodeLoading = true;
  state.episodeError = "";

  try {
    const [episodeResult, userEpisodeResult] = await Promise.all([
      bangumi.getEpisodesBySubject(subjectId, { limit: 200, offset: 0 }),
      bangumi.getCurrentUserSubjectEpisodeCollections(subjectId, {
        limit: 1000,
        offset: 0,
      }),
    ]);

    if (!episodeResult.ok) {
      state.episodeError = episodeResult.error;
      return;
    }

    state.episodes = [...episodeResult.data.data].sort((left, right) => Number(left.sort ?? 0) - Number(right.sort ?? 0));

    if (userEpisodeResult.ok) {
      const mapping: Record<number, number> = {};
      for (const item of userEpisodeResult.data.data) {
        if (item.episode?.id) {
          mapping[item.episode.id] = Number(item.type ?? 0);
        }
      }

      state.episodeTypeById = mapping;
    } else if (!getEpisodeCollectionNotFound(userEpisodeResult.error)) {
      state.episodeError = userEpisodeResult.error;
    }
  } catch (error) {
    state.episodeError = error instanceof Error ? error.message : String(error);
  } finally {
    if (episodeLoadTokens.value[subjectId] === loadToken) {
      state.episodeLoading = false;
    }
  }
}

async function fetchInProgressCollections() {
  const username = currentUsername.value.trim();

  const requestId = ++requestToken;

  loading.value = true;
  error.value = "";

  const result = await bangumi.getCollections({
    limit: pagination.pageSize,
    offset: pagination.offset.value,
    username: username || undefined,
    type: 3,
    subject_type: subjectTypeFilter.value === "all" ? undefined : subjectTypeFilter.value,
  });

  if (requestId !== requestToken) {
    return;
  }

  if (!result.ok) {
    error.value = result.error;
    collections.value = [];
    total.value = undefined;
    episodeStates.value = {};
    episodeLoadTokens.value = {};
    loading.value = false;
    return;
  }

  collections.value = result.data.data;
  dataStore.updateSubjectCollectionMap(result.data.data);
  total.value = result.data.total;
  loading.value = false;

  for (const item of result.data.data) {
    const subjectId = item.subject_id;
    if (!subjectId || !supportsEpisodeProgress(item)) {
      continue;
    }

    const existingState = episodeStates.value[subjectId];
    if (existingState?.episodes.length) {
      continue;
    }

    if (existingState?.episodeLoading) {
      continue;
    }

    void loadEpisodeState(subjectId);
  }
}

async function updateEpisodeStatus(subjectId: number, episodeId: number, nextType: number) {
  const state = ensureEpisodeState(subjectId);
  const previousType = state.episodeTypeById[episodeId] ?? 0;

  state.episodeTypeById = {
    ...state.episodeTypeById,
    [episodeId]: nextType,
  };
  state.episodeSavingId = episodeId;
  state.episodeError = "";

  const result = await bangumi.updateCurrentUserEpisodeCollection(episodeId, nextType);
  if (!result.ok) {
    state.episodeTypeById = {
      ...state.episodeTypeById,
      [episodeId]: previousType,
    };
    state.episodeError = result.error;
    state.episodeSavingId = null;
    return false;
  }

  state.episodeSavingId = null;
  return true;
}

async function markEpisodeAndPreviousSeen(subjectId: number, episodeId: number) {
  const state = ensureEpisodeState(subjectId);
  const orderedEpisodes = [...state.episodes].sort((left, right) => Number(left.sort ?? 0) - Number(right.sort ?? 0));
  const targetIndex = orderedEpisodes.findIndex((episode) => episode.id === episodeId);

  if (targetIndex < 0) {
    return;
  }

  for (const episode of orderedEpisodes.slice(0, targetIndex + 1)) {
    const updated = await updateEpisodeStatus(subjectId, episode.id, 2);
    if (!updated) {
      return;
    }
  }
}

function collectionCardTitle(collection: SubjectCollection) {
  if (appStore.titlePreference.value === "original") {
    return collection.subject?.name || collection.subject?.name_cn || `Subject #${collection.subject_id ?? ""}`;
  }

  return collection.subject?.name_cn || collection.subject?.name || `Subject #${collection.subject_id ?? ""}`;
}

function collectionCardSubtitle(collection: SubjectCollection) {
  const parts = [
    `条目类型：${subjectTypeLabel(collection.subject?.type)}`,
    `收藏状态：${collectionTypeLabel(collection.type)}`,
  ];

  if (typeof collection.rate === "number") {
    parts.push(`评分：${collection.rate}`);
  }

  return parts.join(" · ");
}

defineExpose({
  refresh: fetchInProgressCollections,
});
</script>

<template>
  <section v-if="!sessionStore.authenticated.value" class="empty">
    请先完成 Bangumi 登录。
  </section>
  <section v-else class="complete-panel">
    <section class="filter-tabs">
      <div class="filter-tabs__group" role="tablist" aria-label="按条目类别筛选">
        <button
          v-for="tab in subjectTypeTabs"
          :key="`complete-subject-${tab.key}`"
          class="filter-tab"
          :class="{ 'is-active': subjectTypeFilter === tab.key }"
          type="button"
          @click="subjectTypeFilter = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </section>

    <section v-if="loading" class="list">
      <article v-for="n in 5" :key="`complete-loading-${n}`" class="item is-loading">
        <div></div>
        <span></span>
      </article>
    </section>

    <section v-else-if="error" class="empty">加载失败：{{ error }}</section>

    <section v-else-if="groupedCollections.length === 0" class="empty">
      {{ hasActiveFilter ? "当前筛选下暂无在看条目。" : "暂无在看条目。" }}
    </section>

    <article v-for="subjectGroup in groupedCollections" :key="subjectGroup.key" class="subject-group">
      <header class="subject-group__header">
        <h2>{{ subjectGroup.label }}</h2>
        <span>{{ subjectGroup.total }} 条</span>
      </header>

      <div class="complete-items">
        <article v-for="collection in subjectGroup.items" :key="collection.subject_id ?? collection.updated_at ?? collection.comment" class="item complete-item">
          <div class="cover">
            <img v-if="cover(collection.subject?.images)" :src="cover(collection.subject?.images)" alt="" loading="lazy" />
            <span v-else>BG</span>
          </div>

          <div class="complete-item__main">
            <button
              class="complete-item__title"
              :class="{
                'broadcast-followed': appStore.broadcastMarker.parent.value && appStore.broadcastMarker.inComplete.value && !appStore.markerIconOnly.value && isFollowed(collection.subject_id ?? 0),
                'is-wish': appStore.wishMarker.parent.value && appStore.wishMarker.inComplete.value && !appStore.markerIconOnly.value && collection.type === 1,
                'is-collected': appStore.collectedMarker.parent.value && appStore.collectedMarker.inComplete.value && !appStore.markerIconOnly.value && collection.type === 2,
                'is-watching': appStore.watchingMarker.parent.value && appStore.watchingMarker.inComplete.value && !appStore.markerIconOnly.value && collection.type === 3,
                'is-onhold': appStore.onholdMarker.parent.value && appStore.onholdMarker.inComplete.value && !appStore.markerIconOnly.value && collection.type === 4,
                'is-dropped': appStore.droppedMarker.parent.value && appStore.droppedMarker.inComplete.value && !appStore.markerIconOnly.value && collection.type === 5,
              }"
              type="button"
              @click="openSubject(collection.subject_id)"
            >
              {{ collectionCardTitle(collection) }}
              <svg v-if="appStore.broadcastMarker.parent.value && appStore.broadcastMarker.inComplete.value && isFollowed(collection.subject_id ?? 0)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
              <svg v-if="appStore.wishMarker.parent.value && appStore.wishMarker.inComplete.value && collection.type === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
              <svg v-if="appStore.collectedMarker.parent.value && appStore.collectedMarker.inComplete.value && collection.type === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
              <svg v-if="appStore.watchingMarker.parent.value && appStore.watchingMarker.inComplete.value && collection.type === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
              <svg v-if="appStore.onholdMarker.parent.value && appStore.onholdMarker.inComplete.value && collection.type === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
              <svg v-if="appStore.droppedMarker.parent.value && appStore.droppedMarker.inComplete.value && collection.type === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
            </button>
            <p class="complete-item__meta">{{ collectionCardSubtitle(collection) }}</p>

            <section v-if="supportsEpisodeProgress(collection)" class="complete-episode-manager">
              <p
                v-if="episodeStates[collection.subject_id ?? 0]?.episodeLoading && !episodeStates[collection.subject_id ?? 0]?.episodes.length"
                class="detail-muted"
              >
                正在加载章节列表... 长时间无反应请尝试刷新。
              </p>
              <p v-else-if="episodeStates[collection.subject_id ?? 0]?.episodeError" class="onboarding__error">
                {{ episodeStates[collection.subject_id ?? 0]?.episodeError }}
              </p>

              <div v-else-if="episodeStates[collection.subject_id ?? 0]?.episodes.length" class="episode-groups">
                <section
                  v-for="group in groupedEpisodes(episodeStates[collection.subject_id ?? 0]?.episodes ?? [])"
                  :key="group.type"
                  class="episode-group"
                >
                  <h6>{{ group.label }} · {{ group.items.length }}</h6>
                  <div class="episode-grid complete-episode-grid">
                    <article
                      v-for="episode in group.items"
                      :key="episode.id"
                      class="episode-cell"
                      :class="[
                        episodeTypeClass(episode.type),
                        episodeStatusClass(episodeStatusType(collection.subject_id ?? 0, episode.id)),
                        episodePopoverPlacementClass(collection.subject_id ?? 0, episode.id),
                        { 'is-saving': episodeStates[collection.subject_id ?? 0]?.episodeSavingId === episode.id },
                      ]"
                      tabindex="0"
                      @mouseenter="onEpisodeHover(collection.subject_id ?? 0, episode.id, $event)"
                      @focusin="onEpisodeHover(collection.subject_id ?? 0, episode.id, $event)"
                    >
                      <span class="episode-cell__type">{{ episodeTypeShort(episode.type) }}</span>
                      <strong class="episode-cell__index">{{ episodeDisplayIndex(episode) }}</strong>

                      <section class="episode-popover complete-episode-popover">
                        <p class="episode-popover__title">{{ preferredSubjectTitle(episode.name, episode.name_cn, "未命名章节") }}</p>
                        <p class="episode-popover__meta">{{ notpreferredSubjectTitle(episode.name, episode.name_cn, "未命名章节") }}</p>
                        <p class="episode-popover__meta">类型：{{ episodeTypeLabel(episode.type) }}</p>
                        <p class="episode-popover__meta" v-if="episode.type === 0">集数：EP {{ episode.ep ?? episode.sort }}</p>
                        <p class="episode-popover__meta" v-else>序号：{{ episode.sort }}（非本篇，ep 无意义）</p>

                        <label class="episode-popover__control">
                          收藏状态
                          <select
                            :value="episodeStatusType(collection.subject_id ?? 0, episode.id)"
                            :disabled="episodeStates[collection.subject_id ?? 0]?.episodeSavingId === episode.id"
                            @change="updateEpisodeStatus(collection.subject_id ?? 0, episode.id, Number(($event.target as HTMLSelectElement).value))"
                          >
                            <option :value="0">未看</option>
                            <option :value="2">看过</option>
                          </select>
                        </label>

                        <button class="secondary-button episode-popover__action" type="button" @click="markEpisodeAndPreviousSeen(collection.subject_id ?? 0, episode.id)">
                          看到
                        </button>
                      </section>
                    </article>
                  </div>
                </section>
              </div>

              <p v-else class="detail-muted">暂无章节信息。</p>
            </section>

            <p v-else class="detail-muted">该条目不支持章节状态管理。</p>
          </div>
        </article>
      </div>
    </article>

    <Pager
      v-if="!loading"
      :page-index="currentPage"
      :prev-disabled="pagination.offset.value === 0"
      :next-disabled="isLastPage"
      @prev="pagination.prevPage()"
      @next="pagination.nextPage()"
    />
  </section>
</template>