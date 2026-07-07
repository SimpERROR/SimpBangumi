<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { TenraiAnimeFull } from "../api/Tenrai";
import {
  calculateBroadcast,
  type BroadcastTiming,
} from "../utils/broadcastTiming";

const props = defineProps<{
  TenraiData: TenraiAnimeFull | null;
  loading: boolean;
  refreshing?: boolean;
}>();

const now = ref(Date.now());
let timer: number | null = null;

onUnmounted(() => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
});

// Update every second when countdown is active
watch(
  () => props.TenraiData,
  (data) => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (data) {
      timer = window.setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }
  },
  { immediate: true },
);

const timing = computed<BroadcastTiming | null>(() => {
  if (!props.TenraiData) return null;
  const currentTime = new Date(now.value);
  return calculateBroadcast(
    props.TenraiData.broadcast,
    props.TenraiData.status,
    props.TenraiData.duration,
    props.TenraiData.aired?.from ?? null,
    props.TenraiData.aired?.to ?? null,
    currentTime,
  );
});

const displayText = computed(() => timing.value?.displayText ?? "");
const subText = computed(() => timing.value?.subText ?? "");
const statusClass = computed(() => `broadcast--${timing.value?.status ?? "unknown"}`);
const showBanner = computed(() => timing.value !== null);
</script>

<template>
  <div v-if="showBanner" class="broadcast-banner" :class="statusClass">
    <svg
      class="broadcast-banner__icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 640"
      aria-hidden="true"
    >
      <path
        d="M432 423.8C471.1 391.5 496 342.7 496 288C496 190.8 417.2 112 320 112C222.8 112 144 190.8 144 288C144 342.7 168.9 391.5 208 423.8C208.4 441.4 211.2 464.2 214.4 485.6C144 447.9 96 373.5 96 288C96 164.3 196.3 64 320 64C443.7 64 544 164.3 544 288C544 373.6 496 447.9 425.5 485.6C428.8 464.2 431.5 441.4 431.9 423.8zM418 370.4C409.7 357.8 398.8 348.8 387.6 342.6C385.5 341.5 383.4 340.4 381.3 339.4C393 325.5 400.1 307.5 400.1 287.9C400.1 243.7 364.3 207.9 320.1 207.9C275.9 207.9 240.1 243.7 240.1 287.9C240.1 307.5 247.2 325.5 258.9 339.4C256.8 340.4 254.7 341.4 252.6 342.6C241.4 348.8 230.5 357.8 222.2 370.4C203.4 348.1 192.1 319.4 192.1 288C192.1 217.3 249.4 160 320.1 160C390.8 160 448.1 217.3 448.1 288C448.1 319.4 436.8 348.2 418 370.4zM320 376C352.9 376 384 384.6 384 419.8C384 452.8 371.1 523.9 363.4 552.7C358.3 571.7 338.9 576.1 320 576.1C301.1 576.1 281.8 571.7 276.6 552.7C268.8 524.2 256 453 256 419.9C256 384.8 287.1 376.1 320 376.1zM320 248C342.1 248 360 265.9 360 288C360 310.1 342.1 328 320 328C297.9 328 280 310.1 280 288C280 265.9 297.9 248 320 248z"
      />
    </svg>
    <div class="broadcast-banner__text">
      <p class="broadcast-banner__title">{{ displayText }}</p>
      <p class="broadcast-banner__sub">{{ subText }}</p>
    </div>
  </div>
  <div v-else-if="loading" class="broadcast-banner broadcast--loading">
    <div class="broadcast-banner__text">
      <p class="broadcast-banner__title">{{ refreshing ? '正在加载配信信息...' : '正在匹配配信信息...' }}</p>
    </div>
  </div>
</template>
