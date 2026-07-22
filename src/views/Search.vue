<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import Pager from "../components/Pager.vue";
import { useBangumi } from "../composables/useBangumi";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";
import { isFollowed } from "../composables/useBroadcastNotify";
import type { PersonCareer, SearchCharacter, SearchPerson, SearchSubject } from "../api/bangumi";

const emit = defineEmits<{
  openSubject: [subjectId: number];
  openCharacter: [characterId: number];
  openPerson: [personId: number];
}>();

const PAGE_SIZE = 20;

type SearchTab = "subject" | "character" | "person";

const appStore = useAppStore();
const dataStore = useDataStore();
const bangumi = useBangumi();
const sessionStore = useSessionStore();

function subjectCollectionType(id: number): number {
  return dataStore.subjectCollectionMap[id] ?? 0;
}

const keyword = ref("");
const submittedKeyword = ref("");
const searching = ref(false);
const error = ref("");
const offset = ref(0);
const total = ref<number | undefined>(undefined);
const subjectResults = ref<SearchSubject[]>([]);
const characterResults = ref<SearchCharacter[]>([]);
const personResults = ref<SearchPerson[]>([]);
const filtersOpen = ref(false);
const searchType = ref<SearchTab>("subject");

// ── Search type tab indicator animation ──
const searchTabsRef = ref<HTMLElement | null>(null);
const tabSubjectRef = ref<HTMLElement | null>(null);
const tabCharacterRef = ref<HTMLElement | null>(null);
const tabPersonRef = ref<HTMLElement | null>(null);

const searchTabRefMap: Record<SearchTab, typeof tabSubjectRef> = {
  subject: tabSubjectRef,
  character: tabCharacterRef,
  person: tabPersonRef,
};

const searchTabIndicatorStyle = ref<{ left: string; width: string }>({ left: "0px", width: "0px" });

function updateSearchTabIndicator() {
  const activeRef = searchTabRefMap[searchType.value];
  const tabEl = activeRef?.value;
  const container = searchTabsRef.value;
  if (!tabEl || !container) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();

  searchTabIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

watch(searchType, () => {
  nextTick(updateSearchTabIndicator);
});

onMounted(() => {
  nextTick(updateSearchTabIndicator);
  window.addEventListener("resize", updateSearchTabIndicator);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateSearchTabIndicator);
});

// ── Subject filters ──
const sort = ref<"match" | "heat" | "rank" | "score">("match");
const subjectFilterForm = reactive({
  subjectTypes: [] as number[],
  tags: "",
  airDateFrom: "",
  airDateTo: "",
  ratingMin: null as number | string | null,
  ratingMax: null as number | string | null,
  ratingCountMin: null as number | string | null,
  rankMin: null as number | string | null,
  rankMax: null as number | string | null,
  includeNsfw: false,
});

// ── Character filters ──
const characterSort = ref<"match" | "heat">("match");
const characterIncludeNsfw = ref(false);

// ── Person filters ──
const personSort = ref<"match" | "heat">("match");
const personCareers = ref<PersonCareer[]>([]);

const CAREER_OPTIONS: { key: PersonCareer; label: string }[] = [
  { key: "producer", label: "制作人" },
  { key: "mangaka", label: "漫画家" },
  { key: "artist", label: "艺术家" },
  { key: "seiyu", label: "声优" },
  { key: "writer", label: "作家" },
  { key: "illustrator", label: "插画家" },
  { key: "actor", label: "演员" },
];

const currentPage = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const hasKeyword = computed(() => submittedKeyword.value.length > 0);

const currentResults = computed(() => {
  if (searchType.value === "character") return characterResults.value;
  if (searchType.value === "person") return personResults.value;
  return subjectResults.value;
});

const isLastPage = computed(() => {
  if (total.value === undefined) {
    return currentResults.value.length < PAGE_SIZE;
  }
  return offset.value + PAGE_SIZE >= total.value;
});

const searchPlaceholder = computed(() => {
  if (searchType.value === "character") return "搜索角色，例如：八六";
  if (searchType.value === "person") return "搜索人物，例如：小见川千明";
  return "搜索条目，例如：孤独摇滚！";
});

