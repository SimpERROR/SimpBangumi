<script setup lang="ts">
import { ref, watch } from "vue";
import { clearAllTenraiCache } from "../../utils/animeMatch";
import { useAppStore } from "../../stores/app";
import {
  exportDiagnostics,
  getFrontendLogCount,
} from "../../composables/useDiagnostics";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useBroadcastNotify } from "../../composables/useBroadcastNotify";

const appStore = useAppStore();
const { followed, sendTestNotification, unfollowSubject, clearAllFollowed } = useBroadcastNotify();

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
        <p class="settings-card__hint">清除所有 Bangumi ↔ MAL 自动匹配记录和「关闭此功能」列表。下次打开动画详情时将重新匹配。</p>
        <button class="secondary-button" type="button" :disabled="clearing" style="justify-self: start;" @click="handleClearTenraiCache">
          {{ clearing ? "清除中..." : "清除缓存" }}
        </button>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">诊断信息</h4>
        <p class="settings-card__hint">
          生成包含应用日志、系统版本、网络状态及脱敏配置文件的诊断报告。
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
        <button class="secondary-button" type="button" style="justify-self: start; font-size: 12px;" @click="refreshNotifySettings">刷新状态</button>
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
        <p class="settings-card__hint">使用上方参数发送测试浮窗。</p>
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
            <span class="dev-followed-list__name">{{ subject.nameCn || subject.nameOriginal }}</span>
            <span class="dev-followed-list__meta">BGM #{{ subject.bgmId }} · MAL #{{ subject.malId }}</span>
            <button class="secondary-button" type="button" style="font-size: 11px; padding: 2px 8px;" @click="unfollowSubject(subject.bgmId)">取消关注</button>
          </li>
        </ul>
        <button v-if="followed.length > 0" class="secondary-button" type="button" style="justify-self: start;" @click="clearAllFollowed()">全部清除</button>
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
        <p>诊断信息将用于帮助我们排查软件运行中的异常。导出的文件可能包含：应用日志、系统版本、网络状态以及部分<strong>脱敏</strong>的配置文件摘要。</p>
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
</style>
