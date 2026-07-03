<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useSessionStore } from "../stores/session";

const appStore = useAppStore();
const sessionStore = useSessionStore();
const dataStore = useDataStore();

const collections = computed(() => dataStore.collections.value);

function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.common || "";
}

function metaOf(item: {
  rate?: number;
  comment?: string;
  updated_at?: string;
}) {
  return [
    item.rate ? `${item.rate}/10` : "",
    item.comment || "",
    item.updated_at || "",
  ]
    .filter(Boolean)
    .join(" · ");
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
  <section v-else-if="collections.length === 0" class="empty">暂无收藏条目。</section>
  <section v-else class="list">
    <article
      v-for="collection in collections"
      :key="collection.subject_id ?? collection.updated_at ?? collection.comment"
      class="item"
    >
      <div class="cover">
        <img v-if="cover(collection.subject?.images)" :src="cover(collection.subject?.images)" alt="" loading="lazy" />
        <span v-else>BG</span>
      </div>
      <div class="item__main">
        <h2>
          {{ collection.subject?.name_cn || collection.subject?.name || `Subject #${collection.subject_id ?? ""}` }}
        </h2>
        <p>{{ metaOf(collection) || "收藏条目" }}</p>
      </div>
    </article>
  </section>
</template>
