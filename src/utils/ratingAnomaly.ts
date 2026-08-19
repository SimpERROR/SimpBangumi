export type RatingAnomalyKind =
  | "pre-release-expectation"
  | "pre-release-countervote"
  | "polarization"
  | "extreme-skew"
  | "high-variance"
  | "isolated-spike"
  | "distribution-gap"
  | "data-consistency";

export interface RatingAnomalySignal {
  kind: RatingAnomalyKind;
  direction?: "low" | "high";
  title: string;
  summary: string;
  evidence: string;
  confidence: "低" | "中" | "高";
}

export interface RatingMetricInsight {
  key: "controversy" | "dispersion" | "skewness";
  name: string;
  value: string;
  label: string;
  explanation: string;
}

export interface RatingDistributionProfile {
  label: string;
  description: string;
}

export interface RatingDistributionAnalysis {
  status: "insufficient" | "clear" | "watch";
  sampleSize: number;
  mean: number;
  standardDeviation: number;
  skewness: number;
  controversyIndex: number;
  profile: RatingDistributionProfile;
  metrics: RatingMetricInsight[];
  signals: RatingAnomalySignal[];
  summary: string;
}

interface RatingDistributionInput {
  count: Record<string, number> | null | undefined;
  total?: number | null;
  score?: number | null;
}

export interface RatingDistributionContext {
  broadcastPhase?: "not-aired" | "airing" | "finished" | null;
}

const MIN_ANALYSIS_SAMPLES = 100;
const Z_95 = 1.96;

function finiteCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function wilsonInterval(successes: number, total: number): { lower: number; upper: number } {
  if (total <= 0) return { lower: 0, upper: 1 };
  const proportion = successes / total;
  const zSquared = Z_95 ** 2;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin = Z_95 * Math.sqrt(
    (proportion * (1 - proportion) / total) + zSquared / (4 * total ** 2),
  ) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function exceedsSamplingNoise(observed: number, expected: number, minimumExcess = 8): boolean {
  const excess = observed - expected;
  const standardError = Math.sqrt(Math.max(1, observed + expected));
  return excess >= minimumExcess && excess >= Z_95 * standardError;
}

/**
 * Expected distance between two random voters, normalized to 0-100.
 * The theoretical maximum is a 50/50 split between scores 1 and 10.
 */
function calculateControversyIndex(counts: number[], total: number): number {
  if (total <= 1) return 0;
  let distance = 0;
  for (let first = 0; first < counts.length; first += 1) {
    for (let second = first + 1; second < counts.length; second += 1) {
      distance += counts[first] * counts[second] * (second - first);
    }
  }
  return Math.min(100, (distance * 2 / (total * total) / 9) * 200);
}

function controversyLabel(index: number, polarized: boolean): string {
  if (index < 20) return "高度共识";
  if (index < 35) return "主流趋同";
  if (index < 50) return "众口不一";
  if (index < 65) return polarized ? "阵营交锋" : "评价分散";
  if (polarized) return "粉黑大战";
  if (index < 80) return "高度分散";
  return "几乎无共识";
}

function dispersionLabel(value: number): string {
  if (value < 0.9) return "口碑集中";
  if (value < 1.5) return "常规波动";
  if (value < 2.1) return "评价分散";
  if (value < 2.7) return "两极倾向";
  return "高度离散";
}

function skewnessLabel(value: number): string {
  if (value <= -1) return "低分离群明显";
  if (value <= -0.35) return "低分长尾";
  if (value < 0.35) return "两侧较平衡";
  if (value < 1) return "高分长尾";
  return "高分离群明显";
}

function buildMetricInsights(
  controversyIndex: number,
  standardDeviation: number,
  skewness: number,
  polarized: boolean,
): RatingMetricInsight[] {
  const typicalGap = controversyIndex * 0.045;
  return [
    {
      key: "controversy",
      name: "争议指数",
      value: controversyIndex.toFixed(0),
      label: controversyLabel(controversyIndex, polarized),
      explanation: `随机抽取两位评分者，评分平均相差约 ${typicalGap.toFixed(1)} 分。`,
    },
    {
      key: "dispersion",
      name: "标准差",
      value: standardDeviation.toFixed(2),
      label: dispersionLabel(standardDeviation),
      explanation: `单个评分偏离平均分的典型幅度约为 ${standardDeviation.toFixed(1)} 分。`,
    },
    {
      key: "skewness",
      name: "偏度",
      value: skewness.toFixed(2),
      label: skewnessLabel(skewness),
      explanation: Math.abs(skewness) < 0.35
        ? "高低分两侧相对平衡，没有明显单侧长尾。"
        : skewness < 0
          ? "少量低分把分布尾部拉向左侧。"
          : "少量高分把分布尾部拉向右侧。",
    },
  ];
}

function buildProfile(
  signals: RatingAnomalySignal[],
  controversyIndex: number,
  standardDeviation: number,
  skewness: number,
): RatingDistributionProfile {
  const has = (kind: RatingAnomalyKind) => signals.some((signal) => signal.kind === kind);
  if (has("pre-release-expectation") && has("pre-release-countervote")) {
    return { label: "上映前评分博弈", description: "期待性高分与疑似反向低分同时出现，当前均分主要反映预期和立场，不能代表观后口碑。" };
  }
  if (has("pre-release-expectation")) {
    return { label: "上映前期待聚集", description: "作品尚未开播，高分更可能表达期待、原作情怀或企划关注度，而非实际观看评价。" };
  }
  if (has("pre-release-countervote")) {
    return { label: "上映前低分反制候选", description: "极低分在开播前形成不连续聚集，可能包含对提前高分的反向制衡，但无法仅凭分布确认动机。" };
  }
  if (has("polarization") && has("extreme-skew")) {
    const extremeDirection = signals.find((signal) => signal.kind === "extreme-skew")?.direction;
    return extremeDirection === "low"
      ? { label: "疑似低分冲击", description: "主流评价与孤立低分阵营同时存在，一星集中票放大了对立程度。" }
      : { label: "疑似高分护航", description: "主流评价与孤立满分阵营同时存在，十分集中票放大了对立程度。" };
  }
  if (has("polarization")) {
    return controversyIndex >= 65
      ? { label: "粉黑大战", description: "评分形成距离较远的两个阵营，中间立场相对稀少。" }
      : { label: "两派争议", description: "分布中存在两个可辨认的评价群，但对立强度仍有限。" };
  }
  if (has("extreme-skew")) {
    const extremeDirection = signals.find((signal) => signal.kind === "extreme-skew")?.direction;
    return extremeDirection === "low"
      ? { label: "低分突刺", description: "一星附近出现不连续的集中票，明显拉出低分长尾。" }
      : { label: "满分簇拥", description: "十分附近出现不连续的集中票，明显拉出高分长尾。" };
  }
  if (has("isolated-spike")) return { label: "单点聚集", description: "某个具体分数吸收了远高于相邻档位的票数。" };
  if (has("distribution-gap")) return { label: "分布断层", description: "相邻评分之间出现难以由平滑偏好解释的票数缺口。" };
  if (has("data-consistency")) return { label: "数据待同步", description: "评分汇总与分布重算结果不一致，当前画像可能受数据延迟影响。" };
  if (standardDeviation >= 2.1) return { label: "众口难调", description: "评价分布较宽，单看平均分会掩盖明显的意见差异。" };
  if (Math.abs(skewness) >= 0.75) {
    return { label: skewness < 0 ? "少量差评拉尾" : "少量好评拉尾", description: "主体评价较集中，但一侧仍有少量远离主流的评分。" };
  }
  if (controversyIndex < 35) return { label: "口碑趋同", description: "评分大多聚集在相近区间，平均分具有较好代表性。" };
  return { label: "常规分布", description: "存在自然意见差异，但尚未形成突出的异常形态。" };
}

function findSeparatedModes(counts: number[], total: number) {
  const smoothed = counts.map((value, index) => (
    value * 0.5
      + (counts[index - 1] ?? value) * 0.25
      + (counts[index + 1] ?? value) * 0.25
  ));
  const peaks = smoothed
    .map((value, index) => ({ index, value }))
    .filter(({ index, value }) => (
      value >= (smoothed[index - 1] ?? -1)
      && value >= (smoothed[index + 1] ?? -1)
    ));

  let best: { first: number; second: number; valleyRatio: number; firstMass: number; secondMass: number } | null = null;
  for (let left = 0; left < peaks.length; left += 1) {
    for (let right = left + 1; right < peaks.length; right += 1) {
      const first = peaks[left].index;
      const second = peaks[right].index;
      if (second - first < 4) continue;
      const firstMass = counts.slice(Math.max(0, first - 1), Math.min(10, first + 2)).reduce((sum, value) => sum + value, 0) / total;
      const secondMass = counts.slice(Math.max(0, second - 1), Math.min(10, second + 2)).reduce((sum, value) => sum + value, 0) / total;
      const valley = Math.min(...smoothed.slice(first + 1, second));
      const valleyRatio = valley / Math.max(1, Math.min(peaks[left].value, peaks[right].value));
      const minimumModeMass = Math.max(0.1, 20 / total);
      const valleyExpected = Math.min(peaks[left].value, peaks[right].value);
      const valleyIsMeaningful = exceedsSamplingNoise(valleyExpected, valley, 8);
      if (firstMass < minimumModeMass || secondMass < minimumModeMass || valleyRatio > 0.62 || !valleyIsMeaningful) continue;
      if (!best || firstMass + secondMass > best.firstMass + best.secondMass) {
        best = { first, second, valleyRatio, firstMass, secondMass };
      }
    }
  }
  return best;
}

export function analyzeRatingDistribution(input: RatingDistributionInput, context: RatingDistributionContext = {}): RatingDistributionAnalysis {
  const counts = Array.from({ length: 10 }, (_, index) => finiteCount(input.count?.[String(index + 1)]));
  const sampleSize = counts.reduce((sum, value) => sum + value, 0);
  const emptyResult: RatingDistributionAnalysis = {
    status: "insufficient",
    sampleSize,
    mean: 0,
    standardDeviation: 0,
    skewness: 0,
    controversyIndex: 0,
    profile: { label: "样本积累中", description: "评分数量不足，暂不生成分布画像。" },
    metrics: [],
    signals: [],
    summary: `至少需要 ${MIN_ANALYSIS_SAMPLES} 份评分，当前样本不足，暂不判断。`,
  };
  if (sampleSize === 0) return emptyResult;

  const mean = counts.reduce((sum, count, index) => sum + count * (index + 1), 0) / sampleSize;
  const variance = counts.reduce((sum, count, index) => sum + count * ((index + 1) - mean) ** 2, 0) / sampleSize;
  const standardDeviation = Math.sqrt(variance);
  const skewness = standardDeviation > 0
    ? counts.reduce((sum, count, index) => sum + count * (((index + 1) - mean) / standardDeviation) ** 3, 0) / sampleSize
    : 0;
  const controversyIndex = calculateControversyIndex(counts, sampleSize);

  if (sampleSize < MIN_ANALYSIS_SAMPLES) {
    return { ...emptyResult, mean, standardDeviation, skewness, controversyIndex };
  }

  const shares = counts.map((value) => value / sampleSize);
  const signals: RatingAnomalySignal[] = [];
  const reportedTotal = finiteCount(input.total);
  const reportedScore = Number(input.score);
  const totalDifference = reportedTotal > 0 ? Math.abs(reportedTotal - sampleSize) / Math.max(reportedTotal, sampleSize) : 0;
  const scoreDifference = Number.isFinite(reportedScore) && reportedScore > 0 ? Math.abs(reportedScore - mean) : 0;
  const distributionReliable = totalDifference < 0.05 && scoreDifference < 0.3;

  if (totalDifference >= 0.02 || scoreDifference >= 0.15) {
    signals.push({
      kind: "data-consistency",
      title: "评分汇总不一致",
      summary: distributionReliable
        ? "页面汇总值与分布重算结果略有差异，可能处于数据同步窗口。"
        : "页面汇总值与分布重算结果明显不同，已暂停其他异常判定。",
      evidence: `分布合计 ${sampleSize.toFixed(0)} 票、重算均分 ${mean.toFixed(2)}；暂不据此判断投票行为。`,
      confidence: distributionReliable ? "中" : "高",
    });
  }

  if (!distributionReliable) {
    return {
      status: "watch",
      sampleSize,
      mean,
      standardDeviation,
      skewness,
      controversyIndex,
      profile: buildProfile(signals, controversyIndex, standardDeviation, skewness),
      metrics: buildMetricInsights(controversyIndex, standardDeviation, skewness, false),
      signals,
      summary: "评分汇总与分布尚未同步，已暂停分布异常判定。",
    };
  }

  if (context.broadcastPhase === "not-aired") {
    const highVotes = counts.slice(7).reduce((sum, value) => sum + value, 0);
    const lowVotes = counts.slice(0, 3).reduce((sum, value) => sum + value, 0);
    const highInterval = wilsonInterval(highVotes, sampleSize);
    const lowInterval = wilsonInterval(lowVotes, sampleSize);
    const lowNeighborBaseline = (counts[3] + counts[4] + counts[5]) / 3;
    const expectationCluster = sampleSize >= 30 && highInterval.lower >= 0.5;
    const countervoteCandidate = sampleSize >= 50
      && lowVotes >= 5
      && lowInterval.lower >= 0.015
      && (counts[0] >= Math.max(3, counts[1] * 1.5) || lowVotes >= lowNeighborBaseline * 1.5)
      && exceedsSamplingNoise(lowVotes, lowNeighborBaseline, 3);

    if (expectationCluster) {
      signals.push({
        kind: "pre-release-expectation",
        direction: "high",
        title: "开播前期待性高分聚集",
        summary: "作品尚未开播，8–10 分已占据多数；这些票更适合解释为期待强度，不能作为成片口碑。",
        evidence: `8–10 分共 ${highVotes.toFixed(0)} 票，占 ${formatPercent(highVotes / sampleSize)}；95% 置信区间下界为 ${formatPercent(highInterval.lower)}。`,
        confidence: sampleSize >= 200 && highInterval.lower >= 0.7 ? "高" : sampleSize >= 80 ? "中" : "低",
      });
    }
    if (countervoteCandidate) {
      signals.push({
        kind: "pre-release-countervote",
        direction: "low",
        title: "开播前反向压分候选",
        summary: "在大量提前高分之外，低分端也出现了不连续聚集；其中可能包含反感票或用于抵消高分的反向投票。",
        evidence: `1–3 分共 ${lowVotes.toFixed(0)} 票，占 ${formatPercent(lowVotes / sampleSize)}；1 分 ${counts[0].toFixed(0)} 票，相邻 2 分 ${counts[1].toFixed(0)} 票。仅凭票型无法确认投票动机。`,
        confidence: sampleSize >= 300 && lowInterval.lower >= 0.04 ? "中" : "低",
      });
    }
    if (!signals.some((signal) => signal.kind.startsWith("pre-release-"))) {
      signals.push({
        kind: "pre-release-expectation",
        title: "开播前评分样本",
        summary: "作品尚未开播，现有评分缺少实际观看基础，暂不执行常规口碑异常判定。",
        evidence: `当前共 ${sampleSize.toFixed(0)} 票；开播后需重新观察评分分布与样本变化。`,
        confidence: "低",
      });
    }

    const preReleaseSignals = signals.filter((signal) => signal.kind === "data-consistency" || signal.kind.startsWith("pre-release-"));
    const polarized = expectationCluster && countervoteCandidate;
    return {
      status: "watch",
      sampleSize,
      mean,
      standardDeviation,
      skewness,
      controversyIndex,
      profile: buildProfile(preReleaseSignals, controversyIndex, standardDeviation, skewness),
      metrics: buildMetricInsights(controversyIndex, standardDeviation, skewness, polarized),
      signals: preReleaseSignals,
      summary: polarized
        ? "检测到开播前期待性高分与反向低分候选。当前分数反映预期博弈，不代表观后口碑。"
        : "作品尚未开播，现有评分按预期性投票解读，不参与常规口碑异常判断。",
    };
  }

  const modes = findSeparatedModes(counts, sampleSize);
  if (modes && controversyIndex >= 45) {
    signals.push({
      kind: "polarization",
      title: "双峰极化",
      summary: `${modes.first + 1} 分与 ${modes.second + 1} 分附近形成相互分离的评价群。`,
      evidence: `两侧各占 ${formatPercent(modes.firstMass)} / ${formatPercent(modes.secondMass)}，争议指数 ${controversyIndex.toFixed(0)} / 100。`,
      confidence: modes.valleyRatio <= 0.35 && sampleSize >= 800
        ? "高"
        : modes.valleyRatio <= 0.52 && sampleSize >= 300 ? "中" : "低",
    });
  }

  // An extreme vote is suspicious only when it is both numerous and isolated
  // from the adjacent bucket. Ordinary positive/negative skew does not qualify.
  const lowBaseline = (counts[1] + counts[2] + counts[3]) / 3;
  const highBaseline = (counts[7] + counts[8]) / 2;
  const meanWithoutLow = sampleSize > counts[0]
    ? (mean * sampleSize - counts[0]) / (sampleSize - counts[0])
    : 1;
  const meanWithoutHigh = sampleSize > counts[9]
    ? (mean * sampleSize - counts[9] * 10) / (sampleSize - counts[9])
    : 10;
  const lowExtreme = sampleSize >= 150
    && wilsonInterval(counts[0], sampleSize).lower >= 0.045
    && counts[0] >= counts[1] * 1.8
    && counts[0] >= lowBaseline * 1.35
    && exceedsSamplingNoise(counts[0], lowBaseline)
    && meanWithoutLow >= 5.5;
  const highExtreme = sampleSize >= 250
    && wilsonInterval(counts[9], sampleSize).lower >= 0.14
    && counts[9] >= counts[8] * 2
    && counts[9] >= highBaseline * 1.75
    && exceedsSamplingNoise(counts[9], highBaseline, 12)
    && meanWithoutHigh <= 8.6;
  if (lowExtreme || highExtreme) {
    const score = lowExtreme ? 1 : 10;
    const share = lowExtreme ? shares[0] : shares[9];
    signals.push({
      kind: "extreme-skew",
      direction: lowExtreme ? "low" : "high",
      title: "极端分离群偏度",
      summary: `${score} 分票数形成与相邻分数不连续的尖峰，可能存在集中打分影响。`,
      evidence: `${score} 分占 ${formatPercent(share)}，偏度 ${skewness.toFixed(2)}；仅凭分布不能认定刷分。`,
      confidence: share >= (lowExtreme ? 0.18 : 0.38) && sampleSize >= 1500
        ? "高"
        : share >= (lowExtreme ? 0.10 : 0.25) && sampleSize >= 500 ? "中" : "低",
    });
  }

  const tailsShare = shares.slice(0, 3).reduce((sum, value) => sum + value, 0)
    + shares.slice(7).reduce((sum, value) => sum + value, 0);
  if (standardDeviation >= 2 && tailsShare >= 0.45) {
    signals.push({
      kind: "high-variance",
      title: "评分离散度较高",
      summary: "评分分散在相距较远的区间，平均分对典型观感的代表性可能较弱。",
      evidence: `标准差 ${standardDeviation.toFixed(2)}，两端区间合计 ${formatPercent(tailsShare)}。`,
      confidence: standardDeviation >= 2.8 && sampleSize >= 800
        ? "高"
        : standardDeviation >= 2.4 && sampleSize >= 300 ? "中" : "低",
    });
  }

  if (sampleSize >= 300) {
    const isolated = counts
      .map((value, index) => ({ index, value }))
      .slice(1, 9)
      .filter(({ index, value }) => (
        wilsonInterval(value, sampleSize).lower >= 0.11
        && value >= ((counts[index - 1] + counts[index + 1]) / 2) * 2.25
        && exceedsSamplingNoise(value, (counts[index - 1] + counts[index + 1]) / 2, 12)
      ))
      .sort((first, second) => second.value - first.value)[0];
    if (isolated) {
      signals.push({
        kind: "isolated-spike",
        title: "孤立评分尖峰",
        summary: `${isolated.index + 1} 分的集中度明显高于相邻分数，分布呈现不自然的单点堆积。`,
        evidence: `该分数占 ${formatPercent(isolated.value / sampleSize)}，至少是两侧平均票数的 2.25 倍。`,
        confidence: isolated.value / sampleSize >= 0.32 && sampleSize >= 1500
          ? "高"
          : isolated.value / sampleSize >= 0.22 && sampleSize >= 800 ? "中" : "低",
      });
    }
  }

  if (!modes && sampleSize >= 200) {
    const gap = counts
      .map((value, index) => ({ index, value }))
      .slice(1, 9)
      .find(({ index, value }) => (
        wilsonInterval(counts[index - 1], sampleSize).lower >= 0.02
        && wilsonInterval(counts[index + 1], sampleSize).lower >= 0.02
        && value <= ((counts[index - 1] + counts[index + 1]) / 2) * 0.25
        && exceedsSamplingNoise((counts[index - 1] + counts[index + 1]) / 2, value, 8)
      ));
    if (gap) {
      signals.push({
        kind: "distribution-gap",
        title: "分布出现断层",
        summary: `${gap.index + 1} 分票数远低于两侧，可能是特殊投票行为或数据缺口。`,
        evidence: `该档仅 ${gap.value.toFixed(0)} 票，而相邻两档均超过总票数的 2.5%。`,
        confidence: sampleSize >= 1200 ? "高" : sampleSize >= 500 ? "中" : "低",
      });
    }
  }

  const polarized = signals.some((signal) => signal.kind === "polarization");
  return {
    status: signals.length > 0 ? "watch" : "clear",
    sampleSize,
    mean,
    standardDeviation,
    skewness,
    controversyIndex,
    profile: buildProfile(signals, controversyIndex, standardDeviation, skewness),
    metrics: buildMetricInsights(controversyIndex, standardDeviation, skewness, polarized),
    signals,
    summary: signals.length > 0
      ? `检测到 ${signals.length} 项需要留意的分布信号。它们是统计提示，不等同于刷分结论。`
      : "当前未发现突出的评分分布异常。",
  };
}
