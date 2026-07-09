<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/app";
import type { Live2dModelInfo } from "../../stores/app";
import { linkConfirmEnabled } from "../../composables/useLinkInterceptor";

const appStore = useAppStore();

const importing = ref(false);
const openingFolder = ref(false);
async function openDialogFolder() {
  openingFolder.value = true;
  try {
    await invoke("open_live2d_dialog_folder");
  } catch { /* ignore */ }
  openingFolder.value = false;
}

const importError = ref("");
const downloadingCore = ref(false);
const CORE_DOWNLOADED_KEY = "bangumi.live2d.coreDownloaded";
const coreDownloaded = ref(localStorage.getItem(CORE_DOWNLOADED_KEY) === "1");
const newModelName = ref("");

const hasModel = computed(() => appStore.live2dModels.value.length > 0);

onMounted(async () => {
  try {
    const models = await invoke<Live2dModelInfo[]>("list_live2d_models");
    appStore.live2dModels.value = models;
    if (models.length > 0 && !appStore.live2dActiveModel.value) {
      appStore.live2dActiveModel.value = models[0].name;
    }
  } catch { /* ignore */ }
  if (coreDownloaded.value) {
    try { await invoke<string>("download_live2d_cubism_core"); } catch {
      coreDownloaded.value = false;
      localStorage.removeItem(CORE_DOWNLOADED_KEY);
    }
  }
});

async function handleImport() {
  const selected = await open({ title: "选择 Live2D 模型文件夹", directory: true, multiple: false });
  if (!selected) return;
  const dirPath = typeof selected === "string" ? selected : (selected as { path: string }).path;
  const name = newModelName.value.trim();
  if (!name) { importError.value = "请输入模型名称。"; return; }
  importing.value = true;
  importError.value = "";
  try {
    const info = await invoke<Live2dModelInfo>("import_live2d_model", { sourceDir: dirPath, modelName: name });
    appStore.live2dModels.value = [...appStore.live2dModels.value, info];
    appStore.live2dActiveModel.value = info.name;
    newModelName.value = "";
    appStore.showToast(`模型「${name}」导入成功！`, "success");
  } catch (err: unknown) {
    importError.value = err instanceof Error ? err.message : String(err);
    appStore.showToast(`导入失败: ${importError.value}`, "error");
  } finally { importing.value = false; }
}

