<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import * as PIXI from "pixi.js";
import { Application } from "pixi.js";
import { useAppStore } from "../stores/app";

// ── Store ───────────────────────────────────────────────
const appStore = useAppStore();

// ── 对话框 ──────────────────────────────────────────────
const dialogVisible = ref(false);
const dialogText = ref("");
const dialogTimer = ref<number | null>(null);
let autoSpeakTimer: number | null = null;

function getRandomMessage(): string {
  const msgs = appStore.live2dDialogMessages.value;
  if (!msgs || msgs.length === 0) return "……";
  return msgs[Math.floor(Math.random() * msgs.length)];
}

function showDialog(text: string) {
  if (dialogTimer.value !== null) {
    window.clearTimeout(dialogTimer.value);
  }
  dialogText.value = text;
  dialogVisible.value = true;
  const durationMs = Math.max(2000, Math.min(20000, text.length * 160));
  dialogTimer.value = window.setTimeout(() => {
    dialogVisible.value = false;
    dialogTimer.value = null;
  }, durationMs);
}

function speakRandom() {
  // 正在浏览 NSFW 条目时，有一定概率说 NSFW 特殊对话
  if (isBrowsingNsfw() && nsfwInteractionAvailable() && Math.random() < 0.3) {
    const msg = pickRandom(appStore.nsfwBrowsingMessages.value);
    if (msg) { showDialog(msg); return; }
  }
  showDialog(getRandomMessage());
}

function scheduleAutoSpeak() {
  if (autoSpeakTimer !== null) {
    window.clearTimeout(autoSpeakTimer);
    autoSpeakTimer = null;
  }
  if (!appStore.live2dAutoSpeakEnabled.value) return;

  const hasNormal = appStore.live2dDialogMessages.value.length > 0;
  const hasNsfw = appStore.nsfwBrowsingMessages.value.length > 0;
  if (!hasNormal && !hasNsfw) return;

  const minSec = Math.max(appStore.live2dAutoSpeakMinInterval.value, 5);
  const maxSec = Math.max(appStore.live2dAutoSpeakMaxInterval.value, minSec);
  // 在 minSec ~ maxSec 秒之间随机
  const delay = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  autoSpeakTimer = window.setTimeout(() => {
    // 正在浏览 NSFW 条目时，有一定概率说 NSFW 特殊对话
    if (isBrowsingNsfw() && nsfwInteractionAvailable() && Math.random() < 0.3) {
      const msg = pickRandom(appStore.nsfwBrowsingMessages.value);
      if (msg) { showDialog(msg); scheduleAutoSpeak(); return; }
    }
    if (hasNormal) {
      speakRandom();
    }
    scheduleAutoSpeak(); // 递归调度下一次
  }, delay);
}

function clearAutoSpeak() {
  if (autoSpeakTimer !== null) {
    window.clearTimeout(autoSpeakTimer);
    autoSpeakTimer = null;
  }
}

/** 从文件重新加载对话内容 */
async function reloadDialogMessages() {
  try {
    const lines = await invoke<string[]>("read_live2d_dialog_file");
    appStore.live2dDialogMessages.value = lines;
  } catch {
    // fallback: keep existing messages
  }
}

/** 从文件加载 NSFW 对话内容 */
async function reloadNsfwMessages() {
  try {
    const [warning, browsing, exit] = await Promise.all([
      invoke<string[]>("read_live2d_nsfw_warning_file"),
      invoke<string[]>("read_live2d_nsfw_browsing_file"),
      invoke<string[]>("read_live2d_nsfw_exit_file"),
    ]);
    appStore.nsfwWarningMessages.value = warning;
    appStore.nsfwBrowsingMessages.value = browsing;
    appStore.nsfwExitMessages.value = exit;
  } catch {
    // fallback: keep existing messages
  }
}

function pickRandom(arr: string[]): string | null {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** NSFW 互动是否可用 */
function nsfwInteractionAvailable(): boolean {
  return appStore.nsfwInteractionEnabled.value;
}

/** 当前是否在浏览 NSFW 条目（已通过警告） */
function isBrowsingNsfw(): boolean {
  return appStore.currentDetailNsfw.value && !appStore.nsfwWarningVisible.value;
}

/** 显示 NSFW 警告对话 */
function speakNsfwWarning() {
  if (!nsfwInteractionAvailable()) return;
  const msg = pickRandom(appStore.nsfwWarningMessages.value);
  if (msg) showDialog(msg);
}

/** 显示 NSFW 浏览中对话 */
function speakNsfwBrowsing() {
  if (!nsfwInteractionAvailable()) return;
  const msg = pickRandom(appStore.nsfwBrowsingMessages.value);
  if (msg) showDialog(msg);
}

/** 显示 NSFW 退出对话 */
function speakNsfwExit() {
  if (!nsfwInteractionAvailable()) return;
  const msg = pickRandom(appStore.nsfwExitMessages.value);
  if (msg) showDialog(msg);
}

// ── Props ───────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    visible: boolean;
    modelUrl?: string;
    pointerThrough?: boolean;
    canvasWidth?: number;
    canvasHeight?: number;
  }>(),
  {
    visible: true,
    modelUrl: "",
    pointerThrough: false,
    canvasWidth: 280,
    canvasHeight: 340,
  },
);

