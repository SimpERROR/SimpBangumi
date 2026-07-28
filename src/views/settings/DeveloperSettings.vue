<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { clearAllTenraiCache } from "../../utils/animeMatch";
import { useAppStore } from "../../stores/app";
import {
  exportDiagnostics,
  getFrontendLogCount,
} from "../../composables/useDiagnostics";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useBroadcastNotify } from "../../composables/useBroadcastNotify";
import { useBangumi } from "../../composables/useBangumi";
import type { SearchSubject } from "../../api/bangumi";
import {
  buildFakeAnimeFull,
  clearAllFakeSubjects,
  FAKE_STATUS_OPTIONS,
  isFakeSubjectId,
  isValidJstTime,
  JST_DAY_OPTIONS,
  jstScheduleInMinutes,
  loadFakeSubjects,
  makeFakeSubject,
  removeFakeSubject,
  syncFakeSubjectsToCache,
  upsertFakeSubject,
  type FakeBroadcastStatus,
  type FakeSubject,
} from "../../utils/fakeBroadcast";
import {
  calculateBroadcast,
  type BroadcastTiming,
} from "../../utils/broadcastTiming";

const appStore = useAppStore();
const bangumi = useBangumi();
const {
  followed,
  sendTestNotification,
  followSubject,
  unfollowSubject,
  clearAllFollowed,
  resetNotifyState,
  runBroadcastCheckNow,
  startBroadcastNotify,
} = useBroadcastNotify();

const DEBUG_SCORE_KEY = "bangumi.Tenrai.debugScore";

const clearing = ref(false);
const debugScore = ref(localStorage.getItem(DEBUG_SCORE_KEY) === "1");

const notifyEnabled = ref(localStorage.getItem("bangumi.broadcast.notifyEnabled") === "1");
const notifyBeforeMin = ref(Number(localStorage.getItem("bangumi.broadcast.notifyBeforeMinutes")) || 5);
const notifyDelayMin = ref(Number(localStorage.getItem("bangumi.broadcast.notifyDelayMinutes")) || 0);

function refreshNotifySettings() {
  notifyEnabled.value = localStorage.getItem("bangumi.broadcast.notifyEnabled") === "1";
  notifyBeforeMin.value = Number(localStorage.getItem("bangumi.broadcast.notifyBeforeMinutes")) || 5;
  notifyDelayMin.value = Number(localStorage.getItem("bangumi.broadcast.notifyDelayMinutes")) || 0;
}

watch(notifyBeforeMin, (val) => {
  localStorage.setItem("bangumi.broadcast.notifyBeforeMinutes", String(val));
});
watch(notifyDelayMin, (val) => {
  localStorage.setItem("bangumi.broadcast.notifyDelayMinutes", String(val));
});

const showExportConfirm = ref(false);
const exporting = ref(false);
const exportResultPath = ref<string | null>(null);
const exportError = ref<string | null>(null);

watch(debugScore, (val) => {
  localStorage.setItem(DEBUG_SCORE_KEY, val ? "1" : "0");
});

async function handleClearTenraiCache() {
  clearing.value = true;
  try {
    clearAllTenraiCache();
    // 假番剧的数据也在这张表里，清完立刻写回，否则关注列表会剩下读不到数据的空壳
    syncFakeSubjectsToCache();
    appStore.showToast("已清除本地 Tenrai 匹配缓存和关闭记录。", "success");
  } catch {
    appStore.showToast("清除缓存失败。", "error");
  }
  clearing.value = false;
}

function handleStartExport() {
  exportError.value = null;
  exportResultPath.value = null;
  showExportConfirm.value = true;
}

function handleCancelExport() {
  showExportConfirm.value = false;
}

