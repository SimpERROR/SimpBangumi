<script setup lang="ts">
import { ref } from "vue";
import { version } from "../../../package.json";
import appLogo from "../../assets/app-logo.png";
import CollectionGames from "../../components/CollectionGames.vue";

const GITHUB_REPO = "https://github.com/SimpERROR/SimpBangumi";
const BANGUMI_SITE = "https://bgm.tv";
const ISSUES_URL = `${GITHUB_REPO}/issues`;
const TAURI_SITE = "https://tauri.app";
const RUST_SITE = "https://www.rust-lang.org";
const VUE_SITE = "https://vuejs.org";
const TENRAI_SITE = "https://api.tenrai.org";
const FONTAWESOME_SITE = "https://fontawesome.com";
const LIVE2D_SITE = "https://www.live2d.com";
const MAL_SITE = "https://myanimelist.net";
const gameOpen = ref(false);
let versionClickCount = 0;
let versionClickStartedAt = 0;

function handleVersionClick() {
  const now = Date.now();
  if (!versionClickStartedAt || now - versionClickStartedAt > 2500) {
    versionClickCount = 0;
    versionClickStartedAt = now;
  }
  versionClickCount += 1;
  if (versionClickCount < 5) return;
  versionClickCount = 0;
  versionClickStartedAt = 0;
  gameOpen.value = true;
}
</script>

<template>
  <div class="display-settings">

    <!-- ═══ 品牌 ═══ -->
    <section class="settings-card">
      <div class="about-brand">
        <img :src="appLogo" alt="SimpBangumi" class="about-brand__logo" />
        <div class="about-brand__text">
          <h1 class="about-brand__name">SimpBangumi</h1>
          <button class="about-brand__version" type="button" :aria-label="`版本 ${version}`" @click="handleVersionClick">v{{ version }}</button>
        </div>
      </div>
      <p class="settings-card__desc">一个基于 Bangumi API 的桌面客户端，帮助你管理番组收藏、发现新作品。</p>
      <dl class="about-meta">
        <div><dt>技术栈</dt><dd>Tauri v2 · Rust · Vue 3</dd></div>
      </dl>
    </section>

    <!-- ═══ 鸣谢 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">鸣谢与开源致谢</h3>
      <dl class="about-meta">
        <div>
          <dt>Bangumi 番组计划</dt>
          <dd>感谢官方提供的公开 API。<a :href="BANGUMI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a></dd>
        </div>
        <div>
          <dt>Tauri · Rust · Vue 3</dt>
          <dd>感谢 <a :href="TAURI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Tauri</a>、<a :href="RUST_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Rust</a>、<a :href="VUE_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Vue 3</a> 社区提供的卓越底层支持。</dd>
        </div>
        <div>
          <dt>Live2D Cubism SDK</dt>
          <dd>看板娘渲染引擎，通过 pixi-live2d-display 集成。<a :href="LIVE2D_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a></dd>
        </div>
        <div>
          <dt>Tenrai API</dt>
          <dd>提供更多动画信息。<a :href="TENRAI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">API ↗</a></dd>
        </div>
        <div>
          <dt>Font Awesome</dt>
          <dd>界面中使用的图标集。<a :href="FONTAWESOME_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a></dd>
        </div>
      </dl>
    </section>

    <!-- ═══ 相关链接 ═══ -->
    <section class="settings-card">
      <h3 class="settings-card__title">相关链接</h3>
      <div class="about-links">
        <a :href="GITHUB_REPO" target="_blank" rel="noopener noreferrer" class="about-link">GitHub 仓库 ↗</a>
        <a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer" class="about-link">问题反馈 ↗</a>
        <a :href="BANGUMI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Bangumi ↗</a>
        <a :href="MAL_SITE" target="_blank" rel="noopener noreferrer" class="about-link">MyAnimeList ↗</a>
      </div>
    </section>
    <CollectionGames v-if="gameOpen" @close="gameOpen = false" />
  </div>
</template>

<style scoped>
.about-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 4px;
}

.about-brand__logo {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
}

.about-brand__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-brand__name {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
}

.about-brand__version {
  width: fit-content;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
  cursor: default;
}

.about-brand__version:focus-visible {
  border-radius: 3px;
  outline: 2px solid color-mix(in srgb, var(--accent) 42%, transparent);
  outline-offset: 3px;
}

.about-meta {
  display: grid;
  gap: 6px;
  margin: 0;
}

.about-meta div {
  display: grid;
  gap: 2px;
}

.about-meta dt {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.about-meta dd {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.about-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}

.about-link:hover {
  text-decoration: underline;
}

.about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.about-disclaimer {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text);
}
</style>