// ── Emits ───────────────────────────────────────────────
const emit = defineEmits<{
  click: [event: MouseEvent];
  hoverenter: [event: MouseEvent];
  hoverleave: [event: MouseEvent];
  modelLoaded: [];
  modelError: [error: string];
}>();

// ── State ───────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const collapsed = ref(false);
const modelLoading = ref(false);
const modelLoadError = ref("");
const rendering = ref(false);
const internalVisible = ref(props.visible);
const containerHovered = ref(false);

watch(() => props.visible, (v) => {
  internalVisible.value = v;
  if (v) {
    let retries = 0;
    const tryLoad = () => {
      if (props.modelUrl) {
        nextTick(() => loadModel(props.modelUrl!));
      } else if (++retries < 25) {
        setTimeout(tryLoad, 200);
      }
    };
    tryLoad();
  }
});

const containerStyle = computed(() => ({
  width: `${props.canvasWidth}px`,
  height: collapsed.value ? "48px" : `${props.canvasHeight}px`,
  pointerEvents: props.pointerThrough ? "none" : "auto",
  // 详情页「回到顶部」按钮出现时左移避让
  right: appStore.detailBackToTopVisible.value ? "66px" : "16px",
  transition: "right 0.25s ease",
}));

const canvasStyle = computed(() => ({
  width: `${props.canvasWidth}px`,
  height: `${props.canvasHeight}px`,
}));

const hasModel = computed(() => (props.modelUrl ?? "").trim().length > 0);

function isLocalPath(url: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("/");
}

function toAssetUrl(filePath: string): string {
  // Windows 反斜杠转正斜杠，asset protocol 才能正确解析相对路径
  return convertFileSrc(filePath.replace(/\\/g, "/"));
}

function isCubism4(url: string): boolean {
  return /\.model3\.json$/i.test(url);
}

/** 确保 Live2D Cubism 4 Core 已加载（pixi-live2d-display/cubism4 依赖） */
async function ensureCubism4Core(): Promise<void> {
  // 已加载（上一次调用成功）
  if ((window as unknown as Record<string, unknown>).Live2DCubismCore) {
    return;
  }

  // 从 Tauri 后端获取已下载的 core 文件路径
  let corePath: string;
  try {
    corePath = await invoke<string>("download_live2d_cubism_core");
  } catch {
    throw new Error(
      "未找到 Cubism 4 运行时。请在「设置 → 显示设置 → Live2D 看板娘」中点击「下载运行必须文件」。",
    );
  }

  const assetUrl = convertFileSrc(corePath);
  console.log("[Live2D] Loading Cubism 4 Core from:", assetUrl);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = assetUrl;
    script.onload = () => {
      console.log("[Live2D] Cubism 4 Core loaded");
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Cubism 4 Core 加载失败。请尝试在设置中重新下载。"));
    document.head.appendChild(script);
  });
}

// ── PIXI + Live2D ───────────────────────────────────────
let pixiApp: Application | null = null;
let live2dModel: unknown = null;
let pixiInitFailed = false;
const blobUrls: string[] = [];

function revokeBlobUrls() {
  for (const url of blobUrls) URL.revokeObjectURL(url);
  blobUrls.length = 0;
}

function createPixiApp(canvas: HTMLCanvasElement): Application {
  const app = new Application({
    view: canvas,
    width: props.canvasWidth,
    height: props.canvasHeight,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // pixi-live2d-display 需要 window.PIXI 来获取 Ticker 驱动模型动画
  (window as unknown as Record<string, unknown>).PIXI = PIXI;

  console.log("[Live2D] PIXI Application created", { app, canvas });
  return app;
}

function destroyModel() {
  if (live2dModel) {
    try {
      (live2dModel as { destroy?: () => void }).destroy?.();
    } catch { /* ignore */ }
    live2dModel = null;
  }
  if (pixiApp) {
    pixiApp.stage.removeChildren();
  }
  revokeBlobUrls();
}

// ── 用户交互：拖拽 + 平滑滚轮缩放（分模型存储） ──────
const modelScale = ref(0.5);
const targetScale = ref(0.5);
const modelPosX = ref(0);
const modelPosY = ref(0);
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0, mx: 0, my: 0 });

