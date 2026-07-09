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
    <h3 class="settings-page__section-title">配信跟踪（Beta）</h3>
    <p class="onboarding__description">
      配置番剧配信信息的获取方式。
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
          <p>自动匹配在获取依赖信息时使用的数据源。</p>
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
    <div class="settings-page__footer-note">
      <div class="footer-note__header">
        <svg class="footer-note__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M424.5 355.1C449 329.2 464 294.4 464 256C464 176.5 399.5 112 320 112C240.5 112 176 176.5 176 256C176 294.4 191 329.2 215.5 355.1C236.8 377.5 260.4 409.1 268.8 448L371.2 448C379.6 409 403.2 377.5 424.5 355.1zM459.3 388.1C435.7 413 416 443.4 416 477.7L416 496C416 540.2 380.2 576 336 576L304 576C259.8 576 224 540.2 224 496L224 477.7C224 443.4 204.3 413 180.7 388.1C148 353.7 128 307.2 128 256C128 150 214 64 320 64C426 64 512 150 512 256C512 307.2 492 353.7 459.3 388.1zM272 248C272 261.3 261.3 272 248 272C234.7 272 224 261.3 224 248C224 199.4 263.4 160 312 160C325.3 160 336 170.7 336 184C336 197.3 325.3 208 312 208C289.9 208 272 225.9 272 248z" fill="currentColor"/></svg>
        <b>数据源选择提示</b>
      </div>
      <ul class="footer-note__list">
        <li>Tenrai 获取速度更快，但可能存在延迟或不及时更新的情况。</li>
        <li>MAL 官网爬取速度较慢但数据更及时，且不受第三方 API 状态影响。</li>
      </ul>
    </div>
  </div>
</template>
