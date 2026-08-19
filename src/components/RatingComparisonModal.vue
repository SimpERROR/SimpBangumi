<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  computeRatingWeights,
  ratingComparisonConfig,
  PLATFORM_LABELS,
  type PlatformRatingEntry,
  type ExternalPlatformId,
  type PlatformWeightResult,
} from "../utils/ratingComparison";

const props = defineProps<{
  visible: boolean;
  bangumiScore: number;
  loading: boolean;
  entries: Partial<Record<ExternalPlatformId, PlatformRatingEntry | null>>;
  errors: Partial<Record<ExternalPlatformId, string>>;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const showFormula = ref(false);

const result = computed(() => computeRatingWeights(props.bangumiScore, props.entries, ratingComparisonConfig.smartWeight));

const unavailablePlatforms = computed(() =>
  ratingComparisonConfig.platforms
    .filter((p) => !props.entries[p])
    .map((p) => ({ platform: p, reason: shortReason(props.errors[p]) })),
);

function shortReason(reason?: string): string {
  if (!reason) return "暂无数据";
  if (/未配置|暂无评分|未找到|未在|未获取|网页抓取|接口|访问|获取失败/u.test(reason)) {
    return "暂无评分或暂时不可用";
  }
  return reason.length > 18 ? `${reason.slice(0, 18)}…` : reason;
}

function platformRow(p: PlatformWeightResult) {
  return {
    label: PLATFORM_LABELS[p.platform],
    ...p,
  };
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      showFormula.value = false;
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="link-confirm">
      <div v-if="visible" class="overlay rating-compare-overlay" @click.self="emit('close')">
        <div class="modal rating-compare-modal">
          <h3>综合评分构成</h3>

          <div v-if="loading" class="rating-compare__loading">正在获取各平台评分…</div>

          <template v-else>
            <p class="rating-compare__aggregate">
              综合评分 <strong>{{ result.aggregateScore > 0 ? result.aggregateScore.toFixed(1) : "暂无" }}</strong>
              <span class="rating-compare__aggregate-meta">/ 10</span>
            </p>

            <ul class="rating-compare__list">
              <li v-for="p in result.platforms" :key="p.platform" class="rating-compare__row">
                <div class="rating-compare__row-head">
                  <span class="rating-compare__platform">{{ PLATFORM_LABELS[p.platform] }}</span>
                  <span class="rating-compare__score">{{ p.score.toFixed(1) }}</span>
                </div>
                <div class="rating-compare__bar">
                  <span class="rating-compare__bar-fill" :style="{ width: `${(p.score / 10) * 100}%` }"></span>
                </div>
                <div class="rating-compare__row-foot">
                  <span>权重 {{ p.weight.toFixed(2) }} · 占比 {{ p.contributionPercent.toFixed(0) }}%</span>
                  <span class="rating-compare__reason">{{ p.reason }}</span>
                </div>
              </li>
              <li v-if="!result.platforms.length" class="rating-compare__empty">暂无可用的平台评分数据</li>
              <li v-for="u in unavailablePlatforms" :key="`unavailable-${u.platform}`" class="rating-compare__row rating-compare__row--unavailable">
                <div class="rating-compare__row-head">
                  <span class="rating-compare__platform">{{ PLATFORM_LABELS[u.platform] }}</span>
                  <span class="rating-compare__score">未获取</span>
                </div>
                <p class="rating-compare__reason">{{ u.reason }}</p>
              </li>
            </ul>

            <button type="button" class="rating-compare__formula-toggle" @click="showFormula = !showFormula">
              ⓘ 评分怎么算？
            </button>
            <div v-if="showFormula" class="rating-compare__formula">
              <p>
                综合评分 = Σ(评分 × 权重) / Σ(权重)。Bangumi 权重固定为 1，始终最高。
              </p>
              <p v-if="ratingComparisonConfig.smartWeight">
                已启用智能权重：参考票数、平台可靠性和与 Bangumi 的差异动态计算，外部平台权重为 0.12～0.82。
              </p>
              <p v-else>智能权重已关闭：其他平台统一使用权重 0.55。</p>
            </div>
          </template>

          <div class="modal__actions">
            <button class="secondary-button" type="button" @click="emit('close')">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.rating-compare-modal {
  max-width: 460px;
  width: 92vw;
}
.rating-compare__loading {
  padding: 24px 0;
  text-align: center;
  color: var(--text-secondary, #888);
}
.rating-compare__aggregate {
  font-size: 15px;
  margin: 4px 0 12px;
}
.rating-compare__aggregate strong {
  font-size: 22px;
  margin-left: 6px;
}
.rating-compare__aggregate-meta {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin-left: 2px;
}
.rating-compare__list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rating-compare__scale {
  display: flex;
  justify-content: space-between;
  margin: 2px 0 -7px;
  padding-left: 1px;
  color: var(--text-secondary, #888);
  font-size: 10px;
}
.rating-compare__row-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.rating-compare__row--unavailable {
  opacity: 0.65;
}
.rating-compare__row--unavailable .rating-compare__score {
  font-weight: 400;
  font-size: 12px;
  color: var(--text-secondary, #888);
}
.rating-compare__platform {
  font-weight: 600;
}
.rating-compare__bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.2);
  margin: 4px 0;
  overflow: hidden;
}
.rating-compare__bar-fill {
  display: block;
  height: 100%;
  background: var(--accent-color, #3b82f6);
  border-radius: 3px;
  transform-origin: left center;
  animation: rating-compare-bar-in 520ms cubic-bezier(.2,.8,.2,1) both;
  transition: width 360ms ease;
}
@keyframes rating-compare-bar-in {
  from { transform: scaleX(0); opacity: .45; }
  to { transform: scaleX(1); opacity: 1; }
}
.rating-compare__row-foot {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #888);
  gap: 8px;
}
.rating-compare__row-foot > span {
  min-width: 0;
}
.rating-compare__row-foot .rating-compare__reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.rating-compare__row--unavailable .rating-compare__reason {
  margin: 4px 0 0;
}
.rating-compare__empty {
  text-align: center;
  color: var(--text-secondary, #888);
  padding: 12px 0;
}
.rating-compare__formula-toggle {
  background: none;
  border: none;
  color: var(--accent-color, #3b82f6);
  cursor: pointer;
  font-size: 12.5px;
  padding: 4px 0;
  text-align: left;
}
.rating-compare__formula {
  font-size: 12.5px;
  color: var(--text-secondary, #888);
  background: rgba(127, 127, 127, 0.08);
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.6;
}
.rating-compare__formula p + p {
  margin-top: 6px;
}
</style>
