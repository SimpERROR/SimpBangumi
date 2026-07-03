import { reactive, ref } from "vue";

export type ThemeMode = "light" | "dark";
export type SubjectTypeFilter = 1 | 2 | 3 | 4 | 6 | "all";
export type CollectionTypeFilter = 1 | 2 | 3 | 4 | 5 | "all";
export type TitlePreference = "translated" | "original";

const theme = ref<ThemeMode>("light");
const loading = ref(false);
const error = ref("");
const offset = ref(0);
const total = ref<number | undefined>(undefined);
const subjectTypeFilter = ref<SubjectTypeFilter>("all");
const collectionTypeFilter = ref<CollectionTypeFilter>("all");
const titlePreference = ref<TitlePreference>("translated");
const windowState = reactive({
  maximized: false,
  fullscreen: false,
});

export function useAppStore() {
  return {
    theme,
    loading,
    error,
    offset,
    total,
    subjectTypeFilter,
    collectionTypeFilter,
    titlePreference,
    window: windowState,
  };
}
