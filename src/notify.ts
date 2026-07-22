import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface BroadcastNotification {
  id: string;
  nameCn: string;
  nameOriginal: string;
  type: "before-broadcast" | "on-air";
  message: string;
  broadcastTime: number;
  countdownSeconds: number;
  delayMinutes: number;
  timestamp: number;
  coverUrl?: string;
}

const THEME_KEY = "bangumi.theme";
const TITLE_PREFERENCE_KEY = "bangumi.title.preference";

// ── Theme initialization ──
function getTheme(): string {
  return localStorage.getItem(THEME_KEY) || "light";
}

function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
}

// Apply initial theme
applyTheme(getTheme());

// Listen for theme changes from main window (via storage event)
window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY && event.newValue) {
    applyTheme(event.newValue);
  }
});

// ── Title preference ──
function getTitlePreference(): "translated" | "original" {
  return (localStorage.getItem(TITLE_PREFERENCE_KEY) as "translated" | "original") || "translated";
}

const container = document.getElementById("container")!;
const emptyEl = document.getElementById("empty")!;

const WIN_WIDTH = 370;
const MAX_VISIBLE_CARDS = 3;

const notifications: BroadcastNotification[] = [];
const autoDismissTimers = new Map<string, number>();
const cardElements = new Map<string, HTMLElement>();
let countdownTimer: number | null = null;

// ── Prevent right-click ──
document.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Format helpers ──

