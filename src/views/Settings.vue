<script setup lang="ts">
import { computed, ref } from "vue";
import SettingsHome from "./settings/SettingsHome.vue";
import DisplaySettings from "./settings/DisplaySettings.vue";
import AboutSettings from "./settings/AboutSettings.vue";
import WebLoginSettings from "./settings/WebLoginSettings.vue";

type SettingsPage = "home" | "display" | "web-login" | "about";

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

  return "设置";
});

function openPage(page: "display" | "web-login" | "about") {
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
    <AboutSettings v-else />
  </section>
</template>
