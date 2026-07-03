<script setup lang="ts">
import { computed, onMounted, watchEffect } from "vue";
import TitleBar from "./components/TitleBar.vue";
import Pager from "./components/Pager.vue";
import TimelineView from "./views/Timeline.vue";
import CollectionsView from "./views/Collections.vue";
import { useAppStore } from "./stores/app";
import { useSessionStore } from "./stores/session";
import { useHome } from "./composables/useHome";
import { usePagination } from "./composables/usePagination";

const appStore = useAppStore();
const sessionStore = useSessionStore();
const pagination = usePagination({
  pageSize: 20,
  initialOffset: appStore.offset.value,
});
const home = useHome({ pagination });

const pageTitle = computed(() =>
  appStore.view.value === "timeline" ? "Timeline" : "Subject Collections",
);

const sessionText = computed(() => {
  if (!sessionStore.session.value) {
    return "读取登录状态中";
  }

  if (!sessionStore.authenticated.value) {
    return "未登录";
  }

  const user = sessionStore.session.value.user;
  return `已登录：${user?.nickname || user?.username || "Bangumi"}`;
});

watchEffect(() => {
  document.documentElement.dataset.theme = appStore.theme.value;
});

onMounted(() => {
  void home.fetchHome();
});
</script>

<template>
  <div class="window">
    <TitleBar />

    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Home</p>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="session">{{ sessionText }}</div>
      </section>

      <section class="toolbar">
        <div class="tabs" role="tablist" aria-label="首页视图">
          <button
            class="tab"
            :class="{ 'is-active': appStore.view.value === 'timeline' }"
            type="button"
            @click="home.setView('timeline')"
          >
            Timeline
          </button>
          <button
            class="tab"
            :class="{ 'is-active': appStore.view.value === 'collections' }"
            type="button"
            @click="home.setView('collections')"
          >
            收藏
          </button>
        </div>
        <button class="secondary-button" type="button" @click="home.refresh">刷新</button>
      </section>

      <TimelineView v-if="appStore.view.value === 'timeline'" />
      <CollectionsView v-else />

      <Pager
        :page-index="home.currentPage.value"
        :prev-disabled="home.offset.value === 0 || home.loading.value"
        :next-disabled="home.isLastPage.value || home.loading.value"
        @prev="home.prevPage"
        @next="home.nextPage"
      />
    </main>
  </div>
</template>
