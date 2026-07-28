import { NonceGuard } from './nonce-guard.js';

export { NonceGuard };

const TOKEN_ENDPOINT = "https://bgm.tv/oauth/access_token";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CODE_LENGTH = 2048;
const MIN_CODE_VERIFIER_LENGTH = 43;
const MAX_CODE_VERIFIER_LENGTH = 128;
const MAX_REFRESH_TOKEN_LENGTH = 4096;
const ALLOWED_REDIRECT_URI = "http://127.0.0.1:46231/oauth/callback";
const DEVICE_CLOCK_SKEW_SECONDS = 90;
const DEVICE_NONCE_TTL_SECONDS = 180;
const MAX_DEVICE_ID_LENGTH = 128;
const DEFAULT_MAX_DEVICES_PER_ACCOUNT = 5;
const MAX_CONFIGURED_DEVICES_PER_ACCOUNT = 100;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") {
      if (!origin || !cors) return json({ error: "CORS origin not allowed" }, 403);
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405, cors);
    if (origin && !cors) return json({ error: "Origin not allowed" }, 403);
    if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET) return json({ error: "Server not configured" }, 500, cors);
    if (request.headers.get("Content-Type")?.toLowerCase().split(";")[0] !== "application/json") {
      return json({ error: "Content-Type must be application/json" }, 415, cors);
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Request body too large" }, 413, cors);
    if (!env.OAUTH_RATE_LIMIT_KV) return json({ error: "Rate limiting is not configured" }, 503, cors);
    if (!env.NONCE_GUARD) return json({ error: "Nonce guard is not configured" }, 503, cors);
    if (await rateLimited(request, env.OAUTH_RATE_LIMIT_KV)) return json({ error: "Too many requests" }, 429, cors);
    let body;
    try { body = await request.json(); } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }
    if (!body?.auth || !(await verifyDeviceRequest(body, env))) return json({ error: "Invalid device signature" }, 401, cors);
    if (body?.grant_type === "authorization_code") {
      if (!validString(body.code, MAX_CODE_LENGTH) || !validPkceVerifier(body.code_verifier) || body.redirect_uri !== ALLOWED_REDIRECT_URI) {
        return json({ error: "Invalid authorization request" }, 400, cors);
      }
      const tokenResponse = await exchangeToken({ grant_type: "authorization_code", code: body.code, code_verifier: body.code_verifier, redirect_uri: body.redirect_uri }, env, cors);
      if (!tokenResponse.ok) return tokenResponse;

      let tokenData;
      try {
        tokenData = await tokenResponse.json();
      } catch {
        return json({ error: "Invalid upstream token response" }, 502, cors);
      }
      const accountId = normalizeAccountId(tokenData?.user_id);
      if (!accountId) return json({ error: "OAuth upstream response missing user identity" }, 502, cors);

      let binding;
      try {
        binding = await registerDevice(body.auth, accountId, env);
      } catch {
        return json({ error: "Device binding unavailable" }, 503, cors);
      }
      if (!binding.ok) return json({ error: binding.error }, binding.status, cors);
      return json(tokenData, 200, cors);
    }
    if (body?.grant_type === "refresh_token") {
      if (!validString(body.refresh_token, MAX_REFRESH_TOKEN_LENGTH)) return json({ error: "Invalid refresh request" }, 400, cors);
      let refreshBinding;
      try {
        refreshBinding = await readDeviceBinding(body.auth.device_id, env.OAUTH_RATE_LIMIT_KV);
      } catch {
        return json({ error: "Device binding unavailable" }, 503, cors);
      }
      if (!refreshBinding || refreshBinding.legacy) return json({ error: "Invalid device binding" }, 401, cors);

      const tokenResponse = await exchangeToken({ grant_type: "refresh_token", refresh_token: body.refresh_token }, env, cors);
      if (!tokenResponse.ok) return tokenResponse;

      let tokenData;
      try {
        tokenData = await tokenResponse.json();
      } catch {
        return json({ error: "Invalid upstream token response" }, 502, cors);
      }
      const accountId = normalizeAccountId(tokenData?.user_id);
      if (!accountId || accountId !== refreshBinding.account_id) {
        return json({ error: "Device account binding mismatch" }, 403, cors);
      }
      return json(tokenData, 200, cors);
    }
    return json({ error: "Unsupported grant type" }, 400, cors);
  },
};
function logDeviceAuth(stage, auth, details = {}) {
  console.log(JSON.stringify({
    event: "device-auth",
    stage,
    device_id: typeof auth?.device_id === "string" ? auth.device_id : null,
    ...details,
  }));
}
async function verifyDeviceRequest(body, env) {
  const auth = body.auth;
  if (!auth || !validString(auth.device_id, MAX_DEVICE_ID_LENGTH) || !validString(auth.device_public_key, 128) || !validString(auth.nonce, 128) || !validString(auth.signature, 256)) {
    logDeviceAuth("invalid-shape", auth, { has_auth: Boolean(auth), grant_type: body?.grant_type ?? null });
    return false;
  }
  const timestamp = Number(auth.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > DEVICE_CLOCK_SKEW_SECONDS) {
    logDeviceAuth("timestamp-rejected", auth, { timestamp, now: Math.floor(Date.now() / 1000) });
    return false;
  }
  let registered;
  try {
    registered = await readDeviceBinding(auth.device_id, env.OAUTH_RATE_LIMIT_KV);
    logDeviceAuth("binding-read", auth, { binding: registered ? (registered.legacy ? "legacy" : "current") : "missing" });
  } catch (error) {
    logDeviceAuth("binding-read-error", auth, { error: String(error) });
    return false;
  }
  if (registered && registered.public_key !== auth.device_public_key) {
    logDeviceAuth("public-key-mismatch", auth, { registered_public_key_len: registered.public_key.length, request_public_key_len: auth.device_public_key.length });
    return false;
  }
  if (body.grant_type === "refresh_token" && (!registered || registered.legacy)) {
    logDeviceAuth("refresh-binding-rejected", auth, { binding: registered ? "legacy" : "missing" });
    return false;
  }
  const messageValue = body.grant_type === "authorization_code"
    ? `${body.code}.${body.code_verifier}`
    : body.refresh_token;
  const message = `v2.${body.grant_type}.${auth.device_id}.${timestamp}.${auth.nonce}.${messageValue}`;
  try {
    const key = await crypto.subtle.importKey("raw", decodeBase64Url(auth.device_public_key), { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("Ed25519", key, decodeBase64Url(auth.signature), new TextEncoder().encode(message));
    if (!valid) {
      logDeviceAuth("signature-invalid", auth, { message_len: message.length, value_len: typeof messageValue === "string" ? messageValue.length : 0 });
      return false;
    }
    logDeviceAuth("signature-verified", auth, { message_len: message.length, value_len: typeof messageValue === "string" ? messageValue.length : 0 });
  } catch (error) {
    logDeviceAuth("signature-exception", auth, { error: String(error) });
    return false;
  }
  try {
    const nonceGuard = env.NONCE_GUARD.getByName(auth.device_id);
    const consumed = await nonceGuard.consume(auth.nonce, DEVICE_NONCE_TTL_SECONDS);
    if (!consumed) {
      logDeviceAuth("nonce-rejected", auth);
      return false;
    }
    logDeviceAuth("nonce-consumed", auth);
  } catch (error) {
    logDeviceAuth("nonce-exception", auth, { error: String(error) });
    return false;
  }
  const limited = await deviceRateLimited(auth.device_id, env.OAUTH_RATE_LIMIT_KV);
  if (limited) {
    logDeviceAuth("device-rate-limited", auth);
    return false;
  }
  logDeviceAuth("request-verified", auth);
  return true;
}async function readDeviceBinding(deviceId, kv) {
  const raw = await kv.get("oauth-device:" + deviceId);
  return parseDeviceBinding(raw);
}
function parseDeviceBinding(raw) {
  if (!validString(raw, 16 * 1024)) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && validString(parsed.account_id, 128) && validString(parsed.public_key, 128) && Number.isInteger(parsed.created_at)) {
      return {
        account_id: parsed.account_id,
        public_key: parsed.public_key,
        created_at: parsed.created_at,
        legacy: false,
      };
    }
  } catch {
    // Existing deployments stored the public key as a bare string. Treat it as legacy.
  }
  return { account_id: null, public_key: raw, created_at: null, legacy: true };
}
function normalizeAccountId(value) {
  if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}
