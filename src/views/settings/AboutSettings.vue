<script setup lang="ts">
import { version } from "../../../package.json";
import appLogo from "../../assets/app-logo.png";

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
</script>

<template>
  <div class="onboarding__panel settings-page">

    <!-- ── 品牌 ────────────────────────────────────── -->
    <div class="about-brand">
      <img :src="appLogo" alt="SimpBangumi" class="about-brand__logo" />
      <div class="about-brand__text">
        <h1 class="about-brand__name">SimpBangumi</h1>
        <p class="about-brand__version">v{{ version }}</p>
      </div>
    </div>

    <p class="onboarding__description">
      一个基于 Bangumi API 的桌面客户端，帮助你管理番组收藏、发现新作品。
    </p>

    <!-- ── 基本信息 ────────────────────────────────── -->
    <dl class="settings-about-list">
      <div>
        <dt>技术栈</dt>
        <dd>Tauri v2 · Rust · Vue 3</dd>
      </div>
      <div>
        <dt>开源协议</dt>
        <dd>GPL-3.0</dd>
      </div>
    </dl>

    <!-- ── 鸣谢 ────────────────────────────────────── -->
    <h2 style="margin-top: 8px;">鸣谢与开源致谢</h2>

    <dl class="settings-about-list">
      <div>
        <dt>Bangumi 番组计划</dt>
        <dd>
          感谢官方提供的公开 API。
          <a :href="BANGUMI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a>
        </dd>
      </div>
      <div>
        <dt>Tauri · Rust · Vue 3</dt>
        <dd>
          感谢
          <a :href="TAURI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Tauri</a>、
          <a :href="RUST_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Rust</a>、
          <a :href="VUE_SITE" target="_blank" rel="noopener noreferrer" class="about-link">Vue 3</a>
          社区提供的卓越底层支持。
        </dd>
      </div>
      <div>
        <dt>Live2D Cubism SDK</dt>
        <dd>
          看板娘渲染引擎。通过 pixi-live2d-display 集成。
          <a :href="LIVE2D_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a>
        </dd>
      </div>
      <div>
        <dt>Tenrai API</dt>
        <dd>
          提供更多动画信息。
          <a :href="TENRAI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">API ↗</a>
        </dd>
      </div>
      <div>
        <dt>Font Awesome</dt>
        <dd>
          界面中使用的图标集。
          <a :href="FONTAWESOME_SITE" target="_blank" rel="noopener noreferrer" class="about-link">官网 ↗</a>
        </dd>
      </div>
      <div>
        <dt>开源第三方组件</dt>
        <dd>
          本项目使用了大量 MIT / Apache 2.0 / BSD 等协议的开源依赖，在此向所有底层依赖的开发者致以最崇高的敬意。
        </dd>
      </div>
    </dl>

    <!-- ── 相关链接 ────────────────────────────────── -->
    <h2 style="margin-top: 8px;">相关链接</h2>

    <div class="about-links">
      <a :href="GITHUB_REPO" target="_blank" rel="noopener noreferrer" class="about-link">
        GitHub 仓库 ↗
      </a>
      <a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer" class="about-link">
        问题反馈 ↗
      </a>
      <a :href="BANGUMI_SITE" target="_blank" rel="noopener noreferrer" class="about-link">
        Bangumi 番组计划 官网 ↗
      </a>
      <a :href="MAL_SITE" target="_blank" rel="noopener noreferrer" class="about-link">
        MyAnimeList 官网 ↗
      </a>
    </div>

    <h2 style="margin-top: 8px;">烦请注意</h2>
    <p class="about-disclaimer">
      SimpBangumi 不内置、不提供、亦不分发任何 Live2D 角色模型及 Live2D Cubism SDK 核心运行时。
      所有相关资产均需由您自行合法获取并手动导入。<br>
      SimpBangumi 不是 Bangumi 番组计划 官方桌面客户端。
    </p>

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
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
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
