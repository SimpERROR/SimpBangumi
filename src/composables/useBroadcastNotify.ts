import { ref } from "vue";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { calculateBroadcast } from "../utils/broadcastTiming";
import { getCachedMatch, fetchMalAnimeFull } from "../utils/animeMatch";
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

// Singleton state
const followed = ref<FollowedSubject[]>(loadFollowed());
const lastNotifiedType = new Map<number, string>();
let checkTimer: number | null = null;
let refreshTimer: number | null = null;
let notifyWindow: WebviewWindow | null = null;

// ▸▸ Helpers

function getNotifyHtmlUrl(): string {
  // In dev mode, use the Vite dev server; in prod, Tauri serves from dist via asset protocol
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return `http://localhost:1420/notify.html`;
  }
  return `asset://localhost/notify.html`;
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
  if (followed.value.length === 0) return;

  const now = Date.now();
  const notifyBeforeMin = getNotifyBeforeMinutes();
  const notifyDelayMin = getNotifyDelayMinutes();
  const delayMs = notifyDelayMin * 60 * 1000;

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
        // Use the actual remaining seconds from timing — the delay is already
        // accounted for in notifyTargetMs (it shifts when the notification fires),
        // so we must NOT subtract delayMs again here.
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
        });
        if (sent) {
          lastNotifiedType.set(subject.bgmId, typeKey);
        }
      }
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
        });
        if (sent) {
          lastNotifiedType.set(subject.bgmId, typeKey);
        }
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
}

async function refreshBroadcastData(): Promise<void> {
  for (const subject of followed.value) {
    try {
      await fetchMalAnimeFull(subject.malId);
    } catch { /* ignore */ }
  }
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
  });
}

export function clearAllFollowed(): void {
  followed.value = [];
  saveFollowed([]);
  lastNotifiedType.clear();
}

// ▸▸ Lifecycle

export function startBroadcastNotify(): void {
  if (checkTimer !== null) return;

  // Pre-create the notification window so the first notification appears instantly
  void ensureNotifyWindow();

  checkTimer = window.setInterval(() => {
    void checkAndNotify();
  }, 30_000);

  refreshTimer = window.setInterval(() => {
    void refreshBroadcastData();
  }, 10 * 60_000);

  void checkAndNotify();
}

export function stopBroadcastNotify(): void {
  if (checkTimer !== null) {
    window.clearInterval(checkTimer);
    checkTimer = null;
  }
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
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
    isFollowed,
    followSubject,
    unfollowSubject,
    sendTestNotification,
    clearAllFollowed,
    startBroadcastNotify,
    stopBroadcastNotify,
  };
}
