<script setup lang="ts">
import { computed } from "vue";
import logoUrl from "../../app-logo.png";
import { useAppStore } from "../stores/app";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../tauri/windowControls";

const appStore = useAppStore();

const maximizeLabel = computed(() =>
  appStore.window.maximized || appStore.window.fullscreen ? "窗口化" : "最大化",
);

function toggleTheme() {
  appStore.theme.value = appStore.theme.value === "light" ? "dark" : "light";
}

async function onTitleBarDoubleClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.closest("[data-tauri-drag-region]")) {
    return;
  }

  if (appStore.window.fullscreen) {
    return;
  }

  await toggleMaximizeWindow();
}
</script>

<template>
  <header class="titlebar" @dblclick="onTitleBarDoubleClick">
    <div class="titlebar__brand" data-tauri-drag-region>
      <img class="titlebar__logo" :src="logoUrl" alt="SimpBangumi 徽标" />
      <span>SimpBangumi</span>
    </div>
    <div class="titlebar__drag-region" data-tauri-drag-region></div>
    <div class="titlebar__controls">
      <button
        class="icon-button icon-button--text"
        type="button"
        title="切换主题"
        aria-label="切换主题"
        @click="toggleTheme"
      >
        {{ appStore.theme.value === "light" ? "深色" : "浅色" }}
      </button>
      <button
        class="icon-button"
        type="button"
        title="最小化"
        aria-label="最小化"
        @click="minimizeWindow"
      >
        <span class="window-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M3 8.5h10" /></svg>
        </span>
      </button>
      <button
        class="icon-button"
        type="button"
        :title="maximizeLabel"
        :aria-label="maximizeLabel"
        @click="toggleMaximizeWindow"
      >
        <span class="window-icon" aria-hidden="true">
          <svg v-if="appStore.window.maximized || appStore.window.fullscreen" viewBox="0 0 16 16">
            <path d="M5 5.5h6a1.5 1.5 0 0 1 1.5 1.5v4" />
            <path d="M10.5 4H6A1.5 1.5 0 0 0 4.5 5.5V10" />
            <rect x="3.5" y="6.5" width="7" height="6" rx="1.2" />
          </svg>
          <svg v-else viewBox="0 0 16 16">
            <rect x="3" y="3" width="10" height="10" rx="1.5" />
          </svg>
        </span>
      </button>
      <button
        class="icon-button icon-button--danger"
        type="button"
        title="关闭"
        aria-label="关闭"
        @click="closeWindow"
      >
        <span class="window-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></svg>
        </span>
      </button>
    </div>
  </header>
</template>
