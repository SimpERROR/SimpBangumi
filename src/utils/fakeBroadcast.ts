import type { TenraiAnimeFull } from "../api/Tenrai";
import { clearCachedMatch, setManualMatch } from "./animeMatch";

/**
 * 「假番剧」——开发者选项里手工捏造的配信条目。
 *
 * 番剧信息（名称、封面、集数）取自真实 Bangumi 条目，配信时间等则完全由用户指定。
 * 数据被写进和真实匹配结果同一份缓存（`bangumi.Tenrai.matchMap`），所以
 * `checkAndNotify()` → `calculateBroadcast()` → 通知浮窗这条链路走的是真实逻辑，
 * 不存在任何为测试开的旁路。
 */

const FAKE_KEY = "bangumi.broadcast.fakeSubjects";

/** 假番剧一律使用负数 ID，绝不会和真实的 Bangumi / MAL 条目冲突 */
const FIRST_FAKE_ID = -900001;

export type FakeBroadcastStatus =
  | "Currently Airing"
  | "Not yet aired"
  | "Finished Airing";

export interface FakeSubject {
  /** 合成的负数 Bangumi ID，作为关注列表与匹配缓存的键 */
  bgmId: number;
  /** 合成的负数 MAL ID，用于避免真实的详情刷新请求 */
  malId: number;
  /** 信息来源的真实 Bangumi 条目 ID，仅作展示 */
  sourceBgmId: number | null;
  nameCn: string;
  nameOriginal: string;
  coverUrl?: string;
  episodes: number | null;
  /** 原样喂给 calculateBroadcast() 的 MAL 状态串 */
  status: FakeBroadcastStatus;
  /** 英文星期名（JST），例如 "Mondays" */
  broadcastDay: string;
  /** JST "HH:MM"，支持 24:00–30:59 的深夜档写法 */
  broadcastTime: string;
  /** 单集时长（分钟），0 表示未知 */
  durationMin: number;
  /** 首播日期 "YYYY-MM-DD"，仅在「尚未开播」时影响判定 */
  airedFrom: string | null;
  /** 完结日期 "YYYY-MM-DD"，仅在「已完结」时影响判定 */
  airedTo: string | null;
  createdAt: number;
}

/** 星期选项，value 直接对应 broadcastTiming.ts 里的 DAY_NAME_TO_INDEX */
export const JST_DAY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Sundays", label: "周日" },
  { value: "Mondays", label: "周一" },
  { value: "Tuesdays", label: "周二" },
  { value: "Wednesdays", label: "周三" },
  { value: "Thursdays", label: "周四" },
  { value: "Fridays", label: "周五" },
  { value: "Saturdays", label: "周六" },
];

const DAY_INDEX_TO_NAME = JST_DAY_OPTIONS.map((option) => option.value);

