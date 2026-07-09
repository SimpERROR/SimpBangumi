<script setup lang="ts">
import { computed, ref } from "vue";
import SettingsHome from "./settings/SettingsHome.vue";
import DisplaySettings from "./settings/DisplaySettings.vue";
import DeveloperSettings from "./settings/DeveloperSettings.vue";
import AboutSettings from "./settings/AboutSettings.vue";
import WebLoginSettings from "./settings/WebLoginSettings.vue";
import BroadcastSettings from "./settings/BroadcastSettings.vue";

type SettingsPage = "home" | "display" | "web-login" | "broadcast" | "about" | "developer";

const activePage = ref<SettingsPage>("home");

const pageTitle = computed(() => {
  if (activePage.value === "display") {
    return "显示设置";
  }

  if (activePage.value === "about") {
    return "关于";
  }

  if (activePage.value === "web-login") {
    return "网页登录与 Cookie";
  }

  if (activePage.value === "broadcast") {
    return "配信跟踪（Beta）";
  }

  if (activePage.value === "developer") {
    return "开发者选项";
  }

  return "设置";
});

function openPage(page: "display" | "web-login" | "broadcast" | "about" | "developer") {
  activePage.value = page;
}

function goHome() {
  activePage.value = "home";
}
</script>

<template>
  <section class="settings-shell">
    <div v-if="activePage !== 'home'" class="settings-breadcrumb">
      <button class="secondary-button" type="button" @click="goHome">
        返回设置
      </button>
      <span class="settings-breadcrumb__current">{{ pageTitle }}</span>
    </div>

    <SettingsHome v-if="activePage === 'home'" @open-page="openPage" />
    <DisplaySettings v-else-if="activePage === 'display'" />
    <WebLoginSettings v-else-if="activePage === 'web-login'" />
    <BroadcastSettings v-else-if="activePage === 'broadcast'" />
    <DeveloperSettings v-else-if="activePage === 'developer'" />
    <AboutSettings v-else />
  </section>
</template>
