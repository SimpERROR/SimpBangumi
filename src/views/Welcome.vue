<script setup lang="ts">
import { ref } from "vue";
import logoUrl from "../../app-logo.png";
import { bangumiApi } from "../api/bangumi";
import { useSessionStore } from "../stores/session";

const sessionStore = useSessionStore();

const token = ref("");
const loading = ref(false);
const error = ref("");

async function loginWithPAT() {
  const trimmed = token.value.trim();
  if (!trimmed) return;

  loading.value = true;
  error.value = "";

  try {
    const session = await bangumiApi.loginWithPersonalAccessToken(trimmed);
    sessionStore.session.value = session;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function skipLogin() {
  sessionStore.dismissed.value = true;
}
</script>

<template>
  <div class="welcome">
    <div class="welcome__card">
      <div class="welcome__brand">
        <img class="welcome__logo" :src="logoUrl" alt="Bangumi Client 徽标" />
        <h1 class="welcome__title">Bangumi Client</h1>
      </div>

      <p class="welcome__subtitle">登录你的 Bangumi 账户，以查看 Timeline 和收藏列表。</p>

      <section class="welcome__section">
        <h2 class="welcome__section-title">个人访问令牌登录</h2>
        <form class="welcome__form" @submit.prevent="loginWithPAT">
          <input
            v-model="token"
            class="welcome__input"
            type="password"
            placeholder="粘贴你的个人访问令牌"
            autocomplete="off"
            :disabled="loading"
          />
          <button
            class="welcome__primary-button"
            type="submit"
            :disabled="loading || !token.trim()"
          >
            {{ loading ? "登录中…" : "登录" }}
          </button>
        </form>
        <p v-if="error" class="welcome__error">{{ error }}</p>
        <p class="welcome__hint">
          前往
          <a href="https://next.bgm.tv/demo/access-token" target="_blank" rel="noopener noreferrer">
            bgm.tv 个人访问令牌页面
          </a>
          创建令牌后粘贴至此处。
        </p>
      </section>

      <button class="welcome__skip-button" type="button" @click="skipLogin">
        暂不登录，直接浏览
      </button>
    </div>
  </div>
</template>
