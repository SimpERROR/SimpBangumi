<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useBangumi } from "../../composables/useBangumi";
import { formatReadableDateTime } from "../../utils/datetime";

const bangumi = useBangumi();
const cookieInput = ref("");
const loading = ref(false);
const saving = ref(false);
const clearing = ref(false);
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

  success.value = "已打开应用内登录窗口，请在窗口中完成登录后保持其开启，并点击“我已登录，自动获取”。";
  openingEmbedded.value = false;
}

async function captureEmbeddedCookie() {
  capturingEmbedded.value = true;
  resetMessages();

  const result = await bangumi.captureEmbeddedWebCookie();
  if (!result.ok) {
    error.value = result.error;
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

onMounted(() => {
  void refreshCookieStatus();
});
</script>

<template>
  <div class="onboarding__panel settings-page">
    <h2>网页登录与 Cookie</h2>
    <p class="onboarding__description">
      当网页抓取触发风控时，可先网页登录 Bangumi，再保存 Cookie 以用于抓取请求。
    </p>

    <article class="comment-box">
      <div class="comment-box__header">
        <h5>应用内登录并自动获取</h5>
      </div>
      <p class="detail-muted">
        请在应用内窗口完成登录，在保持此窗口开启的情况下，再点击 “我已登录，自动获取” 自动保存 Cookie。
      </p>
      <div class="modal__actions">
        <button class="primary-button" type="button" :disabled="openingEmbedded || capturingEmbedded" @click="openEmbeddedLogin">
          {{ openingEmbedded ? "打开中..." : "应用内登录并自动获取" }}
        </button>
        <button class="secondary-button" type="button" :disabled="openingEmbedded || capturingEmbedded" @click="captureEmbeddedCookie">
          {{ capturingEmbedded ? "读取中..." : "我已登录，自动获取" }}
        </button>
      </div>
      <p class="detail-muted">
        如果应用内窗口无法使用，可改为浏览器登录并手动粘贴 Cookie。
      </p>
      <div class="modal__actions">
        <button class="secondary-button" type="button" @click="openBangumiLoginPage">
          打开浏览器登录页
        </button>
      </div>
    </article>

      <p v-if="error" class="onboarding__error">{{ error }}</p>
      <p v-if="success" class="detail-success">{{ success }}</p>

    <article class="comment-box">
      <div class="comment-box__header">
        <h5>Cookie 状态</h5>
      </div>

      <p v-if="loading" class="detail-muted">正在读取 Cookie 状态...</p>
      <template v-else>
        <p class="detail-muted">
          当前状态：{{ cookieConfigured ? "已配置" : "未配置" }}
        </p>
        <p v-if="cookieUpdatedAt" class="detail-muted">
          最近保存：{{ formatReadableDateTime(cookieUpdatedAt) }}
        </p>
      </template>

      <label>
        <p>Cookie</p><br>
        <textarea
          v-model="cookieInput"
          rows="4"
          :disabled="saving || clearing || openingEmbedded || capturingEmbedded"
          placeholder="例如：chii_auth=...; chii_sid=..."
        ></textarea>
      </label>

      <div class="modal__actions">
        <button class="primary-button" type="button" :disabled="saving || clearing || openingEmbedded || capturingEmbedded" @click="saveCookie">
          {{ saving ? "保存中..." : "保存 Cookie" }}
        </button>
        <button class="secondary-button" type="button" :disabled="saving || clearing || openingEmbedded || capturingEmbedded" @click="clearCookie">
          {{ clearing ? "清除中..." : "清除 Cookie" }}
        </button>
        <button class="secondary-button" type="button" :disabled="saving || clearing || openingEmbedded || capturingEmbedded" @click="refreshCookieStatus">
          刷新状态
        </button>
      </div>

      <p class="detail-muted">
        Cookie 将本地加密保存，应用不会回显或上传该值；抓取时仅在本地请求头中使用。
      </p>
    </article>
  </div>
</template>
