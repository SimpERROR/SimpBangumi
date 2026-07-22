<script setup lang="ts">
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
</script>

<template>
  <div class="display-settings">
    <section class="settings-card">
      <h3 class="settings-card__title">更新选项</h3>
      <p class="settings-card__desc">控制应用版本更新行为。</p>
      <label class="toggle-row">
        <span class="toggle-row__label">启动时检查更新</span>
        <input v-model="appStore.checkUpdateOnStartup.value" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__hint">开启后，每次启动应用时会自动从 GitHub 检查是否有新版本可用。</p>
    </section>
  </div>
</template>