export const FAKE_STATUS_OPTIONS: ReadonlyArray<{
  value: FakeBroadcastStatus;
  label: string;
}> = [
  { value: "Currently Airing", label: "连载中（Currently Airing）" },
  { value: "Not yet aired", label: "尚未开播（Not yet aired）" },
  { value: "Finished Airing", label: "已完结（Finished Airing）" },
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** ── 存取 ── */

export function loadFakeSubjects(): FakeSubject[] {
  try {
    const raw = localStorage.getItem(FAKE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FakeSubject[];
  } catch {
    return [];
  }
}

function saveFakeSubjects(list: FakeSubject[]): void {
  try {
    localStorage.setItem(FAKE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** 分配下一个可用的假番剧 ID（依次递减） */
export function nextFakeId(): number {
  const list = loadFakeSubjects();
  if (list.length === 0) return FIRST_FAKE_ID;
  const min = Math.min(...list.map((item) => item.bgmId));
  return Math.min(min - 1, FIRST_FAKE_ID);
}

/** 负数 ID 即假番剧 */
export function isFakeSubjectId(bgmId: number): boolean {
  return bgmId < 0;
}

/** ── 时间换算 ── */

/**
 * 把一个本地时间点换算成 JST 的「星期 + HH:MM」。
 *
 * 换算方式和 broadcastTiming.ts 中的 nowJst 一致，所以
 * calculateBroadcast() 解析回来时能够精确还原到同一分钟。
 * 注意 calculateBroadcast() 会把秒清零，实际开播时刻落在该分钟的 00 秒。
 */
export function jstScheduleFromLocalTime(target: Date): {
  day: string;
  time: string;
} {
  const jstOffset = 9 * 60;
  const localOffset = -target.getTimezoneOffset();
  const jst = new Date(target.getTime() + (jstOffset - localOffset) * 60000);
  return {
    day: DAY_INDEX_TO_NAME[jst.getDay()],
    time: `${pad2(jst.getHours())}:${pad2(jst.getMinutes())}`,
  };
}

/** 「N 分钟后开播」——返回对应的 JST 星期与时间 */
export function jstScheduleInMinutes(minutesFromNow: number): {
  day: string;
  time: string;
} {
  // 输入框被清空时会传进 NaN，按 0 处理
  const minutes = Number.isFinite(minutesFromNow) ? minutesFromNow : 0;
  return jstScheduleFromLocalTime(new Date(Date.now() + minutes * 60000));
}

/** 校验 JST 时间串，支持 24:00–30:59 的深夜档写法 */
export function isValidJstTime(time: string): boolean {
  return /^([0-2]?\d|30):([0-5]\d)$/.test(time.trim());
}

/** ── 构造 ── */

function parseDateParts(value: string | null): {
  day: number | null;
  month: number | null;
  year: number | null;
} {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: null, month: null, year: null };
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  };
}

/** 把假番剧配置转换成和真实数据源完全同构的 TenraiAnimeFull */
export function buildFakeAnimeFull(fake: FakeSubject): TenraiAnimeFull {
  const broadcastString = `${fake.broadcastDay} at ${fake.broadcastTime} (JST)`;
  return {
    mal_id: fake.malId,
    url: "",
    title: fake.nameOriginal || fake.nameCn,
    title_english: null,
    title_japanese: fake.nameOriginal || null,
    type: "TV",
    status: fake.status,
    episodes: fake.episodes,
    aired: {
      from: fake.airedFrom,
      to: fake.airedTo,
      prop: {
        from: parseDateParts(fake.airedFrom),
        to: parseDateParts(fake.airedTo),
      },
      string: [fake.airedFrom, fake.airedTo].filter(Boolean).join(" to ") || null,
    },
    duration: fake.durationMin > 0 ? `${fake.durationMin} min per ep` : null,
    rating: null,
    score: null,
    broadcast: {
      day: fake.broadcastDay,
      time: fake.broadcastTime,
      timezone: "JST",
      string: broadcastString,
    },
    synopsis: null,
    images: {
      jpg: {
        image_url: fake.coverUrl ?? null,
        small_image_url: fake.coverUrl ?? null,
        large_image_url: fake.coverUrl ?? null,
      },
      webp: {
        image_url: fake.coverUrl ?? null,
        small_image_url: fake.coverUrl ?? null,
        large_image_url: fake.coverUrl ?? null,
      },
    },
  };
}

/** 把单个假番剧写进匹配缓存，之后 checkAndNotify() 就能读到 */
function writeToMatchCache(fake: FakeSubject): void {
  setManualMatch(fake.bgmId, {
    bgmId: fake.bgmId,
    malId: fake.malId,
    data: buildFakeAnimeFull(fake),
    cachedAt: Date.now(),
    detailFetchedAt: Date.now(),
    detailSource: "fake",
  });
}

/** ── 增删改 ── */

/** 新建或更新一个假番剧，并同步匹配缓存 */
export function upsertFakeSubject(fake: FakeSubject): void {
  const list = loadFakeSubjects();
  const index = list.findIndex((item) => item.bgmId === fake.bgmId);
  if (index >= 0) {
    list[index] = fake;
  } else {
    list.push(fake);
  }
  saveFakeSubjects(list);
  writeToMatchCache(fake);
}

/** 删除一个假番剧，并清掉它的匹配缓存 */
export function removeFakeSubject(bgmId: number): void {
  saveFakeSubjects(loadFakeSubjects().filter((item) => item.bgmId !== bgmId));
  clearCachedMatch(bgmId);
}

export function clearAllFakeSubjects(): number[] {
  const list = loadFakeSubjects();
  for (const fake of list) {
    clearCachedMatch(fake.bgmId);
  }
  saveFakeSubjects([]);
  return list.map((item) => item.bgmId);
}

/**
 * 把所有假番剧重新写回匹配缓存。
 *
 * 「清除 MAL 匹配缓存」会把整张表删掉，假番剧必须能自己长回来，
 * 否则关注列表里会留下读不到数据的空壳。
 */
export function syncFakeSubjectsToCache(): void {
  for (const fake of loadFakeSubjects()) {
    writeToMatchCache(fake);
  }
}

/** 用真实条目信息 + 默认配信参数拼一个新的假番剧 */
export function makeFakeSubject(source: {
  sourceBgmId: number | null;
  nameCn: string;
  nameOriginal: string;
  coverUrl?: string;
  episodes?: number | null;
  minutesFromNow?: number;
  durationMin?: number;
  status?: FakeBroadcastStatus;
}): FakeSubject {
  const id = nextFakeId();
  const schedule = jstScheduleInMinutes(source.minutesFromNow ?? 10);
  return {
    bgmId: id,
    malId: id,
    sourceBgmId: source.sourceBgmId,
    nameCn: source.nameCn,
    nameOriginal: source.nameOriginal,
    coverUrl: source.coverUrl,
    episodes: source.episodes ?? null,
    status: source.status ?? "Currently Airing",
    broadcastDay: schedule.day,
    broadcastTime: schedule.time,
    durationMin: source.durationMin ?? 24,
    airedFrom: defaultAiredFrom(),
    airedTo: null,
    createdAt: Date.now(),
  };
}

/** 默认首播日期取 30 天前，避免「连载中」被当成尚未开播 */
function defaultAiredFrom(): string {
  const date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
