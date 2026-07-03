<script setup lang="ts">
defineProps<{
  pageIndex: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
}>();
</script>

<template>
  <footer class="pager">
    <button
      class="secondary-button"
      type="button"
      :disabled="prevDisabled"
      @click="emit('prev')"
    >
      上一页
    </button>
    <span>第 {{ pageIndex }} 页</span>
    <button
      class="secondary-button"
      type="button"
      :disabled="nextDisabled"
      @click="emit('next')"
    >
      下一页
    </button>
  </footer>
</template>