function maxDevicesPerAccount(env) {
  const configured = Number(env.MAX_DEVICES_PER_ACCOUNT ?? DEFAULT_MAX_DEVICES_PER_ACCOUNT);
  if (!Number.isInteger(configured) || configured < 1 || configured > MAX_CONFIGURED_DEVICES_PER_ACCOUNT) {
    return DEFAULT_MAX_DEVICES_PER_ACCOUNT;
  }
  return configured;
}
async function registerDevice(auth, accountId, env) {
  const deviceKey = "oauth-device:" + auth.device_id;
  const accountDevicesKey = "oauth-account-devices:" + accountId;
  const existing = await readDeviceBinding(auth.device_id, env.OAUTH_RATE_LIMIT_KV);
  if (existing && existing.public_key !== auth.device_public_key) {
    return { ok: false, status: 403, error: "Device public key mismatch" };
  }
  if (existing && !existing.legacy && existing.account_id !== accountId) {
    return { ok: false, status: 403, error: "Device is bound to another account" };
  }

  const rawDevices = await env.OAUTH_RATE_LIMIT_KV.get(accountDevicesKey);
  const devices = parseAccountDevices(rawDevices);
  const known = devices.find((device) => device.device_id === auth.device_id);
  if (known && known.public_key !== auth.device_public_key) {
    return { ok: false, status: 403, error: "Device public key mismatch" };
  }
  if (known) {
    if (!existing || existing.legacy) {
      await env.OAUTH_RATE_LIMIT_KV.put(deviceKey, JSON.stringify({
        account_id: accountId,
        public_key: auth.device_public_key,
        created_at: known.created_at,
      }));
    }
    return { ok: true };
  }

  if (devices.length >= maxDevicesPerAccount(env)) {
    return { ok: false, status: 403, error: "Maximum devices per account exceeded" };
  }

  const record = {
    device_id: auth.device_id,
    public_key: auth.device_public_key,
    created_at: Date.now(),
  };
  devices.push(record);
  await env.OAUTH_RATE_LIMIT_KV.put(accountDevicesKey, JSON.stringify(devices));
  await env.OAUTH_RATE_LIMIT_KV.put(deviceKey, JSON.stringify({
    account_id: accountId,
    public_key: auth.device_public_key,
    created_at: record.created_at,
  }));
  return { ok: true };
}
function parseAccountDevices(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("invalid device list");
    const seen = new Set();
    return parsed.filter((device) => {
      if (!device || !validString(device.device_id, MAX_DEVICE_ID_LENGTH) || !validString(device.public_key, 128) || !Number.isInteger(device.created_at) || seen.has(device.device_id)) return false;
      seen.add(device.device_id);
      return true;
    });
  } catch {
    throw new Error("Invalid account device list");
  }
}
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function deviceRateLimited(deviceId, kv) {
  const bucket = Math.floor(Date.now() / 60000);
  const key = `oauth-device-rate:${deviceId}:${bucket}`;
  const current = Number(await kv.get(key) ?? "0");
  if (current >= 30) return true;
  await kv.put(key, String(current + 1), { expirationTtl: 120 });
  return false;
}
async function exchangeToken(payload, env, cors) {
  const params = new URLSearchParams({
    grant_type: payload.grant_type,
    client_id: env.BANGUMI_CLIENT_ID,
    client_secret: env.BANGUMI_CLIENT_SECRET,
  });
  if (payload.code) {
    params.set("code", payload.code);
    params.set("redirect_uri", payload.redirect_uri);
    params.set("code_verifier", payload.code_verifier);
  } else {
    params.set("refresh_token", payload.refresh_token);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "SimpBangumi-Tauri-Proxy/2.0",
      },
      body: params,
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (text.length > 64 * 1024) return json({ error: "Upstream response too large" }, 502, cors);
    let data;
    try { data = JSON.parse(text); } catch {
      return json({ error: "Invalid upstream response" }, 502, cors);
    }
    if (!upstream.ok) return json({ error: "OAuth request rejected" }, upstream.status === 429 ? 429 : 502, cors);
    if (!validString(data?.access_token, 8192)) return json({ error: "Invalid upstream token response" }, 502, cors);
    return json({
      access_token: data.access_token,
      refresh_token: validString(data.refresh_token, 8192) ? data.refresh_token : null,
      user_id: typeof data.user_id === "string" || typeof data.user_id === "number" ? data.user_id : null,
    }, 200, cors);
  } catch (error) {
    console.log(JSON.stringify({
      event: "oauth-upstream-failure",
      grant_type: payload.grant_type,
      error_name: error instanceof Error ? error.name : typeof error,
      error_message: error instanceof Error ? error.message : String(error),
    }));
    return json({ error: "OAuth upstream request failed" }, 502, cors);
  } finally {
    clearTimeout(timer);
  }
}
function validString(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
function validPkceVerifier(value) {
  return typeof value === "string"
    && value.length >= MIN_CODE_VERIFIER_LENGTH
    && value.length <= MAX_CODE_VERIFIER_LENGTH
    && /^[A-Za-z0-9._~-]+$/.test(value);
}
function corsHeaders(origin, env) {
  if (!origin) return null;
  const allowed = String(env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
async function rateLimited(request, kv) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const bucket = Math.floor(Date.now() / 60000);
  const key = "oauth-rate:" + ip + ":" + bucket;
  const current = Number(await kv.get(key) ?? "0");
  if (current >= 20) return true;
  await kv.put(key, String(current + 1), { expirationTtl: 120 });
  return false;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      ...headers,
    },
  });
}
