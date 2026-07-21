import type { TenraiBroadcast } from "../api/Tenrai";

const DAY_NAME_TO_INDEX: Record<string, number> = {
  monday: 1, mondays: 1, mon: 1,
  tuesday: 2, tuesdays: 2, tue: 2, tues: 2,
  wednesday: 3, wednesdays: 3, wed: 3,
  thursday: 4, thursdays: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fridays: 5, fri: 5,
  saturday: 6, saturdays: 6, sat: 6,
  sunday: 0, sundays: 0, sun: 0,
};

/** Parse Tenrai broadcast day string to JS day index (0=Sun, 1=Mon...6=Sat) */
function parseBroadcastDay(day: string | null): number | null {
  if (!day) return null;
  const lower = day.trim().toLowerCase();
  return DAY_NAME_TO_INDEX[lower] ?? null;
}

/** Parse Tenrai broadcast time "HH:MM" to [hours, minutes]. Supports 深夜档 24:00–30:00. */
function parseBroadcastTime(time: string | null): [number, number] | null {
  if (!time) return null;
  const match = time.trim().match(/^([0-2]?\d|3[0-0]):([0-5]\d)$/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

/** Parse Tenrai duration string to total minutes. e.g. "24 min per ep" → 24 */
export function parseDurationMinutes(duration: string | null): number {
  if (!duration) return 0;
  let total = 0;
  const hrMatch = duration.match(/(\d+)\s*hr/);
  if (hrMatch) total += parseInt(hrMatch[1], 10) * 60;
  const minMatch = duration.match(/(\d+)\s*min/);
  if (minMatch) total += parseInt(minMatch[1], 10);
  return total > 0 ? total : 0;
}

export interface BroadcastTiming {
  /** JS Date of the next broadcast start (in local time) */
  nextBroadcast: Date;
  /** Broadcast day index (0=Sun, 1=Mon...6=Sat) in JST */
  dayIndex: number;
  /** Broadcast time in JST [hours, minutes] */
  timeJst: [number, number];
  /** Duration in minutes */
  durationMin: number;
  /** Whether this episode crosses midnight JST */
  crossesMidnight: boolean;
  /** Current status */
  status: BroadcastStatus;
  /** Human-readable countdown or elapsed time */
  displayText: string;
  /** Secondary info text */
  subText: string;
  /** Countdown seconds (for live updating) */
  countdownSeconds: number | null;
}

export type BroadcastStatus =
  | "not-aired"
  | "not-today"
  | "before-broadcast"
  | "on-air"
  | "ended-today"
  | "finished";

/**
 * Calculate broadcast timing info for an anime.
 * @param broadcast Tenrai broadcast object
 * @param status Tenrai anime status string
 * @param durationStr Tenrai duration string
 * @param airedFrom Air date ISO string (for "not yet aired" check)
 * @param airedTo Air end date ISO string (for "finished" 1-week window)
 */
export function calculateBroadcast(
  broadcast: TenraiBroadcast | null,
  status: string | null,
  durationStr: string | null,
  airedFrom: string | null,
  airedTo: string | null = null,
  now: Date = new Date(),
): BroadcastTiming | null {
  const dayIndex = parseBroadcastDay(broadcast?.day ?? null);
  const timeJst = parseBroadcastTime(broadcast?.time ?? null);
  const durationMin = parseDurationMinutes(durationStr);

  // Cannot calculate without day and time
  if (dayIndex === null || timeJst === null) {
    return null;
  }

  // Handle 深夜档: 24:00+ means next calendar day
  let adjustedDayIndex = dayIndex;
  let adjustedHours = timeJst[0];
  let adjustedMinutes = timeJst[1];
  if (adjustedHours >= 24) {
    adjustedDayIndex = (adjustedDayIndex + 1) % 7;
    adjustedHours -= 24;
  }
  const timeJstAdjusted: [number, number] = [adjustedHours, adjustedMinutes];

  const jstOffset = 9 * 60; // JST = UTC+9 in minutes
  const localOffset = -now.getTimezoneOffset(); // local offset in minutes

  // Calculate the next broadcast occurrence in JST
  // First, get current JST time
  const nowJst = new Date(now.getTime() + (jstOffset - localOffset) * 60000);
  const currentJstDay = nowJst.getDay(); // 0=Sun in JST

  // Calculate days until next broadcast
  let daysUntil = (adjustedDayIndex - currentJstDay + 7) % 7;
  if (daysUntil === 0) {
    // Same day — check if broadcast time has passed
    const broadcastMinJst = adjustedHours * 60 + adjustedMinutes;
    const currentMinJst = nowJst.getHours() * 60 + nowJst.getMinutes();
    // When duration known: check if broadcast ended. When unknown: just check if start time passed.
    const broadcastPassed = durationMin > 0
      ? currentMinJst >= broadcastMinJst + durationMin
      : currentMinJst >= broadcastMinJst;
    if (broadcastPassed) {
      daysUntil = 7;
    }
  }

  // Construct next broadcast date in JST
  const nextBroadcastJst = new Date(nowJst);
  nextBroadcastJst.setDate(nowJst.getDate() + daysUntil);
  nextBroadcastJst.setHours(adjustedHours, adjustedMinutes, 0, 0);

  // Convert to local time for display
  const nextBroadcastLocal = new Date(
    nextBroadcastJst.getTime() - (jstOffset - localOffset) * 60000,
  );

  // Determine if crosses midnight JST
  const crossesMidnight = adjustedHours * 60 + adjustedMinutes + durationMin >= 24 * 60;

  // Determine status
  let broadcastStatus: BroadcastStatus;
  let displayText: string;
  let subText: string;
  let countdownSeconds: number | null = null;

  // Pre-compute air-day info for "Not yet aired" check — parse manually to avoid timezone offset
  const airDate = parseAirDate(airedFrom);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const airDay = airDate
    ? new Date(airDate[0], airDate[1] - 1, airDate[2])
    : null;
  const isAirDateToday = airDay !== null && airDay.getTime() === today.getTime();
  const isAirDatePast = airDay !== null && airDay.getTime() < today.getTime();

  // Check if anime has finished airing
  if (status === "Finished Airing") {
    const finishedRecently =
      airedTo != null &&
      (now.getTime() - new Date(airedTo).getTime()) < 7 * 24 * 60 * 60 * 1000;

    if (finishedRecently) {
      broadcastStatus = "finished";
      const finishedDate = new Date(airedTo!).toLocaleDateString("zh-CN");
      displayText = "完结撒花！";
      subText = `番剧已全部配信完成，完结时间：${finishedDate}`;
    } else {
      // Finished long ago — show as ended, no next broadcast
      broadcastStatus = "ended-today";
      displayText = "配信已结束。";
      subText = "本番剧已完结。";
    }
  } else if (status === "Not yet aired"
    && !(isAirDateToday && daysUntil === 7) // let normal logic handle ended-today
  ) {
    broadcastStatus = "not-aired";
    if (airedFrom) {
      if (isAirDateToday) {
        if (now.getTime() < nextBroadcastLocal.getTime()) {
          displayText = "今日首播！";
          const countdownMs = nextBroadcastLocal.getTime() - now.getTime();
          countdownSeconds = Math.max(0, Math.floor(countdownMs / 1000));
          const durStr = formatDuration(durationMin);
          subText = `预计开始于 ${formatDateShort(nextBroadcastLocal)} ，还剩 ${formatCountdown(countdownSeconds)}${durStr ? ` ，持续 ${durStr}` : ""} 。数据源更新可能延迟。`;
        } else {
          displayText = "已经首播。";
          subText = `首播开始于 ${formatDateShort(nextBroadcastLocal)} 。`;
        }
      } else if (isAirDatePast) {
        // Data stale — estimate using known broadcast schedule
        broadcastStatus = "before-broadcast";
        const countdownMs = nextBroadcastLocal.getTime() - now.getTime();
        countdownSeconds = Math.max(0, Math.floor(countdownMs / 1000));
        displayText = "即将配信！";
        subText = `下次配信于 ${formatDateShort(nextBroadcastLocal)}。数据源存在较大延迟。`;
      } else {
        const airDateStr = airDate
          ? `${airDate[0]}-${String(airDate[1]).padStart(2, '0')}-${String(airDate[2]).padStart(2, '0')}`
          : "待定";
        displayText = "此番剧尚未开播！";
        subText = `开播时间：${airDateStr}`;}
    } else {
      displayText = "此番剧尚未开播！";
      subText = "开播时间：待定";
    }
  } else {
    // Currently Airing — determine exact state
    const broadcastMinJst = adjustedHours * 60 + adjustedMinutes;
    const currentMinJst = nowJst.getHours() * 60 + nowJst.getMinutes();
    // When duration unknown and broadcast passed today, daysUntil was set to 7.
    // Treat as "ended today" rather than "not today".
    const isEndedTodayUnknownDuration = durationMin === 0 && daysUntil === 7;

    if (daysUntil === 0 || isEndedTodayUnknownDuration) {
      // Today is broadcast day (or ended today with unknown duration)
      if (durationMin > 0 && currentMinJst < broadcastMinJst) {
        // Before broadcast (duration known)
        broadcastStatus = "before-broadcast";
        const countdownMs = nextBroadcastLocal.getTime() - now.getTime();
        countdownSeconds = Math.max(0, Math.floor(countdownMs / 1000));
        displayText = "今日配信！";
        subText = `开始于 ${formatDateShort(nextBroadcastLocal)} ，还剩 ${formatCountdown(countdownSeconds)} ，持续 ${formatDuration(durationMin)} 。`;
      } else if (durationMin > 0 && currentMinJst < broadcastMinJst + durationMin) {
        // Currently on air
        broadcastStatus = "on-air";
        const elapsedMin = currentMinJst - broadcastMinJst;
        const remainingMin = durationMin - elapsedMin;
        displayText = "正在配信！";
        subText = `已配信 ${formatDuration(elapsedMin)}，还剩 ${formatDuration(remainingMin)}。`;
        countdownSeconds = remainingMin * 60;
      } else {
        // Broadcast ended today (either duration known or unknown)
        broadcastStatus = "ended-today";
        const nextNext = new Date(nextBroadcastLocal);
        // When duration known and ended, nextBroadcastLocal is today → add 7 days.
        // When duration unknown, nextBroadcastLocal already points to next week.
        if (!isEndedTodayUnknownDuration) {
          nextNext.setDate(nextNext.getDate() + 7);
        }
        displayText = "今日配信已结束。";
        subText = `下次配信：${formatDateShort(nextNext)}。字幕组翻译可能需要一定时间。`;
      }
    } else {
      // Not today
      broadcastStatus = "not-today";
      displayText = "即将配信！";
      subText = `下次配信时间：${formatDateShort(nextBroadcastLocal)}`;
    }
  }

  return {
    nextBroadcast: nextBroadcastLocal,
    dayIndex: adjustedDayIndex,
    timeJst: timeJstAdjusted,
    durationMin,
    crossesMidnight,
    status: broadcastStatus,
    displayText,
    subText,
    countdownSeconds,
  };
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "即将开始";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h} 时 ${m} 分 ${s} 秒`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "";
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  }
  return `${totalMinutes} 分钟`;
}

function formatDateShort(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month} 月 ${day} 日 ${weekdays[date.getDay()]} ${hours}:${minutes}`;
}

/** Parse airedFrom string like "2026-07-08" to [year, month, day] without timezone offset */
function parseAirDate(dateStr: string | null): [number, number, number] | null {
  if (!dateStr) return null;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}
