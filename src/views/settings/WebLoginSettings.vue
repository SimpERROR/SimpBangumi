<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useBangumi } from "../../composables/useBangumi";
import { formatReadableDateTime } from "../../utils/datetime";
import { useAppStore } from "../../stores/app";

const bangumi = useBangumi();
const appStore = useAppStore();
const cookieInput = ref("");
const loading = ref(false);
const saving = ref(false);
const clearing = ref(false);
const validating = ref(false);
const openingEmbedded = ref(false);
const capturingEmbedded = ref(false);
const error = ref("");
const success = ref("");
const cookieConfigured = ref(false);
const cookieUpdatedAt = ref<number | null>(null);

function resetMessages() {
  error.value = "";
  success.value = "";
}

function isInvalidCookieError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("cookie")
    && (
      normalized.includes("无效")
      || normalized.includes("为空")
      || normalized.includes("失效")
      || normalized.includes("invalid")
      || normalized.includes("empty")
      || normalized.includes("expired")
    );
}

async function syncCookieStatusAfterWrite(successMessage: string): Promise<boolean> {
  const statusResult = await bangumi.getWebCookieStatus();
  if (!statusResult.ok) {
    error.value = `保存后校验失败：${statusResult.error}`;
    return false;
  }

  cookieConfigured.value = statusResult.data.configured;
  cookieUpdatedAt.value = statusResult.data.updated_at ?? null;

  if (!statusResult.data.configured) {
    error.value = "已执行保存，但刷新读取不到 Cookie。通常是系统钥匙串写入权限或隔离策略导致。";
    return false;
  }

  success.value = successMessage;
  return true;
}

async function openBangumiLoginPage() {
  resetMessages();

  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://bangumi.tv/login");
    return;
  } catch {
    // Ignore and fallback to browser popup in non-Tauri preview.
  }

  const popup = window.open("https://bangumi.tv/login", "_blank", "noopener,noreferrer");
  if (!popup) {
    error.value = "无法自动打开登录页，请检查系统默认浏览器设置。";
  }
}

async function openEmbeddedLogin() {
  openingEmbedded.value = true;
  resetMessages();

  const result = await bangumi.openEmbeddedWebLogin();
  if (!result.ok) {
    error.value = result.error;
    openingEmbedded.value = false;
    return;
  }

  success.value = "已打开应用内登录窗口，请在窗口中完成登录后保持其开启，并点击「我已登录，自动获取」。";
  openingEmbedded.value = false;
}

async function captureEmbeddedCookie() {
  capturingEmbedded.value = true;
  resetMessages();

  const result = await bangumi.captureEmbeddedWebCookie();
  if (!result.ok) {
    error.value = result.error;
    if (isInvalidCookieError(result.error)) {
      appStore.showToast("自动获取到的 Cookie 为空或无效，请确认已登录后重试。", "error");
    }
    capturingEmbedded.value = false;
    return;
  }

  await syncCookieStatusAfterWrite("已自动获取并安全保存登录 Cookie。");
  capturingEmbedded.value = false;
}

async function refreshCookieStatus() {
  loading.value = true;
  resetMessages();

  const result = await bangumi.getWebCookieStatus();
  if (!result.ok) {
    error.value = result.error;
    loading.value = false;
    return;
  }

  cookieConfigured.value = result.data.configured;
  cookieUpdatedAt.value = result.data.updated_at ?? null;
  loading.value = false;
}

async function saveCookie() {
  const value = cookieInput.value.trim();
  if (!value) {
    error.value = "请先粘贴 Cookie。";
    return;
  }

  saving.value = true;
  resetMessages();

  const result = await bangumi.saveWebCookie(value);
  if (!result.ok) {
    error.value = result.error;
    saving.value = false;
    return;
  }

  const verified = await syncCookieStatusAfterWrite("Cookie 已安全保存。");
  cookieInput.value = "";
  if (!verified) {
    saving.value = false;
    return;
  }
  saving.value = false;
}

async function clearCookie() {
  clearing.value = true;
  resetMessages();

  const result = await bangumi.clearWebCookie();
  if (!result.ok) {
    error.value = result.error;
    clearing.value = false;
    return;
  }

  cookieConfigured.value = false;
  cookieUpdatedAt.value = null;
  cookieInput.value = "";
  success.value = "已清除保存的 Cookie。";
  clearing.value = false;
}

