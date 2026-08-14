<script setup lang="ts">
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
</script>

<template>
  <div class="display-settings">
    <section class="settings-card">
      <h3 class="settings-card__title">收藏状态联动</h3>
      <p class="settings-card__desc">控制条目收藏状态与逐集进度之间的自动同步。</p>

      <label class="toggle-row">
        <span class="toggle-row__label">设为「看过」时同步所有剧集</span>
        <input
          :checked="appStore.autoMarkEpisodesSeen.value"
          class="toggle-row__input"
          type="checkbox"
          role="switch"
          @change="appStore.setAutoMarkEpisodesSeen(($event.target as HTMLInputElement).checked)"
        />
        <span class="toggle-row__track" />
      </label>

      <p class="settings-card__hint">
        开启后，将动画或三次元条目的收藏状态更改为「看过」时，会同时把该条目的所有剧集标记为「看过」。
      </p>
    </section>
  </div>
</template>
