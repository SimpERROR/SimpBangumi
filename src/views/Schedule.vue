<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useBangumi } from "../composables/useBangumi";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { isFollowed } from "../composables/useBroadcastNotify";
import type { CalendarDay, CalendarSubject } from "../api/bangumi";

const emit = defineEmits<{
  openSubject: [subjectId: number];
}>();

const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

const bangumi = useBangumi();
const appStore = useAppStore();
const dataStore = useDataStore();

function subjectCollectionType(id: number): number {
  return dataStore.subjectCollectionMap[id] ?? 0;
}

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
