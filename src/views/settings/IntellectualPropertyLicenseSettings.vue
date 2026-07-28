<script setup lang="ts">
import { computed, ref } from "vue";
import projectLicense from "../../../LICENSE?raw";
import licenseManifest from "../../generated/third-party-licenses.json";

type Ecosystem = "npm" | "Cargo";
type LicenseEntry = (typeof licenseManifest.entries)[number];

const ecosystems: Ecosystem[] = ["npm", "Cargo"];
const searchTerm = ref("");
const expanded = ref<Record<Ecosystem, boolean>>({ npm: false, Cargo: false });
const projectLicenseName = computed(() => /GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(projectLicense)
  ? "GNU General Public License v3.0 (GPL-3.0)"
  : "请以仓库根目录的 LICENSE 文件为准");
const normalizedSearch = computed(() => searchTerm.value.trim().toLowerCase());
const entries = computed(() => licenseManifest.entries as LicenseEntry[]);
const filteredEntries = (ecosystem: Ecosystem) => entries.value.filter((entry) => {
  if (entry.ecosystem !== ecosystem) return false;
  if (!normalizedSearch.value) return true;
  return [entry.name, entry.version, entry.license, entry.source ?? ""].some((value) => value.toLowerCase().includes(normalizedSearch.value));
});
const totalMatches = computed(() => filteredEntries("npm").length + filteredEntries("Cargo").length);
function toggle(ecosystem: Ecosystem) {
  expanded.value[ecosystem] = !expanded.value[ecosystem];
}
</script>

<template>
  <div class="display-settings legal-content">
    <section class="settings-card">
      <h3 class="settings-card__title">软件版权声明</h3>
      <p class="settings-card__desc">SimpBangumi 项目自身代码的著作权归相应贡献者及权利人所有；未单独标注的具体权利主体，以源代码文件、提交记录和仓库声明为准。</p>
      <dl class="about-meta">
        <div><dt>当前项目许可证</dt><dd>{{ projectLicenseName }}</dd></div>
        <div><dt>使用须知</dt><dd>使用、修改或分发本项目时，请遵守仓库根目录 LICENSE 文件载明的许可证条款，并保留适用的版权与许可证声明。</dd></div>
      </dl>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">第三方开源组件声明</h3>
      <p class="settings-card__desc">以下清单由 package-lock.json 与 Cargo.lock 自动生成。许可证无法从本地依赖元数据确认时，会标记为「需要确认」。</p>
      <p class="settings-card__hint">生成时间：{{ licenseManifest.generatedAt }} · 当前匹配 {{ totalMatches }} 条</p>
      <label class="license-search">
        <span class="license-search__label">搜索组件</span>
        <input v-model="searchTerm" type="search" placeholder="名称、版本、许可证或来源" />
      </label>

      <div v-for="ecosystem in ecosystems" :key="ecosystem" class="license-group">
        <button class="license-group__header" type="button" :aria-expanded="expanded[ecosystem]" @click="toggle(ecosystem)">
          <span>{{ ecosystem === 'npm' ? 'npm 依赖' : 'Rust / Cargo 依赖' }}</span>
          <span class="license-group__meta">{{ filteredEntries(ecosystem).length }} 条 <span aria-hidden="true">{{ expanded[ecosystem] ? '−' : '+' }}</span></span>
        </button>
        <div v-if="expanded[ecosystem]" class="license-list">
          <article v-for="entry in filteredEntries(ecosystem)" :key="`${entry.ecosystem}:${entry.name}:${entry.version}`" class="license-item">
            <div class="license-item__main">
              <strong>{{ entry.name }}</strong>
              <span class="license-item__version">v{{ entry.version }}</span>
            </div>
            <div class="license-item__details">
              <span :class="{ 'license-item__unknown': entry.license === '需要确认' }">{{ entry.license }}</span>
              <a v-if="entry.source" :href="entry.source" target="_blank" rel="noopener noreferrer">项目来源</a>
              <span v-else class="license-item__muted">来源未声明</span>
            </div>
          </article>
          <p v-if="filteredEntries(ecosystem).length === 0" class="settings-card__hint">没有匹配的组件。</p>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">Tauri 声明</h3>
      <p class="settings-card__desc">本软件使用 Tauri 框架构建桌面客户端。Tauri 及其相关组件的版权归其作者或权利人所有，并应遵循其对应的开源许可证。</p>
      <p class="settings-card__hint">本项目与 Tauri 官方不存在合作、赞助、背书或授权关系。</p>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">第三方内容版权声明</h3>
      <p class="settings-card__desc">应用中出现的第三方番剧信息、图片、文本及其他内容（如存在）其版权归原作者、内容提供方或其他权利人所有。SimpBangumi 不拥有该等第三方内容的版权。</p>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">商标声明</h3>
      <p class="settings-card__desc">第三方名称、商标、Logo 及品牌标识归各自权利人所有。除非另有明确说明，本项目不代表与任何第三方存在官方合作、授权或隶属关系。</p>
    </section>
    <section class="settings-card">
      <h3 class="settings-card__title">其他权利与非官方声明</h3>
      <ul class="settings-card__list">
        <li>SimpBangumi 不内置、不提供、亦不分发任何 Live2D 角色模型及 Live2D Cubism SDK 核心运行时；相关资产需由用户自行合法获取并手动导入。</li>
        <li>SimpBangumi 不是 Bangumi 番组计划官方桌面客户端，与 Bangumi 官方不存在合作、赞助、背书或授权关系。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.settings-card { overflow: hidden; }
.settings-card__title { display: flex; align-items: center; gap: 10px; font-size: 16px; letter-spacing: 0.02em; }
.settings-card__title::before { width: 4px; height: 18px; border-radius: 999px; background: var(--accent); content: ""; flex: 0 0 auto; }
.settings-card__desc { max-width: 760px; line-height: 1.75; }
.about-meta { gap: 14px; }
.about-meta div { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--surface) 45%, transparent); }
.about-meta dt { margin-bottom: 4px; color: var(--text); font-size: 13px; }
.about-meta dd { margin: 0; color: var(--muted); font-size: 13px; font-weight: 400; line-height: 1.75; }
.license-search { display: grid; gap: 6px; margin: 14px 0; }
.license-search__label { color: var(--text); font-size: 13px; font-weight: 600; }
.license-search input { width: 100%; min-height: 34px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
.license-search input:focus { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 24%, transparent); }
.license-group { border-top: 1px solid var(--border); }
.license-group__header { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 12px 0; border: 0; background: transparent; color: var(--text); cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; text-align: left; }
.license-group__header:hover { color: var(--accent); }
.license-group__meta { color: var(--muted); font-size: 12px; font-weight: 400; }
.license-list { display: grid; gap: 6px; padding: 0 0 12px; }
.license-item { display: grid; gap: 5px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--border) 72%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--surface) 50%, transparent); }
.license-item__main, .license-item__details { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.license-item__main { color: var(--text); font-size: 13px; }
.license-item__version, .license-item__details { color: var(--muted); font-size: 12px; }
.license-item__details a { color: var(--accent); text-decoration: none; }
.license-item__details a:hover { text-decoration: underline; }
.license-item__unknown { color: var(--danger); font-weight: 600; }
.license-item__muted { color: var(--muted); }
.settings-card__list { display: grid; gap: 9px; margin: 12px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; line-height: 1.75; }
.settings-card__list li::marker { color: var(--accent); }
</style>