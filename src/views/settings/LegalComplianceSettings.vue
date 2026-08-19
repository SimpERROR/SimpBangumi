<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import PrivacyDataComplianceSettings from "./PrivacyDataComplianceSettings.vue";
import OAuthSecurityComplianceSettings from "./OAuthSecurityComplianceSettings.vue";
const IntellectualPropertyLicenseSettings = defineAsyncComponent(() => import("./IntellectualPropertyLicenseSettings.vue"));

function preloadLegalCompliancePages() {
  const preloadTasks = [
    import("./IntellectualPropertyLicenseSettings.vue"),
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

type CompliancePage = "home" | "privacy-data" | "oauth-security" | "intellectual-property";

const activePage = ref<CompliancePage>("home");
const pageTitle = computed(() => {
  if (activePage.value === "privacy-data") return "隐私与数据处理";
  if (activePage.value === "oauth-security") return "OAuth 与安全说明";
  if (activePage.value === "intellectual-property") return "知识产权与开源许可";
  return "法律与合规";
});

function openPage(page: Exclude<CompliancePage, "home">) {
  activePage.value = page;
}

onMounted(() => {
  preloadLegalCompliancePages();
});
</script>

<template>
  <Transition name="settings-page-switch" mode="out-in">
    <div :key="activePage" class="legal-compliance">
      <div v-if="activePage !== 'home'" class="settings-breadcrumb legal-compliance__breadcrumb">
        <button class="secondary-button" type="button" @click="activePage = 'home'">返回法律与合规</button>
        <span class="settings-breadcrumb__current">{{ pageTitle }}</span>
      </div>

      <div v-if="activePage === 'home'" class="onboarding__panel settings-page">
        <p class="onboarding__description">查看与本应用相关的数据处理、安全机制、可选多平台评分与小游戏分析、知识产权和开源许可说明。</p>
        <div class="settings-entry-list">
          <button class="item item--button settings-entry" type="button" @click="openPage('privacy-data')">
            <div class="settings-entry__content">
              <h3>隐私与数据处理</h3>
              <p>了解必要数据、多平台评分、本地小游戏分析、数据控制与第三方服务。</p>
            </div>
            <span class="settings-entry__chevron" aria-hidden="true">></span>
          </button>

          <button class="item item--button settings-entry" type="button" @click="openPage('oauth-security')">
            <div class="settings-entry__content">
              <h3>OAuth 与安全说明</h3>
              <p>了解 OAuth 流程、设备密钥与使用免责声明。</p>
            </div>
            <span class="settings-entry__chevron" aria-hidden="true">></span>
          </button>

          <button class="item item--button settings-entry" type="button" @click="openPage('intellectual-property')">
            <div class="settings-entry__content">
              <h3>知识产权与开源许可</h3>
              <p>查看软件版权、第三方组件、内容版权和商标声明。</p>
            </div>
            <span class="settings-entry__chevron" aria-hidden="true">></span>
          </button>
        </div>
      </div>

      <PrivacyDataComplianceSettings v-else-if="activePage === 'privacy-data'" />
      <OAuthSecurityComplianceSettings v-else-if="activePage === 'oauth-security'" />
      <IntellectualPropertyLicenseSettings v-else />
    </div>
  </Transition>
</template>

<style scoped>
.legal-compliance__breadcrumb {
  margin-bottom: 14px;
}
</style>
