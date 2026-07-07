<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Pager from "../components/Pager.vue";
import { useBangumi } from "../composables/useBangumi";
import { usePagination } from "../composables/usePagination";
import { useAppStore } from "../stores/app";
import { useSessionStore } from "../stores/session";
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
            <button class="complete-item__title" type="button" @click="openSubject(collection.subject_id)">
              {{ collectionCardTitle(collection) }}
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