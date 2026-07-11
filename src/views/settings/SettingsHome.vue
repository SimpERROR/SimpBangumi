<script setup lang="ts">
const emit = defineEmits<{
  (event: "open-page", page: "display" | "web-login" | "broadcast" | "update" | "about" | "developer"): void;
}>();

function openDisplaySettings() {
  emit("open-page", "display");
}

function openBroadcastSettings() {
  emit("open-page", "broadcast");
}

function openUpdateSettings() {
  emit("open-page", "update");
}

function openAboutSettings() {
  emit("open-page", "about");
}

function openWebLoginSettings() {
  emit("open-page", "web-login");
}

function openDeveloperSettings() {
  emit("open-page", "developer");
}
</script>

<template>
  <div class="onboarding__panel settings-page">
    <p class="onboarding__description">请选择要管理的设置页面。</p>

    <div class="settings-entry-list">
      <button class="item item--button settings-entry" type="button" @click="openDisplaySettings">
        <div class="settings-entry__content">
          <h3>显示设置</h3>
          <p>调整应用的显示偏好。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

      <button class="item item--button settings-entry" type="button" @click="openWebLoginSettings">
        <div class="settings-entry__content">
          <h3>网页登录与 Cookie</h3>
          <p>配置网页抓取所需登录态，降低风控影响。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

      <button class="item item--button settings-entry" type="button" @click="openBroadcastSettings">
        <div class="settings-entry__content">
          <h3>配信跟踪（Beta）</h3>
          <p>配置番剧配信数据源与匹配行为。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

      <button class="item item--button settings-entry" type="button" @click="openUpdateSettings">
        <div class="settings-entry__content">
          <h3>更新选项</h3>
          <p>控制应用版本更新的检查行为。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

      <button class="item item--button settings-entry" type="button" @click="openAboutSettings">
        <div class="settings-entry__content">
          <h3>关于</h3>
          <p>查看应用信息、技术栈和开源协议。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

      <button class="item item--button settings-entry" type="button" @click="openDeveloperSettings">
        <div class="settings-entry__content">
          <h3>开发者选项</h3>
          <p>调试工具和高级功能。</p>
        </div>
        <span class="settings-entry__chevron" aria-hidden="true">></span>
      </button>

    </div>
  </div>
</template>
