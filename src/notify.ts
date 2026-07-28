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
  episodeNumber?: number;
  totalEpisodes?: number;
}

const THEME_KEY = "bangumi.theme";
const TITLE_PREFERENCE_KEY = "bangumi.title.preference";
const container = document.getElementById("container")!;
const emptyEl = document.getElementById("empty")!;
const notifications: BroadcastNotification[] = [];
const cards = new Map<string, HTMLElement>();
const timers = new Map<string, number>();
let countdownTimer: number | null = null;

function applyTheme(): void { document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || "light"; }
applyTheme();
window.addEventListener("storage", (e) => { if (e.key === THEME_KEY) applyTheme(); });
document.addEventListener("contextmenu", (e) => e.preventDefault());

function escapeHtml(value: string): string { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; }
function formatTime(ts: number): string {
  const d = new Date(ts);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${week} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "即将开始";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (h) return `${h}小时 ${m}分 ${s}秒`;
  if (m) return `${m}分 ${s}秒`;
  return `${s}秒`;
}
function remaining(n: BroadcastNotification): number { return n.type === "before-broadcast" ? Math.max(0, Math.floor((n.broadcastTime - Date.now()) / 1000)) : 0; }
function episodeText(n: BroadcastNotification): string { return n.episodeNumber ? `第 ${n.episodeNumber} 集${n.totalEpisodes ? ` / 共 ${n.totalEpisodes} 集` : ""}` : "集数待数据源确认"; }
function buildCard(n: BroadcastNotification): string {
  const originalFirst = localStorage.getItem(TITLE_PREFERENCE_KEY) === "original";
  const primary = originalFirst ? (n.nameOriginal || n.nameCn) : (n.nameCn || n.nameOriginal);
  const secondary = originalFirst ? n.nameCn : n.nameOriginal;
  const cover = n.coverUrl ? `<img class="card__cover" src="${escapeHtml(n.coverUrl)}" alt="" />` : `<div class="card__cover card__cover--empty">番</div>`;
  const countdown = remaining(n);
  return `<div class="card__header"><span class="card__dot ${n.type === "on-air" ? "card__dot--live" : ""}"></span><span class="card__label">${n.type === "on-air" ? "正在配信" : "配信提醒"}</span>${n.delayMinutes ? `<span class="card__badge">已延迟 ${n.delayMinutes} 分钟</span>` : ""}</div>
    <div class="card__title-row">${cover}<div class="card__title-col"><div class="card__name-primary">${escapeHtml(primary)}</div>${secondary && secondary !== primary ? `<div class="card__name-secondary">${escapeHtml(secondary)}</div>` : ""}<div class="card__episode">${escapeHtml(episodeText(n))}</div></div></div>
    <div class="card__body"><div class="card__row"><span>开播时间</span><strong>${formatTime(n.broadcastTime)}</strong></div>${n.type === "before-broadcast" ? `<div class="card__countdown-row"><span>距离配信</span><strong data-countdown="${n.id}">${formatCountdown(countdown)}</strong></div>` : `<div class="card__row"><span>状态</span><strong class="card__on-air">● 配信中</strong></div>`}<p class="card__message">${escapeHtml(n.message)}</p></div>
    <button class="card__close" data-close="${n.id}" aria-label="关闭">×</button>`;
}
function stopCountdown(): void { if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; } }
function updateCountdowns(): void {
  let active = false;
  for (const n of notifications) { if (n.type !== "before-broadcast") continue; const value = remaining(n); const el = document.querySelector(`[data-countdown="${n.id}"]`); if (el) el.textContent = formatCountdown(value); if (value > 0) active = true; }
  if (!active) stopCountdown();
}
function dismiss(id: string): void {
  const index = notifications.findIndex((n) => n.id === id); if (index < 0) return;
  clearTimeout(timers.get(id)); timers.delete(id);
  const card = cards.get(id);
  notifications.splice(index, 1);
  if (!card) { cards.delete(id); render(); return; }
  card.classList.add("card-exit");
  card.addEventListener("animationend", () => {
    card.remove();
    cards.delete(id);
    render();
  }, { once: true });
}
function render(): void {
  container.replaceChildren();
  emptyEl.style.display = notifications.length ? "none" : "flex";
  if (!notifications.length) { container.appendChild(emptyEl); stopCountdown(); void getCurrentWindow().hide(); return; }
  // Render oldest first so the newest notification stays at the bottom.
  for (const n of notifications) {
    let card = cards.get(n.id);
    if (!card) {
      const newCard = document.createElement("article");
      newCard.className = `card card-enter ${n.type === "on-air" ? "on-air" : ""}`;
      newCard.innerHTML = buildCard(n);
      newCard.querySelector("[data-close]")?.addEventListener("click", () => dismiss(n.id));
      cards.set(n.id, newCard);
      card = newCard;
      newCard.addEventListener("animationend", () => newCard.classList.remove("card-enter"), { once: true });
    }
    container.appendChild(card);
  }
  if (notifications.some((n) => n.type === "before-broadcast" && remaining(n) > 0) && countdownTimer === null) countdownTimer = window.setInterval(updateCountdowns, 1000);
  const shell = document.getElementById("app-shell");
  shell?.classList.remove("window-enter");
  requestAnimationFrame(() => shell?.classList.add("window-enter"));
  void getCurrentWindow().show();
}
async function setup(): Promise<void> {
  await listen<{ notification: BroadcastNotification }>("broadcast-notify-show", ({ payload }) => {
    if (notifications.some((n) => n.id === payload.notification.id)) return;
    notifications.push(payload.notification);
    while (notifications.length > 3) dismiss(notifications[0].id);
    const timeout = payload.notification.type === "on-air" ? 30000 : 20000;
    timers.set(payload.notification.id, window.setTimeout(() => dismiss(payload.notification.id), timeout));
    render();
  });
}
void setup();