<script setup lang="ts">
import { computed, ref } from "vue";
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
const maskTipVisible = ref(false);
const maskTipX = ref(0);
const maskTipY = ref(0);

const summaryHtml = computed(() => renderBbcodeText(props.content));
const summaryLength = computed(() => (props.content ?? "").trim().length);
const canCollapse = computed(() => summaryLength.value > props.collapseThreshold);

function toggleExpanded() {
  expanded.value = !expanded.value;
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
    <p
      class="bbcode-content bbcode-summary__content"
      :class="{ 'is-collapsed': canCollapse && !expanded }"
      :style="canCollapse && !expanded ? { maxHeight: collapsedMaxHeight } : undefined"
      v-html="summaryHtml"
    ></p>

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
