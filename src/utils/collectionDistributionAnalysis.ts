export type CollectionStateKey = "wish" | "collect" | "doing" | "on_hold" | "dropped";

export interface CollectionDistributionInput {
  wish?: number | null;
  collect?: number | null;
  doing?: number | null;
  on_hold?: number | null;
  dropped?: number | null;
}

export type CollectionBroadcastPhase = "not-aired" | "airing" | "finished";

export interface CollectionDistributionContext {
  broadcastPhase?: CollectionBroadcastPhase | null;
}

export interface CollectionMetricInsight {
  key: "completion" | "dropout" | "diversity";
  name: string;
  value: string;
  label: string;
  explanation: string;
}

export interface CollectionDistributionSignal {
  kind: "wish-backlog" | "active-surge" | "on-hold" | "dropout" | "outcome-split";
  title: string;
  summary: string;
  evidence: string;
  confidence: "低" | "中" | "高";
}

export interface CollectionDistributionAnalysis {
  status: "insufficient" | "clear" | "watch";
  sampleSize: number;
  profile: { label: string; description: string };
  metrics: CollectionMetricInsight[];
  signals: CollectionDistributionSignal[];
  summary: string;
}

const MIN_COLLECTION_SAMPLES = 100;
const Z_95 = 1.96;

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percent(value: number): string {
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

function completionLabel(value: number, broadcastPhase?: CollectionBroadcastPhase | null): string {
  if (broadcastPhase === "not-aired") return "尚未开播";
  if (broadcastPhase === "airing" && value < 0.45) return "放送进行中";
  if (value >= 0.7) return "完结充分";
  if (value >= 0.45) return "稳步沉淀";
  if (value >= 0.25) return "持续消化";
  return "尚在早期";
}

function dropoutLabel(value: number): string {
  if (value < 0.08) return "弃坑极少";
  if (value < 0.18) return "流失较低";
  if (value < 0.32) return "存在流失";
  if (value < 0.5) return "弃坑偏高";
  return "弃坑主导";
}

function diversityLabel(value: number): string {
  if (value < 30) return "单一状态主导";
  if (value < 55) return "倾向较明确";
  if (value < 75) return "多状态并存";
  return "状态高度分散";
}

export function analyzeCollectionDistribution(
  input: CollectionDistributionInput | null | undefined,
  context: CollectionDistributionContext = {},
): CollectionDistributionAnalysis {
  const counts: Record<CollectionStateKey, number> = {
    wish: safeCount(input?.wish),
    collect: safeCount(input?.collect),
    doing: safeCount(input?.doing),
    on_hold: safeCount(input?.on_hold),
    dropped: safeCount(input?.dropped),
  };
  const values = Object.values(counts);
  const sampleSize = values.reduce((sum, value) => sum + value, 0);
  const broadcastPhase = context.broadcastPhase ?? null;
  if (sampleSize < MIN_COLLECTION_SAMPLES) {
    return {
      status: "insufficient",
      sampleSize,
      profile: { label: "样本积累中", description: "收藏人数不足，暂不生成状态画像。" },
      metrics: [],
      signals: [],
      summary: `至少需要 ${MIN_COLLECTION_SAMPLES} 份收藏状态，当前样本不足，暂不分析。`,
    };
  }

  const shares = Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, value / sampleSize]),
  ) as Record<CollectionStateKey, number>;
  const started = counts.collect + counts.doing + counts.on_hold + counts.dropped;
  const decided = counts.collect + counts.dropped;
  const completionRate = started > 0 ? counts.collect / started : 0;
  const dropoutRate = decided > 0 ? counts.dropped / decided : 0;
  const activeRate = started > 0 ? counts.doing / started : 0;
  const onHoldRate = started > 0 ? counts.on_hold / started : 0;
  const startRate = sampleSize > 0 ? started / sampleSize : 0;
  const entropy = values.reduce((sum, value) => {
    if (value <= 0) return sum;
    const share = value / sampleSize;
    return sum - share * Math.log(share);
  }, 0);
  const diversityIndex = entropy / Math.log(values.length) * 100;

  const metrics: CollectionMetricInsight[] = [
    {
      key: "completion",
      name: "完成占比",
      value: started > 0 ? percent(completionRate) : "--",
      label: started > 0 ? completionLabel(completionRate, broadcastPhase) : "暂无进度",
      explanation: started > 0
        ? `在 ${started.toFixed(0)} 位已开始接触的用户中，当前有 ${counts.collect.toFixed(0)} 位标记为完成${broadcastPhase === "airing" ? "；作品仍在放送，此比例会自然偏低" : ""}。`
        : "目前只有想看收藏，尚未形成可计算的观看或游玩进度。",
    },
    {
      key: "dropout",
      name: "弃坑率",
      value: decided > 0 ? percent(dropoutRate) : "--",
      label: decided > 0 ? dropoutLabel(dropoutRate) : "暂无结局",
      explanation: decided > 0
        ? `只看“看完”与“抛弃”两种明确结局，每 100 人约有 ${(dropoutRate * 100).toFixed(0)} 人弃坑。`
        : "尚无看完或抛弃记录，不能计算弃坑率。",
    },
    {
      key: "diversity",
      name: "状态分歧",
      value: diversityIndex.toFixed(0),
      label: diversityLabel(diversityIndex),
      explanation: "衡量五种收藏状态是否集中；越接近 100，用户所处阶段越分散。",
    },
  ];

  const signals: CollectionDistributionSignal[] = [];
  const startInterval = wilsonInterval(started, sampleSize);
  const activeInterval = wilsonInterval(counts.doing, started);
  const onHoldInterval = wilsonInterval(counts.on_hold, started);
  const dropoutInterval = wilsonInterval(counts.dropped, decided);
  const droppedAmongStartedInterval = wilsonInterval(counts.dropped, started);
  const wishBacklog = broadcastPhase !== "not-aired"
    && started >= 30 && startInterval.upper <= 0.48 && counts.wish >= started * 1.25;
  const activeSurge = started >= 50 && activeInterval.lower >= 0.3 && shares.doing >= 0.24;
  const onHoldHigh = started >= 50 && counts.on_hold >= 20
    && onHoldInterval.lower >= 0.1 && counts.on_hold >= counts.doing * 0.45;
  const dropoutHigh = broadcastPhase === "not-aired"
    ? false
    : decided >= 50 && counts.dropped >= 20 && dropoutInterval.lower >= 0.22
      && (broadcastPhase !== "airing"
        || droppedAmongStartedInterval.lower >= 0.07
        // During airing, the decided subset is self-selected: most users are still
        // watching, so a high decided-only rate is not enough to call broad churn.
        || (dropoutRate >= 0.3 && counts.dropped >= 50 && droppedAmongStartedInterval.lower >= 0.02)
        || (dropoutRate >= 0.35 && counts.dropped >= 80 && droppedAmongStartedInterval.lower >= 0.015));
  const outcomeSplit = broadcastPhase !== "not-aired" && broadcastPhase !== "airing"
    && decided >= 80 && counts.collect >= 30 && counts.dropped >= 25
    && dropoutInterval.lower >= 0.2 && dropoutInterval.upper <= 0.6;

  if (wishBacklog) {
    signals.push({
      kind: "wish-backlog",
      title: "观望积压",
      summary: "想看人数明显多于已经开始接触的人数，关注尚未充分转化为观看或游玩。",
      evidence: `想看占 ${percent(shares.wish)}，开始转化占 ${percent(startRate)}（95% 区间上限 ${percent(startInterval.upper)}）。`,
      confidence: startInterval.upper <= 0.34 && sampleSize >= 500 ? "高" : startInterval.upper <= 0.42 ? "中" : "低",
    });
  }
  if (activeSurge) {
    signals.push({
      kind: "active-surge",
      title: broadcastPhase === "finished" ? "完结后消化中" : "追看热潮",
      summary: broadcastPhase === "finished"
        ? "作品已经完结，但仍有大量用户处于进行中状态，收藏结构尚未完全沉淀。"
        : "大量用户正处于进行中状态，收藏结构仍在快速变化。",
      evidence: `在看占全部收藏的 ${percent(shares.doing)}，并占已开始用户的 ${percent(activeRate)}（95% 区间下限 ${percent(activeInterval.lower)}）。`,
      confidence: activeInterval.lower >= 0.48 && started >= 500 ? "高" : activeInterval.lower >= 0.38 ? "中" : "低",
    });
  }
  if (onHoldHigh) {
    signals.push({
      kind: "on-hold",
      title: "搁置高发",
      summary: "较多用户开始后暂时停下，内容节奏、长度或追更间隔可能构成阻力。",
      evidence: `搁置占已开始用户的 ${percent(onHoldRate)}（95% 区间下限 ${percent(onHoldInterval.lower)}），相当于在看人数的 ${percent(counts.on_hold / Math.max(1, counts.doing))}。`,
      confidence: onHoldInterval.lower >= 0.2 && started >= 500 ? "高" : onHoldInterval.lower >= 0.15 ? "中" : "低",
    });
  }
  if (dropoutHigh) {
    signals.push({
      kind: "dropout",
      title: "弃坑高发",
      summary: broadcastPhase === "airing"
        ? "作品仍在放送，但抛弃状态在明确结局和已开始用户中均达到明显比例。"
        : "抛弃状态在全部收藏和明确结局中都占有明显比例。",
      evidence: broadcastPhase === "airing"
        ? `抛弃占明确结局的 ${percent(dropoutRate)}，并占已开始用户的 ${percent(counts.dropped / Math.max(1, started))}（95% 区间下限 ${percent(droppedAmongStartedInterval.lower)}）。`
        : `抛弃占明确结局的 ${percent(dropoutRate)}，其 95% 区间下限为 ${percent(dropoutInterval.lower)}。`,
      confidence: dropoutInterval.lower >= 0.4 && counts.dropped >= 100 ? "高" : dropoutInterval.lower >= 0.3 ? "中" : "低",
    });
  }
  if (outcomeSplit) {
    signals.push({
      kind: "outcome-split",
      title: "结局分流",
      summary: "看完与抛弃均形成可见群体，开始后的体验反馈存在明显分化。",
      evidence: `明确结局中，看完 ${percent(1 - dropoutRate)}、抛弃 ${percent(dropoutRate)}；抛弃比例的 95% 区间为 ${percent(dropoutInterval.lower)}–${percent(dropoutInterval.upper)}。`,
      confidence: decided >= 500 && dropoutInterval.lower >= 0.28 ? "高" : decided >= 150 ? "中" : "低",
    });
  }

  let profile = { label: "常规流转", description: "收藏状态呈现自然的进入、进行与完成结构。" };
  if (broadcastPhase === "not-aired") profile = { label: "待播蓄势", description: "作品尚未开播，想看收藏占主导属于正常的预热结构。" };
  else if (outcomeSplit) profile = { label: "口碑分流", description: "看完与弃坑两种结果同时突出，用户体验出现分叉。" };
  else if (dropoutHigh) profile = { label: "弃坑高发", description: "已经作出明确结局的用户中，抛弃比例偏高。" };
  else if (onHoldHigh) profile = { label: "大量搁置", description: "不少用户停留在搁置状态，完成转化受到阻力。" };
  else if (activeSurge) profile = broadcastPhase === "finished"
    ? { label: "完结后消化", description: "作品已经完结，仍有较多用户处于观看或游玩过程中。" }
    : { label: "追看热潮", description: "进行中用户占据主导，当前热度和参与度较高。" };
  else if (wishBacklog) profile = { label: "观望积压", description: "想看关注很多，但真正开始接触的转化相对有限。" };
  else if (completionRate >= 0.7) profile = { label: "完结沉淀", description: "已开始用户大多完成，收藏结构相对稳定。" };
  else if (diversityIndex >= 75) profile = { label: "状态多元", description: "用户广泛分布在各个阶段，没有单一状态占据主导。" };

  return {
    status: signals.some((signal) => ["on-hold", "dropout", "outcome-split"].includes(signal.kind)) ? "watch" : "clear",
    sampleSize,
    profile,
    metrics,
    signals,
    summary: broadcastPhase === "not-aired"
      ? "作品尚未开播，当前收藏结构主要反映播前关注度。"
      : signals.length > 0
      ? `识别出 ${signals.length} 项收藏状态特征，反映用户从关注到完成的流转情况。`
      : "当前收藏状态流转较为常规，未发现突出的结构特征。",
  };
}
