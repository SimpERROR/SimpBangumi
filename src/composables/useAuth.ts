import { exchangeCodeForToken, refreshToken, type WorkerExchangeTokenResponse } from "../api/auth";
import { useBangumi, type ApiResult } from "./useBangumi";
import { useSessionStore } from "../stores/session";
import { useAppStore } from "../stores/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AuthSession } from "../api/bangumi";
import { withAuthTransition } from "../api/authRequestGate";

const OAUTH_REDIRECT_URI = "http://127.0.0.1:46231/oauth/callback";
const OAUTH_POLL_INTERVAL_MS = 800;
const OAUTH_WAIT_TIMEOUT_MS = 190000;
let refreshInFlight: Promise<ApiResult<WorkerExchangeTokenResponse>> | null = null;

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
    const showWorkerOverlay = options.showWorkerOverlay ?? true;
    logInfo("waiting for OAuth callback");
    const deadline = Date.now() + OAUTH_WAIT_TIMEOUT_MS;
    let callback = await bangumi.waitOAuthLoginResult();
    let pollCount = 0;

    while (callback.ok && !callback.data.completed && Date.now() < deadline) {
      await sleep(OAUTH_POLL_INTERVAL_MS);
      pollCount += 1;
      callback = await bangumi.waitOAuthLoginResult();
    }

    logInfo("OAuth callback wait finished", {
      pollCount,
      completed: callback.ok ? callback.data.completed : false,
    });

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

    if (callback.data.error || !callback.data.code || !callback.data.code_verifier) {
      logError("OAuth callback returned error", callback.data.error ?? "missing code");
      return {
        ok: false,
        data: null,
        error: callback.data.error ?? "OAuth callback missing code or PKCE verifier",
      };
    }

    // OAuth code 已拿到，将应用窗口提到最前
    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.unminimize();
      // Windows 前台锁定绕行：短暂设为置顶再取消，强制提到最前
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setFocus();
      await appWindow.setAlwaysOnTop(false);
    } catch {
      // 非 Tauri 环境（浏览器 dev）忽略
    }

    let tokenPayload: WorkerExchangeTokenResponse;
    try {
      logInfo("exchanging OAuth code via worker", { redirectUri: OAUTH_REDIRECT_URI });
      options.onWorkerCommunication?.();
      if (showWorkerOverlay) appStore.workersCommunicating.value = true;
      tokenPayload = await exchangeCodeForToken(callback.data.code, OAUTH_REDIRECT_URI, callback.data.code_verifier);
    } catch (error) {
      logError("worker code exchange failed", error);
      if (showWorkerOverlay) appStore.workersCommunicating.value = false;
      return {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (showWorkerOverlay) appStore.workersCommunicating.value = false;
    }

    logInfo("worker returned OAuth tokens", {
      hasRefreshToken: Boolean(tokenPayload.refresh_token),
      hasUserId: tokenPayload.user_id !== undefined && tokenPayload.user_id !== null,
    });
    const login = await withAuthTransition(async () => {
      const result = await bangumi.loginWithWorkerToken({
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token ?? null,
      });
      if (!result.ok) {
        logError("failed to persist worker token into Bangumi session", result.error);
        return result;
      }
      sessionStore.session.value = result.data;
      sessionStore.oauthTokens.value = {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token ?? null,
        userId: tokenPayload.user_id ? String(tokenPayload.user_id) : null,
      };
      return result;
    });
    if (!login.ok) return login;
    logInfo("OAuth login completed", {
      authenticated: login.data.authenticated,
      source: login.data.source ?? null,
    });
    return login;
  }

  function tryRefresh(): Promise<ApiResult<WorkerExchangeTokenResponse>> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = withAuthTransition(async (): Promise<ApiResult<WorkerExchangeTokenResponse>> => {
      const refresh = sessionStore.oauthTokens.value?.refreshToken;
      if (!refresh) return { ok: false as const, data: null, error: "No refresh token available" };
      try {
        appStore.workersCommunicating.value = true;
        const next = await refreshToken(refresh);
        const nextRefreshToken = next.refresh_token ?? refresh;
        const login = await bangumi.loginWithWorkerToken({ access_token: next.access_token, refresh_token: nextRefreshToken });
        if (!login.ok) return login;
        sessionStore.session.value = login.data;
        sessionStore.oauthTokens.value = {
          accessToken: next.access_token,
          refreshToken: nextRefreshToken,
          userId: next.user_id ? String(next.user_id) : sessionStore.oauthTokens.value?.userId ?? null,
        };
        return { ok: true as const, data: next, error: null };
      } catch (error) {
        return { ok: false as const, data: null, error: error instanceof Error ? error.message : String(error) };
      } finally {
        appStore.workersCommunicating.value = false;
      }
    }).finally(() => { refreshInFlight = null; });
    return refreshInFlight!
  }

  return {
    startOAuthLogin,
    finishOAuthLogin,
    tryRefresh,
  };
}
