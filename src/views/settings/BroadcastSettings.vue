<script setup lang="ts">
import { ref, watch } from "vue";

const DETAIL_SOURCE_KEY = "bangumi.broadcast.detailSource";
const BROADCAST_DISABLED_KEY = "bangumi.broadcast.disabled";
const NOTIFY_ENABLED_KEY = "bangumi.broadcast.notifyEnabled";
const NOTIFY_BEFORE_MINUTES_KEY = "bangumi.broadcast.notifyBeforeMinutes";
const NOTIFY_DELAY_MINUTES_KEY = "bangumi.broadcast.notifyDelayMinutes";
type DetailSource = "tenrai" | "mal";

const detailSource = ref<DetailSource>(
  (localStorage.getItem(DETAIL_SOURCE_KEY) as DetailSource) || "tenrai",
);

const broadcastDisabled = ref(
  localStorage.getItem(BROADCAST_DISABLED_KEY) === "1",
);

const notifyEnabled = ref(
  localStorage.getItem(NOTIFY_ENABLED_KEY) === "1",
);

const notifyBeforeMinutes = ref(
  Number(localStorage.getItem(NOTIFY_BEFORE_MINUTES_KEY)) || 5,
);

const notifyDelayMinutes = ref(
  Number(localStorage.getItem(NOTIFY_DELAY_MINUTES_KEY)) || 0,
);

watch(detailSource, (val) => {
  localStorage.setItem(DETAIL_SOURCE_KEY, val);
});

watch(broadcastDisabled, (val) => {
  localStorage.setItem(BROADCAST_DISABLED_KEY, val ? "1" : "0");
});

watch(notifyEnabled, (val) => {
  localStorage.setItem(NOTIFY_ENABLED_KEY, val ? "1" : "0");
});

watch(notifyBeforeMinutes, (val) => {
  localStorage.setItem(NOTIFY_BEFORE_MINUTES_KEY, String(val));
});

watch(notifyDelayMinutes, (val) => {
  localStorage.setItem(NOTIFY_DELAY_MINUTES_KEY, String(val));
});
</script>

<template>
  <div class="display-settings">

    <!-- ═══ 数据源 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">配信跟踪</h3>
      <p class="settings-card__desc">配置番剧配信信息的获取方式与数据源。</p>

      <label class="toggle-row">
        <span class="toggle-row__label">禁用配信跟踪</span>
        <input v-model="broadcastDisabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">详细信息数据源</h4>
        <p class="settings-card__hint">获取番剧配信时间、状态、集数等信息时使用的数据源。自动匹配默认使用 Tenrai API。</p>
        <select v-model="detailSource" class="broadcast-select">
          <option value="tenrai">Tenrai API</option>
          <option value="mal">MAL 官网爬取</option>
        </select>
      </div>
    </section>

    <!-- ═══ 配信提示 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">配信提示</h3>
      <p class="settings-card__desc">在番剧配信前和配信开始时收到浮窗通知。</p>

      <label class="toggle-row">
        <span class="toggle-row__label">启用配信提示</span>
        <input v-model="notifyEnabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>

      <template v-if="notifyEnabled">
        <div class="settings-card__field">
          <label class="settings-card__field-label">提前通知（分钟）</label>
          <div class="settings-card__row">
            <input v-model.number="notifyBeforeMinutes" type="number" min="1" max="120" class="onboarding__input" style="width: 80px;" />
            <span class="settings-card__hint">配信开始前多少分钟发送提示</span>
          </div>
        </div>

        <div class="settings-card__field">
          <label class="settings-card__field-label">延迟通知（分钟）</label>
          <div class="settings-card__row">
            <input v-model.number="notifyDelayMinutes" type="number" min="0" max="120" class="onboarding__input" style="width: 80px;" />
            <span class="settings-card__hint">所有通知延迟发送，设为 0 则不延迟</span>
          </div>
        </div>
      </template>
    </section>

    <!-- ═══ 数据源提示 ═══ -->
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

<style scoped>
.broadcast-select {
  width: auto;
  min-width: 160px;
  justify-self: start;
}
</style>