// 保存模型的原始尺寸（scale=1 时），用于重置位置计算
const originalModelWidth = ref(0);
const originalModelHeight = ref(0);

function storageKey(suffix: string) {
  const id = props.modelUrl ? btoa(props.modelUrl).replace(/[/+=]/g, "_").substring(0, 40) : "default";
  return `bangumi.live2d.${id}.${suffix}`;
}

function loadSavedTransform(): { x: number; y: number; scale: number } | null {
  try {
    const pos = localStorage.getItem(storageKey("pos"));
    const scl = localStorage.getItem(storageKey("scale"));
    if (pos && scl) {
      const [x, y] = JSON.parse(pos);
      return { x, y, scale: parseFloat(scl) };
    }
  } catch { /* ignore */ }
  return null;
}

function saveTransform() {
  localStorage.setItem(storageKey("pos"), JSON.stringify([modelPosX.value, modelPosY.value]));
  localStorage.setItem(storageKey("scale"), String(modelScale.value));
}

function applyTransform() {
  if (!live2dModel) return;
  const m = live2dModel as { scale: { set: (v: number) => void }; x: number; y: number };
  m.scale.set(modelScale.value);
  m.x = modelPosX.value;
  m.y = modelPosY.value;
}

/** 清除已保存的变换数据 */
function clearSavedTransform() {
  localStorage.removeItem(storageKey("pos"));
  localStorage.removeItem(storageKey("scale"));
}

/** 重置模型位置：清除记忆 + 重新计算居中 */
function resetModelPosition() {
  clearSavedTransform();

  if (!live2dModel) return;

  // 使用保存的原始尺寸，而非当前 PIXI 对象上已被 scale 影响的宽高
  const mw = originalModelWidth.value || 1;
  const mh = originalModelHeight.value || 1;
  const stageW = props.canvasWidth;
  const stageH = props.canvasHeight;

  // 尽量将模型缩放到在画布内可见：高度占 80%，宽度不超过 90%
  let s = stageH * 0.8 / mh;
  if (mw * s > stageW) s = stageW * 0.9 / mw;
  s = Math.max(0.25, Math.min(s, 1.5));

  modelScale.value = s;
  targetScale.value = s;
  modelPosX.value = (stageW - mw * s) / 2;
  modelPosY.value = (stageH - mh * s) / 2;

  saveTransform();
  applyTransform();
}

/** 根据模型尺寸计算居中位置（无已保存数据时使用） */
function initModelPosition(model: { width: number; height: number }, stageW: number, stageH: number) {
  const saved = loadSavedTransform();
  if (saved) {
    modelScale.value = saved.scale;
    targetScale.value = saved.scale;
    modelPosX.value = saved.x;
    modelPosY.value = saved.y;
    applyTransform();
    return;
  }

  const mw = model.width || 1;
  const mh = model.height || 1;
  let s = stageH * 0.8 / mh;
  if (mw * s > stageW) s = stageW * 0.9 / mw;
  s = Math.max(0.25, Math.min(s, 1.5));

  modelScale.value = s;
  targetScale.value = s;
  modelPosX.value = (stageW - mw * s) / 2;
  modelPosY.value = (stageH - mh * s) / 2;
  saveTransform();
  applyTransform();
}

// ── 平滑缩放 ────────────────────────────────────────────
let zoomAnimFrame: number | null = null;

function animateZoom() {
  if (zoomAnimFrame !== null) return;
  const lerp = () => {
    const diff = targetScale.value - modelScale.value;
    if (Math.abs(diff) < 0.001) {
      modelScale.value = targetScale.value;
      applyTransform();
      saveTransform();
      zoomAnimFrame = null;
      return;
    }
    modelScale.value += diff * 0.3;
    applyTransform();
    zoomAnimFrame = requestAnimationFrame(lerp);
  };
  zoomAnimFrame = requestAnimationFrame(lerp);
}

function onStageWheel(event: WheelEvent) {
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.03 : 0.03;
  targetScale.value = Math.max(0.15, Math.min(2.5, targetScale.value + delta));
  animateZoom();
}

// ── 拖拽 + 点击 ────────────────────────────────────────
const CLICK_THRESHOLD = 5; // px，超过此距离视为拖拽而非点击

