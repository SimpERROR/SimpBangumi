<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useBangumi } from "../composables/useBangumi";
import { useAuth } from "../composables/useAuth";
import { useAppStore } from "../stores/app";
import { useSessionStore } from "../stores/session";
import akariAvatar from "../assets/akari.png";
import type { BangumiUser } from "../api/bangumi";

type LoginState = "idle" | "authenticating" | "success" | "error";
type OAuthPhase = "authorization" | "worker";
type LogoutState = "confirming" | "logging-out" | "success" | "error";

const COOKIE_GUIDE_DISMISSED_KEY = "bangumi.web-cookie.guide.dismissed";

const emit = defineEmits<{
  authenticated: [];
  loggedOut: [];
  openCookieSettings: [];
}>();
const sessionStore = useSessionStore();
const appStore = useAppStore();
const bangumi = useBangumi();
const auth = useAuth();
const mode = ref<"overview" | "login" | "logout" | "cookie-guide">("overview");
const patToken = ref("");
const authorizeUrl = ref("");
const form = reactive({ submitting: false, error: "" });
const loginState = ref<LoginState>("idle");
const oauthPhase = ref<OAuthPhase>("authorization");
const loginProgress = ref(0);
const loginProgressLabel = ref("");
const loginProgressPercent = computed(() => Math.round(loginProgress.value));
const navigationDirection = ref<"forward" | "back">("forward");
const logoutState = ref<LogoutState>("confirming");
const logoutAvatarUrl = ref(akariAvatar);
const logoutError = ref("");
const shouldShowCookieGuide = ref(false);
let loginProgressGeneration = 0;
let loginProgressAnimationFrame: number | null = null;
let resolveLoginProgressAnimation: (() => void) | null = null;

const user = computed<BangumiUser | null>(() => sessionStore.session.value?.user ?? null);
const displayName = computed(() => user.value?.nickname || user.value?.username || "未登录");
const username = computed(() => user.value?.username || "未登录");
const profileUrl = computed(() => user.value?.username ? `https://bgm.tv/user/${user.value.username}` : "");
const avatarUrl = computed(() => parseAvatar(user.value?.avatar) || akariAvatar);
const loginAvatarUrl = computed(() => loginState.value === "success" ? avatarUrl.value : akariAvatar);
const loginTitle = computed(() => {
  if (loginState.value === "authenticating") {
    return oauthPhase.value === "worker" ? "请稍候" : "等待手动确认";
  }
  if (loginState.value === "success") return `欢迎回来，${displayName.value}`;
  if (loginState.value === "error") return "登录未完成";
  return "登录 Bangumi";
});
const loginSubtitle = computed(() => {
  if (loginState.value === "authenticating") {
    return oauthPhase.value === "worker"
      ? "正在与 Worker 通讯以完成登录"
      : "请在开启的网页中操作授权。";
  }
  if (loginState.value === "success") return "登录成功 (/▽＼)";
  if (loginState.value === "error") return form.error || "请稍后重试";
  return "使用你的 Bangumi 账户继续";
});
const logoutTitle = computed(() => {
  if (logoutState.value === "logging-out") return "请稍候";
  if (logoutState.value === "success") return "再见！";
  if (logoutState.value === "error") return "退出未完成";
  return "退出登录？";
});
const logoutSubtitle = computed(() => {
  if (logoutState.value === "logging-out") return "正在安全退出你的 Bangumi 账户";
  if (logoutState.value === "success") return "已退出登录 (´；ω；`)";
  if (logoutState.value === "error") return logoutError.value || "请稍后重试";
  return "确定要退出当前 Bangumi 账户吗？";
});
const logoutDisplayAvatar = computed(() => logoutState.value === "success" ? akariAvatar : logoutAvatarUrl.value);

function parseAvatar(avatar: unknown): string {
  if (typeof avatar === "string") return absoluteBangumiUrl(avatar);
  if (!avatar || typeof avatar !== "object") return "";
  const record = avatar as Record<string, unknown>;
  for (const key of ["large", "medium", "small", "url"])
    if (typeof record[key] === "string" && record[key]) return absoluteBangumiUrl(record[key] as string);
  if (record.avatar && record.avatar !== avatar) return parseAvatar(record.avatar);
  return "";
}

function absoluteBangumiUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://bgm.tv${url}`;
  return url;
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (image.complete) finish();
  });
}

function stopLoginProgressAnimation() {
  if (loginProgressAnimationFrame !== null) {
    cancelAnimationFrame(loginProgressAnimationFrame);
    loginProgressAnimationFrame = null;
  }
  resolveLoginProgressAnimation?.();
  resolveLoginProgressAnimation = null;
}

function resetLoginProgress() {
  loginProgressGeneration += 1;
  stopLoginProgressAnimation();
  loginProgress.value = 0;
  loginProgressLabel.value = "";
}

function animateLoginProgressTo(nextTarget: number, duration: number, linear = false): Promise<void> {
  const startValue = loginProgress.value;
  const distance = nextTarget - startValue;
  if (distance <= 0.01) {
    loginProgress.value = nextTarget;
    return Promise.resolve();
  }

  const startTime = performance.now();
  return new Promise((resolve) => {
    resolveLoginProgressAnimation = resolve;
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startTime) / duration);
      const eased = linear ? elapsed : 1 - Math.pow(1 - elapsed, 3);
      loginProgress.value = startValue + distance * eased;
      if (elapsed < 1) {
        loginProgressAnimationFrame = requestAnimationFrame(animate);
        return;
      }
      loginProgress.value = nextTarget;
      loginProgressAnimationFrame = null;
      resolveLoginProgressAnimation = null;
      resolve();
    };
    loginProgressAnimationFrame = requestAnimationFrame(animate);
  });
}

function setLoginProgress(value: number, label: string, stallLimit?: number): Promise<void> {
  const generation = ++loginProgressGeneration;
  stopLoginProgressAnimation();
  loginProgressLabel.value = label;

  const nextTarget = Math.max(loginProgress.value, Math.min(100, value));
  const duration = Math.min(900, Math.max(280, (nextTarget - loginProgress.value) * 24));
  const stageAnimation = animateLoginProgressTo(nextTarget, duration);
  void stageAnimation.then(() => {
    if (generation !== loginProgressGeneration || stallLimit === undefined) return;
    const driftTarget = Math.max(nextTarget, Math.min(99, stallLimit));
    const driftDistance = driftTarget - loginProgress.value;
    if (driftDistance <= 0.01) return;
    const driftDuration = Math.max(4800, driftDistance * 420);
    void animateLoginProgressTo(driftTarget, driftDuration, true);
  });
  return stageAnimation;
}

async function finishLogin(result: { ok: true; data: { authenticated: boolean; user?: BangumiUser | null } } | { ok: false; error: string }) {
  if (!result.ok) {
    form.error = result.error;
    form.submitting = false;
    loginState.value = "error";
    return;
  }
  sessionStore.session.value = result.data;
  setLoginProgress(88, "正在加载账户资料", 94);
  await preloadImage(avatarUrl.value);
  const guideDismissed = localStorage.getItem(COOKIE_GUIDE_DISMISSED_KEY) === "1";
  if (!guideDismissed) {
    setLoginProgress(95, "正在检查网页功能状态", 99);
    const cookieStatus = await bangumi.getWebCookieStatus();
    shouldShowCookieGuide.value = cookieStatus.ok && !cookieStatus.data.configured;
  } else {
    shouldShowCookieGuide.value = false;
  }
  form.submitting = false;
  form.error = "";
  patToken.value = "";
  await setLoginProgress(100, "登录完成");
  loginState.value = "success";
  emit("authenticated");
}

async function loginWithPat() {
  const token = patToken.value.trim();
  if (!token) {
    form.error = "请输入 Personal Access Token。";
    return;
  }
  form.submitting = true;
  form.error = "";
  loginState.value = "authenticating";
  oauthPhase.value = "authorization";
  resetLoginProgress();
  setLoginProgress(18, "正在验证访问令牌", 77);
  const result = await bangumi.loginWithPersonalAccessToken(token);
  if (result.ok) setLoginProgress(78, "正在建立本地会话", 87);
  await finishLogin(result);
}

