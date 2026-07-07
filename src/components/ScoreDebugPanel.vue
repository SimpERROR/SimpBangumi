<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import type { ScoredCandidate } from "../utils/animeMatch";

const props = defineProps<{
  candidates: ScoredCandidate[];
  bgmName: string;
  locked: boolean;
}>();

const visible = ref(true);
const panel = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });
const panelPos = reactive({ x: window.innerWidth - 320, y: 120 });

function onPointerDown(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest(".debug-panel__header")) return;
  dragging.value = true;
  dragStart.x = e.clientX - panelPos.x;
  dragStart.y = e.clientY - panelPos.y;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  panelPos.x = Math.max(0, Math.min(window.innerWidth - 290, e.clientX - dragStart.x));
  panelPos.y = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragStart.y));
}

function onPointerUp() {
  dragging.value = false;
}

onUnmounted(() => {
  dragging.value = false;
});

const top5 = computed(() => props.candidates.slice(0, 5));

function formatScoreItem(label: string, detail: { score: number; bgmYear?: number | null; TenraiYear?: number | null; bgmEps?: number | null; TenraiEps?: number | null; TenraiType?: string | null; TenraiStatus?: string | null }) {
  let info = "";
  if (detail.TenraiYear !== undefined) info += ` BGM=${detail.bgmYear ?? "-"} JKN=${detail.TenraiYear ?? "-"}`;
  if (detail.TenraiEps !== undefined) info += ` BGM=${detail.bgmEps ?? "-"} JKN=${detail.TenraiEps ?? "-"}`;
  if (detail.TenraiType) info += ` ${detail.TenraiType}`;
  if (detail.TenraiStatus) info += ` ${detail.TenraiStatus}`;
  return `${label}: +${detail.score}${info}`;
}
</script>

<template>
  <div
    v-if="visible"
    ref="panel"
    class="debug-panel"
    :style="{ left: panelPos.x + 'px', top: panelPos.y + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <div class="debug-panel__header">
      <span class="debug-panel__title">
        MAL 匹配 · {{ bgmName.slice(0, 14) }}{{ bgmName.length > 14 ? '…' : '' }}
        <template v-if="locked">🔒</template>
      </span>
      <button class="debug-panel__close" type="button" @click="visible = false">✕</button>
    </div>

    <div v-if="top5.length === 0" class="debug-panel__empty">
      无候选数据。
    </div>

    <div v-for="(sc, i) in top5" :key="sc.item.mal_id" class="debug-panel__candidate" :class="{ 'is-best': i === 0 }">
      <div class="debug-panel__candidate-head">
        <span class="debug-panel__rank">#{{ i + 1 }}</span>
        <span class="debug-panel__malid">MAL #{{ sc.item.mal_id }}</span>
        <span class="debug-panel__total">{{ sc.score.total }}分</span>
      </div>
      <div class="debug-panel__candidate-title">{{ sc.item.title }}</div>
      <div class="debug-panel__score-items">
        <div class="debug-panel__score-item">{{ formatScoreItem('标题', sc.score.title) }} {{ sc.score.title.bgmRomaji ? `"${sc.score.title.bgmRomaji}"` : '' }}</div>
        <div class="debug-panel__score-item">{{ formatScoreItem('年份', sc.score.year) }}</div>
        <div class="debug-panel__score-item">{{ formatScoreItem('集数', sc.score.episodes) }}</div>
        <div class="debug-panel__score-item">{{ formatScoreItem('类型', sc.score.type) }}</div>
        <div class="debug-panel__score-item">{{ formatScoreItem('状态', sc.score.status) }}</div>
        <div class="debug-panel__score-item">
          封面: +{{ sc.score.image?.score ?? 0 }}{{ sc.score.image?.distance != null ? ` (距离=${sc.score.image.distance})` : '' }}
        </div>
      </div>
    </div>
  </div>
</template>