function onStagePointerDown(event: PointerEvent) {
  isDragging.value = true;
  dragStart.value = {
    x: event.clientX,
    y: event.clientY,
    mx: modelPosX.value,
    my: modelPosY.value,
  };
  (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
}

function onStagePointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  const dx = event.clientX - dragStart.value.x;
  const dy = event.clientY - dragStart.value.y;
  modelPosX.value = dragStart.value.mx + dx;
  modelPosY.value = dragStart.value.my + dy;
  applyTransform();
}

function onStagePointerUp(event: PointerEvent) {
  isDragging.value = false;
  saveTransform();
  // 判断是否为点击（移动距离小于阈值）
  const dx = event.clientX - dragStart.value.x;
  const dy = event.clientY - dragStart.value.y;
  if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) {
    if (!props.pointerThrough) {
      emit("click", event);
      speakRandom();
    }
  }
}

async function renderModel(resolvedUrl: string) {
  if (rendering.value) return;
  rendering.value = true;

  try {
  // 懒初始化 PIXI：此时 canvas 已因 hasModel=true 而可见（v-show）
  if (!pixiApp) {
    // 等待 Vue 完成 DOM 更新（v-show 切换 + Transition 渲染后 canvas 就绪）
    if (!canvasRef.value) {
      await nextTick();
    }

    if (!canvasRef.value) {
      throw new Error("Canvas 元素未就绪。");
    }
    if (pixiInitFailed) {
      throw new Error("PIXI 初始化曾失败，请刷新页面重试。");
    }

    // 再等一个 tick 确保 canvas 已 attach 到 DOM
    await nextTick();

    try {
      pixiApp = createPixiApp(canvasRef.value);
      pixiApp.ticker.start();
      console.log("[Live2D] PIXI app initialized, ticker started:", pixiApp.ticker.started, "listeners:", pixiApp.ticker.count);
    } catch (err) {
      pixiInitFailed = true;
      throw new Error(`PIXI Application 创建失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  destroyModel();

  // 正斜杠规范化 URL：convertFileSrc 会编码 : / \ 为 %3A %2F %5C
  const cleanUrl = resolvedUrl
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":")
    .replace(/%5C/g, "/")
    .replace(/\\/g, "/");
  console.log("[Live2D] Loading model from:", cleanUrl);

  let Live2DModel: {
    from: (source: string | object, options?: { ticker?: unknown }) => Promise<{ width: number; height: number; scale: { set: (v: number) => void }; x: number; y: number; destroy?: () => void }>;
  };
  let Cubism4ModelSettings: { new (json: Record<string, unknown>): object } | null = null;

  if (isCubism4(resolvedUrl)) {
    await ensureCubism4Core();
    const mod = await import("pixi-live2d-display/cubism4");
    Live2DModel = mod.Live2DModel;
    Cubism4ModelSettings = mod.Cubism4ModelSettings;
  } else {
    const mod = await import("pixi-live2d-display");
    Live2DModel = mod.Live2DModel;
  }

  console.log("[Live2D] Calling Live2DModel.from with preloaded files...");

  // 自己 fetch model json + 所有二进制文件为 blob URL，绕过 asset protocol 的 XHR 限制
  const resp = await fetch(cleanUrl);
  if (!resp.ok) throw new Error(`无法读取模型文件 (HTTP ${resp.status})`);
  const modelJson: Record<string, unknown> = await resp.json();
  const baseUrl = cleanUrl.substring(0, cleanUrl.lastIndexOf("/") + 1);

  async function preloadFile(name: string, fileUrl: string, setResult: (result: string) => void) {
    console.log("[Live2D] preloadFile:", name);
    try {
      if (/\.(png|jpg|jpeg|webp)$/i.test(name)) {
        const blob = await (await fetch(fileUrl)).blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        setResult(dataUrl);
        console.log("[Live2D] Texture converted to data URL, length:", dataUrl.length);
      } else if (/\.moc3$/i.test(name)) {
        fileBuffers.set(fileUrl, await (await fetch(fileUrl)).arrayBuffer());
        console.log("[Live2D] Moc3 buffered");
      }
    } catch (e) {
      console.warn("[Live2D] Failed to preload:", fileUrl, e);
    }
  }

  // 预加载：贴图 → base64 data URL，.moc3 → ArrayBuffer，JSON 文件不拦截
  const fileBuffers = new Map<string, ArrayBuffer>();
  if (modelJson.FileReferences && typeof modelJson.FileReferences === "object") {
    const refs = modelJson.FileReferences as Record<string, unknown>;
    for (const key of Object.keys(refs)) {
      const raw = refs[key];
      console.log("[Live2D] FileRef:", key, typeof raw, Array.isArray(raw) ? `array[${(raw as any[]).length}]` : String(raw).substring(0, 60));
      if (typeof raw === "string" && !raw.startsWith("http") && !raw.startsWith("blob:") && !raw.startsWith("data:")) {
        const fileUrl = baseUrl + raw;
        await preloadFile(raw, fileUrl, (result) => { refs[key] = result; });
      } else if (Array.isArray(raw)) {
        // Textures 是数组
        const arr = raw as string[];
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          if (typeof item === "string" && !item.startsWith("http") && !item.startsWith("blob:") && !item.startsWith("data:")) {
            const fileUrl = baseUrl + item;
            await preloadFile(item, fileUrl, (result) => { arr[i] = result; });
          }
        }
      }
    }
    console.log("[Live2D] Preloaded", fileBuffers.size, "moc3 buffers");
  }

  // 劫持 XHR：库请求预加载过的文件时直接返回内存数据
  const OrigXHR = window.XMLHttpRequest;
  const xhrSend = OrigXHR.prototype.send;
  const xhrOpen = OrigXHR.prototype.open;
  let xhrPatched = false;

  const patchXHR = () => {
    if (xhrPatched) return;
    xhrPatched = true;
    OrigXHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
      const urlStr = typeof url === "string" ? url : url.href;
      (this as unknown as Record<string, unknown>)._lxUrl = urlStr;
      return xhrOpen.call(this, method, url);
    };
    OrigXHR.prototype.send = function (this: XMLHttpRequest) {
      const url = (this as unknown as Record<string, unknown>)._lxUrl as string | undefined;
      if (url && fileBuffers.has(url)) {
        console.log("[Live2D] XHR served from buffer:", url.substring(url.lastIndexOf("/") + 1));
        const buffer = fileBuffers.get(url)!;
        queueMicrotask(() => {
          Object.defineProperty(this, "readyState", { get: () => 4, configurable: true });
          Object.defineProperty(this, "status", { get: () => 200, configurable: true });
          Object.defineProperty(this, "response", { get: () => buffer, configurable: true });
          Object.defineProperty(this, "responseType", { get: () => "arraybuffer", configurable: true });
          Object.defineProperty(this, "responseURL", { get: () => url, configurable: true });
          const ev = new Event("load");
          Object.defineProperty(ev, "target", { get: () => this, configurable: true });
          Object.defineProperty(ev, "currentTarget", { get: () => this, configurable: true });
          if (this.onload) this.onload(ev as ProgressEvent);
          this.dispatchEvent(ev);
        });
      } else {
        if (url && /\.(moc3|png|jpg|jpeg)$/i.test(url)) {
          console.warn("[Live2D] XHR not in buffer, fetching via network:", url.substring(url.lastIndexOf("/") + 1));
        }
        xhrSend.call(this);
      }
    };
  };

  patchXHR();
  modelJson.url = cleanUrl;

  const source = Cubism4ModelSettings ? new Cubism4ModelSettings(modelJson) : modelJson;

  let model: { width: number; height: number; scale: { set: (v: number) => void }; x: number; y: number; destroy?: () => void };
  try {
    model = await Live2DModel.from(source, { ticker: pixiApp!.ticker, autoUpdate: true });
  } finally {
    OrigXHR.prototype.send = xhrSend;
    OrigXHR.prototype.open = xhrOpen;
  }
  const m = model as unknown as { width: number; height: number; alpha: number; visible: boolean; children: Array<{ width: number; height: number; alpha: number; visible: boolean; texture?: { width: number; height: number; valid: boolean } }>; internalModel?: { renderer?: Record<string, unknown> } };
  console.log("[Live2D] Model loaded:", {
    width: m.width, height: m.height, alpha: m.alpha, visible: m.visible,
    children: m.children.length, hasInternal: !!(m as any).internalModel,
  });
  // 检查 internalModel 详情
  const im = (m as any).internalModel;
  if (im) {
    console.log("[Live2D] internalModel:", { drawables: im.drawables?.length, parts: im.parts?.length, parameters: im.parameters?.length });
    // fix(pixi-live2d-display@0.5.0-beta): CubismRenderer_WebGL.initialize()
    // 仅在 model.isUsingMasking() 时创建 _clippingManager，但后续方法
    // （startUp / updateWebGLContext / doDrawModel）无条件访问它。
    // 为不使用遮罩的模型补上一个包含所有必要方法的完整兜底对象。
    if (im.renderer && !im.renderer._clippingManager) {
      im.renderer._clippingManager = {
        _currentFrameNo: 0,
        _maskTexture: undefined,
        _colorBuffer: null,
        _clippingContextListForMask: [],
        _clippingContextListForDraw: [],
        setGL: () => {},
        setupClippingContext: () => {},
        getColorBuffer: () => null,
        getClippingContextListForDraw: () => [],
        getChannelFlagAsColor: () => {},
        calcClippedDrawTotalSize: () => {},
      };
      console.log("[Live2D] Patched missing _clippingManager on internal renderer");
    }
  } else {
    console.warn("[Live2D] No internalModel!");
  }
  if (m.children.length > 0) {
    const c = m.children[0];
    console.log("[Live2D] First child:", { w: c.width, h: c.height, alpha: c.alpha, visible: c.visible, texW: c.texture?.width, texH: c.texture?.height, texValid: c.texture?.valid });
  }

  pixiApp!.stage.addChild(model as unknown as import("pixi.js").Container);
  live2dModel = model;
  // 记录原始尺寸（scale=1），用于后续重置位置时计算
  originalModelWidth.value = model.width;
  originalModelHeight.value = model.height;
  initModelPosition(model, props.canvasWidth, props.canvasHeight);

  // 立即渲染一帧
  try {
    pixiApp!.renderer.render(pixiApp!.stage);
  } catch (renderErr) {
    console.warn("[Live2D] First render failed (may self-recover with ticker):", renderErr);
  }
  console.log("[Live2D] Model added to stage, rendered, children:", pixiApp!.stage.children.length);
  } finally {
    rendering.value = false;
  }
}

// ── Model Loading ───────────────────────────────────────
async function loadModel(url: string) {
  if (!url || rendering.value) return;

  modelLoading.value = true;
  modelLoadError.value = "";

  const resolvedUrl = isLocalPath(url) ? toAssetUrl(url) : url;
  console.log("[Live2D] loadModel start", { url, resolvedUrl, isLocal: isLocalPath(url), pixiApp: !!pixiApp });

  try {
    if (!isLocalPath(url)) {
      const response = await fetch(resolvedUrl, { method: "HEAD" });
      if (!response.ok) {
        throw new Error(`模型文件不可访问 (HTTP ${response.status})`);
      }
    }

    await renderModel(resolvedUrl);
    emit("modelLoaded");
    console.log("[Live2D] modelLoaded emitted");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "未知错误";
    console.error("[Live2D] loadModel failed:", message, err);
    modelLoadError.value = message;
    emit("modelError", message);
  } finally {
    modelLoading.value = false;
  }
}

// ── Interaction ─────────────────────────────────────────
function handleDialogClick() {
  dialogVisible.value = false;
  if (dialogTimer.value !== null) {
    window.clearTimeout(dialogTimer.value);
    dialogTimer.value = null;
  }
}

function onContainerEnter() { containerHovered.value = true; }
function onContainerLeave() { containerHovered.value = false; }

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

// ── Lifecycle ───────────────────────────────────────────
onMounted(async () => {
  // 从文件加载对话内容
  await Promise.all([reloadDialogMessages(), reloadNsfwMessages()]);

  if (!props.visible) return;

  await nextTick();
  console.log("[Live2D] Component mounted, canvas:", canvasRef.value);
  if (props.modelUrl) {
    loadModel(props.modelUrl);
  }
  // 启动主动说话
  scheduleAutoSpeak();
});

onBeforeUnmount(() => {
  if (zoomAnimFrame !== null) cancelAnimationFrame(zoomAnimFrame);
  if (dialogTimer.value !== null) window.clearTimeout(dialogTimer.value);
  clearAutoSpeak();
  destroyModel();
  revokeBlobUrls();
  if (pixiApp) {
    try { pixiApp.destroy(true, { children: true }); } catch { /* ignore */ }
    pixiApp = null;
  }
});

watch(
  () => props.modelUrl,
  (newUrl) => {
    if (!props.visible) return;
    if (newUrl) {
      loadModel(newUrl);
    }
  },
);

// 主动说话：监听可见性 + 开关变化
watch(() => props.visible, (v) => {
  if (v) {
    scheduleAutoSpeak();
  } else {
    clearAutoSpeak();
  }
});

watch(() => appStore.live2dAutoSpeakEnabled.value, () => {
  if (props.visible) {
    clearAutoSpeak();
    scheduleAutoSpeak();
  }
});

watch(() => appStore.live2dAutoSpeakMinInterval.value, () => {
  if (props.visible && appStore.live2dAutoSpeakEnabled.value) {
    clearAutoSpeak();
    scheduleAutoSpeak();
  }
});

watch(() => appStore.live2dAutoSpeakMaxInterval.value, () => {
  if (props.visible && appStore.live2dAutoSpeakEnabled.value) {
    clearAutoSpeak();
    scheduleAutoSpeak();
  }
});

// 响应设置页的「重置位置」信号
watch(() => appStore.live2dResetPositionCounter.value, () => {
  resetModelPosition();
});

// 响应设置页的「刷新对话文件」信号
watch(() => appStore.live2dRefreshDialogCounter.value, async () => {
  await reloadDialogMessages();
  appStore.showToast("对话文件已刷新。", "success");
});

// ── NSFW 互动 ──────────────────────────────────────────

// NSFW 警告弹窗出现时 → 说一句警告对话
watch(() => appStore.nsfwWarningVisible.value, (visible) => {
  if (visible) speakNsfwWarning();
});

// 退出 NSFW 详情 → 一定概率说一句退出对话
watch(() => appStore.nsfwExitTriggerCounter.value, () => {
  if (Math.random() < 0.4) speakNsfwExit();
});

// ── 收藏状态更新 → 笑脸 + 对话 ───────────────────────

/** 尝试让模型做「笑」的表情 */
function trySmileExpression() {
  if (!live2dModel) return;

  const model = live2dModel as Record<string, unknown>;
  const internal = model.internalModel as Record<string, unknown> | undefined;
  const motionMgr = internal?.motionManager as Record<string, unknown> | undefined;
  const exprMgr = motionMgr?.expressionManager as Record<string, unknown> | undefined;

  if (!exprMgr || typeof exprMgr.setExpression !== "function") {
    // 尝试模型自身的 expression() 方法（pixi-live2d-display 某些版本）
    if (typeof model.expression === "function") {
      try { (model.expression as (id: string) => unknown)("smile"); } catch { /* ignore */ }
    }
    return;
  }

  // 获取可用表情列表，优先匹配「笑」相关的名字
  const expressions = (exprMgr.expressions as Array<{ name?: string; id?: string }> | undefined) ?? [];
  const smileCandidates = ["smile", "Smile", "happy", "Happy", "fun", "Fun", "grin", "Grin", "joy", "Joy", "laugh", "Laugh"];
  let matchedExpr: string | null = null;

  for (const candidate of smileCandidates) {
    const found = expressions.find(
      (e) =>
        (e.name && e.name.toLowerCase() === candidate.toLowerCase()) ||
        (e.id && e.id.toLowerCase() === candidate.toLowerCase()),
    );
    if (found) {
      matchedExpr = found.id ?? found.name ?? null;
      break;
    }
  }

  // 没找到精确匹配，用第一个可用表情（通常默认模型至少有 1 个表情）
  if (!matchedExpr && expressions.length > 0) {
    matchedExpr = expressions[0].id ?? expressions[0].name ?? null;
  }

  if (matchedExpr) {
    try {
      (exprMgr.setExpression as (id: string) => void)(matchedExpr);
      // 1.5 秒后恢复默认表情
      setTimeout(() => {
        try { (exprMgr.setExpression as (id: string) => void)(""); } catch { /* ignore */ }
      }, 1500);
    } catch {
      /* ignore */
    }
  }
}

watch(() => appStore.collectionSaveSuccessCounter.value, () => {
  trySmileExpression();
  showDialog("状态更新成功！");
});

defineExpose({
  loadModel,
  resetModelPosition,
  collapse: () => { collapsed.value = true; },
  expand: () => { collapsed.value = false; },
  toggleCollapse,
});
</script>

<template>
  <Transition name="companion-fade">
    <div
      v-if="internalVisible"
      ref="containerRef"
      class="live2d-companion"
      :class="{
        'live2d-companion--collapsed': collapsed,
        'live2d-companion--pointer-through': pointerThrough,
        'live2d-companion--loading': modelLoading,
        'live2d-companion--idle': hasModel && !collapsed && !containerHovered,
      }"
      :style="containerStyle"
      role="complementary"
      aria-label="Live2D 看板娘"
      @mouseenter="onContainerEnter"
      @mouseleave="onContainerLeave"
    >
      <!-- 折叠/展开 切换按钮 -->
      <button
        class="live2d-companion__toggle"
        type="button"
        :aria-label="collapsed ? '展开看板娘' : '收起看板娘'"
        :title="collapsed ? '展开看板娘' : '收起看板娘'"
        @click.stop="toggleCollapse"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          :style="{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <!-- 对话框气泡 -->
      <Transition name="bubble-pop">
        <div
          v-if="dialogVisible"
          class="live2d-companion__bubble"
          @click.stop="handleDialogClick"
        >
          <p class="live2d-companion__bubble-text">{{ dialogText }}</p>
          <div class="live2d-companion__bubble-tail" />
        </div>
      </Transition>

      <!-- 模型错误提示 -->
      <div v-if="modelLoadError" class="live2d-companion__error">
        <span>⚠ {{ modelLoadError }}</span>
      </div>

      <!-- 无模型提示 -->
      <div v-if="!hasModel && !collapsed" class="live2d-companion__placeholder">
        <span>未配置模型</span>
      </div>

      <!-- Live2D 渲染画布（用 visibility 而非 v-show，保持 WebGL 上下文存活） -->
      <div
        class="live2d-companion__stage"
        :style="{ visibility: (!collapsed && hasModel) ? 'visible' : 'hidden', pointerEvents: (!collapsed && hasModel) ? 'auto' : 'none' }"
        @wheel.prevent="onStageWheel"
        @pointerdown="onStagePointerDown"
        @pointermove="onStagePointerMove"
        @pointerup="onStagePointerUp"
        @pointerleave="onStagePointerUp"
      >
        <canvas
          ref="canvasRef"
          class="live2d-companion__canvas"
          :width="canvasWidth"
          :height="canvasHeight"
          :style="canvasStyle"
        />
      </div>

      <!-- 拖拽手柄（预留） -->
      <div
        v-show="!collapsed"
        class="live2d-companion__grip"
        title="拖拽移动看板娘（预留）"
      />
    </div>
  </Transition>
</template>

<style scoped>
.live2d-companion {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1000;
  border-radius: 12px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #dce2ea);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.10),
    0 1px 4px rgba(0, 0, 0, 0.06);
  overflow: visible;
  transition:
    width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 0.35s ease;
}

.live2d-companion--collapsed {
  height: 48px !important;
  border-radius: 24px;
}

.live2d-companion--pointer-through {
  pointer-events: none;
}

.live2d-companion--pointer-through .live2d-companion__toggle {
  pointer-events: auto;
}

.live2d-companion__toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border, #dce2ea);
  border-radius: 50%;
  background: var(--surface, #ffffff);
  color: var(--muted, #697386);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.live2d-companion:hover .live2d-companion__toggle,
.live2d-companion--collapsed .live2d-companion__toggle {
  opacity: 1;
}

.live2d-companion--collapsed .live2d-companion__toggle {
  position: relative;
  top: auto;
  right: auto;
  margin: auto;
}

.live2d-companion__toggle:hover {
  color: var(--accent, #2f6f63);
  background: var(--surface-muted, #f6f8fb);
}

.live2d-companion__toggle svg {
  transition: transform 0.3s ease;
}

.live2d-companion__stage {
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
  border-radius: inherit;
}

.live2d-companion__stage:active {
  cursor: grabbing;
}

.live2d-companion__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.live2d-companion__error {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  z-index: 10;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(179, 38, 30, 0.12);
  color: var(--danger, #b3261e);
  font-size: 12px;
  line-height: 1.4;
}

.live2d-companion__grip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 6px;
  cursor: ns-resize;
  background: linear-gradient(
    to bottom,
    transparent,
    var(--border, #dce2ea) 50%,
    transparent
  );
  opacity: 0;
  transition: opacity 0.2s ease;
}

.live2d-companion:hover .live2d-companion__grip {
  opacity: 0.6;
}

.live2d-companion--loading .live2d-companion__stage {
  cursor: wait;
}

/* 鼠标不在画布内：隐藏边框/背景/阴影，只留模型 */
.live2d-companion--idle {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.live2d-companion--idle .live2d-companion__toggle {
  opacity: 0;
  pointer-events: none;
}

.live2d-companion__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 24px;
  font-size: 13px;
  color: var(--muted, #697386);
  text-align: center;
}

/* ── 对话框气泡 ──────────────────────────────────────── */
.live2d-companion__bubble {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  min-width: 140px;
  max-width: 300px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--accent, #2f6f63);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  user-select: none;
}

.live2d-companion__bubble-text {
  margin: 0;
  word-break: break-word;
}

.live2d-companion__bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 12px;
  height: 12px;
  background: var(--accent, #2f6f63);
  border-radius: 2px;
}

/* ── 气泡动画 ────────────────────────────────────────── */
.bubble-pop-enter-active {
  animation: bubble-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bubble-pop-leave-active {
  animation: bubble-out 0.2s ease forwards;
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.7) translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) scale(1) translateY(0);
  }
}

@keyframes bubble-out {
  to {
    opacity: 0;
    transform: translateX(-50%) scale(0.85) translateY(8px);
  }
}

/* ── Transition ──────────────────────────────────────── */
.companion-fade-enter-active,
.companion-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.companion-fade-enter-from,
.companion-fade-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
</style>