function formatTime(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const wd = weekdays[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${wd} ${hh}:${mm}`;
}

function formatCountdown(sec: number): string {
  if (sec <= 0) return "即将开始";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function liveCountdown(n: BroadcastNotification): number {
  if (n.type !== "before-broadcast" || n.countdownSeconds <= 0) return 0;
  const elapsed = Math.floor((Date.now() - n.timestamp) / 1000);
  return Math.max(0, n.countdownSeconds - elapsed);
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Card HTML ──

function buildCardHtml(n: BroadcastNotification): string {
  const remaining = liveCountdown(n);
  const pref = getTitlePreference();

  // Primary title = user's preferred order
  const primaryName = pref === "original"
    ? (n.nameOriginal || n.nameCn)
    : (n.nameCn || n.nameOriginal);
  const secondaryName = pref === "original"
    ? (n.nameCn !== n.nameOriginal ? n.nameCn : "")
    : (n.nameOriginal !== n.nameCn ? n.nameOriginal : "");

  // Cover image section
  const coverHtml = n.coverUrl
    ? `<img class="card__cover" src="${escapeHtml(n.coverUrl)}" alt="" loading="lazy" />`
    : "";

  return `
    <div class="card__header">
      <svg class="card__icon" viewBox="0 0 640 640" aria-hidden="true">
        <path d="M432 423.8C471.1 391.5 496 342.7 496 288C496 190.8 417.2 112 320 112C222.8 112 144 190.8 144 288C144 342.7 168.9 391.5 208 423.8C208.4 441.4 211.2 464.2 214.4 485.6C144 447.9 96 373.5 96 288C96 164.3 196.3 64 320 64C443.7 64 544 164.3 544 288C544 373.6 496 447.9 425.5 485.6C428.8 464.2 431.5 441.4 431.9 423.8zM418 370.4C409.7 357.8 398.8 348.8 387.6 342.6C385.5 341.5 383.4 340.4 381.3 339.4C393 325.5 400.1 307.5 400.1 287.9C400.1 243.7 364.3 207.9 320.1 207.9C275.9 207.9 240.1 243.7 240.1 287.9C240.1 307.5 247.2 325.5 258.9 339.4C256.8 340.4 254.7 341.4 252.6 342.6C241.4 348.8 230.5 357.8 222.2 370.4C203.4 348.1 192.1 319.4 192.1 288C192.1 217.3 249.4 160 320.1 160C390.8 160 448.1 217.3 448.1 288C448.1 319.4 436.8 348.2 418 370.4zM320 376C352.9 376 384 384.6 384 419.8C384 452.8 371.1 523.9 363.4 552.7C358.3 571.7 338.9 576.1 320 576.1C301.1 576.1 281.8 571.7 276.6 552.7C268.8 524.2 256 453 256 419.9C256 384.8 287.1 376.1 320 376.1zM320 248C342.1 248 360 265.9 360 288C360 310.1 342.1 328 320 328C297.9 328 280 310.1 280 288C280 265.9 297.9 248 320 248z" fill="currentColor"/>
      </svg>
      <span class="card__label">${n.type === "on-air" ? "正在配信" : "配信提醒"}</span>
      ${n.delayMinutes > 0 ? `<span class="card__badge">已延迟 ${n.delayMinutes} 分钟</span>` : ""}
    </div>
    <div class="card__title-row">
      ${coverHtml}
      <div class="card__title-col">
        <div class="card__name-primary">${escapeHtml(primaryName)}</div>
        ${secondaryName ? `<div class="card__name-secondary">${escapeHtml(secondaryName)}</div>` : ""}
      </div>
    </div>
    <div class="card__body">
      <div class="card__row">
        <span class="card__row-label">开播时间</span>
        <span class="card__row-value">${formatTime(n.broadcastTime)}</span>
      </div>
      ${n.type === "before-broadcast" && remaining > 0 ? `
      <div class="card__row card__row--countdown" data-countdown="${n.id}">
        <span class="card__row-label">距离配信</span>
        <span class="card__countdown">${formatCountdown(remaining)}</span>
      </div>` : ""}
      ${n.type === "on-air" ? `
      <div class="card__row">
        <span class="card__row-label">状态</span>
        <span class="card__row-value card__on-air">🔴 配信中</span>
      </div>` : ""}
      ${n.delayMinutes > 0 ? `
      <div class="card__row">
        <span class="card__row-label">通知延迟</span>
        <span class="card__row-value">${n.delayMinutes} 分钟</span>
      </div>` : ""}
    </div>
    <button class="card__close" data-close="${n.id}" aria-label="关闭通知">✕</button>
  `;
}

// ── Render ──

function renderAll() {
  container.innerHTML = "";

  if (notifications.length === 0) {
    container.appendChild(emptyEl);
    emptyEl.style.display = "flex";
    stopCountdownTimer();
    void hideWindow();
    return;
  }

  emptyEl.style.display = "none";

  // Render newest first (column-reverse in CSS displays newest at bottom)
  for (const n of [...notifications].reverse()) {
    const existing = cardElements.get(n.id);
    if (existing) {
      container.appendChild(existing);
      continue;
    }

    const card = document.createElement("div");
    card.className = `card${n.type === "on-air" ? " on-air" : ""}`;
    card.innerHTML = buildCardHtml(n);

    // Attach close handler
    card.querySelector("[data-close]")?.addEventListener("click", () => {
      dismissById(n.id);
    });

    // Play entry animation
    card.classList.add("card-enter");
    card.addEventListener("animationend", () => {
      card.classList.remove("card-enter");
    }, { once: true });

    cardElements.set(n.id, card);
    container.appendChild(card);
  }

  // Scroll to bottom to show newest
  container.scrollTop = container.scrollHeight;

  // Start/stop countdown timer
  if (notifications.some((n) => n.type === "before-broadcast" && n.countdownSeconds > 0)) {
    startCountdownTimer();
  }

  void getCurrentWindow().show();
}

function updateCountdowns() {
  const now = Date.now();
  for (const n of notifications) {
    const remaining = n.type === "before-broadcast"
      ? Math.max(0, n.countdownSeconds - Math.floor((now - n.timestamp) / 1000))
      : 0;
    const el = document.querySelector(`[data-countdown="${n.id}"] .card__countdown`);
    if (el) {
      el.textContent = formatCountdown(remaining);
    }
  }
}

// ── Countdown timer ──

function startCountdownTimer() {
  if (countdownTimer !== null) return;
  countdownTimer = window.setInterval(updateCountdowns, 1000);
}

function stopCountdownTimer() {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ── Dismiss ──

function dismissById(id: string) {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx === -1) return;

  const card = cardElements.get(id);
  if (card) {
    // Play exit animation
    card.classList.add("card-exit");
    card.addEventListener("animationend", () => {
      card.remove();
      cardElements.delete(id);
    }, { once: true });
  }

  notifications.splice(idx, 1);

  const timer = autoDismissTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    autoDismissTimers.delete(id);
  }

  // Defer renderAll slightly so exit animation plays first
  setTimeout(() => {
    // Remove from container only if animation already finished
    if (!card?.classList.contains("card-exit")) {
      card?.remove();
      cardElements.delete(id);
    }
    renderAll();
  }, 220);
}

function scheduleAutoDismiss(id: string) {
  const timer = window.setTimeout(() => {
    autoDismissTimers.delete(id);
    dismissById(id);
  }, 15_000);
  autoDismissTimers.set(id, timer);
}

// ── Window hide ──

async function hideWindow() {
  try {
    const win = getCurrentWindow();
    await win.hide();
  } catch {
    // ignore
  }
}

// ── Event listener ──

interface NotifyEventPayload {
  notification: BroadcastNotification;
}

async function setupListener() {
  await listen<NotifyEventPayload>("broadcast-notify-show", (event) => {
    const { notification } = event.payload;

    // Dedup
    if (notifications.some((n) => n.id === notification.id)) return;

    notifications.push(notification);
    scheduleAutoDismiss(notification.id);
    renderAll();
  });
}

// ── Start ──

setupListener();
