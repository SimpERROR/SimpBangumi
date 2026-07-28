import { ref } from "vue";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { calculateBroadcast } from "../utils/broadcastTiming";
import { getCachedMatch, fetchMalAnimeFull, setManualMatch } from "../utils/animeMatch";
import { isFakeSubjectId, syncFakeSubjectsToCache } from "../utils/fakeBroadcast";
import type { TenraiAnimeFull } from "../api/Tenrai";

const FOLLOWED_KEY = "bangumi.broadcast.followedSubjects";
const NOTIFY_ENABLED_KEY = "bangumi.broadcast.notifyEnabled";
const NOTIFY_BEFORE_MINUTES_KEY = "bangumi.broadcast.notifyBeforeMinutes";
const NOTIFY_DELAY_MINUTES_KEY = "bangumi.broadcast.notifyDelayMinutes";
const NOTIFY_WINDOW_LABEL = "broadcast-notify";

export interface FollowedSubject {
  bgmId: number;
  /** 中文译名 */
  nameCn: string;
  /** 原文名（日文等） */
  nameOriginal: string;
  malId: number;
  /** 番剧封面图片 URL */
  coverUrl?: string;
}

export type NotificationType = "before-broadcast" | "on-air";

export interface BroadcastNotification {
  id: string;
  nameCn: string;
  nameOriginal: string;
  type: NotificationType;
  message: string;
  broadcastTime: number;
  countdownSeconds: number;
  delayMinutes: number;
  timestamp: number;
  /** 番剧封面图片 URL */
  coverUrl?: string;
  episodeNumber?: number;
  totalEpisodes?: number;
}


