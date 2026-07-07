<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useBangumi } from "../composables/useBangumi";
import { useAppStore } from "../stores/app";
import type { CalendarDay, CalendarSubject } from "../api/bangumi";

const emit = defineEmits<{
  openSubject: [subjectId: number];
}>();

const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

const bangumi = useBangumi();
const appStore = useAppStore();

const calendarDays = ref<CalendarDay[]>([]);
const loading = ref(false);
const error = ref("");
const selectedDayIndex = ref(0);

function getCurrentWeekDays() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push(day);
  }
  return days;
}

const weekDays = computed(() => getCurrentWeekDays());

const todayIndex = computed(() => {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
});

const selectedDaySubjects = computed(() => {
  if (calendarDays.value.length === 0) return [];
  const targetWeekdayId = selectedDayIndex.value + 1;
  const day = calendarDays.value.find((d) => d.weekday.id === targetWeekdayId);
  return day?.items ?? [];
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

function selectDay(index: number) {
  selectedDayIndex.value = index;
}

function openSubject(item: CalendarSubject) {
  emit("openSubject", item.id);
}

async function refresh() {
  loading.value = true;
  error.value = "";
  const result = await bangumi.getCalendar();

  if (!result.ok) {
    error.value = result.error;
    loading.value = false;
    return;
  }

  calendarDays.value = result.data;
  loading.value = false;
}

onMounted(() => {
  selectedDayIndex.value = todayIndex.value;
  refresh();
});

defineExpose({ refresh });
</script>

<template>
  <section class="schedule">
    <!-- Day selector squares -->
    <nav class="schedule__tabs" aria-label="本周日期">
      <button
        v-for="(day, index) in weekDays"
        :key="index"
        class="schedule__day-tab"
        :class="{
          'is-active': selectedDayIndex === index,
          'is-today': todayIndex === index,
        }"
        type="button"
        @click="selectDay(index)"
      >
        <span class="schedule__day-month">{{ day.getMonth() + 1 }}月</span>
        <span class="schedule__day-date">{{ day.getDate() }}</span>
        <span class="schedule__day-weekday">周{{ WEEKDAY_SHORT[index] }}</span>
      </button>
    </nav>

    <!-- Loading state -->
    <section v-if="loading" class="schedule__list">
      <article v-for="n in 5" :key="`schedule-loading-${n}`" class="item is-loading">
        <div></div>
        <span></span>
      </article>
    </section>

    <!-- Error state -->
    <p v-else-if="error" class="schedule__empty">获取排期失败：{{ error }}</p>

    <!-- Empty state -->
    <p v-else-if="selectedDaySubjects.length === 0" class="schedule__empty">
      当日暂无放送番剧。
    </p>

    <!-- Subject list -->
    <section v-else class="schedule__list">
      <button
        v-for="item in selectedDaySubjects"
        :key="item.id"
        class="item item--button schedule__item"
        type="button"
        @click="openSubject(item)"
      >
        <div class="cover">
          <img v-if="cover(item.images)" :src="cover(item.images)" alt="" loading="lazy" />
          <span v-else>BG</span>
        </div>
        <div class="item__main">
          <h2>{{ preferredSubjectTitle(item.name, item.name_cn, `Subject #${item.id}`) }}</h2>
          <p>{{ notpreferredSubjectTitle(item.name, item.name_cn, `Subject #${item.id}`) }}</p>
          <p class="schedule__item-meta">
            类型 {{ subjectTypeLabel(item.type) }}
            <template v-if="item.rating?.score"> · 评分 {{ item.rating.score.toFixed(1) }}</template>
            <template v-if="item.rank"> · Rank {{ item.rank }}</template>
          </p>
        </div>
      </button>
    </section>
  </section>
</template>
