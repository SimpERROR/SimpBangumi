import { ref } from "vue";
import type { SubjectCollection } from "../api/bangumi";

const collections = ref<SubjectCollection[]>([]);

export function useDataStore() {
  return {
    collections,
  };
}