async function validateCookie() {
  validating.value = true;
  resetMessages();

  const result = await bangumi.validateWebCookie();
  if (!result.ok) {
    error.value = result.error;
    appStore.showToast(result.error, "error");
    validating.value = false;
    return;
  }

  cookieConfigured.value = result.data.configured;

  if (!result.data.configured) {
    error.value = result.data.reason ?? "尚未保存 Cookie，请先完成登录并保存。";
    appStore.showToast(error.value, "error");
    validating.value = false;
    return;
  }

  if (!result.data.valid) {
    error.value = result.data.reason ?? "当前 Cookie 已失效，请重新登录并保存。";
    appStore.showToast(error.value, "error");
    validating.value = false;
    return;
  }

  success.value = "Cookie 仍然有效。";
  appStore.showToast(success.value, "success");
  validating.value = false;
}

onMounted(() => {
  void refreshCookieStatus();
});
</script>

<template>
  <div class="display-settings">

    <!-- ═══ 登录与获取 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">网页登录与 Cookie</h3>
      <p class="settings-card__desc">当网页抓取触发风控时，可先网页登录 Bangumi，再保存 Cookie 以用于抓取请求。</p>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">应用内登录</h4>
        <p class="settings-card__hint">在应用内窗口完成登录后，保持窗口开启并点击自动获取。</p>
        <div class="settings-card__actions">
          <button class="primary-button" type="button" :disabled="openingEmbedded || capturingEmbedded" @click="openEmbeddedLogin">
            {{ openingEmbedded ? "打开中..." : "应用内登录" }}
          </button>
          <button class="secondary-button" type="button" :disabled="openingEmbedded || capturingEmbedded" @click="captureEmbeddedCookie">
            {{ capturingEmbedded ? "读取中..." : "自动获取" }}
          </button>
        </div>
      </div>

      <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">浏览器登录</h4>
        <p class="settings-card__hint">如果应用内窗口无法使用，可改为浏览器登录后手动粘贴 Cookie。</p>
        <button class="secondary-button" type="button" style="justify-self: start;" @click="openBangumiLoginPage">打开浏览器登录页</button>
      </div>
    </section>

    <!-- ═══ Cookie 管理 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">Cookie 管理</h3>

      <p v-if="loading" class="settings-card__hint">正在读取 Cookie 状态...</p>
      <template v-else>
        <p class="settings-card__hint">
          当前状态：<strong>{{ cookieConfigured ? "已配置" : "未配置" }}</strong>
          <template v-if="cookieUpdatedAt"> · 最近保存：{{ formatReadableDateTime(cookieUpdatedAt) }}</template>
        </p>
      </template>

      <textarea
        v-model="cookieInput"
        class="web-login-textarea"
        rows="4"
        :disabled="saving || clearing || validating || openingEmbedded || capturingEmbedded"
        placeholder="例如：chii_auth=...; chii_sid=..."
      ></textarea>

      <div class="settings-card__actions">
        <button class="primary-button" type="button" :disabled="saving || clearing || validating || openingEmbedded || capturingEmbedded" @click="saveCookie">
          {{ saving ? "保存中..." : "保存 Cookie" }}
        </button>
        <button class="secondary-button" type="button" :disabled="saving || clearing || validating || openingEmbedded || capturingEmbedded" @click="clearCookie">
          {{ clearing ? "清除中..." : "清除 Cookie" }}
        </button>
        <button class="secondary-button" type="button" :disabled="saving || clearing || validating || openingEmbedded || capturingEmbedded" @click="refreshCookieStatus">刷新状态</button>
        <button class="secondary-button" type="button" :disabled="saving || clearing || validating || openingEmbedded || capturingEmbedded" @click="validateCookie">
          {{ validating ? "验证中..." : "验证有效性" }}
        </button>
      </div>

      <p v-if="error" class="settings-card__error">{{ error }}</p>
      <p v-if="success" class="settings-card__hint" style="color: var(--accent);">{{ success }}</p>

      <p class="settings-card__hint">Cookie 将本地加密保存，应用不会回显或上传；抓取时仅在本地请求头中使用。</p>
    </section>

  </div>
</template>

<style scoped>
.web-login-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.2s ease;
}

.web-login-textarea:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
