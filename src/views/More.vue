<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OneSentenceTime from "../components/OneSentenceTime.vue";

type ToolPage = "home" | "score";

interface ScoreSource {
  id: number;
  name: string;
  score: number;
  weight: number;
}

const activePage = ref<ToolPage>("home");
let nextId = 4;
const sources = ref<ScoreSource[]>([
  { id: 1, name: "Bangumi", score: 8, weight: 1 },
  { id: 2, name: "MyAnimeList", score: 8, weight: 1 },
  { id: 3, name: "AniList", score: 8, weight: 1 },
]);

const totalWeight = computed(() => sources.value.reduce((sum, source) => sum + safeNumber(source.weight), 0));
const totalScore = computed(() => {
  if (totalWeight.value <= 0) return 0;
  return sources.value.reduce((sum, source) => sum + safeNumber(source.score) * safeNumber(source.weight), 0) / totalWeight.value;
});
const totalScoreText = computed(() => totalScore.value.toFixed(2));
const scoreRollDirection = ref<"up" | "down">("up");

watch(totalScore, (next, previous) => {
  scoreRollDirection.value = next >= previous ? "up" : "down";
});

function safeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function addSource() {
  sources.value.push({ id: nextId++, name: `评分来源 ${sources.value.length + 1}`, score: 0, weight: 1 });
}

function removeSource(id: number) {
  if (sources.value.length <= 1) return;
  sources.value = sources.value.filter((source) => source.id !== id);
}

function resetSources() {
  sources.value = [
    { id: 1, name: "Bangumi", score: 8, weight: 1 },
    { id: 2, name: "MyAnimeList", score: 8, weight: 1 },
    { id: 3, name: "AniList", score: 8, weight: 1 },
  ];
  nextId = 4;
}

function contribution(source: ScoreSource): string {
  if (totalWeight.value <= 0) return "0%";
  return `${((safeNumber(source.weight) / totalWeight.value) * 100).toFixed(1)}%`;
}
</script>

<template>
  <div class="more-tools">
    <Transition name="tool-page-switch" mode="out-in">
      <template v-if="activePage === 'home'">
        <div class="more-tools__home" key="toolbox-home">
          <OneSentenceTime />
          <section class="toolbox" aria-labelledby="toolbox-title">
            <div class="toolbox__header">
              <div>
                <p class="eyebrow">Tools</p>
                <h2 id="toolbox-title">工具箱</h2>
                <p>是可能用到的妙妙小工具哦 (っ °Д °;)っ</p>
              </div>
            </div>
            <button class="toolbox-entry" type="button" @click="activePage = 'score'">
              <span class="toolbox-entry__icon" aria-hidden="true">Σ</span>
              <span class="toolbox-entry__body">
                <strong>综合评分计算器</strong>
                <span>手动输入多个评分来源和权重，计算加权综合得分。</span>
              </span>
              <span class="toolbox-entry__arrow" aria-hidden="true">→</span>
            </button>
          </section>
        </div>
      </template>

      <section v-else key="score-calculator" class="score-calculator" aria-labelledby="score-calculator-title">
        <header class="score-calculator__header">
          <button class="secondary-button" type="button" @click="activePage = 'home'">← 返回工具箱</button>
          <div>
            <p class="eyebrow">Tools / Calculator</p>
            <h2 id="score-calculator-title">综合评分计算器</h2>
            <p>为每个来源填写 0–10 分和权重，结果会按权重实时计算。</p>
          </div>
        </header>

        <div class="score-calculator__layout">
          <div class="score-calculator__form settings-card">
            <div class="score-calculator__form-header">
              <h3 class="settings-card__title">评分来源</h3>
              <button class="secondary-button" type="button" @click="addSource">＋ 添加来源</button>
            </div>
            <div class="score-source-list">
              <div v-for="source in sources" :key="source.id" class="score-source-row">
                <label class="score-source-row__name">
                  <span>来源名称</span>
                  <input v-model="source.name" class="onboarding__input" type="text" placeholder="例如：Bangumi" />
                </label>
                <label>
                  <span>评分 / 10</span>
                  <input v-model.number="source.score" class="onboarding__input score-source-row__number" type="number" min="0" max="10" step="0.1" />
                </label>
                <label>
                  <span>权重</span>
                  <input v-model.number="source.weight" class="onboarding__input score-source-row__number" type="number" min="0" step="0.1" />
                </label>
                <button class="icon-button score-source-row__remove" type="button" title="移除来源" aria-label="移除来源" :disabled="sources.length <= 1" @click="removeSource(source.id)">×</button>
              </div>
            </div>
            <div class="score-calculator__actions">
              <button class="secondary-button" type="button" @click="resetSources">恢复示例</button>
              <span class="settings-card__hint">总权重：{{ totalWeight.toFixed(1) }}</span>
            </div>
          </div>

          <aside class="score-result" aria-live="polite">
            <p class="eyebrow">Result</p>
            <h3>综合得分</h3>
            <div class="score-result__value" :class="`is-${scoreRollDirection}`">
              <span class="score-result__digits" aria-hidden="true">
                <span v-for="(character, index) in totalScoreText.split('')" :key="index" class="score-result__slot" :class="{ 'is-separator': character === '.' }">
                  <Transition :name="`rating-score-roll-${scoreRollDirection}`" mode="out-in">
                    <span :key="character" class="score-result__character">{{ character }}</span>
                  </Transition>
                </span>
              </span>
              <span class="score-result__meta"> / 10</span>
            </div>
            <p class="score-result__hint">加权平均值</p>
            <div class="score-result__breakdown">
              <div v-for="source in sources" :key="`breakdown-${source.id}`" class="score-result__item">
                <span>{{ source.name || "未命名来源" }}</span>
                <strong>{{ contribution(source) }}</strong>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </Transition>
  </div>
</template>
