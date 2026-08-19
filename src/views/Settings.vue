<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import SettingsHome from "./settings/SettingsHome.vue";

const DisplaySettings = defineAsyncComponent(() => import("./settings/DisplaySettings.vue"));
const CollectionSettings = defineAsyncComponent(() => import("./settings/CollectionSettings.vue"));
const DeveloperSettings = defineAsyncComponent(() => import("./settings/DeveloperSettings.vue"));
const AboutSettings = defineAsyncComponent(() => import("./settings/AboutSettings.vue"));
const WebLoginSettings = defineAsyncComponent(() => import("./settings/WebLoginSettings.vue"));
const BroadcastSettings = defineAsyncComponent(() => import("./settings/BroadcastSettings.vue"));
const RatingComparisonSettings = defineAsyncComponent(() => import("./settings/RatingComparisonSettings.vue"));
const LabSettings = defineAsyncComponent(() => import("./settings/LabSettings.vue"));
const UpdateSettings = defineAsyncComponent(() => import("./settings/UpdateSettings.vue"));
const LegalComplianceSettings = defineAsyncComponent(() => import("./settings/LegalComplianceSettings.vue"));

function preloadSettingsPages() {
  const preloadTasks = [
    import("./settings/DisplaySettings.vue"),
    import("./settings/CollectionSettings.vue"),
    import("./settings/DeveloperSettings.vue"),
    import("./settings/AboutSettings.vue"),
    import("./settings/WebLoginSettings.vue"),
    import("./settings/BroadcastSettings.vue"),
    import("./settings/RatingComparisonSettings.vue"),
    import("./settings/LabSettings.vue"),
    import("./settings/UpdateSettings.vue"),
    import("./settings/LegalComplianceSettings.vue"),
  ];

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => {
      void Promise.allSettled(preloadTasks);
    });
    return;
  }

  setTimeout(() => {
    void Promise.allSettled(preloadTasks);
  }, 150);
}

type SettingsPage = "home" | "display" | "collection" | "web-login" | "broadcast" | "rating-comparison" | "lab" | "update" | "about" | "developer" | "legal-compliance";

const activePage = ref<SettingsPage>("home");

const pageTitle = computed(() => {
  if (activePage.value === "display") {
    return "显示设置";
  }

  if (activePage.value === "collection") {
    return "收藏与进度";
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

  if (activePage.value === "rating-comparison") {
    return "多平台评分比对";
  }

  if (activePage.value === "lab") {
    return "实验室";
  }

  if (activePage.value === "update") {
    return "更新选项";
  }

  if (activePage.value === "legal-compliance") {
    return "法律与合规";
  }

  if (activePage.value === "developer") {
    return "开发者选项";
  }

  return "设置";
});

function openPage(page: Exclude<SettingsPage, "home">) {
  activePage.value = page;
}

function goHome() {
  activePage.value = "home";
}

defineExpose({
  openWebLogin: () => openPage("web-login"),
});

onMounted(() => {
  preloadSettingsPages();
});
</script>

<template>
  <section class="settings-shell">
    <Transition name="settings-page-switch" mode="out-in">
      <div :key="activePage" class="settings-page-stage">
    <div v-if="activePage !== 'home'" class="settings-breadcrumb">
      <button class="secondary-button" type="button" @click="goHome">
        返回设置
      </button>
      <span class="settings-breadcrumb__current">{{ pageTitle }}</span>
    </div>

    <SettingsHome v-if="activePage === 'home'" @open-page="openPage" />
    <DisplaySettings v-else-if="activePage === 'display'" />
    <CollectionSettings v-else-if="activePage === 'collection'" />
    <WebLoginSettings v-else-if="activePage === 'web-login'" />
    <BroadcastSettings v-else-if="activePage === 'broadcast'" />
    <RatingComparisonSettings v-else-if="activePage === 'rating-comparison'" />
    <LabSettings v-else-if="activePage === 'lab'" />
    <UpdateSettings v-else-if="activePage === 'update'" />
    <DeveloperSettings v-else-if="activePage === 'developer'" />
    <LegalComplianceSettings v-else-if="activePage === 'legal-compliance'" />
    <AboutSettings v-else />
      </div>
    </Transition>
  </section>
</template>