async function loginWithOAuth() {
  form.submitting = true;
  form.error = "";
  loginState.value = "authenticating";
  resetLoginProgress();
  setLoginProgress(8, "正在创建授权请求", 15);
  const start = await auth.startOAuthLogin(appStore.theme.value);
  if (!start.ok) {
    form.error = start.error;
    form.submitting = false;
    loginState.value = "error";
    return;
  }
  setLoginProgress(16, "正在打开授权页面", 23);
  authorizeUrl.value = start.data;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(start.data);
  } catch {
    const popup = window.open(start.data, "_blank", "noopener,noreferrer");
    if (!popup) {
      form.error = "授权页未自动弹出，请点击下方链接手动打开。";
      form.submitting = false;
      loginState.value = "error";
      return;
    }
  }
  setLoginProgress(24, "等待你在网页中确认授权");
  const result = await auth.finishOAuthLogin({
    showWorkerOverlay: false,
    onWorkerCommunication: () => {
      oauthPhase.value = "worker";
      setLoginProgress(56, "授权成功，正在建立安全登录会话", 79);
    },
  });
  if (result.ok) setLoginProgress(80, "已建立安全登录会话", 87);
  await finishLogin(result);
}

function openLogin() {
  navigationDirection.value = "forward";
  mode.value = "login";
  loginState.value = "idle";
  oauthPhase.value = "authorization";
  resetLoginProgress();
  form.error = "";
}

function closeLogin() {
  navigationDirection.value = "back";
  mode.value = "overview";
  loginState.value = "idle";
  oauthPhase.value = "authorization";
  form.error = "";
}

function retryLogin() {
  loginState.value = "idle";
  oauthPhase.value = "authorization";
  form.error = "";
  authorizeUrl.value = "";
  resetLoginProgress();
}

function completeLogin() {
  if (shouldShowCookieGuide.value) {
    navigationDirection.value = "forward";
    mode.value = "cookie-guide";
  } else {
    navigationDirection.value = "back";
    mode.value = "overview";
  }
  loginState.value = "idle";
}

function closeCookieGuide() {
  navigationDirection.value = "back";
  mode.value = "overview";
}

function dismissCookieGuide() {
  localStorage.setItem(COOKIE_GUIDE_DISMISSED_KEY, "1");
  shouldShowCookieGuide.value = false;
  closeCookieGuide();
}

function openCookieSettings() {
  emit("openCookieSettings");
}

function openLogout() {
  logoutAvatarUrl.value = avatarUrl.value;
  logoutState.value = "confirming";
  logoutError.value = "";
  navigationDirection.value = "forward";
  mode.value = "logout";
}

function closeLogout() {
  navigationDirection.value = "back";
  mode.value = "overview";
  logoutState.value = "confirming";
  logoutError.value = "";
}

async function confirmLogout() {
  logoutState.value = "logging-out";
  logoutError.value = "";
  const result = await bangumi.logout();
  if (!result.ok) {
    logoutError.value = result.error;
    logoutState.value = "error";
    return;
  }

  sessionStore.session.value = result.data;
  await preloadImage(akariAvatar);
  logoutState.value = "success";
  emit("loggedOut");
}

function retryLogout() {
  logoutState.value = "confirming";
  logoutError.value = "";
}
</script>