async function handleConfirmExport() {
  showExportConfirm.value = false;
  exporting.value = true;
  exportError.value = null;
  exportResultPath.value = null;

  try {
    const filePath = await exportDiagnostics();
    exportResultPath.value = filePath;
    appStore.showToast("诊断信息已导出。", "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    exportError.value = message;
    appStore.showToast(`导出失败：${message}`, "error");
  } finally {
    exporting.value = false;
  }
}

async function handleOpenExportFolder() {
  if (exportResultPath.value) {
    try {
      await revealItemInDir(exportResultPath.value);
    } catch {
      appStore.showToast("无法打开导出目录。", "error");
    }
  }
}

/* ═══ 假番剧 ═══ */

/** 每秒跳一次，用来驱动倒计时预览 */
const nowTick = ref(Date.now());
let tickTimer: number | null = null;

onMounted(() => {
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
  reloadFakeSubjects();
});

onBeforeUnmount(() => {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
});

const fakeSubjects = ref<FakeSubject[]>(loadFakeSubjects());
const fakeQuery = ref("");
const fakeSearching = ref(false);
const fakeSearchError = ref<string | null>(null);
const fakeSearchResults = ref<SearchSubject[]>([]);
const fakeSource = ref<SearchSubject | null>(null);
const fakeMinutesFromNow = ref(10);

const fakeForm = reactive({
  broadcastDay: "Mondays",
  broadcastTime: "23:30",
  durationMin: 24,
  status: "Currently Airing" as FakeBroadcastStatus,
  airedFrom: "",
  airedTo: "",
});

/** 每条已创建假番剧的「N 分钟后重新开播」输入框 */
const fakeItemMinutes = reactive<Record<number, number>>({});

function coverOf(subject: SearchSubject): string | undefined {
  const images = subject.images;
  if (!images) return undefined;
  return images.common || images.medium || images.large || images.small || images.grid;
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

async function handleSearchFakeSource() {
  const keyword = fakeQuery.value.trim();
  if (!keyword) return;
  fakeSearching.value = true;
  fakeSearchError.value = null;

  const result = await bangumi.searchSubjects(keyword, {
    limit: 8,
    subject_types: [2],
    sort: "match",
  });

  if (!result.ok) {
    fakeSearchError.value = result.error;
    fakeSearchResults.value = [];
  } else {
    fakeSearchResults.value = result.data.data;
    if (result.data.data.length === 0) {
      fakeSearchError.value = "没有找到匹配的动画条目。";
    }
  }
  fakeSearching.value = false;
}

function selectFakeSource(subject: SearchSubject) {
  fakeSource.value = subject;
  // 用默认参数填一遍表单
  const draft = makeFakeSubject({
    sourceBgmId: subject.id,
    nameCn: subject.name_cn || subject.name,
    nameOriginal: subject.name,
    coverUrl: coverOf(subject),
    episodes: subject.eps ?? null,
    minutesFromNow: fakeMinutesFromNow.value,
  });
  fakeForm.broadcastDay = draft.broadcastDay;
  fakeForm.broadcastTime = draft.broadcastTime;
  fakeForm.durationMin = draft.durationMin;
  fakeForm.status = draft.status;
  fakeForm.airedFrom = toDateInput(draft.airedFrom);
  fakeForm.airedTo = "";
}

/** 把「N 分钟后开播」换算成 JST 星期 + 时间填进表单 */
function applyMinutesFromNow(minutes: number) {
  fakeMinutesFromNow.value = minutes;
  const schedule = jstScheduleInMinutes(minutes);
  fakeForm.broadcastDay = schedule.day;
  fakeForm.broadcastTime = schedule.time;
  // 只有「连载中」才会走到配信前 / 正在配信的判定分支
  fakeForm.status = "Currently Airing";
}

/** 表单当前状态对应的临时假番剧，ID 留空，仅用于预览 */
const draftFake = computed<FakeSubject | null>(() => {
  const source = fakeSource.value;
  if (!source) return null;
  return {
    bgmId: 0,
    malId: 0,
    sourceBgmId: source.id,
    nameCn: source.name_cn || source.name,
    nameOriginal: source.name,
    coverUrl: coverOf(source),
    episodes: source.eps ?? null,
    status: fakeForm.status,
    broadcastDay: fakeForm.broadcastDay,
    broadcastTime: fakeForm.broadcastTime,
    durationMin: fakeForm.durationMin,
    airedFrom: fakeForm.airedFrom || null,
    airedTo: fakeForm.airedTo || null,
    createdAt: 0,
  };
});

const broadcastTimeValid = computed(() => isValidJstTime(fakeForm.broadcastTime));

/** 用真实的 calculateBroadcast() 算一遍，所见即所得 */
function timingOf(fake: FakeSubject, at: number): BroadcastTiming | null {
  if (!isValidJstTime(fake.broadcastTime)) return null;
  const data = buildFakeAnimeFull(fake);
  return calculateBroadcast(
    data.broadcast,
    data.status,
    data.duration,
    data.aired.from,
    data.aired.to,
    new Date(at),
  );
}

const draftTiming = computed<BroadcastTiming | null>(() => {
  const fake = draftFake.value;
  if (!fake) return null;
  return timingOf(fake, nowTick.value);
});

const fakeRows = computed(() => {
  // 读一下 followed，保证在关注列表变动时重算
  const followedIds = new Set(followed.value.map((item) => item.bgmId));
  return fakeSubjects.value.map((fake) => {
    const timing = timingOf(fake, nowTick.value);
    return {
      fake,
      timing,
      followed: followedIds.has(fake.bgmId),
      notifyText: describeNotifyTarget(timing, nowTick.value),
    };
  });
});

function formatClock(date: Date): string {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekdays[date.getDay()]} ${hh}:${mm}:${ss}`;
}

/**
 * 复刻 checkAndNotify() 的触发条件，算出通知的预计发出时刻。
 * 只有 before-broadcast 与 on-air 两种状态会发通知。
 */
function describeNotifyTarget(timing: BroadcastTiming | null, at: number): string {
  if (!timing) return "配信时间无效，无法计算";
  const beforeMs = notifyBeforeMin.value * 60_000;
  const delayMs = notifyDelayMin.value * 60_000;

  if (timing.status === "before-broadcast" && timing.countdownSeconds !== null) {
    const startMs = at + timing.countdownSeconds * 1000;
    const targetMs = startMs - beforeMs + delayMs;
    const suffix = targetMs <= at ? "（已到点，即将发出）" : "";
    return `「配信前」通知：${formatClock(new Date(targetMs))}${suffix}`;
  }

  if (timing.status === "on-air") {
    const targetMs = timing.nextBroadcast.getTime() + delayMs;
    const suffix = targetMs <= at ? "（已到点，即将发出）" : "";
    return `「正在配信」通知：${formatClock(new Date(targetMs))}${suffix}`;
  }

  return "当前状态不会触发通知";
}

function reloadFakeSubjects() {
  fakeSubjects.value = loadFakeSubjects();
  for (const fake of fakeSubjects.value) {
    if (fakeItemMinutes[fake.bgmId] === undefined) {
      fakeItemMinutes[fake.bgmId] = 1;
    }
  }
}

function handleCreateFake() {
  const draft = draftFake.value;
  if (!draft || !broadcastTimeValid.value) {
    appStore.showToast("配信时间格式无效，应为 HH:MM。", "error");
    return;
  }

  const fake = makeFakeSubject({
    sourceBgmId: draft.sourceBgmId,
    nameCn: draft.nameCn,
    nameOriginal: draft.nameOriginal,
    coverUrl: draft.coverUrl,
    episodes: draft.episodes,
  });
  fake.status = draft.status;
  fake.broadcastDay = draft.broadcastDay;
  fake.broadcastTime = draft.broadcastTime;
  fake.durationMin = draft.durationMin;
  fake.airedFrom = draft.airedFrom;
  fake.airedTo = draft.airedTo;

  upsertFakeSubject(fake);
  followSubject(fake.bgmId, fake.nameCn, fake.nameOriginal, fake.malId, fake.coverUrl);
  resetNotifyState(fake.bgmId);
  fakeItemMinutes[fake.bgmId] = fakeMinutesFromNow.value;
  reloadFakeSubjects();

  appStore.showToast(`已创建假番剧「${fake.nameCn}」并加入关注列表。`, "success");
}

/** 把某条已创建的假番剧重设为「N 分钟后开播」，并清掉已通知记录 */
function handleRescheduleFake(fake: FakeSubject) {
  const raw = fakeItemMinutes[fake.bgmId];
  const minutes = Number.isFinite(raw) ? raw : 1;
  const schedule = jstScheduleInMinutes(minutes);
  upsertFakeSubject({
    ...fake,
    broadcastDay: schedule.day,
    broadcastTime: schedule.time,
  });
  resetNotifyState(fake.bgmId);
  reloadFakeSubjects();
  appStore.showToast(`「${fake.nameCn}」已重设为 ${minutes} 分钟后开播。`, "success");
}

/** 在「已关注的番剧」里被手动取消关注后，重新加回去 */
function handleRefollowFake(fake: FakeSubject) {
  followSubject(fake.bgmId, fake.nameCn, fake.nameOriginal, fake.malId, fake.coverUrl);
  resetNotifyState(fake.bgmId);
  appStore.showToast(`已重新关注「${fake.nameCn}」。`, "success");
}

function handleResetNotifyState(fake: FakeSubject) {
  resetNotifyState(fake.bgmId);
  appStore.showToast(`已重置「${fake.nameCn}」的通知记录。`, "success");
}

function handleRemoveFake(fake: FakeSubject) {
  removeFakeSubject(fake.bgmId);
  unfollowSubject(fake.bgmId);
  delete fakeItemMinutes[fake.bgmId];
  reloadFakeSubjects();
  appStore.showToast(`已删除假番剧「${fake.nameCn}」。`, "success");
}

function handleClearAllFakes() {
  for (const bgmId of clearAllFakeSubjects()) {
    unfollowSubject(bgmId);
    delete fakeItemMinutes[bgmId];
  }
  reloadFakeSubjects();
  appStore.showToast("已删除全部假番剧。", "success");
}

async function handleRunCheckNow() {
  await runBroadcastCheckNow();
  appStore.showToast("已执行一次配信检查。", "info");
}

/** 配信提示未启用时直接在这里开起来，省去重启应用 */
function handleEnableNotify() {
  localStorage.setItem("bangumi.broadcast.notifyEnabled", "1");
  startBroadcastNotify();
  refreshNotifySettings();
  appStore.showToast("已启用配信提示并启动检查循环。", "success");
}
</script>

<template>
  <div class="display-settings">

    <!-- ═══ 调试工具 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">调试工具</h3>
      <p class="settings-card__desc">以下选项供调试和高级用户使用，请谨慎操作。</p>

      <label class="toggle-row">
        <span class="toggle-row__label">查看 MAL 匹配得分</span>
        <input v-model="debugScore" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__hint">在动画详情页显示可拖动的浮窗，列出候选项的匹配得分与分项明细。</p>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">MAL 匹配缓存</h4>
        <p class="settings-card__hint">清除所有 Bangumi ↔ MAL 自动匹配记录和「关闭此功能」列表。下次打开动画详情时将重新匹配。假番剧的数据会被自动写回。</p>
        <button class="secondary-button" type="button" :disabled="clearing" style="justify-self: start;" @click="handleClearTenraiCache">
          {{ clearing ? "清除中..." : "清除缓存" }}
        </button>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">诊断信息</h4>
        <p class="settings-card__hint">
          生成包含应用日志、系统与应用版本、认证状态、网络连通性及日志截断摘要的诊断报告。
          <template v-if="exportResultPath"><br>已导出至：{{ exportResultPath }}</template>
          <template v-if="exportError"><br><span style="color: var(--danger);">上次导出失败：{{ exportError }}</span></template>
        </p>
        <div class="settings-card__actions">
          <button v-if="exportResultPath" class="secondary-button" type="button" @click="handleOpenExportFolder">打开目录</button>
          <button class="secondary-button" type="button" :disabled="exporting" @click="handleStartExport">
            {{ exporting ? "导出中..." : "导出诊断报告" }}
          </button>
        </div>
      </div>
    </section>

    <!-- ═══ 配信提示测试 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">配信提示测试</h3>
      <p class="settings-card__desc">测试配信提示功能。先在「配信跟踪」中确认功能已开启。</p>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">当前状态</h4>
        <p class="settings-card__hint">
          配信提示：{{ notifyEnabled ? '✅ 已开启' : '❌ 未开启' }} ·
          提前 {{ notifyBeforeMin }} 分钟通知 ·
          延迟 {{ notifyDelayMin }} 分钟
        </p>
        <div class="settings-card__actions">
          <button class="secondary-button" type="button" style="font-size: 12px;" @click="refreshNotifySettings">刷新状态</button>
          <button v-if="!notifyEnabled" class="secondary-button" type="button" style="font-size: 12px;" @click="handleEnableNotify">立即启用并启动</button>
        </div>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">快速调参</h4>
        <p class="settings-card__hint">修改后立即生效，可用于验证延迟 + 提前通知组合。</p>
        <div class="settings-card__row">
          <label class="dev-label">提前通知（分钟）</label>
          <input v-model.number="notifyBeforeMin" type="number" min="1" max="120" class="onboarding__input" style="width: 70px;" />
        </div>
        <div class="settings-card__row">
          <label class="dev-label">延迟通知（分钟）</label>
          <input v-model.number="notifyDelayMin" type="number" min="0" max="120" class="onboarding__input" style="width: 70px;" />
        </div>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">发送测试通知</h4>
        <p class="settings-card__hint">直接推一张浮窗卡片，不经过配信判定逻辑。</p>
        <div class="settings-card__actions">
          <button class="secondary-button" type="button" @click="sendTestNotification('before-broadcast')">模拟「配信前」通知</button>
          <button class="secondary-button" type="button" @click="sendTestNotification('on-air')">模拟「正在配信」通知</button>
        </div>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">已关注的番剧（{{ followed.length }}）</h4>
        <template v-if="followed.length === 0">
          <p class="settings-card__hint">暂无关注的番剧。请在动漫详情页三个点菜单中使用「关注配信情况」添加。</p>
        </template>
        <ul v-else class="dev-followed-list">
          <li v-for="subject in followed" :key="subject.bgmId" class="dev-followed-list__item">
            <span class="dev-followed-list__name">
              <span v-if="isFakeSubjectId(subject.bgmId)" class="dev-fake-tag">假</span>
              {{ subject.nameCn || subject.nameOriginal }}
            </span>
            <span class="dev-followed-list__meta">BGM #{{ subject.bgmId }} · MAL #{{ subject.malId }}</span>
            <button class="secondary-button" type="button" style="font-size: 11px; padding: 2px 8px;" @click="unfollowSubject(subject.bgmId)">取消关注</button>
          </li>
        </ul>
        <button v-if="followed.length > 0" class="secondary-button" type="button" style="justify-self: start;" @click="clearAllFollowed()">全部清除</button>
      </div>
    </section>

    <!-- ═══ 假番剧 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">假番剧</h3>
      <p class="settings-card__desc">
        取一部真实番剧的名称、封面与集数，再自行指定配信时间。条目会被写进真实的关注列表与 MAL 匹配缓存，
        配信判定、通知触发与浮窗渲染全部走正式逻辑，没有为测试开的旁路。
      </p>

      <p v-if="!notifyEnabled" class="settings-card__hint" style="color: var(--danger);">
        配信提示当前未启用，创建后不会有任何通知。请先用上方的「立即启用并启动」。
      </p>

      <!-- ① 选择信息来源 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">① 选择番剧信息来源</h4>
        <p class="settings-card__hint">搜索一部真实动画，借用它的名称与封面。</p>
        <div class="settings-card__row">
          <input
            v-model="fakeQuery"
            class="onboarding__input"
            style="flex: 1; min-width: 160px;"
            placeholder="输入番剧名称后回车"
            @keyup.enter="handleSearchFakeSource"
          />
          <button class="secondary-button" type="button" :disabled="fakeSearching" @click="handleSearchFakeSource">
            {{ fakeSearching ? "搜索中..." : "搜索" }}
          </button>
        </div>
        <p v-if="fakeSearchError" class="settings-card__hint" style="color: var(--danger);">{{ fakeSearchError }}</p>

        <ul v-if="fakeSearchResults.length > 0" class="fake-result-list">
          <li
            v-for="item in fakeSearchResults"
            :key="item.id"
            class="fake-result-list__item"
            :class="{ 'is-selected': fakeSource?.id === item.id }"
            @click="selectFakeSource(item)"
          >
            <img v-if="coverOf(item)" class="fake-result-list__cover" :src="coverOf(item)" alt="" />
            <div class="fake-result-list__text">
              <span class="fake-result-list__name">{{ item.name_cn || item.name }}</span>
              <span class="fake-result-list__meta">
                {{ item.name }} · {{ item.date || "日期未知" }} · {{ item.eps ? `${item.eps} 集` : "集数未知" }} · BGM #{{ item.id }}
              </span>
            </div>
          </li>
        </ul>
      </div>

      <!-- ② 配信参数 -->
      <template v-if="fakeSource">
        <div class="settings-card__subsection">
          <h4 class="settings-card__subtitle">② 自定义配信信息</h4>
          <p class="settings-card__hint">已选择：{{ fakeSource.name_cn || fakeSource.name }}</p>

          <div class="settings-card__row">
            <label class="dev-label">快捷设置</label>
            <input v-model.number="fakeMinutesFromNow" type="number" min="0" max="10080" class="onboarding__input" style="width: 80px;" />
            <span class="settings-card__hint">分钟后开播</span>
            <button class="secondary-button" type="button" @click="applyMinutesFromNow(fakeMinutesFromNow)">套用</button>
          </div>
          <div class="settings-card__actions">
            <button class="secondary-button" type="button" @click="applyMinutesFromNow(notifyBeforeMin)">
              立刻触发「配信前」（{{ notifyBeforeMin }} 分钟后开播）
            </button>
            <button class="secondary-button" type="button" @click="applyMinutesFromNow(0)">
              立刻触发「正在配信」（现在开播）
            </button>
          </div>

          <div class="settings-card__row">
            <label class="dev-label">配信日（JST）</label>
            <select v-model="fakeForm.broadcastDay" class="fake-select">
              <option v-for="day in JST_DAY_OPTIONS" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select>
            <label class="dev-label">时间</label>
            <input v-model="fakeForm.broadcastTime" class="onboarding__input" style="width: 80px;" placeholder="23:30" />
          </div>
          <p class="settings-card__hint">
            时间为日本标准时间，支持 24:00–30:59 的深夜档写法（自动顺延到次日）。
            <span v-if="!broadcastTimeValid" style="color: var(--danger);">当前格式无效。</span>
          </p>

          <div class="settings-card__row">
            <label class="dev-label">单集时长（分钟）</label>
            <input v-model.number="fakeForm.durationMin" type="number" min="0" max="600" class="onboarding__input" style="width: 80px;" />
            <span class="settings-card__hint">填 0 表示时长未知，用来测试未知时长分支</span>
          </div>

          <div class="settings-card__row">
            <label class="dev-label">配信状态</label>
            <select v-model="fakeForm.status" class="fake-select">
              <option v-for="option in FAKE_STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="settings-card__row">
            <label class="dev-label">首播日期</label>
            <input v-model="fakeForm.airedFrom" type="date" class="onboarding__input" style="width: 150px;" />
            <label class="dev-label">完结日期</label>
            <input v-model="fakeForm.airedTo" type="date" class="onboarding__input" style="width: 150px;" />
          </div>
          <p class="settings-card__hint">首播日期只在「尚未开播」时参与判定；完结日期只在「已完结」时决定是否显示「完结撒花」。</p>
        </div>

        <!-- ③ 预览 -->
        <div class="settings-card__subsection">
          <h4 class="settings-card__subtitle">③ 判定结果预览</h4>
          <p v-if="!draftTiming" class="settings-card__hint" style="color: var(--danger);">
            无法计算配信时间，请检查星期与时间格式。
          </p>
          <p v-else class="settings-card__hint">
            状态：<b>{{ draftTiming.status }}</b> · {{ draftTiming.displayText }}<br>
            {{ draftTiming.subText }}<br>
            配信时间（JST）：{{ fakeForm.broadcastDay }} {{ fakeForm.broadcastTime }}<br>
            下次配信（本地时间）：{{ formatClock(draftTiming.nextBroadcast) }}<br>
            {{ describeNotifyTarget(draftTiming, nowTick) }}
          </p>
          <button class="primary-button" type="button" style="justify-self: start;" :disabled="!draftTiming" @click="handleCreateFake">
            创建假番剧并关注
          </button>
        </div>
      </template>

      <!-- ④ 已创建列表 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">已创建的假番剧（{{ fakeSubjects.length }}）</h4>
        <p v-if="fakeSubjects.length === 0" class="settings-card__hint">还没有假番剧。</p>

        <ul v-else class="fake-list">
          <li v-for="row in fakeRows" :key="row.fake.bgmId" class="fake-list__item">
            <div class="fake-list__head">
              <img v-if="row.fake.coverUrl" class="fake-list__cover" :src="row.fake.coverUrl" alt="" />
              <div class="fake-list__text">
                <span class="fake-list__name">{{ row.fake.nameCn }}</span>
                <span class="fake-list__meta">
                  {{ row.fake.broadcastDay }} {{ row.fake.broadcastTime }} JST ·
                  {{ row.fake.durationMin > 0 ? `${row.fake.durationMin} 分钟` : "时长未知" }} ·
                  {{ row.fake.status }} ·
                  假 ID {{ row.fake.bgmId }} ·
                  {{ row.followed ? "已关注" : "未关注（不会通知）" }}
                </span>
                <span class="fake-list__meta">
                  <template v-if="row.timing">{{ row.timing.status }} · {{ row.timing.displayText }} {{ row.timing.subText }}</template>
                  <template v-else>配信时间无效</template>
                </span>
                <span class="fake-list__meta">{{ row.notifyText }}</span>
              </div>
            </div>
            <div class="fake-list__actions">
              <input
                v-model.number="fakeItemMinutes[row.fake.bgmId]"
                type="number"
                min="0"
                max="10080"
                class="onboarding__input"
                style="width: 70px;"
              />
              <button class="secondary-button" type="button" @click="handleRescheduleFake(row.fake)">分钟后重新开播</button>
              <button v-if="!row.followed" class="secondary-button" type="button" @click="handleRefollowFake(row.fake)">重新关注</button>
              <button class="secondary-button" type="button" @click="handleResetNotifyState(row.fake)">重置通知记录</button>
              <button class="secondary-button" type="button" @click="handleRemoveFake(row.fake)">删除</button>
            </div>
          </li>
        </ul>

        <div v-if="fakeSubjects.length > 0" class="settings-card__actions">
          <button class="secondary-button" type="button" @click="handleRunCheckNow">立即检查一次</button>
          <button class="secondary-button" type="button" @click="handleClearAllFakes">删除全部假番剧</button>
        </div>
        <p class="settings-card__hint">
          检查循环每 30 秒兜底跑一次，并会为最近的一个通知时刻单独排一个精确定时器，所以通知是准点发出的。
          同一集只会通知一次；想重复触发同一条通知，请先「重置通知记录」。
        </p>
      </div>
    </section>

    <!-- ═══ 页脚 ═══ -->
    <p class="settings-page__footer-note" style="margin-top: 0;">
      Tenrai 缓存存储于浏览器 localStorage，仅影响当前设备。<br>
      已捕获前端日志数：{{ getFrontendLogCount() }}
    </p>

    <!-- 导出确认对话框 -->
    <div v-if="showExportConfirm" class="overlay" role="dialog" aria-modal="true" aria-label="导出诊断信息" @click.self="handleCancelExport">
      <section class="modal">
        <h3>导出诊断信息</h3>
        <p>诊断信息将用于帮助我们排查软件运行中的异常。导出的文件可能包含：应用日志、系统与应用版本、网络连通性、认证状态以及日志截断摘要。身份信息与凭据会在导出前<strong>脱敏</strong>。</p>
        <p>即使经过脱敏，但为了您的隐私安全，请勿将敏感 Token 或个人隐私公开上传到公共讨论区。</p>
        <p>多数敏感信息将在导出前被自动脱敏处理。您亦可以在使用前，自行审阅并编辑本文件。</p>
        <p>导出期间弹出命令行窗口是正常程序行为。除非您手动上传，生成的诊断文件不会因 SimpBangumi 而离开您的电脑。</p>
        <div class="modal__actions">
          <button class="secondary-button" type="button" @click="handleCancelExport">取消</button>
          <button class="primary-button" type="button" @click="handleConfirmExport">确认导出</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dev-label {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
}

.dev-followed-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.dev-followed-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-size: 13px;
}

.dev-followed-list__name {
  flex: 1;
  font-weight: 500;
  color: var(--text);
}

.dev-followed-list__meta {
  color: var(--muted);
  font-size: 12px;
}

.dev-fake-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 11px;
  line-height: 16px;
}

.fake-select {
  width: auto;
  min-width: 120px;
}

.fake-result-list,
.fake-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.fake-result-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
}

.fake-result-list__item:hover {
  border-color: var(--accent);
}

.fake-result-list__item.is-selected {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.fake-result-list__cover,
.fake-list__cover {
  width: 36px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.fake-result-list__text,
.fake-list__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.fake-result-list__name,
.fake-list__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.fake-result-list__meta,
.fake-list__meta {
  font-size: 12px;
  color: var(--muted);
  word-break: break-all;
}

.fake-list__item {
  display: grid;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.fake-list__head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.fake-list__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.fake-list__actions .secondary-button {
  font-size: 12px;
  padding: 3px 8px;
}
</style>
