export interface ReadableDateTimeOptions {
  fallback?: string;
  dateOnly?: boolean;
  includeSeconds?: boolean;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function hasTimePart(raw: string) {
  return /(?:T|\s)\d{1,2}:\d{2}(?::\d{2})?/.test(raw);
}

function parseToDate(value: string | number) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const ms = raw.length <= 10 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const normalized = raw.replace(" ", "T");
  if (normalized !== raw) {
    const retry = new Date(normalized);
    if (!Number.isNaN(retry.getTime())) {
      return retry;
    }
  }

  return null;
}

export function formatReadableDateTime(
  value?: string | number | null,
  options: ReadableDateTimeOptions = {},
) {
  const fallback = options.fallback ?? "-";
  if (value === null || value === undefined) {
    return fallback;
  }

  const raw = typeof value === "string" ? value.trim() : String(value);
  if (!raw) {
    return fallback;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    return raw;
  }

  const date = parseToDate(value);
  if (!date) {
    return raw;
  }

  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (options.dateOnly) {
    return datePart;
  }

  const shouldShowTime = hasTimePart(raw) || typeof value === "number";
  if (!shouldShowTime) {
    return datePart;
  }

  const timePart = options.includeSeconds
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  return `${datePart} ${timePart}`;
}