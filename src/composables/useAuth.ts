import { exchangeCodeForToken, refreshToken, type WorkerExchangeTokenResponse } from "../api/auth";
import { useBangumi, type ApiResult } from "./useBangumi";
import { useSessionStore } from "../stores/session";
import type { AuthSession } from "../api/bangumi";

const OAUTH_REDIRECT_URI = "http://127.0.0.1:46231/oauth/callback";
const OAUTH_POLL_INTERVAL_MS = 800;
const OAUTH_WAIT_TIMEOUT_MS = 190000;

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

  async function startOAuthLogin(state?: string): Promise<ApiResult<string>> {
    logInfo("starting OAuth login");
    const result = await bangumi.startOAuthLogin({ state });
    if (result.ok) {
      logInfo("OAuth authorize URL ready");
    } else {
      logError("failed to start OAuth login", result.error);
    }

    return result;
  }

  async function finishOAuthLogin(): Promise<ApiResult<AuthSession>> {
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

    if (callback.data.error || !callback.data.code) {
      logError("OAuth callback returned error", callback.data.error ?? "missing code");
      return {
        ok: false,
        data: null,
        error: callback.data.error ?? "OAuth callback missing code",
      };
    }

    let tokenPayload: WorkerExchangeTokenResponse;
    try {
      logInfo("exchanging OAuth code via worker", { redirectUri: OAUTH_REDIRECT_URI });
      tokenPayload = await exchangeCodeForToken(callback.data.code, OAUTH_REDIRECT_URI);
    } catch (error) {
      logError("worker code exchange failed", error);
      return {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    logInfo("worker returned OAuth tokens", {
      hasRefreshToken: Boolean(tokenPayload.refresh_token),
      hasUserId: tokenPayload.user_id !== undefined && tokenPayload.user_id !== null,
    });

    sessionStore.oauthTokens.value = {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token ?? null,
      userId: tokenPayload.user_id ? String(tokenPayload.user_id) : null,
    };

    const login = await bangumi.loginWithWorkerToken({
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token ?? null,
    });

    if (!login.ok) {
      logError("failed to persist worker token into Bangumi session", login.error);
      return login;
    }

    sessionStore.session.value = login.data;
    logInfo("OAuth login completed", {
      authenticated: login.data.authenticated,
      source: login.data.source ?? null,
    });
    return login;
  }

  async function tryRefresh(): Promise<ApiResult<WorkerExchangeTokenResponse>> {
    const refresh = sessionStore.oauthTokens.value?.refreshToken;
    if (!refresh) {
      logError("refresh requested without refresh token", "missing refresh token");
      return {
        ok: false,
        data: null,
        error: "No refresh token available",
      };
    }

    try {
      logInfo("refreshing OAuth token via worker");
      const next = await refreshToken(refresh);
      sessionStore.oauthTokens.value = {
        accessToken: next.access_token,
        refreshToken: next.refresh_token ?? refresh,
        userId: next.user_id ? String(next.user_id) : sessionStore.oauthTokens.value?.userId ?? null,
      };
      logInfo("OAuth refresh completed", {
        hasRefreshToken: Boolean(next.refresh_token ?? refresh),
      });
      return { ok: true, data: next, error: null };
    } catch (error) {
      logError("OAuth refresh failed", error);
      return {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    startOAuthLogin,
    finishOAuthLogin,
    tryRefresh,
  };
}
