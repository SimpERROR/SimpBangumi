/**
 * Network time validation — DISABLED.
 * Previously compared local time against network sources and disabled
 * broadcast tracking when the clock was off by more than 5 minutes.
 * Now all functions are no-ops: local time is always trusted.
 */

export interface TimeCheckResult {
  ok: boolean;
  localTime: number;
  networkTime: number;
  driftMs: number;
}

/** Always returns null → trust local time. */
export async function checkTimeDrift(): Promise<TimeCheckResult | null> {
  return null;
}

/** No-op. */
export function setTimeMismatch(_mismatch: boolean): void {}

/** Always returns false → broadcast tracking is never suppressed by time check. */
export function isTimeMismatch(): boolean {
  return false;
}