async function handleDelete(name: string) {
  try {
    await invoke("remove_live2d_model", { modelName: name });
    appStore.live2dModels.value = appStore.live2dModels.value.filter((m) => m.name !== name);
    if (appStore.live2dActiveModel.value === name) {
      appStore.live2dActiveModel.value = appStore.live2dModels.value[0]?.name ?? "";
    }
    appStore.showToast(`模型「${name}」已删除。`, "success");
  } catch (err: unknown) {
    appStore.showToast(`删除失败: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

async function handleDownloadCore() {
  downloadingCore.value = true;
  try {
    await invoke<string>("download_live2d_cubism_core");
    coreDownloaded.value = true;
    localStorage.setItem(CORE_DOWNLOADED_KEY, "1");
    appStore.showToast("Cubism 4 Core 运行时下载完成！", "success");
  } catch (err: unknown) {
    appStore.showToast(`下载失败: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally { downloadingCore.value = false; }
}

async function handleRemoveCore() {
  try {
    await invoke("remove_live2d_cubism_core");
    coreDownloaded.value = false;
    localStorage.removeItem(CORE_DOWNLOADED_KEY);
    appStore.showToast("Cubism 4 Core 运行时已卸载。", "success");
  } catch (err: unknown) {
    appStore.showToast(`卸载失败: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function handleResetPosition() {
  appStore.live2dResetPositionCounter.value++;
  appStore.showToast("模型位置已重置。", "success");
}

function handleRefreshDialog() {
  appStore.live2dRefreshDialogCounter.value++;
}
</script>

<template>
  <div class="onboarding__panel settings-page">

    <h2>标题显示优先级</h2>
    <p class="onboarding__description">设置条目标题优先显示内容。</p>

    <div class="filter-tabs__group" role="radiogroup" aria-label="标题显示优先级">
      <button class="filter-tab" :class="{ 'is-active': appStore.titlePreference.value === 'translated' }" type="button" @click="appStore.titlePreference.value = 'translated'">译名优先</button>
      <button class="filter-tab" :class="{ 'is-active': appStore.titlePreference.value === 'original' }" type="button" @click="appStore.titlePreference.value = 'original'">原文优先</button>
    </div>

    <h2 style="margin-top: 24px;">链接行为</h2>

    <label class="settings-toggle">
      <span class="settings-toggle__label">打开外部链接前确认</span>
      <input v-model="linkConfirmEnabled" class="settings-toggle__input" type="checkbox" role="switch" />
      <span class="settings-toggle__track" />
    </label>
    <p class="settings-field__hint">
      关闭后点击链接将直接在浏览器中打开，不再弹出确认提示。针对特定域名可在弹窗中勾选「不再提示」。
    </p>

    <h2 style="margin-top: 24px;">Live2D 看板娘</h2>
    <p class="onboarding__description">在界面右下角显示一个 Live2D 吉祥物。</p>

    <label class="settings-toggle" :class="{ 'settings-toggle--disabled': !hasModel }" :title="!hasModel ? '请先导入模型' : undefined">
      <span class="settings-toggle__label">启用看板娘</span>
      <input v-model="appStore.live2dEnabled.value" class="settings-toggle__input" type="checkbox" role="switch" :disabled="!hasModel" />
      <span class="settings-toggle__track" />
    </label>

    <div class="settings-field" style="margin-top: 16px;">
      <label class="settings-field__label">已导入的模型</label>
      <div v-if="appStore.live2dModels.value.length === 0" class="settings-field__hint">暂无模型，请导入。</div>
      <div v-for="m in appStore.live2dModels.value" :key="m.name" class="settings-model-row" :class="{ 'settings-model-row--active': m.name === appStore.live2dActiveModel.value }">
        <button class="settings-model-row__select" type="button" @click="appStore.live2dActiveModel.value = m.name">
          {{ m.name }}
          <span v-if="m.name === appStore.live2dActiveModel.value" class="settings-model-row__badge">当前</span>
        </button>
        <button class="secondary-button settings-model-row__del" type="button" @click="handleDelete(m.name)">删除</button>
      </div>
    </div>

    <div class="settings-field" style="margin-top: 12px;">
      <div class="settings-field__row">
        <button
          class="secondary-button"
          type="button"
          :disabled="!hasModel || !appStore.live2dEnabled.value"
          @click="handleResetPosition"
        >
          重置模型位置
        </button>
      </div>
      <p class="settings-field__hint">将模型重新居中到画布可见区域，同时清除已记忆的拖拽位置。</p>
    </div>

    <div class="settings-field" style="margin-top: 12px;">
      <label class="settings-field__label">导入新模型</label>
      <div class="settings-field__row">
        <input v-model="newModelName" class="onboarding__input settings-field__input" type="text" placeholder="模型名称（如 hiyori）" autocomplete="off" @keydown.enter="handleImport" />
        <button class="secondary-button" type="button" :disabled="importing" @click="handleImport">{{ importing ? "导入中..." : "选择文件夹并导入" }}</button>
      </div>
      <p v-if="importError" class="settings-field__error">{{ importError }}</p>
      <p class="settings-field__hint">选择包含 .model.json 或 .model3.json 的整个模型文件夹，为模型命名后导入。名称不可重复。</p>
    </div>

    <div class="settings-field" style="margin-top: 12px;">
      <p class="onboarding__description">使用 Cubism 4（.model3.json）模型需要 Live2D 官方运行时。</p>
      <div class="settings-field__row">
        <button class="secondary-button" type="button" :disabled="downloadingCore" @click="handleDownloadCore">{{ downloadingCore ? "下载中..." : coreDownloaded ? "重新下载" : "下载运行必须文件" }}</button>
        <button v-if="coreDownloaded" class="secondary-button" type="button" @click="handleRemoveCore">卸载</button>
      </div>
      <p v-if="coreDownloaded" class="settings-field__hint" style="color: var(--accent);">✓ Cubism 4 运行时已就绪。</p>
    </div>

    <!-- ── 看板娘对话框 ────────────────────────────────── -->
    <h2 style="margin-top: 24px;">看板娘对话框</h2>
    <p class="onboarding__description">点击看板娘会随机说一句话。在文件中编辑说话内容，每行一条。</p>

    <div class="settings-field" style="margin-top: 12px;">
      <button class="secondary-button" type="button" :disabled="openingFolder" @click="openDialogFolder">
        {{ openingFolder ? "打开中..." : "在资源管理器中显示对话文件" }}
      </button>
      <p class="settings-field__hint">文件位于应用数据目录下的 <code>live2d/dialog.txt</code>。</p>
    </div>

    <div class="settings-field" style="margin-top: 12px;">
      <button class="secondary-button" type="button" @click="handleRefreshDialog">
        刷新对话文件
      </button>
      <p class="settings-field__hint">手动编辑对话文件后，点击此按钮立即重新加载，无需重启应用。</p>
    </div>

    <h3 style="margin-top: 20px; font-size: 14px;">主动说话</h3>
    <p class="onboarding__description">看板娘会每隔一段时间主动弹出对话框。</p>

    <label class="settings-toggle">
      <span class="settings-toggle__label">启用主动说话</span>
      <input v-model="appStore.live2dAutoSpeakEnabled.value" class="settings-toggle__input" type="checkbox" role="switch" />
      <span class="settings-toggle__track" />
    </label>

    <div v-if="appStore.live2dAutoSpeakEnabled.value" class="settings-field" style="margin-top: 12px;">
      <label class="settings-field__label">最小间隔</label>
      <div class="settings-field__row">
        <input
          v-model.number="appStore.live2dAutoSpeakMinInterval.value"
          class="onboarding__input settings-field__input"
          type="range"
          min="5"
          max="120"
          step="5"
        />
        <span style="font-size: 13px; color: var(--text); min-width: 48px; text-align: right;">{{ appStore.live2dAutoSpeakMinInterval.value }}秒</span>
      </div>
    </div>

    <div v-if="appStore.live2dAutoSpeakEnabled.value" class="settings-field" style="margin-top: 8px;">
      <label class="settings-field__label">最大间隔</label>
      <div class="settings-field__row">
        <input
          v-model.number="appStore.live2dAutoSpeakMaxInterval.value"
          class="onboarding__input settings-field__input"
          type="range"
          min="5"
          max="300"
          step="5"
        />
        <span style="font-size: 13px; color: var(--text); min-width: 48px; text-align: right;">{{ appStore.live2dAutoSpeakMaxInterval.value }}秒</span>
      </div>
    </div>

    <!-- ── NSFW 互动 ──────────────────────────────────── -->
    <h2 style="margin-top: 24px;">NSFW 互动</h2>
    <p class="onboarding__description">浏览 NSFW 内容时，看板娘会进行特殊对话。</p>

    <label class="settings-toggle" style="margin-top: 12px;">
      <span class="settings-toggle__label">启用 NSFW 特殊对话</span>
      <input v-model="appStore.nsfwInteractionEnabled.value" class="settings-toggle__input" type="checkbox" role="switch" />
      <span class="settings-toggle__track" />
    </label>

  </div>
</template>

<style scoped>
.settings-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; user-select: none; }
.settings-toggle__label { font-size: 14px; color: var(--text); white-space: nowrap; }
.settings-toggle__input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.settings-toggle__track { position: relative; width: 44px; height: 24px; border-radius: 999px; background: var(--border); transition: background 0.25s ease; flex-shrink: 0; }
.settings-toggle__track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.15); transition: transform 0.25s ease; }
.settings-toggle__input:checked + .settings-toggle__track { background: var(--accent); }
.settings-toggle__input:checked + .settings-toggle__track::after { transform: translateX(20px); }
.settings-toggle--disabled { cursor: not-allowed; opacity: 0.45; }
.settings-toggle--disabled .settings-toggle__track { background: var(--border); }
.settings-toggle--disabled .settings-toggle__input:checked + .settings-toggle__track { background: var(--muted); }
.settings-field { display: flex; flex-direction: column; gap: 6px; }
.settings-field__label { font-size: 13px; font-weight: 500; color: var(--text); }
.settings-field__hint { margin: 0; font-size: 12px; color: var(--muted); }
.settings-field__row { display: flex; gap: 8px; align-items: center; }
.settings-field__input { flex: 1; }
.settings-field__error { margin: 0; font-size: 12px; color: var(--danger); }
.settings-model-row { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); }
.settings-model-row--active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.settings-model-row__select { flex: 1; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text); cursor: pointer; text-align: left; font: inherit; display: flex; align-items: center; gap: 8px; }
.settings-model-row__select:hover { background: var(--surface-muted); }
.settings-model-row__badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--accent); color: #fff; }
.settings-model-row__del { flex-shrink: 0; }
.settings-dialog-textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  transition: border-color 0.2s ease;
}
.settings-dialog-textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.settings-field__row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
  height: 6px;
  cursor: pointer;
}
</style>
