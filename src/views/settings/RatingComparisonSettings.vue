<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ratingComparisonConfig as config,
  PLATFORM_LABELS,
  type ExternalPlatformId,
} from "../../utils/ratingComparison";

interface PlatformMeta {
  id: ExternalPlatformId;
  desc: string;
  sourceField?: "tmdbSource" | "imdbSource";
  keyField?: "tmdbApiKey" | "omdbApiKey";
  keyLabel?: string;
  guideLabel?: string;
  guideUrl?: string;
}

const ALL_PLATFORMS: PlatformMeta[] = [
  { id: "mal", desc: "已内置 Tenrai/MAL 匹配数据，无需额外配置。" },
  { id: "anilist", desc: "公开 GraphQL 接口，无需额外配置。" },
  {
    id: "imdb",
    desc: "无官方免费接口，可选择网页抓取（无需配置）或通过 OMDb API 获取（需要免费 Key，更稳定）。",
    sourceField: "imdbSource",
    keyField: "omdbApiKey",
    keyLabel: "OMDb API Key",
    guideLabel: "前往 omdbapi.com 免费申请",
    guideUrl: "https://www.omdbapi.com/apikey.aspx",
  },
  {
    id: "tmdb",
    desc: "可选择网页抓取（无需配置）或通过官方 API 获取（需要免费 Key，更稳定）。",
    sourceField: "tmdbSource",
    keyField: "tmdbApiKey",
    keyLabel: "TMDB API Key",
    guideLabel: "前往 themoviedb.org 免费申请",
    guideUrl: "https://www.themoviedb.org/settings/api",
  },
];

function isEnabled(platform: ExternalPlatformId) {
  return config.platforms.includes(platform);
}

function togglePlatform(platform: ExternalPlatformId) {
  const set = new Set(config.platforms);
  if (set.has(platform)) {
    set.delete(platform);
  } else {
    set.add(platform);
  }
  config.platforms = Array.from(set);
}

