<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Pager from "../components/Pager.vue";
import { useBangumi } from "../composables/useBangumi";
import { useAppStore } from "../stores/app";
import { useSessionStore } from "../stores/session";
import type { SearchSubject } from "../api/bangumi";

const emit = defineEmits<{
  openSubject: [subjectId: number];
}>();

const PAGE_SIZE = 20;

const appStore = useAppStore();
const bangumi = useBangumi();
const sessionStore = useSessionStore();

const keyword = ref("");
const submittedKeyword = ref("");
const searching = ref(false);
const error = ref("");
const offset = ref(0);
const total = ref<number | undefined>(undefined);
const results = ref<SearchSubject[]>([]);
const filtersOpen = ref(false);

const sort = ref<"match" | "heat" | "rank" | "score">("match");
const filterForm = reactive({
  subjectTypes: [] as number[],
  tags: "",
  airDate: "",
  rating: "",
  ratingCount: "",
  rank: "",
  includeNsfw: false,
});

const currentPage = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const hasKeyword = computed(() => submittedKeyword.value.length > 0);
const isLastPage = computed(() => {
  if (total.value === undefined) {
    return results.value.length < PAGE_SIZE;
  }

  return offset.value + PAGE_SIZE >= total.value;
});

function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.common || "";
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
      return type ?? "-";
  }
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
  if (filterForm.subjectTypes.includes(type)) {
    filterForm.subjectTypes = filterForm.subjectTypes.filter((item) => item !== type);
    return;
  }

  filterForm.subjectTypes = [...filterForm.subjectTypes, type];
}

function openSubject(item: SearchSubject) {
  if (!item.id) {
    return;
  }

  emit("openSubject", item.id);
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

  const result = await bangumi.searchSubjects(query, {
    limit: PAGE_SIZE,
    offset: offset.value,
    sort: sort.value,
    subject_types: filterForm.subjectTypes,
    tags: parseFilterList(filterForm.tags),
    air_date: parseFilterList(filterForm.airDate),
    rating: parseFilterList(filterForm.rating),
    rating_count: parseFilterList(filterForm.ratingCount),
    rank: parseFilterList(filterForm.rank),
    nsfw: filterForm.includeNsfw,
  });

  if (!result.ok) {
    error.value = result.error;
    searching.value = false;
    return;
  }

  submittedKeyword.value = query;
  results.value = result.data.data;
  total.value = result.data.total;
  searching.value = false;
}

async function search() {
  await executeSearch(true);
}

async function nextPage() {
  if (searching.value || isLastPage.value) {
    return;
  }

  offset.value += PAGE_SIZE;
  await executeSearch(false);
}

async function prevPage() {
  if (searching.value || offset.value === 0) {
    return;
  }

  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  await executeSearch(false);
}
</script>

<template>
  <section class="search-panel">
    <p v-if="!sessionStore.authenticated.value" class="search-warning">
      当前未登录。你仍可搜索条目，但可能无法获取部分特殊条目（如受权限限制或 NSFW 的结果）。
    </p>

    <form class="search-form" @submit.prevent="search">
      <input
        v-model="keyword"
        class="onboarding__input"
        type="search"
        placeholder="搜索条目，例如：孤独摇滚！"
      />
      <select v-model="sort" class="onboarding__input search-form__sort" :disabled="searching">
        <option value="match">match（相关度）</option>
        <option value="heat">heat（收藏人数）</option>
        <option value="rank">rank（排名）</option>
        <option value="score">score（评分）</option>
      </select>
      <button class="primary-button" type="submit" :disabled="searching">
        {{ searching ? "搜索中..." : "搜索" }}
      </button>
    </form>

    <button class="secondary-button search-filter-toggle" type="button" @click="filtersOpen = !filtersOpen">
      {{ filtersOpen ? "收起筛选" : "展开筛选" }}
    </button>

    <section v-if="filtersOpen" class="search-filters">
      <div class="search-filters__types">
        <span>条目类型</span>
        <div class="search-filters__chips">
          <button class="filter-chip" :class="{ 'is-active': filterForm.subjectTypes.includes(1) }" type="button" @click="toggleSubjectType(1)">书籍</button>
          <button class="filter-chip" :class="{ 'is-active': filterForm.subjectTypes.includes(2) }" type="button" @click="toggleSubjectType(2)">动画</button>
          <button class="filter-chip" :class="{ 'is-active': filterForm.subjectTypes.includes(3) }" type="button" @click="toggleSubjectType(3)">音乐</button>
          <button class="filter-chip" :class="{ 'is-active': filterForm.subjectTypes.includes(4) }" type="button" @click="toggleSubjectType(4)">游戏</button>
          <button class="filter-chip" :class="{ 'is-active': filterForm.subjectTypes.includes(6) }" type="button" @click="toggleSubjectType(6)">三次元</button>
        </div>
      </div>

      <label>
        tag（多个用英文逗号分隔，且关系）
        <input v-model="filterForm.tags" class="onboarding__input" type="text" placeholder="如：机战, 战争" />
      </label>

      <label>
        air_date（多个用英文逗号分隔）
        <input v-model="filterForm.airDate" class="onboarding__input" type="text" placeholder="如：>=2020-01-01,<2021-01-01" />
      </label>

      <label>
        rating（多个用英文逗号分隔）
        <input v-model="filterForm.rating" class="onboarding__input" type="text" placeholder="如：>=7,<9" />
      </label>

      <label>
        rating_count（多个用英文逗号分隔）
        <input v-model="filterForm.ratingCount" class="onboarding__input" type="text" placeholder="如：>=500" />
      </label>

      <label>
        rank（多个用英文逗号分隔）
        <input v-model="filterForm.rank" class="onboarding__input" type="text" placeholder="如：<=300" />
      </label>

      <label class="search-filters__switch">
        <input v-model="filterForm.includeNsfw" type="checkbox" />
        包含 NSFW 结果（未登录时此项无效）
      </label>
    </section>

    <section v-if="searching" class="list">
      <article v-for="n in 5" :key="`search-loading-${n}`" class="item is-loading">
        <div></div>
        <span></span>
      </article>
    </section>

    <section v-else-if="error" class="empty">搜索失败：{{ error }}</section>

    <section v-else-if="hasKeyword && results.length === 0" class="empty">
      未找到与“{{ submittedKeyword }}”相关的条目。
    </section>

    <section v-else-if="results.length > 0" class="list">
      <button v-for="item in results" :key="item.id" class="item item--button search-item" type="button" @click="openSubject(item)">
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
