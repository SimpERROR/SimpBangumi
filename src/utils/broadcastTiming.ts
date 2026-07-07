import type { TenraiBroadcast } from "../api/Tenrai";

const DAY_NAME_TO_INDEX: Record<string, number> = {
  mondays: 1,
  tuesdays: 2,
  wednesdays: 3,
  thursdays: 4,
  fridays: 5,
  saturdays: 6,
  sundays: 0,
};

/** Parse Tenrai broadcast day string to JS day index (0=Sun, 1=Mon...6=Sat) */
function parseBroadcastDay(day: string | null): number | null {
  if (!day) return null;
  const lower = day.trim().toLowerCase();
  return DAY_NAME_TO_INDEX[lower] ?? null;
}

/** Parse Tenrai broadcast time "HH:MM" to [hours, minutes] */
function parseBroadcastTime(time: string | null): [number, number] | null {
  if (!time) return null;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

/** Parse Tenrai duration string to total minutes. e.g. "24 min per ep" → 24 */
export function parseDurationMinutes(duration: string | null): number {
  if (!duration) return 24; // default assumption
  let total = 0;
  const hrMatch = duration.match(/(\d+)\s*hr/);
  if (hrMatch) total += parseInt(hrMatch[1], 10) * 60;
  const minMatch = duration.match(/(\d+)\s*min/);
  if (minMatch) total += parseInt(minMatch[1], 10);
  return total > 0 ? total : 24;
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
): BroadcastTiming | null {
  const dayIndex = parseBroadcastDay(broadcast?.day ?? null);
  const timeJst = parseBroadcastTime(broadcast?.time ?? null);
  const durationMin = parseDurationMinutes(durationStr);

  // Cannot calculate without day and time
  if (dayIndex === null || timeJst === null) {
    return null;
  }

  const now = new Date();
  const jstOffset = 9 * 60; // JST = UTC+9 in minutes
  const localOffset = -now.getTimezoneOffset(); // local offset in minutes

  // Calculate the next broadcast occurrence in JST
  // First, get current JST time
  const nowJst = new Date(now.getTime() + (jstOffset - localOffset) * 60000);
  const currentJstDay = nowJst.getDay(); // 0=Sun in JST

  // Calculate days until next broadcast
  let daysUntil = (dayIndex - currentJstDay + 7) % 7;
  if (daysUntil === 0) {
    // Same day — check if broadcast time has passed
    const broadcastMinJst = timeJst[0] * 60 + timeJst[1];
    const currentMinJst = nowJst.getHours() * 60 + nowJst.getMinutes();
    if (currentMinJst >= broadcastMinJst + durationMin) {
      // Today's broadcast is over, next is in 7 days
      daysUntil = 7;
    }
  }

  // Construct next broadcast date in JST
  const nextBroadcastJst = new Date(nowJst);
  nextBroadcastJst.setDate(nowJst.getDate() + daysUntil);
  nextBroadcastJst.setHours(timeJst[0], timeJst[1], 0, 0);

  // Convert to local time for display
  const nextBroadcastLocal = new Date(
    nextBroadcastJst.getTime() - (jstOffset - localOffset) * 60000,
  );

  // Determine if crosses midnight JST
  const crossesMidnight = timeJst[0] * 60 + timeJst[1] + durationMin >= 24 * 60;

  // Calculate broadcast end time in JST
  const broadcastEndMinJst = timeJst[0] * 60 + timeJst[1] + durationMin;
  const broadcastEndJst = new Date(nextBroadcastJst);
  broadcastEndJst.setHours(0, broadcastEndMinJst, 0, 0);

  // Determine status
  let broadcastStatus: BroadcastStatus;
  let displayText: string;
  let subText: string;
  let countdownSeconds: number | null = null;

  // Check if anime has finished airing
  if (status === "Finished Airing") {
    // Only show 完结撒花 if finished within the last 7 days
    const finishedRecently = airedTo
      ? (Date.now() - new Date(airedTo).getTime()) < 7 * 24 * 60 * 60 * 1000
      : false;

    if (finishedRecently) {
      broadcastStatus = "finished";
      const finishedDate = new Date(airedTo!).toLocaleDateString("zh-CN");
      displayText = "完结撒花！";
      subText = `番剧已成功配信完成，完结时间：${finishedDate}`;
    } else {
      // Finished long ago — show as ended, no next broadcast
      broadcastStatus = "ended-today";
      displayText = "配信已结束。";
      subText = "本番剧已完结。";
    }
  } else if (status === "Not yet aired") {
    broadcastStatus = "not-aired";
    const airDate = airedFrom
      ? new Date(airedFrom).toLocaleDateString("zh-CN")
      : "待定";
    displayText = "此番剧尚未开播！";
    subText = `开播时间：${airDate}`;
  } else {
    // Currently Airing — determine exact state
    const broadcastMinJst = timeJst[0] * 60 + timeJst[1];
    const currentMinJst = nowJst.getHours() * 60 + nowJst.getMinutes();

    if (daysUntil === 0) {
      // Today is broadcast day
      if (currentMinJst < broadcastMinJst) {
        // Before broadcast
        broadcastStatus = "before-broadcast";
        const countdownMs = nextBroadcastLocal.getTime() - now.getTime();
        countdownSeconds = Math.max(0, Math.floor(countdownMs / 1000));
        displayText = "今日配信！";
        subText = `倒计时：${formatCountdown(countdownSeconds)}，配信时长：${formatDuration(durationMin)}`;
      } else if (currentMinJst < broadcastMinJst + durationMin) {
        // Currently on air
        broadcastStatus = "on-air";
        const elapsedMin = currentMinJst - broadcastMinJst;
        const remainingMin = durationMin - elapsedMin;
        displayText = "正在配信！";
        subText = `已配信 ${elapsedMin} 分钟，还剩 ${remainingMin} 分钟。`;
        countdownSeconds = remainingMin * 60;
      } else {
        // Broadcast ended today
        broadcastStatus = "ended-today";
        const nextNext = new Date(nextBroadcastLocal);
        nextNext.setDate(nextNext.getDate() + 7);
        displayText = "配信已结束。";
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
    dayIndex,
    timeJst,
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
  if (h > 0) return `${h}时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  }
  return `${totalMinutes}分钟`;
}

function formatDateShort(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${weekdays[date.getDay()]} ${hours}:${minutes}`;
}
