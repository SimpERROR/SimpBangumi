import { reactive, ref } from "vue";
import type { SubjectCollection } from "../api/bangumi";

const collections = ref<SubjectCollection[]>([]);

/** subject_id → collection_type (1=wish,2=collected,3=watching,4=onhold,5=dropped) */
const subjectCollectionMap = reactive<Record<number, number>>({});

function updateSubjectCollectionMap(items: SubjectCollection[]) {
  for (const item of items) {
    if (item.subject_id != null && item.type != null) {
      subjectCollectionMap[item.subject_id] = item.type;
    }
  }
}

export function useDataStore() {
  return {
    collections,
    subjectCollectionMap,
    updateSubjectCollectionMap,
  };
}
