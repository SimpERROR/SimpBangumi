import { invoke } from "@tauri-apps/api/core";

type LogLevel = "log" | "info" | "warn" | "error" | "unhandledrejection";

interface FrontendLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  stack?: string;
}

const collectedLogs: FrontendLogEntry[] = [];
const MAX_LOGS = 500;

function serializeArg(arg: unknown): string {
  if (arg instanceof ErrorEvent) {
    const msg = arg.message || "Unknown ErrorEvent";
    const stack = arg.error instanceof Error ? arg.error.stack : undefined;
    return stack ? `${msg}\n${stack}` : msg;
  }
  if (arg instanceof PromiseRejectionEvent) {
    const reason = arg.reason;
    if (reason instanceof Error) {
      return reason.stack || reason.message;
    }
    if (typeof reason === "string") return reason;
    try { return JSON.stringify(reason); } catch { return String(reason); }
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === "string") return arg;
  if (typeof arg === "object" && arg !== null) {
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  return String(arg);
}

function pushLog(level: LogLevel, ...args: unknown[]) {
  if (collectedLogs.length >= MAX_LOGS) {
    collectedLogs.shift();
  }

  const joined = args.map(serializeArg).join(" ");
  if (!joined.trim()) return;

  collectedLogs.push({
    timestamp: new Date().toISOString(),
    level,
    message: joined,
  });
}

/**
 * Install global console interceptors and error listeners.
 * Call once at app startup.
 */
export function installDiagnosticsErrorListeners() {
  // ── Intercept all console methods ──────────────────────

  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    pushLog("log", ...args);
    originalLog(...args);
  };

  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    pushLog("info", ...args);
    originalInfo(...args);
  };

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    pushLog("warn", ...args);
    originalWarn(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushLog("error", ...args);
    originalError(...args);
  };

  // ── Capture unhandled promise rejections ────────────────

  window.addEventListener("unhandledrejection", (event) => {
    pushLog("unhandledrejection", event);
  });

  // ── Capture synchronous errors ──────────────────────────

  window.addEventListener("error", (event) => {
    pushLog("error", event);
  });
}

/**
 * Get serializable log lines for export.
 */
export function getFrontendLogsForExport(): string[] {
  return collectedLogs.map((entry) => {
    let line = `[${entry.timestamp}][${entry.level}] ${entry.message}`;
    return line;
  });
}

export function getFrontendLogCount(): number {
  return collectedLogs.length;
}

/**
 * Invoke the Rust backend to generate a diagnostics report file.
 * Returns the file path where the report was written.
 */
export async function exportDiagnostics(): Promise<string> {
  const frontendLogs = getFrontendLogsForExport();
  const filePath: string = await invoke("export_diagnostics", {
    frontendErrors: frontendLogs.length > 0 ? frontendLogs : null,
  });
  return filePath;
}
