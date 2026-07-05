<script setup lang="ts">
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();
</script>

<template>
  <div class="onboarding__panel settings-page">

    <h2>标题显示优先级</h2>
    <p class="onboarding__description">设置条目标题优先显示内容。</p>

    <div class="filter-tabs__group" role="radiogroup" aria-label="标题显示优先级">
      <button
        class="filter-tab"
        :class="{ 'is-active': appStore.titlePreference.value === 'translated' }"
        type="button"
        @click="appStore.titlePreference.value = 'translated'"
      >
        译名优先
      </button>
      <button
        class="filter-tab"
        :class="{ 'is-active': appStore.titlePreference.value === 'original' }"
        type="button"
        @click="appStore.titlePreference.value = 'original'"
      >
        原文优先
      </button>
    </div>
  </div>
</template>
