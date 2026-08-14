<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { renderBbcodeText } from "../utils/bbcode";

const props = withDefaults(defineProps<{
  content?: string;
  collapseThreshold?: number;
  collapsedMaxHeight?: string;
}>(), {
  content: "",
  collapseThreshold: 220,
  collapsedMaxHeight: "10.2em",
});

const expanded = ref(false);
const contentWrapRef = ref<HTMLElement | null>(null);
const maskTipVisible = ref(false);
const maskTipX = ref(0);
const maskTipY = ref(0);
let heightResetTimer: number | undefined;

const summaryHtml = computed(() => renderBbcodeText(props.content));
const summaryLength = computed(() => (props.content ?? "").trim().length);
const canCollapse = computed(() => summaryLength.value > props.collapseThreshold);

function toggleExpanded() {
  const contentWrap = contentWrapRef.value;
  if (!contentWrap || !canCollapse.value) {
    expanded.value = !expanded.value;
    return;
  }

  const nextExpanded = !expanded.value;
  const currentHeight = contentWrap.getBoundingClientRect().height;

  window.clearTimeout(heightResetTimer);
  contentWrap.style.height = String(currentHeight) + "px";
  void contentWrap.offsetHeight;
  expanded.value = nextExpanded;

  void nextTick(() => {
    const targetHeight = nextExpanded ? contentWrap.scrollHeight : getCollapsedHeight(contentWrap);
    requestAnimationFrame(() => {
      contentWrap.style.height = String(targetHeight) + "px";
    });
    if (nextExpanded) {
      heightResetTimer = window.setTimeout(() => {
        contentWrap.style.height = "";
      }, 360);
    }
  });
}

function getCollapsedHeight(element: HTMLElement) {
  const collapsedHeight = props.collapsedMaxHeight;
  const value = Number.parseFloat(collapsedHeight);
  const maxHeight = collapsedHeight.endsWith("em")
    ? value * Number.parseFloat(getComputedStyle(element).fontSize)
    : collapsedHeight.endsWith("px")
      ? value
      : element.clientHeight;
  return Math.min(element.scrollHeight, maxHeight);
}
function hideMaskTip() {
  maskTipVisible.value = false;
}

function onContainerMouseMove(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    hideMaskTip();
    return;
  }

  const onMask = !!target.closest(".bbcode-mask");
  if (!onMask) {
    hideMaskTip();
    return;
  }

  maskTipVisible.value = true;
  maskTipX.value = event.clientX + 14;
  maskTipY.value = event.clientY + 14;
}
</script>

<template>
  <div
    class="bbcode-summary"
    @mousemove="onContainerMouseMove"
    @mouseleave="hideMaskTip"
  >
    <div
      ref="contentWrapRef"
      class="bbcode-summary__content-wrap"
      :class="{
        'is-collapsed': canCollapse && !expanded,
        'is-expanded': canCollapse && expanded,
      }"
      :style="canCollapse ? { '--bbcode-collapsed-height': props.collapsedMaxHeight } : undefined"
    >
      <p
        class="bbcode-content bbcode-summary__content"
        :class="{ 'is-collapsed': canCollapse && !expanded }"
        v-html="summaryHtml"
      ></p>
    </div>

    <button
      v-if="canCollapse"
      class="secondary-button bbcode-summary__toggle"
      type="button"
      @click="toggleExpanded"
    >
      {{ expanded ? "收起" : "展开全部" }}
    </button>

    <div
      v-if="maskTipVisible"
      class="bbcode-mask-tip"
      :style="{ left: `${maskTipX}px`, top: `${maskTipY}px` }"
    >
      你知道的太多了
    </div>
  </div>
</template>
