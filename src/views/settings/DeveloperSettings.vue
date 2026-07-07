<script setup lang="ts">
import { ref, watch } from "vue";
import { clearAllTenraiCache } from "../../utils/animeMatch";
import { useAppStore } from "../../stores/app";
import {
  exportDiagnostics,
  getFrontendLogCount,
} from "../../composables/useDiagnostics";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

const appStore = useAppStore();

const DEBUG_SCORE_KEY = "bangumi.Tenrai.debugScore";

const clearing = ref(false);
const debugScore = ref(localStorage.getItem(DEBUG_SCORE_KEY) === "1");

// ── 诊断导出状态 ──────────────────────────────────────
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
  <div class="onboarding__panel settings-page">
    <h3 class="settings-page__section-title">开发者选项</h3>
    <p class="onboarding__description">
      以下选项供调试和高级用户使用，请谨慎操作。
    </p>

    <div class="settings-entry-list">
      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>查看 MAL 匹配得分</h3>
          <p>在动画详情页显示可拖动的浮窗，列出候选项的匹配得分与分项明细。</p>
        </div>
        <label class="settings-toggle">
          <input v-model="debugScore" type="checkbox" />
          <span class="settings-toggle__slider"></span>
        </label>
      </div>

      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>删除本地 MAL 匹配缓存</h3>
          <p>清除所有 Bangumi ↔ MAL 自动匹配记录和「关闭此功能」列表。下次打开动画详情时将重新匹配。</p>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="clearing"
          @click="handleClearTenraiCache"
        >
          {{ clearing ? "清除中..." : "清除" }}
        </button>
      </div>

      <div class="item settings-entry">
        <div class="settings-entry__content">
          <h3>导出诊断信息</h3>
          <p>
            生成包含应用日志、系统版本、网络状态及脱敏配置文件的诊断报告，用于排查软件运行异常。
            <template v-if="exportResultPath">
              <br /><span class="export-path-hint">已导出至：{{ exportResultPath }}</span>
            </template>
            <template v-if="exportError">
              <br /><span class="export-error-hint">上次导出失败：{{ exportError }}</span>
            </template>
          </p>
        </div>
        <div class="settings-entry__actions">
          <button
            v-if="exportResultPath"
            class="secondary-button"
            type="button"
            @click="handleOpenExportFolder"
          >
            打开目录
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="exporting"
            @click="handleStartExport"
          >
            {{ exporting ? "导出中..." : "导出" }}
          </button>
        </div>
      </div>
    </div>

    <p class="onboarding__description settings-page__footer-note">
      Tenrai 缓存总量：存储在浏览器 localStorage 中，仅影响当前设备。<br />
      已捕获前端日志数：{{ getFrontendLogCount() }}
    </p>

    <!-- 导出确认对话框 -->
    <div v-if="showExportConfirm" class="overlay" role="dialog" aria-modal="true" aria-label="导出诊断信息" @click.self="handleCancelExport">
      <section class="modal">
        <h3>导出诊断信息</h3>
        <p>
          诊断信息将用于帮助我们排查软件运行中的异常。导出的文件可能包含：应用日志、系统版本、网络状态以及部分<strong>脱敏</strong>的配置文件。
        </p>
        <p>
          即使经过脱敏，但为了您的隐私安全，请勿将包含敏感 Token 或个人隐私的日志公开上传到公共讨论区。
        </p>
        <p>
          所有敏感信息（Token、Authorization 头、用户路径）将在导出前被自动脱敏处理。您亦可以在使用前，自行审阅编辑敏感信息。
        </p>
        <div class="modal__actions">
          <button class="secondary-button" type="button" @click="handleCancelExport">
            取消
          </button>
          <button class="primary-button" type="button" @click="handleConfirmExport">
            确认导出
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
