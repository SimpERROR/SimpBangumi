<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";

const appStore = useAppStore();
const sessionStore = useSessionStore();
const dataStore = useDataStore();

const timeline = computed(() => dataStore.timeline.value);

function formatTimelineMeta(item: { type?: string | number; subject?: { name_cn?: string; name?: string } }) {
  const pieces = [
    typeof item.type === "string" || typeof item.type === "number" ? `type: ${item.type}` : "",
    item.subject?.name_cn || item.subject?.name || "",
  ];

  return pieces.filter(Boolean).join(" · ") || "Timeline item";
}
</script>

<template>
  <section v-if="appStore.error.value" class="empty">加载失败：{{ appStore.error.value }}</section>
  <section v-else-if="!sessionStore.authenticated.value" class="empty">
    请先通过已封装的登录模块完成 Bangumi 登录。
  </section>
  <section v-else-if="appStore.loading.value" class="list">
    <article v-for="n in 5" :key="n" class="item is-loading">
      <div></div>
      <span></span>
    </article>
  </section>
  <section v-else-if="timeline.length === 0" class="empty">暂无 timeline 动态。</section>
  <section v-else class="list">
    <article v-for="item in timeline" :key="item.id ?? item.created_at ?? item.title" class="item">
      <div class="item__main">
        <h2>{{ item.title || item.content || "Bangumi 动态" }}</h2>
        <p>{{ formatTimelineMeta(item) }}</p>
      </div>
      <time>{{ item.created_at || "" }}</time>
    </article>
  </section>
</template>
