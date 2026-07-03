import { computed, ref, type ComputedRef, type Ref } from "vue";

interface UsePaginationOptions {
  pageSize?: number;
  initialOffset?: number;
}

export interface PaginationController {
  pageSize: number;
  offset: Ref<number>;
  currentPage: ComputedRef<number>;
  setOffset: (value: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  reset: () => void;
}

export function usePagination(options: UsePaginationOptions = {}) {
  const pageSize = options.pageSize ?? 20;
  const offset = ref(options.initialOffset ?? 0);
  const currentPage = computed(() => Math.floor(offset.value / pageSize) + 1);

  function setOffset(value: number) {
    offset.value = Math.max(0, value);
  }

  function nextPage() {
    offset.value += pageSize;
  }

  function prevPage() {
    offset.value = Math.max(0, offset.value - pageSize);
  }

  function reset() {
    offset.value = 0;
  }

  const controller: PaginationController = {
    pageSize,
    offset,
    currentPage,
    setOffset,
    nextPage,
    prevPage,
    reset,
  };

  return controller;
}
