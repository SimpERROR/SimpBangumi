<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { useBangumi } from "../composables/useBangumi";
import type { Episode, SubjectCollection, SubjectDetail, UserSubjectCollection } from "../api/bangumi";

const appStore = useAppStore();
const sessionStore = useSessionStore();
const dataStore = useDataStore();
const bangumi = useBangumi();
const currentUsername = computed(() => sessionStore.session.value?.user?.username ?? "");

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

const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref("");
const detail = ref<SubjectDetail | null>(null);
const preDetailLoading = ref(false);

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
  if (!detail.value) {
    return "";
  }

  return preferredSubjectTitle(detail.value.name, detail.value.name_cn, `Subject #${detail.value.id}`);
});

const ratingRows = computed(() => {
  const count = detail.value?.rating.count ?? {};
  const values = ratingOrder.map((score) => Number(count[String(score)] ?? 0));
  const max = Math.max(1, ...values);

  return ratingOrder.map((score) => {
    const value = Number(count[String(score)] ?? 0);
    return {
      score,
      value,
      width: Math.max(4, Math.round((value / max) * 100)),
    };
  });
});

const collectionRows = computed(() => {
  const collection = detail.value?.collection;
  if (!collection) {
    return [] as Array<{ label: string; value: number; width: number }>;
  }

  const rows = [
    { label: "想看", value: Number(collection.wish ?? 0) },
    { label: "看过", value: Number(collection.collect ?? 0) },
    { label: "在看", value: Number(collection.doing ?? 0) },
    { label: "搁置", value: Number(collection.on_hold ?? 0) },
    { label: "抛弃", value: Number(collection.dropped ?? 0) },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));

  return rows.map((row) => ({
    ...row,
    width: Math.max(4, Math.round((row.value / max) * 100)),
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

  if (!prefetchedDetail) {
    const detailResult = await bangumi.getSubjectDetail(subjectId);

    if (!detailResult.ok) {
      detailError.value = detailResult.error;
      detailLoading.value = false;
      return;
    }

    detail.value = detailResult.data;
  }

  if (userCanEditCollection.value) {
    await loadUserCollection(subjectId);
  } else {
    fillCollectionForm(null);
    collectionError.value = "";
    collectionSavedMessage.value = "";
  }

  await loadEpisodesForDetail(subjectId);

  detailLoading.value = false;
}

function closeDetail() {
  detailOpen.value = false;
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
      <p>这个条目被标记为 NSFW，继续访问前请确认你希望查看相关内容。</p>
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
    <section v-else-if="detail" class="detail-content">
      <article class="detail-hero">
        <div class="detail-hero__cover">
          <img v-if="detailCover(detail.images)" :src="detailCover(detail.images)" alt="" loading="lazy" />
          <span v-else>BG</span>
        </div>
        <div class="detail-hero__titles">
          <h3>{{ preferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}</h3>
          <p>{{ notpreferredSubjectTitle(detail.name, detail.name_cn, `Subject #${detail.id}`) }}</p>
        </div>
      </article>

      <article class="detail-section">
        <h4>简介</h4>
        <p>{{ detail.summary || "暂无简介" }}</p>
      </article>

      <article class="detail-section">
        <h4>其他详细信息</h4>
        <dl class="detail-grid">
          <div><dt>ID</dt><dd>{{ detail.id }}</dd></div>
          <div><dt>类型</dt><dd>{{ SUBJECT_TYPE_LABEL[detail.type] || detail.type }}</dd></div>
          <div><dt>系列条目</dt><dd>{{ detail.series ? "是" : "否" }}</dd></div>
          <div><dt>NSFW</dt><dd>{{ detail.nsfw ? "是" : "否" }}</dd></div>
          <div><dt>锁定</dt><dd>{{ detail.locked ? "是" : "否" }}</dd></div>
          <div><dt>日期</dt><dd>{{ detail.date || "-" }}</dd></div>
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

      <article class="detail-section">
        <h4>用户的收藏与完成状态</h4>
        <p v-if="!userCanEditCollection">请先登录后查看和修改你的收藏状态。</p>
        <template v-else>
          <p v-if="collectionLoading">正在读取你的收藏状态...</p>
          <p v-else-if="collectionUpdatedAt" class="detail-muted">最近更新：{{ collectionUpdatedAt }}</p>
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

      <article class="detail-section">
        <h4>站内评分与收藏信息</h4>
        <dl class="detail-grid">
          <div><dt>排名</dt><dd>{{ detail.rating.rank }}</dd></div>
          <div><dt>评分</dt><dd>{{ detail.rating.score }}</dd></div>
          <div><dt>评分人数</dt><dd>{{ detail.rating.total }}</dd></div>
          <div><dt>想看</dt><dd>{{ detail.collection.wish }}</dd></div>
          <div><dt>看过</dt><dd>{{ detail.collection.collect }}</dd></div>
          <div><dt>在看</dt><dd>{{ detail.collection.doing }}</dd></div>
          <div><dt>搁置</dt><dd>{{ detail.collection.on_hold }}</dd></div>
          <div><dt>抛弃</dt><dd>{{ detail.collection.dropped }}</dd></div>
        </dl>

        <div class="chart-group">
          <div class="chart-block">
            <h5>评分分布</h5>
            <ul class="chart-list">
              <li v-for="row in ratingRows" :key="row.score" class="chart-item">
                <span class="chart-item__label">{{ row.score }} 分</span>
                <div class="chart-item__bar">
                  <span class="chart-item__fill" :style="{ width: `${row.width}%` }"></span>
                </div>
                <strong class="chart-item__value">{{ row.value }}</strong>
              </li>
            </ul>
          </div>

          <div class="chart-block">
            <h5>收藏状态分布</h5>
            <ul class="chart-list">
              <li v-for="row in collectionRows" :key="row.label" class="chart-item">
                <span class="chart-item__label">{{ row.label }}</span>
                <div class="chart-item__bar">
                  <span class="chart-item__fill chart-item__fill--collection" :style="{ width: `${row.width}%` }"></span>
                </div>
                <strong class="chart-item__value">{{ row.value }}</strong>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </section>
  </aside>
</template>
