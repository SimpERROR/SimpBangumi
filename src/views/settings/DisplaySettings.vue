<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../stores/app";
import type { Live2dModelInfo } from "../../stores/app";
import { linkConfirmEnabled } from "../../composables/useLinkInterceptor";

const appStore = useAppStore();

interface MarkerMeta {
  key: string
  label: string
  colorVar: string
  parent: ReturnType<typeof ref<boolean>>
  inComplete: ReturnType<typeof ref<boolean>>
  inCollections: ReturnType<typeof ref<boolean>>
  setParent: (v: boolean) => void
  setInComplete: (v: boolean) => void
  setInCollections: (v: boolean) => void
}

const markerMetas = computed<MarkerMeta[]>(() => [
  { key: "broadcast", label: "配信", colorVar: "var(--accent)",    parent: appStore.broadcastMarker.parent, inComplete: appStore.broadcastMarker.inComplete, inCollections: appStore.broadcastMarker.inCollections, setParent: appStore.broadcastMarker.setParent, setInComplete: appStore.broadcastMarker.setInComplete, setInCollections: appStore.broadcastMarker.setInCollections },
  { key: "wish",      label: "想看", colorVar: "var(--wish)",      parent: appStore.wishMarker.parent,      inComplete: appStore.wishMarker.inComplete,      inCollections: appStore.wishMarker.inCollections,      setParent: appStore.wishMarker.setParent,      setInComplete: appStore.wishMarker.setInComplete,      setInCollections: appStore.wishMarker.setInCollections },
  { key: "watching",  label: "在看", colorVar: "var(--watching)",  parent: appStore.watchingMarker.parent,  inComplete: appStore.watchingMarker.inComplete,  inCollections: appStore.watchingMarker.inCollections,  setParent: appStore.watchingMarker.setParent,  setInComplete: appStore.watchingMarker.setInComplete,  setInCollections: appStore.watchingMarker.setInCollections },
  { key: "collected", label: "看过", colorVar: "var(--collected)", parent: appStore.collectedMarker.parent, inComplete: appStore.collectedMarker.inComplete, inCollections: appStore.collectedMarker.inCollections, setParent: appStore.collectedMarker.setParent, setInComplete: appStore.collectedMarker.setInComplete, setInCollections: appStore.collectedMarker.setInCollections },
  { key: "onhold",    label: "搁置", colorVar: "var(--onhold)",    parent: appStore.onholdMarker.parent,    inComplete: appStore.onholdMarker.inComplete,    inCollections: appStore.onholdMarker.inCollections,    setParent: appStore.onholdMarker.setParent,    setInComplete: appStore.onholdMarker.setInComplete,    setInCollections: appStore.onholdMarker.setInCollections },
  { key: "dropped",   label: "抛弃", colorVar: "var(--dropped)",   parent: appStore.droppedMarker.parent,   inComplete: appStore.droppedMarker.inComplete,   inCollections: appStore.droppedMarker.inCollections,   setParent: appStore.droppedMarker.setParent,   setInComplete: appStore.droppedMarker.setInComplete,   setInCollections: appStore.droppedMarker.setInCollections },
]);

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
  <div class="display-settings">

    <!-- ═══ 标题显示 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">标题显示</h3>
      <p class="settings-card__desc">设置条目标题优先显示的语言版本。</p>
      <div class="filter-tabs__group" role="radiogroup" aria-label="标题显示优先级">
        <button
          class="filter-tab"
          :class="{ 'is-active': appStore.titlePreference.value === 'translated' }"
          type="button"
          @click="appStore.titlePreference.value = 'translated'"
        >译名优先</button>
        <button
          class="filter-tab"
          :class="{ 'is-active': appStore.titlePreference.value === 'original' }"
          type="button"
          @click="appStore.titlePreference.value = 'original'"
        >原文优先</button>
      </div>
    </section>

    <!-- ═══ 条目标记 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">条目标记</h3>
      <p class="settings-card__desc">符合条件的条目以特殊颜色显示并附带图标，便于快速识别收藏状态。</p>

      <!-- 颜色预览 -->
      <div class="marker-preview">
        <span v-for="m in markerMetas" :key="m.key" class="marker-preview__chip">
          <span class="marker-preview__dot" :style="{ background: m.colorVar }"></span>
          <!-- broadcast: heart -->
          <svg v-if="m.key==='broadcast'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
          <!-- wish: bookmark -->
          <svg v-if="m.key==='wish'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
          <!-- watching: eye -->
          <svg v-if="m.key==='watching'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
          <!-- collected: check -->
          <svg v-if="m.key==='collected'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
          <!-- onhold: eye-off (box-archive) -->
          <svg v-if="m.key==='onhold'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400zM240.4 311.6C242.9 311.9 245.4 312 248 312C283.3 312 312 283.3 312 248C312 245.4 311.8 242.9 311.6 240.4C274.2 244.3 244.4 274.1 240.5 311.5zM286 196.6C296.8 193.6 308.2 192.1 319.9 192.1C328.7 192.1 337.4 193 345.7 194.7C346 194.8 346.2 194.8 346.5 194.9C404.4 207.1 447.9 258.6 447.9 320.1C447.9 390.8 390.6 448.1 319.9 448.1C258.3 448.1 206.9 404.6 194.7 346.7C192.9 338.1 191.9 329.2 191.9 320.1C191.9 309.1 193.3 298.3 195.9 288.1C196.1 287.4 196.2 286.8 196.4 286.2C208.3 242.8 242.5 208.6 285.9 196.7z"/></svg>
          <!-- dropped: trash -->
          <svg v-if="m.key==='dropped'" class="marker-preview__icon" :style="{ fill: m.colorVar }" viewBox="0 0 640 640" aria-hidden="true"><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
          <span :style="{ color: m.colorVar }">{{ m.label }}</span>
        </span>
      </div>

      <!-- 仅显示图标 -->
      <label class="toggle-row">
        <span class="toggle-row__label">仅显示图标，不更改标题颜色</span>
        <input
          :checked="appStore.markerIconOnly.value"
          class="toggle-row__input"
          type="checkbox"
          role="switch"
          @change="appStore.setMarkerIconOnly(($event.target as HTMLInputElement).checked)"
        />
        <span class="toggle-row__track" />
      </label>

      <!-- 标记配置表 -->
      <div class="marker-table">
        <div class="marker-table__head">
          <span class="marker-table__th"></span>
          <span class="marker-table__th">启用</span>
          <span class="marker-table__th">完成页</span>
          <span class="marker-table__th">收藏页</span>
        </div>
        <div
          v-for="m in markerMetas"
          :key="m.key"
          class="marker-table__row"
          :class="{ 'is-dimmed': !m.parent.value }"
        >
          <span class="marker-table__label" :style="{ color: m.parent.value ? m.colorVar : 'var(--muted)' }">
            <span class="marker-table__dot" :style="{ background: m.parent.value ? m.colorVar : 'var(--border)' }"></span>
            {{ m.label }}
          </span>
          <span class="marker-table__cell">
            <label class="toggle-mini">
              <input :checked="m.parent.value" type="checkbox" role="switch" @change="m.setParent(($event.target as HTMLInputElement).checked)" />
              <span class="toggle-mini__track" />
            </label>
          </span>
          <span class="marker-table__cell">
            <label
              class="toggle-mini"
              :class="{ 'is-disabled': !m.parent.value || !(m.key === 'broadcast' || m.key === 'watching') }"
            >
              <input
                v-if="m.key === 'broadcast' || m.key === 'watching'"
                :checked="m.inComplete.value"
                :disabled="!m.parent.value"
                type="checkbox"
                role="switch"
                @change="m.setInComplete(($event.target as HTMLInputElement).checked)"
              />
              <input v-else disabled type="checkbox" role="switch" />
              <span class="toggle-mini__track" />
            </label>
          </span>
          <span class="marker-table__cell">
            <label class="toggle-mini" :class="{ 'is-disabled': !m.parent.value }">
              <input
                :checked="m.inCollections.value"
                :disabled="!m.parent.value"
                type="checkbox"
                role="switch"
                @change="m.setInCollections(($event.target as HTMLInputElement).checked)"
              />
              <span class="toggle-mini__track" />
            </label>
          </span>
        </div>
      </div>
    </section>

    <!-- ═══ 链接行为 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">链接行为</h3>
      <p class="settings-card__desc">控制点击外部链接时的行为。</p>
      <label class="toggle-row">
        <span class="toggle-row__label">打开外部链接前确认</span>
        <input v-model="linkConfirmEnabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__hint">关闭后直接在浏览器打开，不再弹窗。特定域名可在弹窗中勾选「不再提示」。</p>
    </section>

    <!-- ═══ Live2D 看板娘 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">Live2D 看板娘</h3>
      <p class="settings-card__desc">在桌面右下角显示 Live2D 吉祥物。</p>

      <label
        class="toggle-row"
        :class="{ 'is-disabled': !hasModel }"
        :title="!hasModel ? '请先导入模型' : undefined"
      >
        <span class="toggle-row__label">启用看板娘</span>
        <input
          v-model="appStore.live2dEnabled.value"
          class="toggle-row__input"
          type="checkbox"
          role="switch"
          :disabled="!hasModel"
        />
        <span class="toggle-row__track" />
      </label>

      <!-- 模型管理 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">模型管理</h4>
        <div v-if="appStore.live2dModels.value.length === 0" class="settings-card__hint">暂无模型，请在下方导入。</div>
        <div
          v-for="m in appStore.live2dModels.value"
          :key="m.name"
          class="model-row"
          :class="{ 'is-active': m.name === appStore.live2dActiveModel.value }"
        >
          <button class="model-row__select" type="button" @click="appStore.live2dActiveModel.value = m.name">
            {{ m.name }}
            <span v-if="m.name === appStore.live2dActiveModel.value" class="model-row__badge">当前</span>
          </button>
          <button class="secondary-button model-row__del" type="button" @click="handleDelete(m.name)">删除</button>
        </div>
      </div>

      <!-- 导入模型 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">导入模型</h4>
        <div class="settings-card__row">
          <input
            v-model="newModelName"
            class="onboarding__input"
            type="text"
            placeholder="模型名称（如 hiyori）"
            autocomplete="off"
            @keydown.enter="handleImport"
          />
          <button class="secondary-button" type="button" :disabled="importing" @click="handleImport">
            {{ importing ? "导入中..." : "选择文件夹并导入" }}
          </button>
        </div>
        <p v-if="importError" class="settings-card__error">{{ importError }}</p>
        <p class="settings-card__hint">选择包含 .model.json 或 .model3.json 的文件夹，名称不可重复。</p>
      </div>

      <!-- 运行时 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">Cubism 运行时</h4>
        <p class="settings-card__hint">Cubism 4（.model3.json）模型需要 Live2D 官方运行时。</p>
        <div class="settings-card__row">
          <button class="secondary-button" type="button" :disabled="downloadingCore" @click="handleDownloadCore">
            {{ downloadingCore ? "下载中..." : coreDownloaded ? "重新下载" : "下载运行必须文件" }}
          </button>
          <button v-if="coreDownloaded" class="secondary-button" type="button" @click="handleRemoveCore">卸载</button>
        </div>
        <p v-if="coreDownloaded" class="settings-card__hint" style="color: var(--accent);">✓ Cubism 4 运行时已就绪。</p>
      </div>

      <!-- 位置 -->
      <div class="settings-card__row">
        <button
          class="secondary-button"
          type="button"
          :disabled="!hasModel || !appStore.live2dEnabled.value"
          @click="handleResetPosition"
        >重置模型位置</button>
        <span class="settings-card__hint">将模型重新居中，清除拖拽记忆。</span>
      </div>
    </section>

    <!-- ═══ 看板娘对话框 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">看板娘对话框</h3>
      <p class="settings-card__desc">点击看板娘随机说话。编辑 <code>live2d/dialog.txt</code> 自定义内容，每行一条。</p>

      <div class="settings-card__row">
        <button class="secondary-button" type="button" :disabled="openingFolder" @click="openDialogFolder">
          {{ openingFolder ? "打开中..." : "打开对话文件" }}
        </button>
        <button class="secondary-button" type="button" @click="handleRefreshDialog">刷新对话文件</button>
      </div>
      <p class="settings-card__hint">编辑后点击刷新即可生效，无需重启。</p>

      <!-- 主动说话 -->
      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">主动说话</h4>
        <p class="settings-card__hint">看板娘每隔一段时间自动弹出对话框。</p>

        <label class="toggle-row">
          <span class="toggle-row__label">启用主动说话</span>
          <input
            v-model="appStore.live2dAutoSpeakEnabled.value"
            class="toggle-row__input"
            type="checkbox"
            role="switch"
          />
          <span class="toggle-row__track" />
        </label>

        <template v-if="appStore.live2dAutoSpeakEnabled.value">
          <div class="settings-card__field">
            <label class="settings-card__field-label">最小间隔</label>
            <div class="settings-card__row">
              <input
                v-model.number="appStore.live2dAutoSpeakMinInterval.value"
                type="range"
                min="5" max="120" step="5"
              />
              <span class="settings-card__range-val">{{ appStore.live2dAutoSpeakMinInterval.value }}秒</span>
            </div>
          </div>
          <div class="settings-card__field">
            <label class="settings-card__field-label">最大间隔</label>
            <div class="settings-card__row">
              <input
                v-model.number="appStore.live2dAutoSpeakMaxInterval.value"
                type="range"
                min="5" max="300" step="5"
              />
              <span class="settings-card__range-val">{{ appStore.live2dAutoSpeakMaxInterval.value }}秒</span>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- ═══ NSFW 互动 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">NSFW 互动</h3>
      <p class="settings-card__desc">浏览 NSFW 内容时，看板娘会进行特殊对话。</p>
      <label class="toggle-row">
        <span class="toggle-row__label">启用 NSFW 特殊对话</span>
        <input
          v-model="appStore.nsfwInteractionEnabled.value"
          class="toggle-row__input"
          type="checkbox"
          role="switch"
        />
        <span class="toggle-row__track" />
      </label>
    </section>

  </div>