<template>
  <section class="my-view" :class="`my-view--${navigationDirection}`">
    <Transition name="my-route">
      <div v-if="mode === 'cookie-guide'" key="cookie-guide" class="my-login-stage my-cookie-guide">
        <button class="my-back-button" type="button" @click="closeCookieGuide">‹ <span>我的</span></button>
        <div class="my-cookie-guide__hero">
          <span class="my-cookie-guide__icon" aria-hidden="true"></span>
          <h2>下一步：启用可选的扩展功能</h2>
          <p class="my-muted">按需配置 Bangumi 网页 Cookie</p>
        </div>
        <div class="my-cookie-guide__card">
          <p>OAuth 登录已可使用条目浏览、收藏与进度管理等核心功能。Cookie 仅用于目录详情、向目录添加角色或人物，以及部分收藏操作的网页回退。</p>
          <p>获取条目吐槽箱、角色评论等信息时，未配置 Cookie 更容易遭遇风控而无法显示；对于部分特殊条目，未配置会导致无法获取上述信息。</p>
          <p>现在无需立刻配置，使用相关功能时应用也会再次提示。若要启用，可前往“设置 → 网页登录与 Cookie”在应用内登录并自动获取。</p>
          <p>我们会将您的 Cookie 本地加密保存，不会回显，更不会发送给非 Bangumi 官方的远程服务器。</p>
          <div class="my-cookie-guide__actions">
            <button class="primary-button" type="button" @click="openCookieSettings">现在配置</button>
            <button class="secondary-button" type="button" @click="closeCookieGuide">以后再说</button>
            <button class="my-cookie-guide__dismiss" type="button" @click="dismissCookieGuide">不再显示此引导</button>
          </div>
        </div>
      </div>

      <div v-else-if="mode === 'logout'" key="logout" class="my-login-stage">
        <button class="my-back-button" :class="{ 'is-hidden': logoutState === 'logging-out' || logoutState === 'success' }" type="button" :disabled="logoutState === 'logging-out' || logoutState === 'success'" @click="closeLogout">‹ <span>我的</span></button>
        <div class="my-login-hero">
          <div class="my-login-avatar-shell" :class="{ 'is-communicating': logoutState === 'logging-out' }">
            <Transition name="my-avatar-swap" mode="out-in">
              <img :key="logoutDisplayAvatar" :src="logoutDisplayAvatar" :alt="logoutState === 'success' ? '阿卡林' : `${displayName} 的头像`" class="my-avatar my-avatar--login" />
            </Transition>
            <Transition name="my-loader-fade">
              <span v-if="logoutState === 'logging-out'" class="my-login-loader" aria-label="退出中" />
            </Transition>
          </div>
          <Transition name="my-copy-swap" mode="out-in">
            <div :key="logoutState" class="my-login-copy" aria-live="polite">
              <h2>{{ logoutTitle }}</h2>
              <p class="my-muted" :class="{ 'my-login-error': logoutState === 'error' }">{{ logoutSubtitle }}</p>
            </div>
          </Transition>
        </div>
        <Transition name="my-controls-swap" mode="out-in">
          <div v-if="logoutState === 'confirming'" key="confirming" class="my-logout-confirm-actions">
            <button class="my-logout-button" type="button" @click="confirmLogout">退出登录</button>
            <button class="secondary-button" type="button" @click="closeLogout">取消</button>
          </div>
          <div v-else-if="logoutState === 'success'" key="success" class="my-login-completion">
            <button class="primary-button my-login-button" type="button" @click="closeLogout">完成</button>
          </div>
          <div v-else-if="logoutState === 'error'" key="error" class="my-login-completion">
            <button class="primary-button my-login-button" type="button" @click="retryLogout">重试</button>
          </div>
          <div v-else key="logging-out" class="my-login-progress-spacer" aria-hidden="true" />
        </Transition>
      </div>

      <div v-else-if="mode === 'login'" key="login" class="my-login-stage">
        <button class="my-back-button" :class="{ 'is-hidden': loginState === 'authenticating' }" type="button" :disabled="loginState === 'authenticating'" @click="closeLogin">‹ <span>我的</span></button>
        <div class="my-login-hero">
          <div class="my-login-avatar-shell" :class="{ 'is-communicating': loginState === 'authenticating' }">
            <Transition name="my-avatar-swap" mode="out-in">
              <img :key="loginAvatarUrl" :src="loginAvatarUrl" :alt="loginState === 'success' ? `${displayName} 的头像` : '阿卡林'" class="my-avatar my-avatar--login" />
            </Transition>
            <span v-if="loginState === 'success'" class="my-avatar-rays" aria-hidden="true">
              <i v-for="index in 12" :key="index" :style="{ '--ray-index': index - 1 }" />
            </span>
            <Transition name="my-loader-fade">
              <svg v-if="loginState === 'authenticating'" class="my-login-loader my-login-loader--progress" viewBox="0 0 100 100" role="progressbar" :aria-label="loginProgressLabel" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="loginProgressPercent">
                <circle class="my-login-loader__track" cx="50" cy="50" r="47" pathLength="100" />
                <circle class="my-login-loader__value" cx="50" cy="50" r="47" pathLength="100" :style="{ strokeDashoffset: 100 - loginProgress }" />
              </svg>
            </Transition>
          </div>
          <Transition name="my-copy-swap" mode="out-in">
            <div :key="`${loginState}-${oauthPhase}`" class="my-login-copy" aria-live="polite">
              <h2>{{ loginTitle }}</h2>
              <p class="my-muted" :class="{ 'my-login-error': loginState === 'error' }">{{ loginSubtitle }}</p>
              <div v-if="loginState === 'authenticating'" class="my-login-progress" aria-hidden="true">
                <span>{{ loginProgressLabel }}</span>
                <strong>{{ loginProgressPercent }}%</strong>
              </div>
            </div>
          </Transition>
        </div>
        <Transition name="my-controls-swap" mode="out-in">
          <div v-if="loginState === 'idle'" key="idle" class="my-login-form">
            <button class="primary-button my-login-button" type="button" @click="loginWithOAuth">使用 OAuth 登录</button>
            <details class="my-pat">
              <summary>使用 PAT 登录（备选）</summary>
              <input v-model="patToken" class="onboarding__input" type="password" autocomplete="off" placeholder="粘贴你的 Bangumi PAT" @keydown.enter="loginWithPat" />
              <button class="secondary-button" type="button" @click="loginWithPat">使用 PAT 登录</button>
            </details>
          </div>
          <div v-else-if="loginState === 'success'" key="success" class="my-login-completion">
            <button class="primary-button my-login-button" type="button" @click="completeLogin">完成</button>
          </div>
          <div v-else-if="loginState === 'error'" key="error" class="my-login-completion">
            <a v-if="authorizeUrl" class="onboarding__link" :href="authorizeUrl" target="_blank" rel="noreferrer">重新打开授权页</a>
            <button class="primary-button my-login-button" type="button" @click="retryLogin">重试</button>
          </div>
          <div v-else key="authenticating" class="my-login-progress-spacer" aria-hidden="true" />
        </Transition>
      </div>

      <div v-else key="overview" class="my-overview">
        <header class="my-profile-card" :class="{ 'has-content-below': user }">
          <img :src="avatarUrl" :alt="user ? `${displayName} 的头像` : '阿卡林'" class="my-avatar" />
          <div class="my-profile-copy">
            <h2>{{ displayName }}</h2>
            <p class="my-muted">{{ user ? `@${username}` : "阿卡林~" }}</p>
          </div>
          <button v-if="!user" class="primary-button my-profile-action" type="button" @click="openLogin">登录</button>
        </header>

        <section v-if="user" class="my-account-section">
          <h3 class="my-section-title">账户</h3>
          <div class="my-section-list">
            <a class="my-row" :href="profileUrl" target="_blank" rel="noreferrer"><strong>用户名</strong><span class="my-row-value">{{ username }}</span><span class="my-row-chevron">›</span></a>
            <div class="my-row"><strong>用户 ID</strong><span class="my-row-value">{{ user.id }}</span></div>
            <div class="my-row my-row--sign"><strong>签名</strong><span class="my-row-value">{{ user.sign || "未设置" }}</span></div>
          </div>
        </section>
        <button v-if="user" class="my-logout-button" type="button" @click="openLogout">退出登录</button>
      </div>
    </Transition>
  </section>
</template>
