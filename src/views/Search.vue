<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import Pager from "../components/Pager.vue";
import { useBangumi } from "../composables/useBangumi";
import { useAppStore } from "../stores/app";
import { useSessionStore } from "../stores/session";
import type { PersonCareer, SearchCharacter, SearchPerson, SearchSubject } from "../api/bangumi";

const emit = defineEmits<{
  openSubject: [subjectId: number];
  openCharacter: [characterId: number];
  openPerson: [personId: number];
}>();

const PAGE_SIZE = 20;

type SearchTab = "subject" | "character" | "person";

const appStore = useAppStore();
const bangumi = useBangumi();
const sessionStore = useSessionStore();

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
          <h2>{{ preferredSubjectTitle(item.name, item.name_cn, `Subject #${item.id}`) }}</h2>
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
