import { ref, type Ref } from "vue";
import { calculateBroadcast } from "../utils/broadcastTiming";
import { getCachedMatch, fetchMalAnimeFull } from "../utils/animeMatch";
import type { TenraiAnimeFull } from "../api/Tenrai";

const FOLLOWED_KEY = "bangumi.broadcast.followedSubjects";
const NOTIFY_ENABLED_KEY = "bangumi.broadcast.notifyEnabled";
const NOTIFY_BEFORE_MINUTES_KEY = "bangumi.broadcast.notifyBeforeMinutes";
const NOTIFY_DELAY_MINUTES_KEY = "bangumi.broadcast.notifyDelayMinutes";

export interface FollowedSubject {
  bgmId: number;
  name: string;
  malId: number;
}

export interface BroadcastNotification {
  id: string;
  title: string;
  message: string;
  timestamp: number;
}

function loadFollowed(): FollowedSubject[] {
  try {
    const raw = localStorage.getItem(FOLLOWED_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FollowedSubject[];
  } catch {
    return [];
  }
}

function saveFollowed(list: FollowedSubject[]): void {
  try {
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable
  }
}

function getNotifyBeforeMinutes(): number {
  return Number(localStorage.getItem(NOTIFY_BEFORE_MINUTES_KEY)) || 5;
}

function getNotifyDelayMinutes(): number {
  return Number(localStorage.getItem(NOTIFY_DELAY_MINUTES_KEY)) || 0;
}

let nextId = 1;

// Singleton state: shared across all component instances
const followed = ref<FollowedSubject[]>(loadFollowed());
const notifications: Ref<BroadcastNotification[]> = ref([]);
const lastNotifiedType = new Map<number, string>(); // bgmId -> last notification type key
let checkTimer: number | null = null;
let refreshTimer: number | null = null;

/** Check if a subject is currently followed */
export function isFollowed(bgmId: number): boolean {
  return followed.value.some((s) => s.bgmId === bgmId);
}

/** Follow a subject for broadcast notifications */
export function followSubject(bgmId: number, name: string, malId: number): void {
  if (isFollowed(bgmId)) return;
  const list = [...followed.value, { bgmId, name, malId }];
  followed.value = list;
  saveFollowed(list);
}

/** Unfollow a subject */
export function unfollowSubject(bgmId: number): void {
  const list = followed.value.filter((s) => s.bgmId !== bgmId);
  followed.value = list;
  saveFollowed(list);
  lastNotifiedType.delete(bgmId);
}

async function checkAndNotify(): Promise<void> {
  if (followed.value.length === 0) return;

  const now = Date.now();
  const notifyBeforeMin = getNotifyBeforeMinutes();
  const notifyDelayMin = getNotifyDelayMinutes();
  const delayMs = notifyDelayMin * 60 * 1000;

  for (const subject of followed.value) {
    // Get cached match data
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

    // Check "before-broadcast" notification
    if (
      timing.status === "before-broadcast" &&
      timing.countdownSeconds !== null &&
      timing.countdownSeconds > 0
    ) {
      const broadcastStartMs = now + timing.countdownSeconds * 1000;
      const notifyTargetMs = broadcastStartMs - notifyBeforeMin * 60 * 1000 + delayMs;

      if (now >= notifyTargetMs && lastNotifiedType.get(subject.bgmId) !== typeKey) {
        lastNotifiedType.set(subject.bgmId, typeKey);
        const remainingMin = Math.max(1, Math.round((timing.countdownSeconds - delayMs / 1000) / 60));
        const id = `bn-${Date.now()}-${nextId++}`;
        notifications.value = [
          ...notifications.value,
          {
            id,
            title: subject.name,
            message: `将在约 ${remainingMin} 分钟后开始配信。`,
            timestamp: now,
          },
        ];
        // Auto-dismiss after 8 seconds
        setTimeout(() => dismissNotification(id), 8000);
      }
    }

    // Check "on-air" notification
    if (timing.status === "on-air" && lastNotifiedType.get(subject.bgmId) !== typeKey) {
      const broadcastStartMs = timing.nextBroadcast.getTime();
      const notifyTargetMs = broadcastStartMs + delayMs;

      if (now >= notifyTargetMs) {
        lastNotifiedType.set(subject.bgmId, typeKey);
        const id = `bn-${Date.now()}-${nextId++}`;
        notifications.value = [
          ...notifications.value,
          {
            id,
            title: subject.name,
            message: "正在配信！",
            timestamp: now,
          },
        ];
        // Auto-dismiss after 8 seconds
        setTimeout(() => dismissNotification(id), 8000);
      }
    }

    // Reset last notified type when broadcast transitions to a different phase
    // This allows re-notification for the next episode (next week)
    if (
      timing.status === "ended-today" ||
      timing.status === "not-today" ||
      timing.status === "finished"
    ) {
      // Clear previous notification state so next episode triggers again
      if (lastNotifiedType.has(subject.bgmId)) {
        lastNotifiedType.delete(subject.bgmId);
      }
    }
  }
}

async function refreshBroadcastData(): Promise<void> {
  for (const subject of followed.value) {
    try {
      await fetchMalAnimeFull(subject.malId);
    } catch {
      // Silently ignore refresh failures
    }
  }
}

/** Dismiss a single notification by id */
export function dismissNotification(id: string): void {
  notifications.value = notifications.value.filter((n) => n.id !== id);
}

/** Start the notification check loop. Safe to call multiple times (no-op if already running). */
export function startBroadcastNotify(): void {
  if (checkTimer !== null) return;

  // Check every 30 seconds
  checkTimer = window.setInterval(() => {
    void checkAndNotify();
  }, 30_000);

  // Refresh broadcast data every 10 minutes
  refreshTimer = window.setInterval(() => {
    void refreshBroadcastData();
  }, 10 * 60_000);

  // Run an immediate check
  void checkAndNotify();
}

/** Stop the notification check loop */
export function stopBroadcastNotify(): void {
  if (checkTimer !== null) {
    window.clearInterval(checkTimer);
    checkTimer = null;
  }
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function useBroadcastNotify() {
  return {
    followed,
    notifications,
    isFollowed,
    followSubject,
    unfollowSubject,
    dismissNotification,
    startBroadcastNotify,
    stopBroadcastNotify,
  };
}
