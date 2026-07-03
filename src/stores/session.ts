import { computed, ref } from "vue";
import type { AuthSession } from "../api/bangumi";

const session = ref<AuthSession | null>(null);
const authenticated = computed(() => Boolean(session.value?.authenticated));

export function useSessionStore() {
  return {
    session,
    authenticated,
  };
}