</template>

<style scoped>
/* ── 颜色预览条 ── */
.marker-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-muted);
}

.marker-preview__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  white-space: nowrap;
}

.marker-preview__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.marker-preview__icon {
  width: 0.88em;
  height: 0.88em;
  flex-shrink: 0;
}

/* ── 标记配置表 ── */
.marker-table {
  display: grid;
  gap: 2px;
}

.marker-table__head {
  display: grid;
  grid-template-columns: 1fr 52px 52px 52px;
  gap: 4px;
  padding: 4px 0;
  align-items: center;
}

.marker-table__th {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.marker-table__th:first-child {
  text-align: left;
}

.marker-table__row {
  display: grid;
  grid-template-columns: 1fr 52px 52px 52px;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 6px;
  align-items: center;
  transition: background 0.15s ease;
}

.marker-table__row:hover {
  background: var(--surface-muted);
}

.marker-table__row.is-dimmed .marker-table__label {
  color: var(--muted);
}

.marker-table__label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.marker-table__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.marker-table__cell {
  display: flex;
  justify-content: center;
  align-items: center;
}

/* ── 模型行 ── */
.model-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.model-row.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.model-row__select {
  flex: 1;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-row__select:hover {
  background: var(--surface-muted);
}

.model-row__badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}

.model-row__del {
  flex-shrink: 0;
}
</style>
