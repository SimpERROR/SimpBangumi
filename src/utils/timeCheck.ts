/**
 * Network time validation.
 * On app start, compares local time against a network time source.
 * If the clock is off by more than ALLOWED_DRIFT_MS, disables broadcast tracking.
 */

const TIME_MISMATCH_KEY = "bangumi.timeMismatch";
const ALLOWED_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch network time from a reliable source.
 * Tries multiple endpoints for redundancy.
 */
async function fetchNetworkTime(): Promise<number | null> {
  const endpoints = [
    "https://timeapi.io/api/time/current/zone?timeZone=UTC",
    "https://api.bgm.tv",                         // Bangumi — read Date header
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        method: url === "https://api.bgm.tv" ? "HEAD" : "GET",
      });
      clearTimeout(timeout);

      if (!response.ok && url !== "https://api.bgm.tv") {
        console.log(`[timeCheck] ${url} → HTTP ${response.status}, trying next...`);
        continue;
      }

      // For timeapi.io, parse JSON (unixtime is preferred — timezone-agnostic)
      if (url.includes("timeapi.io")) {
        const data = await response.json() as { dateTime?: string; unixtime?: number };
        if (data.unixtime) {
          console.log(`[timeCheck] ✅ ${url} → unixtime: ${data.unixtime}`);
          return data.unixtime * 1000;
        }
        // dateTime may lack timezone suffix — force UTC
        if (data.dateTime) {
          const utc = data.dateTime.endsWith("Z") || data.dateTime.includes("+") || data.dateTime.includes("-", 10)
            ? data.dateTime
            : data.dateTime + "Z";
          const t = new Date(utc).getTime();
          console.log(`[timeCheck] ✅ ${url} → dateTime: ${data.dateTime} → ${new Date(t).toISOString()}`);
          return t;
        }
        console.log(`[timeCheck] ${url} → unexpected response format, trying next...`);
        continue;
      }

      // For Bangumi, read Date header (HTTP Date is always GMT)
      if (url === "https://api.bgm.tv") {
        const dateHeader = response.headers.get("Date");
        if (dateHeader) {
          const t = new Date(dateHeader).getTime();
          console.log(`[timeCheck] ✅ ${url} → Date header: ${new Date(t).toISOString()}`);
          return t;
        }
        console.log(`[timeCheck] ${url} → no Date header, trying next...`);
        continue;
      }
    } catch (e) {
      console.log(`[timeCheck] ❌ ${url} → ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
  }

  console.log(`[timeCheck] ❌ all endpoints failed — trusting local time`);
  return null;
}

export interface TimeCheckResult {
  /** Whether the local clock is within acceptable drift */
  ok: boolean;
  /** Local time at check (ms) */
  localTime: number;
  /** Network time at check (ms) */
  networkTime: number;
  /** Drift in ms (local - network) */
  driftMs: number;
}

/**
 * Fetch network time and compare with local clock.
 * Returns null if the network request fails (offline, etc.) — in that case we trust local time.
 */
export async function checkTimeDrift(): Promise<TimeCheckResult | null> {
  const networkTime = await fetchNetworkTime();
  if (networkTime === null) return null;

  const localTime = Date.now();
  const driftMs = localTime - networkTime;
  const driftSec = (driftMs / 1000).toFixed(1);
  const ok = Math.abs(driftMs) < ALLOWED_DRIFT_MS;

  console.log(
    `[timeCheck] local=${new Date(localTime).toISOString()} ` +
    `network=${new Date(networkTime).toISOString()} ` +
    `drift=${driftSec}s → ${ok ? "✅ OK" : "❌ MISMATCH"}`,
  );

  return { ok, localTime, networkTime, driftMs };
}

/** Persist mismatch flag so the UI knows to disable broadcast tracking */
export function setTimeMismatch(mismatch: boolean): void {
  try {
    if (mismatch) {
      localStorage.setItem(TIME_MISMATCH_KEY, "1");
    } else {
      localStorage.removeItem(TIME_MISMATCH_KEY);
    }
  } catch { /* ignore */ }
}

/** Check if time mismatch was previously detected */
export function isTimeMismatch(): boolean {
  try {
    return localStorage.getItem(TIME_MISMATCH_KEY) === "1";
  } catch {
    return false;
  }
}
