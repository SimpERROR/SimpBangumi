import { getCurrentWindow } from "@tauri-apps/api/window";
import { nextTick } from "vue";
import { withAuthTransition } from "../api/authRequestGate";
import type { AuthSession } from "../api/bangumi";
import { useAppStore } from "../stores/app";
import { useSessionStore } from "../stores/session";
import { useBangumi, type ApiResult } from "./useBangumi";

const OAUTH_POLL_INTERVAL_MS = 800;
const OAUTH_WAIT_TIMEOUT_MS = 190000;
let refreshInFlight: Promise<ApiResult<AuthSession>> | null = null;

function logInfo(message: string, extra?: Record<string, unknown>) {
  console.info("[auth]", message, extra ?? {});
}

function logError(message: string, error: unknown, extra?: Record<string, unknown>) {
  console.error("[auth]", message, {
    ...extra,
    error: error instanceof Error ? error.message : String(error),
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function focusAppWindow() {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.show();
    await appWindow.unminimize();
    await appWindow.setAlwaysOnTop(true);
    try {
      await appWindow.setFocus();
    } finally {
      await appWindow.setAlwaysOnTop(false);
    }
  } catch {
    // Browser development mode has no Tauri window.
  }
}

export function useAuth() {
  const bangumi = useBangumi();
  const sessionStore = useSessionStore();
  const appStore = useAppStore();

  async function startOAuthLogin(_theme?: string): Promise<ApiResult<string>> {
    logInfo("starting OAuth login");
    const result = await bangumi.startOAuthLogin({});
    if (result.ok) {
      logInfo("OAuth authorize URL ready");
    } else {
      logError("failed to start OAuth login", result.error);
    }

    return result;
  }

  async function finishOAuthLogin(options: {
    showWorkerOverlay?: boolean;
    onWorkerCommunication?: () => void;
  } = {}): Promise<ApiResult<AuthSession>> {
    logInfo("waiting for OAuth callback");
    const deadline = Date.now() + OAUTH_WAIT_TIMEOUT_MS;
    let callback = await bangumi.finishOAuthLogin();
    let pollCount = 0;
    let workerPhaseStarted = false;

    while (callback.ok && !callback.data.completed && Date.now() < deadline) {
      if (callback.data.authorized && !workerPhaseStarted) {
        workerPhaseStarted = true;
        options.onWorkerCommunication?.();
        if (options.showWorkerOverlay ?? true) {
          appStore.workersCommunicating.value = true;
        }
        await nextTick();
        await focusAppWindow();
      } else {
        await sleep(OAUTH_POLL_INTERVAL_MS);
      }

      pollCount += 1;
      callback = await bangumi.finishOAuthLogin();
    }

    logInfo("OAuth callback wait finished", {
      pollCount,
      completed: callback.ok ? callback.data.completed : false,
      authorized: callback.ok ? callback.data.authorized : false,
    });

    try {
      if (!callback.ok) {
        logError("OAuth callback polling failed", callback.error);
        return { ok: false, data: null, error: callback.error };
      }

      if (!callback.data.completed) {
        logError("OAuth login timed out", "timeout", { pollCount });
        return {
          ok: false,
          data: null,
          error: "OAuth login timed out, please try again.",
        };
      }

      if (callback.data.error || !callback.data.session) {
        logError("OAuth callback returned error", callback.data.error ?? "missing session");
        return {
          ok: false,
          data: null,
          error: callback.data.error ?? "OAuth login did not return a session",
        };
      }
      const session = callback.data.session;

      const login = await withAuthTransition(async () => {
        sessionStore.session.value = session;
        return { ok: true as const, data: session, error: null };
      });
      if (!login.ok) return login;
      logInfo("OAuth login completed", {
        authenticated: login.data.authenticated,
        source: login.data.source ?? null,
      });
      return login;
    } finally {
      if (workerPhaseStarted && (options.showWorkerOverlay ?? true)) {
        appStore.workersCommunicating.value = false;
      }
    }
  }

  function tryRefresh(): Promise<ApiResult<AuthSession>> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = withAuthTransition(async (): Promise<ApiResult<AuthSession>> => {
      try {
        appStore.workersCommunicating.value = true;
        const refreshed = await bangumi.refreshOAuthSession();
        if (!refreshed.ok) return refreshed;
        sessionStore.session.value = refreshed.data;
        return refreshed;
      } catch (error) {
        return { ok: false as const, data: null, error: error instanceof Error ? error.message : String(error) };
      } finally {
        appStore.workersCommunicating.value = false;
      }
    }).finally(() => { refreshInFlight = null; });
    return refreshInFlight!;
  }

  return {
    startOAuthLogin,
    finishOAuthLogin,
    tryRefresh,
  };
}
