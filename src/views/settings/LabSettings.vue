<script setup lang="ts">
import { computed, watch } from "vue";
import { useAppStore } from "../../stores/app";

const appStore = useAppStore();

const ratingAnomalyDetectionEnabled = computed({
  get: () => appStore.ratingAnomalyDetectionEnabled.value,
  set: (value: boolean) => appStore.setRatingAnomalyDetectionEnabled(value),
});

const collectionDistributionAnalysisEnabled = computed({
  get: () => appStore.collectionDistributionAnalysisEnabled.value,
  set: (value: boolean) => appStore.setCollectionDistributionAnalysisEnabled(value),
});

const overallWorkOpinionEnabled = computed({
  get: () => appStore.overallWorkOpinionEnabled.value,
  set: (value: boolean) => {
    if (value && !canEnableOverallWorkOpinion.value) return;
    appStore.setOverallWorkOpinionEnabled(value);
  },
});
const canEnableOverallWorkOpinion = computed(() =>
  appStore.ratingAnomalyDetectionEnabled.value && appStore.collectionDistributionAnalysisEnabled.value,
);
watch(canEnableOverallWorkOpinion, (enabled) => {
  if (!enabled && appStore.overallWorkOpinionEnabled.value) {
    appStore.setOverallWorkOpinionEnabled(false);
  }
});
</script>

<template>
  <div class="display-settings">
    <section class="settings-card lab-settings__intro">
      <div>
        <h3 class="settings-card__title">抢先体验未验证的功能。这些功能可能不稳定，亦将会被随时修改、限制或取消。</h3>
        <p class="settings-card__desc">我们将根据反馈不断调整，请发表您的宝贵意见！</p>
      </div>
    </section>

    <section class="settings-card">
      <label class="toggle-row">
        <span class="toggle-row__label">评分异常监测</span>
        <input v-model="ratingAnomalyDetectionEnabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__desc">在条目详情的评分分布下方，检查值得留意的统计形态并说明触发依据。</p>

      <!-- <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">当前检测范围</h4>
        <ul class="lab-settings__feature-list">
          <li><strong>开播前博弈</strong><span>识别期待性高分与反向低分候选；不把提前评分、排名或投票动机当作观后口碑结论。</span></li>
          <li><strong>双峰极化</strong><span>识别相隔较远、各自具有足够票数且中间低谷明显的两个评价群。</span></li>
          <li><strong>极端尖峰</strong><span>结合置信区间、主体均分和相邻票数差异，识别与自然波动不符的 1 分或 10 分聚集。</span></li>
          <li><strong>离散与断层</strong><span>检查异常高方差、孤立单点尖峰、分布缺口和汇总数据不一致。</span></li>
        </ul>
      </div>

      <p class="settings-card__hint">基础分析从 100 份评分开始，部分形态需要 150–300 份。算法会随样本量调整噪声门槛；监测结果仍不能单独证明水军或刷分。</p> -->
    </section>

    <section class="settings-card">
      <label class="toggle-row">
        <span class="toggle-row__label">收藏状态分析</span>
        <input v-model="collectionDistributionAnalysisEnabled" class="toggle-row__input" type="checkbox" role="switch" />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__desc">在收藏状态分布下方解释用户从想看、在看、搁置到看完或抛弃的流转结构。</p>

      <!-- <div class="settings-card__subsection">
        <h4 class="settings-card__subtitle">分析内容</h4>
        <ul class="lab-settings__feature-list">
          <li><strong>流转指标</strong><span>已开始用户中的完成占比、明确结局中的弃坑率，以及五种状态的分歧程度。</span></li>
          <li><strong>状态画像</strong><span>追看热潮、观望积压、完结沉淀、大量搁置、弃坑高发与口碑分流。</span></li>
          <li><strong>触发依据</strong><span>按相关人群计算比例，并展示样本量、置信区间和具体计算口径。</span></li>
        </ul>
      </div>

      <p class="settings-card__hint">至少需要 100 份收藏状态。开启配信跟踪并成功匹配动画时，算法会结合未开播、放送中或已完结状态校准判断；其他情况只描述当前截面。</p> -->
    </section>

    <section class="settings-card lab-opinion-card" :class="{ 'is-locked': !canEnableOverallWorkOpinion }">
      <label class="toggle-row">
        <span class="toggle-row__label">作品总体看法</span>
        <input
          v-model="overallWorkOpinionEnabled"
          class="toggle-row__input"
          type="checkbox"
          role="switch"
          :disabled="!canEnableOverallWorkOpinion"
        />
        <span class="toggle-row__track" />
      </label>
      <p class="settings-card__desc">综合评分异常与收藏状态两项监测，在详情页给出更易读的整体判断。</p>
      <p v-if="!canEnableOverallWorkOpinion" class="settings-card__hint">请先同时开启“评分异常监测”和“收藏状态分析”。</p>
      <p v-else class="settings-card__hint">点击详情页 - 评价中的浮球展开，不会改变原有的两项监测结果。</p>
    </section>
  </div>
</template>
