import { invoke } from "@tauri-apps/api/core";

export interface WorkerExchangeTokenResponse {
  access_token: string;
  refresh_token?: string | null;
  user_id?: string | number | null;
}

interface RefreshTokenRequest {
  refresh_token: string;
  grant_type: "refresh_token";
}

export async function exchangeCodeForToken(
  code: string,
  redirect_uri: string,
  code_verifier: string,
): Promise<WorkerExchangeTokenResponse> {
  return invoke<WorkerExchangeTokenResponse>("bangumi_worker_exchange_code", {
    request: {
      grant_type: "authorization_code",
      code,
      redirect_uri,
      code_verifier,
    },
  });
}

export async function refreshToken(refresh_token: string): Promise<WorkerExchangeTokenResponse> {
  const payload: RefreshTokenRequest = {
    refresh_token,
    grant_type: "refresh_token",
  };

  return invoke<WorkerExchangeTokenResponse>("bangumi_worker_refresh_token", {
    request: payload,
  });
}
