<script setup lang="ts">
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
</script>

<template>
  <div class="onboarding__panel settings-page">
    <h2>更新选项</h2>
    <p class="onboarding__description">控制应用版本更新行为。</p>

    <label class="settings-toggle" style="margin-top: 12px;">
      <span class="settings-toggle__label">启动时检查更新</span>
      <input v-model="appStore.checkUpdateOnStartup.value" class="settings-toggle__input" type="checkbox" role="switch" />
      <span class="settings-toggle__track" />
    </label>
    <p class="settings-field__hint">
      开启后，每次启动应用时会自动从 GitHub 检查是否有新版本可用。
    </p>
  </div>
</template>

<style scoped>
.settings-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; user-select: none; }
.settings-toggle__label { font-size: 14px; color: var(--text); white-space: nowrap; }
.settings-toggle__input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.settings-toggle__track { position: relative; width: 44px; height: 24px; border-radius: 999px; background: var(--border); transition: background 0.25s ease; flex-shrink: 0; }
.settings-toggle__track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.15); transition: transform 0.25s ease; }
.settings-toggle__input:checked + .settings-toggle__track { background: var(--accent); }
.settings-toggle__input:checked + .settings-toggle__track::after { transform: translateX(20px); }
.settings-field__hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
