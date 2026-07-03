import { ref } from "vue";
import type { SubjectCollection, TimelineItem } from "../api/bangumi";

const timeline = ref<TimelineItem[]>([]);
const collections = ref<SubjectCollection[]>([]);

export function useDataStore() {
  return {
    timeline,
    collections,
  };
}
