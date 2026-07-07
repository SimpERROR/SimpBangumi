<script setup lang="ts">
import { ref, watch } from "vue";

const DETAIL_SOURCE_KEY = "bangumi.broadcast.detailSource";
const BROADCAST_DISABLED_KEY = "bangumi.broadcast.disabled";
type DetailSource = "tenrai" | "mal";

const detailSource = ref<DetailSource>(
  (localStorage.getItem(DETAIL_SOURCE_KEY) as DetailSource) || "tenrai",
);

const broadcastDisabled = ref(
  localStorage.getItem(BROADCAST_DISABLED_KEY) === "1",
);

watch(detailSource, (val) => {
  localStorage.setItem(DETAIL_SOURCE_KEY, val);
});

watch(broadcastDisabled, (val) => {
  localStorage.setItem(BROADCAST_DISABLED_KEY, val ? "1" : "0");
});
</script>

<template>
  <div class="onboarding__panel settings-page">
    <h3 class="settings-page__section-title">配信跟踪</h3>
    <p class="onboarding__description">
      配置番剧配信信息的获取方式。自动匹配始终使用 Tenrai API。
    </p>

    <div class="settings-entry-list">
      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>禁用配信跟踪</h3>
          <p>开启后将不再获取任何番剧的配信信息。</p>
        </div>
        <label class="settings-toggle">
          <input v-model="broadcastDisabled" type="checkbox" />
          <span class="settings-toggle__slider"></span>
        </label>
      </div>

      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>自动匹配数据源</h3>
          <p>Tenrai API（不可更改）</p>
        </div>
        <span class="settings-entry__fixed">Tenrai API</span>
      </div>

      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>详细信息数据源</h3>
          <p>获取番剧配信时间、状态、集数等详细信息时使用的数据源。</p>
        </div>
        <select v-model="detailSource" class="onboarding__input" style="width:auto">
          <option value="tenrai">Tenrai API</option>
          <option value="mal">MAL 官网爬取</option>
        </select>
      </div>
    </div>

    <p class="onboarding__description settings-page__footer-note">
      MAL 官网爬取速度较慢但数据更及时，且不受第三方 API 状态影响。
    </p>
  </div>
</template>