function estimateEpisodeNumber(data: TenraiAnimeFull, broadcastTime: number): number | undefined {
  const airedFrom = data.aired?.from;
  if (!airedFrom) return undefined;
  const match = airedFrom.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  // aired.from is a JST calendar date; use JST midnight for the interval.
  const firstAir = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * 60 * 60 * 1000;
  if (!Number.isFinite(firstAir) || broadcastTime < firstAir) return 1;
  const episode = Math.max(1, Math.floor((broadcastTime - firstAir) / (7 * 24 * 60 * 60 * 1000)) + 1);
  return data.episodes && data.episodes > 0 ? Math.min(episode, data.episodes) : episode;
}
function loadFollowed(): FollowedSubject[] {
  try {
    const raw = localStorage.getItem(FOLLOWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((item: Record<string, unknown>) => ({
      bgmId: item.bgmId as number,
      nameCn: (item.nameCn as string) || (item.name as string) || "",
      nameOriginal: (item.nameOriginal as string) || "",
      malId: item.malId as number,
      coverUrl: (item.coverUrl as string) || undefined,
    }));
  } catch {
    return [];
  }
}

function saveFollowed(list: FollowedSubject[]): void {
  try {
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function getNotifyBeforeMinutes(): number {
  return Number(localStorage.getItem(NOTIFY_BEFORE_MINUTES_KEY)) || 5;
}

function getNotifyDelayMinutes(): number {
  return Number(localStorage.getItem(NOTIFY_DELAY_MINUTES_KEY)) || 0;
}

let nextId = 1;

/** 常规轮询间隔。它只是兜底，真正的准点由 preciseTimer 负责。 */
const CHECK_INTERVAL_MS = 30_000;

// Singleton state
const followed = ref<FollowedSubject[]>(loadFollowed());
const notifyEnabled = ref(localStorage.getItem(NOTIFY_ENABLED_KEY) === "1");
const lastNotifiedType = new Map<number, string>();
let checkTimer: number | null = null;
let refreshTimer: number | null = null;
let checkInProgress = false;
/** 为「下一条即将到点的通知」安排的一次性定时器 */
let preciseTimer: number | null = null;
let notifyWindow: WebviewWindow | null = null;

// ▸▸ Helpers

function getNotifyHtmlUrl(): string {
  // In dev mode, use the Vite dev server; in prod, pass a bare path so Tauri
  // resolves it as WebviewUrl::App (relative to frontendDist), avoiding the
  // full https://asset.localhost URL being treated as an external URL.
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return `http://localhost:1420/notify.html`;
  }
  return `/notify.html`;
}

async function ensureNotifyWindow(): Promise<WebviewWindow | null> {
  // Reuse existing window if still alive
  if (notifyWindow) {
    try {
      // Check if window still exists by testing a method
      await notifyWindow.isVisible();
      return notifyWindow;
    } catch {
      notifyWindow = null;
    }
  }

  try {
    // Calculate position: bottom-right of the primary monitor
    const rightOffset = 24;
    const bottomOffset = 24;
    const winWidth = 370;
    const winHeight = 580; // fixed: fits ~3 cards comfortably

    // Use screen info to position at bottom-right
    const screenWidth = typeof window !== "undefined" ? window.screen.width : 1920;
    const screenHeight = typeof window !== "undefined" ? window.screen.height : 1080;

    notifyWindow = new WebviewWindow(NOTIFY_WINDOW_LABEL, {
      url: getNotifyHtmlUrl(),
      width: winWidth,
      height: winHeight,
      x: screenWidth - winWidth - rightOffset,
      y: screenHeight - winHeight - bottomOffset,
      decorations: false,
      transparent: true,
      backgroundColor: [0, 0, 0, 0],
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      visible: false,
      title: "配信提示",
    });

    // Wait for the window to be created
    await new Promise<void>((resolve) => {
      const unlisten = notifyWindow!.once("tauri://created", () => {
        unlisten.then((fn) => fn()).catch(() => {});
        resolve();
      });
      // Timeout fallback
      setTimeout(() => resolve(), 2000);
    });

    return notifyWindow;
  } catch (e) {
    console.warn("[BroadcastNotify] Failed to create notification window:", e);
    notifyWindow = null;
    return null;
  }
}

async function showNotificationOnWindow(notification: BroadcastNotification): Promise<boolean> {
  const win = await ensureNotifyWindow();
  if (!win) return false;

  try {
    await emit("broadcast-notify-show", { notification });
    return true;
  } catch (e) {
    console.warn("[BroadcastNotify] Failed to emit notification:", e);
    return false;
  }
}

// ▸▸ Public API

export function isFollowed(bgmId: number): boolean {
  return followed.value.some((s) => s.bgmId === bgmId);
}

export function followSubject(bgmId: number, nameCn: string, nameOriginal: string, malId: number, coverUrl?: string): void {
  if (isFollowed(bgmId)) return;
  const list = [...followed.value, { bgmId, nameCn, nameOriginal, malId, coverUrl }];
  followed.value = list;
  saveFollowed(list);
}

export function unfollowSubject(bgmId: number): void {
  const list = followed.value.filter((s) => s.bgmId !== bgmId);
  followed.value = list;
  saveFollowed(list);
  lastNotifiedType.delete(bgmId);
}

// ▸▸ Check loop

async function checkAndNotify(): Promise<void> {
  if (checkInProgress) return;
  checkInProgress = true;
  clearPreciseTimer();
  if (followed.value.length === 0) {
    checkInProgress = false;
    return;
  }

  const now = Date.now();
  const notifyBeforeMin = getNotifyBeforeMinutes();
  const notifyDelayMin = getNotifyDelayMinutes();
  const delayMs = notifyDelayMin * 60 * 1000;

  /** 本轮里最早的一个「还没到点」的通知时刻 */
  let earliestPending: number | null = null;
  function notePending(targetMs: number): void {
    if (targetMs <= now) return;
    if (earliestPending === null || targetMs < earliestPending) {
      earliestPending = targetMs;
    }
  }

  try {
    for (const subject of followed.value) {
    const cached = getCachedMatch(subject.bgmId);
    const data: TenraiAnimeFull | null = cached?.data ?? null;
    if (!data) continue;

    const timing = calculateBroadcast(
      data.broadcast,
      data.status,
      data.duration,
      data.aired?.from ?? null,
      data.aired?.to ?? null,
      new Date(now),
    );

    if (!timing) continue;

    const typeKey = `${subject.bgmId}-${timing.status}`;

    // "before-broadcast"
    if (
      timing.status === "before-broadcast" &&
      timing.countdownSeconds !== null &&
      timing.countdownSeconds > 0
    ) {
      const broadcastStartMs = now + timing.countdownSeconds * 1000;
      const notifyTargetMs = broadcastStartMs - notifyBeforeMin * 60 * 1000 + delayMs;

      if (now >= notifyTargetMs && lastNotifiedType.get(subject.bgmId) !== typeKey) {
        const remainingSec = Math.max(1, Math.round(timing.countdownSeconds));
        const sent = await showNotificationOnWindow({
          id: `bn-${Date.now()}-${nextId++}`,
          nameCn: subject.nameCn,
          nameOriginal: subject.nameOriginal,
          type: "before-broadcast",
          message: `将在约 ${Math.max(1, Math.round(remainingSec / 60))} 分钟后开始配信。`,
          broadcastTime: broadcastStartMs,
          countdownSeconds: remainingSec,
          delayMinutes: notifyDelayMin,
          timestamp: now,
          coverUrl: subject.coverUrl,
          episodeNumber: estimateEpisodeNumber(data, broadcastStartMs),
          totalEpisodes: data.episodes ?? undefined,
        });
        if (sent) {
          lastNotifiedType.set(subject.bgmId, typeKey);
        }
      } else {
        notePending(notifyTargetMs);
      }
      // 倒计时归零后会切到 on-air，为那一刻也排上精确定时器
      notePending(broadcastStartMs + delayMs);
    }

    // "on-air"
    if (timing.status === "on-air" && lastNotifiedType.get(subject.bgmId) !== typeKey) {
      const broadcastStartMs = timing.nextBroadcast.getTime();
      const notifyTargetMs = broadcastStartMs + delayMs;

      if (now >= notifyTargetMs) {
        const sent = await showNotificationOnWindow({
          id: `bn-${Date.now()}-${nextId++}`,
          nameCn: subject.nameCn,
          nameOriginal: subject.nameOriginal,
          type: "on-air",
          message: "正在配信！",
          broadcastTime: broadcastStartMs,
          countdownSeconds: 0,
          delayMinutes: notifyDelayMin,
          timestamp: now,
          coverUrl: subject.coverUrl,
          episodeNumber: estimateEpisodeNumber(data, broadcastStartMs),
          totalEpisodes: data.episodes ?? undefined,
        });
        if (sent) {
          lastNotifiedType.set(subject.bgmId, typeKey);
        }
      } else {
        notePending(notifyTargetMs);
      }
    }

    // Reset for next episode
    if (
      timing.status === "ended-today" ||
      timing.status === "not-today" ||
      timing.status === "finished"
    ) {
      lastNotifiedType.delete(subject.bgmId);
    }
  }

    schedulePreciseCheck(earliestPending);
  } finally {
    checkInProgress = false;
  }
}

function clearPreciseTimer(): void {
  if (preciseTimer !== null) {
    window.clearTimeout(preciseTimer);
    preciseTimer = null;
  }
}

/**
 * 常规轮询是 30 秒一次，光靠它通知最多会迟到 30 秒。
 * 这里为最近的一个通知时刻单独排一次定时器，让它准点发出。
 * 比常规间隔还远的目标交给下一次轮询，届时会再排一次，逐步收敛。
 */
function schedulePreciseCheck(targetMs: number | null): void {
  if (targetMs === null) return;
  const delay = targetMs - Date.now();
  if (delay <= 0 || delay >= CHECK_INTERVAL_MS) return;
  preciseTimer = window.setTimeout(() => {
    preciseTimer = null;
    void checkAndNotify();
  }, delay + 200);
}

async function refreshBroadcastData(): Promise<void> {
  for (const subject of followed.value) {
    // 假番剧的数据是本地捏造的，没有对应的远端条目可刷新
    if (isFakeSubjectId(subject.bgmId)) continue;
    try {
      const fresh = await fetchMalAnimeFull(subject.malId);
      const cached = getCachedMatch(subject.bgmId);
      if (fresh && cached) {
        setManualMatch(subject.bgmId, { ...cached, data: fresh, detailFetchedAt: Date.now() });
      }
    } catch { /* ignore */ }
  }
}

/**
 * 清除「本轮已通知过」的记录，让同一条目能再次触发通知。
 * 不传参数则清空全部。
 */
export function resetNotifyState(bgmId?: number): void {
  if (bgmId === undefined) {
    lastNotifiedType.clear();
  } else {
    lastNotifiedType.delete(bgmId);
  }
}

/** 立即跑一次检查，不必等 30 秒的轮询 */
export async function runBroadcastCheckNow(): Promise<void> {
  await checkAndNotify();
}

// ▸▸ Test notification

const TEST_SUBJECTS = [
  { nameCn: "梦想成为魔法少女", nameOriginal: "魔法少女にあこがれて", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/96/d1/424663_mM5GN.jpg" },
  { nameCn: "孤独摇滚！", nameOriginal: "ぼっち・ざ・ろっく！", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/e2/e7/328609_2EHLJ.jpg" },
  { nameCn: "人形电脑天使心", nameOriginal: "ちょびっツ", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/c2/0a/12_q23bZ.jpg" },
  { nameCn: "轻音少女", nameOriginal: "けいおん！", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/48/9d/1424_q8FMQ.jpg" },
  { nameCn: "我们仍未知道那天所看见的花的名字。", nameOriginal: "あの日見た花の名前を僕達はまだ知らない。", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/6c/e8/10440_8HP6O.jpg" },
  { nameCn: "魔法少女小圆", nameOriginal: "魔法少女まどか☆マギカ", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/cb/57/9717_sAVag.jpg" },
  { nameCn: "天使降临到了我身边！", nameOriginal: "私に天使が舞い降りた！", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/f3/2d/249637_2r3gw.jpg" },
  { nameCn: "调教咖啡厅", nameOriginal: "ブレンド・S", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/f4/fe/204145_mbsLs.jpg" },
  { nameCn: "败犬女主太多了！", nameOriginal: "負けヒロインが多すぎる！", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/e4/dc/464376_NsZRw.jpg" },
  { nameCn: "学园孤岛", nameOriginal: "がっこうぐらし！", coverUrl: "https://lain.bgm.tv/r/100/pic/cover/l/e9/a7/106693_68MDM.jpg" },
];

export function sendTestNotification(type: NotificationType): void {
  const now = Date.now();
  const notifyBeforeMin = getNotifyBeforeMinutes();
  const notifyDelayMin = getNotifyDelayMinutes();

  // Countdown = notifyBeforeMin minutes from now — this simulates the point
  // where checkAndNotify would fire the before-broadcast notification.
  const countdownSec = notifyBeforeMin * 60;
  const broadcastTime = type === "before-broadcast" ? now + countdownSec * 1000 : now;

  const picked = TEST_SUBJECTS[Math.floor(Math.random() * TEST_SUBJECTS.length)];

  let message: string;
  if (type === "before-broadcast") {
    const parts = [`将在约 ${notifyBeforeMin} 分钟后开始配信`];
    if (notifyDelayMin > 0) parts.push(`延迟 ${notifyDelayMin} 分钟`);
    parts.push("（测试通知）");
    message = parts.join("，");
  } else {
    const parts = ["正在配信！"];
    if (notifyDelayMin > 0) parts.push(`延迟 ${notifyDelayMin} 分钟`);
    parts.push("（测试通知）");
    message = parts.join("，");
  }

  void showNotificationOnWindow({
    id: `bn-test-${Date.now()}-${nextId++}`,
    nameCn: picked.nameCn,
    nameOriginal: picked.nameOriginal,
    type,
    message,
    broadcastTime,
    countdownSeconds: type === "before-broadcast" ? countdownSec : 0,
    delayMinutes: notifyDelayMin,
    timestamp: now,
    coverUrl: picked.coverUrl,
    episodeNumber: 3,
    totalEpisodes: 12,
  });
}

export function clearAllFollowed(): void {
  followed.value = [];
  saveFollowed([]);
  lastNotifiedType.clear();
}

// ▸▸ Lifecycle

export function startBroadcastNotify(): void {
  notifyEnabled.value = true;
  if (checkTimer !== null) return;

  // 假番剧的数据可能被「清除 MAL 匹配缓存」清掉，启动时重新写回
  syncFakeSubjectsToCache();

  // Pre-create the notification window so the first notification appears instantly
  void ensureNotifyWindow();

  checkTimer = window.setInterval(() => {
    void checkAndNotify();
  }, CHECK_INTERVAL_MS);

  refreshTimer = window.setInterval(() => {
    void refreshBroadcastData();
  }, 10 * 60_000);

  void checkAndNotify();
}

export function stopBroadcastNotify(): void {
  notifyEnabled.value = false;
  if (checkTimer !== null) {
    window.clearInterval(checkTimer);
    checkTimer = null;
  }
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  clearPreciseTimer();
  // Close notification window (fire-and-forget, don't block)
  if (notifyWindow) {
    notifyWindow.close().catch(() => {});
    notifyWindow = null;
  }
}

// ▸▸ Composable hook

export function useBroadcastNotify() {
  return {
    followed,
    notifyEnabled,
    isFollowed,
    followSubject,
    unfollowSubject,
    sendTestNotification,
    clearAllFollowed,
    resetNotifyState,
    runBroadcastCheckNow,
    startBroadcastNotify,
    stopBroadcastNotify,
  };
}