async function openGuideLink(url: string) {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

const enabledPlatformCount = computed(() => config.platforms.length);

// 已填充的密钥默认以掩码显示，只有用户主动点击才可见。
const revealedKey = ref<ExternalPlatformId | null>(null);

function toggleKeyVisibility(platform: ExternalPlatformId) {
  revealedKey.value = revealedKey.value === platform ? null : platform;
}
</script>

<template>
  <div class="display-settings">
    <section class="settings-card">
      <h3 class="settings-card__title">多平台评分比对</h3>
      <p class="settings-card__desc">
        在条目详情页将 Bangumi 评分与其他平台评分综合展示。开启后仅在你打开详情页时后台异步获取，不影响列表加载速度。
      </p>

      <label class="toggle-row">
        <span class="toggle-row__label">启用多平台评分比对</span>
        <input v-model="config.enabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
    </section>

    <template v-if="config.enabled">
      <section class="settings-card">
        <h3 class="settings-card__title">参与比对的平台</h3>
        <p class="settings-card__desc">Bangumi 作为本客户端的主平台，始终参与比对，不可关闭。已选 {{ enabledPlatformCount }} 个额外平台。</p>

        <div class="rating-platform-list">
          <div class="rating-platform-card rating-platform-card--locked">
            <div class="rating-platform-card__head">
              <span class="rating-platform-card__name">Bangumi</span>
              <label class="toggle-row rating-platform-card__toggle">
                <input checked disabled class="toggle-row__input" type="checkbox" role="switch" />
                <span class="toggle-row__track" />
              </label>
            </div>
            <p class="rating-platform-card__desc">本客户端的主评分来源，始终启用。</p>
          </div>

          <div v-for="p in ALL_PLATFORMS" :key="p.id" class="rating-platform-card" :class="{ 'rating-platform-card--active': isEnabled(p.id) }">
            <div class="rating-platform-card__head">
              <span class="rating-platform-card__name">{{ PLATFORM_LABELS[p.id] }}</span>
              <label class="toggle-row rating-platform-card__toggle">
                <input
                  :checked="isEnabled(p.id)"
                  class="toggle-row__input"
                  type="checkbox"
                  role="switch"
                  @change="togglePlatform(p.id)"
                />
                <span class="toggle-row__track" />
              </label>
            </div>
            <p class="rating-platform-card__desc">{{ p.desc }}</p>

            <div v-if="isEnabled(p.id) && p.sourceField" class="rating-platform-card__source">
              <label class="rating-source-option">
                <input v-model="config[p.sourceField]" type="radio" value="scrape" :name="`${p.id}-source`" />
                <span>网页抓取（无需配置）</span>
              </label>
              <label class="rating-source-option">
                <input v-model="config[p.sourceField]" type="radio" value="api" :name="`${p.id}-source`" />
                <span>官方 API（更稳定，需要 Key）</span>
              </label>
            </div>

            <div v-if="isEnabled(p.id) && p.keyField && config[p.sourceField!] === 'api'" class="rating-platform-card__key">
              <label class="settings-card__field-label">{{ p.keyLabel }}</label>
              <div class="rating-key-input-row">
                <input
                  v-model="config[p.keyField]"
                  :type="revealedKey === p.id ? 'text' : 'password'"
                  class="onboarding__input"
                  :placeholder="`填入你自己的 ${p.keyLabel}`"
                  autocomplete="off"
                />
                <button type="button" class="secondary-button rating-key-reveal-btn" @click="toggleKeyVisibility(p.id)">
                  {{ revealedKey === p.id ? "隐藏" : "显示" }}
                </button>
              </div>
              <button v-if="p.guideUrl" type="button" class="rating-guide-link" @click="openGuideLink(p.guideUrl)">
                {{ p.guideLabel }} ↗
              </button>
              <p v-if="p.id === 'tmdb'" class="settings-card__hint">此处填入 API 密钥 即可。密钥仅保存在本机，不会上传。</p>
              <p v-if="p.id === 'imdb'" class="settings-card__hint">密钥仅保存在本机，不会上传。</p>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <h3 class="settings-card__title">智能权重分配</h3>
        <p class="settings-card__desc">根据各平台评分的样本量（投票/评价数）自动分配权重。</p>
        <label class="toggle-row">
          <span class="toggle-row__label">启用智能权重分配</span>
          <input v-model="config.smartWeight" class="toggle-row__input" type="checkbox" role="switch" />
          <span class="toggle-row__track" />
        </label>
      </section>

      <section class="settings-card">
        <h3 class="settings-card__title">评分视图</h3>
        <p class="settings-card__desc">综合评分数据准备好后，条目详情页默认会自动切换到综合评分视图。</p>
        <label class="toggle-row">
          <span class="toggle-row__label">不要自动切换到综合评分</span>
          <input v-model="config.disableAutoSwitchToAggregate" class="toggle-row__input" type="checkbox" role="switch" />
          <span class="toggle-row__track" />
        </label>
      </section>
    </template>

    <div class="settings-page__footer-note">
      <div class="footer-note__header">
        <b>说明</b>
      </div>
      <ul class="footer-note__list">
        <li>Bangumi 评分权重固定为 1，始终占最高比例，不参与权重调配。</li>
        <li>关闭智能权重分配后，其余平台统一使用固定权重。</li>
        <li>可在详情页「综合评分」旁的「查看详细分析」中查看每个平台的具体权重与计算方式。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.rating-platform-list {
  display: grid;
  gap: 10px;
  margin-top: 4px;
}

.rating-platform-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  display: grid;
  gap: 6px;
  background: var(--surface-muted);
  transition: border-color 0.15s ease;
}

.rating-platform-card--active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.rating-platform-card--locked {
  opacity: 0.7;
}

.rating-platform-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rating-platform-card__name {
  font-size: 13px;
  font-weight: 700;
}

.rating-platform-card__toggle {
  margin: 0;
}

.rating-platform-card__desc {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.rating-platform-card__key {
  display: grid;
  gap: 6px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.rating-key-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.rating-key-input-row .onboarding__input {
  flex: 1;
}

.rating-key-reveal-btn {
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 12px;
}

.rating-platform-card__source {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.rating-source-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.rating-source-option input[type="radio"] {
  accent-color: var(--accent);
  cursor: pointer;
}

.rating-guide-link {
  justify-self: start;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.rating-guide-link:hover {
  text-decoration: underline;
}
</style>
