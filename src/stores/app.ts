import { reactive, ref } from "vue";

export type ViewMode = "timeline" | "collections";
export type ThemeMode = "light" | "dark";

const view = ref<ViewMode>("timeline");
const theme = ref<ThemeMode>("light");
const loading = ref(false);
const error = ref("");
const offset = ref(0);
const total = ref<number | undefined>(undefined);
const windowState = reactive({
  maximized: false,
  fullscreen: false,
});

export function useAppStore() {
  return {
    view,
    theme,
    loading,
    error,
    offset,
    total,
    window: windowState,
  };
}
