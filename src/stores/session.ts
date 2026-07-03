import { computed, ref } from "vue";
import type { AuthSession } from "../api/bangumi";

const session = ref<AuthSession | null>(null);
const oauthTokens = ref<{
  accessToken: string;
  refreshToken: string | null;
  userId: string | null;
} | null>(null);
const authenticated = computed(() => {
  return Boolean(oauthTokens.value?.accessToken) || Boolean(session.value?.authenticated);
});

export function useSessionStore() {
  return {
    session,
    oauthTokens,
    authenticated,
  };
}