const emptyMessage = computed(() => {
  if (searchType.value === "character") return `未找到与\u201c${submittedKeyword.value}\u201d相关的角色。`;
  if (searchType.value === "person") return `未找到与\u201c${submittedKeyword.value}\u201d相关的人物。`;
  return `未找到与\u201c${submittedKeyword.value}\u201d相关的条目。`;
});

function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.common || "";
}

function subjectTypeLabel(type?: number) {
  switch (type) {
    case 1: return "书籍";
    case 2: return "动画";
    case 3: return "音乐";
    case 4: return "游戏";
    case 6: return "三次元";
    default: return type ?? "-";
  }
}

function characterTypeLabel(type?: number) {
  if (type === 1) return "角色";
  if (type === 2) return "机体";
  if (type === 3) return "舰船";
  if (type === 4) return "组织";
  return "其他";
}

function personTypeLabel(type?: number) {
  if (type === 1) return "个人";
  if (type === 2) return "公司";
  if (type === 3) return "组合";
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

function parseFilterList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toggleSubjectType(type: number) {
  if (subjectFilterForm.subjectTypes.includes(type)) {
    subjectFilterForm.subjectTypes = subjectFilterForm.subjectTypes.filter((item) => item !== type);
    return;
  }
  subjectFilterForm.subjectTypes = [...subjectFilterForm.subjectTypes, type];
}

function toggleCareer(career: PersonCareer) {
  if (personCareers.value.includes(career)) {
    personCareers.value = personCareers.value.filter((item) => item !== career);
    return;
  }
  personCareers.value = [...personCareers.value, career];
}

function switchSearchType(type: SearchTab) {
  if (searchType.value === type) return;
  searchType.value = type;
  // Clear results when switching tabs
  subjectResults.value = [];
  characterResults.value = [];
  personResults.value = [];
  submittedKeyword.value = "";
  offset.value = 0;
  total.value = undefined;
  error.value = "";
}

function openSubject(item: SearchSubject) {
  if (!item.id) return;
  emit("openSubject", item.id);
}

function openCharacter(item: SearchCharacter) {
  if (!item.id) return;
  emit("openCharacter", item.id);
}

function openPerson(item: SearchPerson) {
  if (!item.id) return;
  emit("openPerson", item.id);
}

async function executeSearch(resetOffset: boolean) {
  const query = keyword.value.trim();
  if (!query) {
    error.value = "请输入搜索关键词。";
    return;
  }

  if (resetOffset) {
    offset.value = 0;
  }

  searching.value = true;
  error.value = "";

  if (searchType.value === "character") {
    const result = await bangumi.searchCharacters(query, {
      limit: PAGE_SIZE,
      offset: offset.value,
      sort: characterSort.value,
      nsfw: characterIncludeNsfw.value,
    });

    if (!result.ok) {
      error.value = result.error;
      searching.value = false;
      return;
    }

    submittedKeyword.value = query;
    characterResults.value = result.data.data;
    total.value = result.data.total;
  } else if (searchType.value === "person") {
    const result = await bangumi.searchPersons(query, {
      limit: PAGE_SIZE,
      offset: offset.value,
      sort: personSort.value,
      career: personCareers.value.length > 0 ? personCareers.value : undefined,
    });

    if (!result.ok) {
      error.value = result.error;
      searching.value = false;
      return;
    }

    submittedKeyword.value = query;
    personResults.value = result.data.data;
    total.value = result.data.total;
  } else {
    const airDateFilter: string[] = [];
    if (subjectFilterForm.airDateFrom) airDateFilter.push(`>=${subjectFilterForm.airDateFrom}`);
    if (subjectFilterForm.airDateTo) airDateFilter.push(`<=${subjectFilterForm.airDateTo}`);

    const ratingFilter: string[] = [];
    if (subjectFilterForm.ratingMin !== null && subjectFilterForm.ratingMin !== "") ratingFilter.push(`>=${subjectFilterForm.ratingMin}`);
    if (subjectFilterForm.ratingMax !== null && subjectFilterForm.ratingMax !== "") ratingFilter.push(`<=${subjectFilterForm.ratingMax}`);

    const ratingCountFilter: string[] = [];
    if (subjectFilterForm.ratingCountMin !== null && subjectFilterForm.ratingCountMin !== "") ratingCountFilter.push(`>=${subjectFilterForm.ratingCountMin}`);

    const rankFilter: string[] = [];
    if (subjectFilterForm.rankMin !== null && subjectFilterForm.rankMin !== "") rankFilter.push(`>=${subjectFilterForm.rankMin}`);
    if (subjectFilterForm.rankMax !== null && subjectFilterForm.rankMax !== "") rankFilter.push(`<=${subjectFilterForm.rankMax}`);

    const result = await bangumi.searchSubjects(query, {
      limit: PAGE_SIZE,
      offset: offset.value,
      sort: sort.value,
      subject_types: subjectFilterForm.subjectTypes,
      tags: parseFilterList(subjectFilterForm.tags),
      air_date: airDateFilter.length > 0 ? airDateFilter : undefined,
      rating: ratingFilter.length > 0 ? ratingFilter : undefined,
      rating_count: ratingCountFilter.length > 0 ? ratingCountFilter : undefined,
      rank: rankFilter.length > 0 ? rankFilter : undefined,
      nsfw: subjectFilterForm.includeNsfw,
    });

    if (!result.ok) {
      error.value = result.error;
      searching.value = false;
      return;
    }

    submittedKeyword.value = query;
    subjectResults.value = result.data.data;
    total.value = result.data.total;
  }

  searching.value = false;
}

async function search() {
  await executeSearch(true);
}

async function nextPage() {
  if (searching.value || isLastPage.value) return;
  offset.value += PAGE_SIZE;
  await executeSearch(false);
}

async function prevPage() {
  if (searching.value || offset.value === 0) return;
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  await executeSearch(false);
}
</script>

<template>
  <section class="search-panel">
    <p v-if="!sessionStore.authenticated.value" class="search-warning">
      当前未登录。你仍可搜索，但可能无法获取部分特殊结果（如受权限限制或 NSFW 的结果）。
    </p>

    <form class="search-form" @submit.prevent="search">
      <input
        v-model="keyword"
        class="onboarding__input"
        type="search"
        :placeholder="searchPlaceholder"
      />
      <select
        v-if="searchType === 'subject'"
        v-model="sort"
        class="onboarding__input search-form__sort"
        :disabled="searching"
      >
        <option value="match">match（相关度）</option>
        <option value="heat">heat（收藏人数）</option>
        <option value="rank">rank（排名）</option>
        <option value="score">score（评分）</option>
      </select>
      <select
        v-else-if="searchType === 'character'"
        v-model="characterSort"
        class="onboarding__input search-form__sort"
        disabled
      >
        <option value="match">match（相关度）</option>
      </select>
      <select
        v-else
        v-model="personSort"
        class="onboarding__input search-form__sort"
        disabled
      >
        <option value="match">match（相关度）</option>
      </select>
      <button class="primary-button" type="submit" :disabled="searching">
        {{ searching ? "搜索中..." : "搜索" }}
      </button>
    </form>

    <div class="search-toolbar">
      <button class="secondary-button search-filter-toggle" type="button" @click="filtersOpen = !filtersOpen">
        {{ filtersOpen ? "收起筛选" : "展开筛选" }}
      </button>

      <div ref="searchTabsRef" class="tabs search-type-tabs">
        <button
          ref="tabSubjectRef"
          class="tab"
          :class="{ 'is-active': searchType === 'subject' }"
          type="button"
          @click="switchSearchType('subject')"
        >
          条目
        </button>
        <button
          ref="tabCharacterRef"
          class="tab"
          :class="{ 'is-active': searchType === 'character' }"
          type="button"
          @click="switchSearchType('character')"
        >
          角色
        </button>
        <button
          ref="tabPersonRef"
          class="tab"
          :class="{ 'is-active': searchType === 'person' }"
          type="button"
          @click="switchSearchType('person')"
        >
          人物
        </button>
        <div
          class="tab-indicator"
          :style="searchTabIndicatorStyle"
        />
      </div>
    </div>

    <Transition name="filter-collapse">
      <div v-if="filtersOpen" class="search-filters-wrapper">
        <!-- Subject filters -->
        <section v-if="searchType === 'subject'" class="search-filters">
          <div class="search-filters__types">
            <span>条目类型</span>
            <div class="search-filters__chips">
              <button class="filter-chip" :class="{ 'is-active': subjectFilterForm.subjectTypes.includes(1) }" type="button" @click="toggleSubjectType(1)">书籍</button>
              <button class="filter-chip" :class="{ 'is-active': subjectFilterForm.subjectTypes.includes(2) }" type="button" @click="toggleSubjectType(2)">动画</button>
              <button class="filter-chip" :class="{ 'is-active': subjectFilterForm.subjectTypes.includes(3) }" type="button" @click="toggleSubjectType(3)">音乐</button>
              <button class="filter-chip" :class="{ 'is-active': subjectFilterForm.subjectTypes.includes(4) }" type="button" @click="toggleSubjectType(4)">游戏</button>
              <button class="filter-chip" :class="{ 'is-active': subjectFilterForm.subjectTypes.includes(6) }" type="button" @click="toggleSubjectType(6)">三次元</button>
            </div>
          </div>

      <div class="search-filter-range">
        <span class="search-filter-range__label">Tag</span>
        <input v-model="subjectFilterForm.tags" class="onboarding__input" type="text" placeholder="多个用英文逗号分隔，如：机战, 战争" style="flex: 1; min-width: 160px;" />
      </div>

      <div class="search-filter-range">
        <span class="search-filter-range__label">播出日期</span>
        <label>
          不早于（从）
          <input v-model="subjectFilterForm.airDateFrom" class="onboarding__input" type="date" placeholder="可选" />
        </label>
        <label>
          不晚于（至）
          <input v-model="subjectFilterForm.airDateTo" class="onboarding__input" type="date" placeholder="可选" />
        </label>
      </div>

      <div class="search-filter-range">
        <span class="search-filter-range__label">评分</span>
        <label>
          不低于（≥）
          <input v-model.number="subjectFilterForm.ratingMin" class="onboarding__input" type="number" min="0" max="10" step="0.1" placeholder="0" />
        </label>
        <label>
          不高于（≤）
          <input v-model.number="subjectFilterForm.ratingMax" class="onboarding__input" type="number" min="0" max="10" step="0.1" placeholder="10" />
        </label>
      </div>

      <div class="search-filter-range">
        <span class="search-filter-range__label">最低评分人数</span>
        <input v-model.number="subjectFilterForm.ratingCountMin" class="onboarding__input" type="number" min="0" step="1" placeholder="如：500" style="width: 100px;" />
      </div>

      <div class="search-filter-range">
        <span class="search-filter-range__label">排名（越小越高）</span>
        <label>
          不劣于
          <input v-model.number="subjectFilterForm.rankMin" class="onboarding__input" type="number" min="1" step="1" placeholder="可选" />
        </label>
        <label>
          不优于
          <input v-model.number="subjectFilterForm.rankMax" class="onboarding__input" type="number" min="1" step="1" placeholder="如：300" />
        </label>
      </div>
        </section>

        <!-- Character filters -->
        <section v-if="searchType === 'character'" class="search-filters">
          <label class="search-filters__switch">
            <input v-model="characterIncludeNsfw" type="checkbox" />
            包含 NSFW 结果（未登录时此项无效）
          </label>
        </section>

        <!-- Person filters -->
        <section v-if="searchType === 'person'" class="search-filters">
          <div class="search-filters__types">
            <span>职业</span>
            <div class="search-filters__chips">
              <button
                v-for="career in CAREER_OPTIONS"
                :key="career.key"
                class="filter-chip"
                :class="{ 'is-active': personCareers.includes(career.key) }"
                type="button"
                @click="toggleCareer(career.key)"
              >
                {{ career.label }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Transition>

    <section v-if="searching" class="list">
      <article v-for="n in 5" :key="`search-loading-${n}`" class="item is-loading">
        <div></div>
        <span></span>
      </article>
    </section>

    <section v-else-if="error" class="empty">搜索失败：{{ error }}</section>

    <section v-else-if="hasKeyword && currentResults.length === 0" class="empty">
      {{ emptyMessage }}
    </section>

    <section v-else-if="searchType === 'subject' && subjectResults.length > 0" class="list">
      <button v-for="item in subjectResults" :key="item.id" class="item item--button search-item" type="button" @click="openSubject(item)">
        <div class="cover">
          <img v-if="cover(item.images)" :src="cover(item.images)" alt="" loading="lazy" />
          <span v-else>BG</span>
        </div>
        <div class="item__main">
          <h2 :class="{
            'broadcast-followed': appStore.broadcastMarker.parent.value && !appStore.markerIconOnly.value && isFollowed(item.id),
            'is-wish': appStore.wishMarker.parent.value && !appStore.markerIconOnly.value && subjectCollectionType(item.id) === 1,
            'is-collected': appStore.collectedMarker.parent.value && !appStore.markerIconOnly.value && subjectCollectionType(item.id) === 2,
            'is-watching': appStore.watchingMarker.parent.value && !appStore.markerIconOnly.value && subjectCollectionType(item.id) === 3,
            'is-onhold': appStore.onholdMarker.parent.value && !appStore.markerIconOnly.value && subjectCollectionType(item.id) === 4,
            'is-dropped': appStore.droppedMarker.parent.value && !appStore.markerIconOnly.value && subjectCollectionType(item.id) === 5,
          }">
            {{ preferredSubjectTitle(item.name, item.name_cn, `Subject #${item.id}`) }}
            <svg v-if="appStore.broadcastMarker.parent.value && isFollowed(item.id)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
            <svg v-if="appStore.wishMarker.parent.value && subjectCollectionType(item.id) === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
            <svg v-if="appStore.collectedMarker.parent.value && subjectCollectionType(item.id) === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
            <svg v-if="appStore.watchingMarker.parent.value && subjectCollectionType(item.id) === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
            <svg v-if="appStore.onholdMarker.parent.value && subjectCollectionType(item.id) === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
            <svg v-if="appStore.droppedMarker.parent.value && subjectCollectionType(item.id) === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
          </h2>
          <p>{{ notpreferredSubjectTitle(item.name, item.name_cn, `Subject #${item.id}`) }}</p>
          <p class="search-item__meta">
            类型 {{ subjectTypeLabel(item.type) }} · 评分 {{ item.score ?? "-" }} · Rank {{ item.rank ?? "-" }}
          </p>
        </div>
      </button>
    </section>

    <!-- Character results -->
    <section v-else-if="searchType === 'character' && characterResults.length > 0" class="list">
      <button v-for="item in characterResults" :key="item.id" class="item item--button search-item" type="button" @click="openCharacter(item)">
        <div class="cover">
          <img v-if="cover(item.images)" :src="cover(item.images)" alt="" loading="lazy" />
          <span v-else>CH</span>
        </div>
        <div class="item__main">
          <h2>{{ item.name || `Character #${item.id}` }}</h2>
          <p v-if="item.summary" class="search-item__summary">{{ item.summary }}</p>
          <p class="search-item__meta">
            类型 {{ characterTypeLabel(item.type) }}
          </p>
        </div>
      </button>
    </section>

    <!-- Person results -->
    <section v-else-if="searchType === 'person' && personResults.length > 0" class="list">
      <button v-for="item in personResults" :key="item.id" class="item item--button search-item" type="button" @click="openPerson(item)">
        <div class="cover">
          <img v-if="cover(item.images)" :src="cover(item.images)" alt="" loading="lazy" />
          <span v-else>PE</span>
        </div>
        <div class="item__main">
          <h2>{{ item.name || `Person #${item.id}` }}</h2>
          <p v-if="item.summary" class="search-item__summary">{{ item.summary }}</p>
          <p class="search-item__meta">
            类型 {{ personTypeLabel(item.type) }}
            <template v-if="item.career.length > 0">
              · {{ item.career.map((c) => personCareerLabel(c)).join(" / ") }}
            </template>
          </p>
        </div>
      </button>
    </section>

    <Pager
      v-if="hasKeyword && !searching"
      :page-index="currentPage"
      :prev-disabled="offset === 0"
      :next-disabled="isLastPage"
      @prev="prevPage"
      @next="nextPage"
    />
  </section>
</template>
