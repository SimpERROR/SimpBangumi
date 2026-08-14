<script lang="ts">
let quizQuestionDeckIds: number[] = [];
let quizRecentlyUsedIds: number[] = [];
let quizDeckPoolSignature = "";
const quizVisualFeatureCache = new Map<number, MaliciousVisualFeature | null>();
const maliciousQuestionTrapScoreCache = new Map<number, number>();
const maliciousOptionCandidateCache = new Map<number, number[]>();
const maliciousOptionSubjectCache = new Map<number, GameSubject>();
const quizCoverPreloadCache = new Set<string>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { SearchSubject, SubjectCollection } from "../api/bangumi";
import { useBangumi } from "../composables/useBangumi";
import {
  MEMORY_GAME_HIGH_SCORE_KEY,
  QUIZ_GAME_BEST_STREAKS_KEY,
  QUIZ_GAME_HIGH_SCORES_KEY,
  QUIZ_MALICIOUS_ANALYSIS_KEY,
  QUIZ_MALICIOUS_HISTORY_KEY,
  QUIZ_MALICIOUS_EXPOSURE_KEY,
  QUIZ_MALICIOUS_POOL_CACHE_KEY,
  QUIZ_MALICIOUS_PROGRESS_KEY,
  QUIZ_UNKNOWN_CHALLENGE_HIGH_SCORE_KEY,
} from "../utils/collectionGameScores";
import appLogo from "../assets/app-logo.png";

type GameMode = "menu" | "memory-detail" | "quiz-detail" | "quiz-initializing" | "memory" | "quiz";
type GameSubject = {
  id: number;
  title: string;
  originalTitle: string;
  translatedTitle: string;
  image: string;
  source?: MaliciousPoolSource;
  familiarity?: number;
  collectionTotal?: number;
  ratingTotal?: number;
  hasRatingData?: boolean;
  airDate?: string;
  disguiseReferenceId?: number;
};
type MaliciousPoolSource = "collection" | "popular" | "obscure" | "explore";
type MemoryCard = GameSubject & { cardId: string };
type QuizOption = GameSubject & { displayTitle: string };
type QuizDifficulty = "relaxed" | "normal" | "hard" | "expert" | "nightmare" | "adaptive";
type QuizTreatmentFamily = "blur" | "zoom" | "grayscale" | "invert" | "color-filter" | "mirror" | "tiles" | "single-tile" | "moving";
type QuizBehaviorStat = { seen: number; correct: number; responseRatioTotal: number };
type QuizBehaviorProfile = {
  answered: number;
  correct: number;
  treatmentStats: Partial<Record<QuizTreatmentFamily, QuizBehaviorStat>>;
  languageStats: { original: QuizBehaviorStat; translated: QuizBehaviorStat };
};
type MaliciousTrapKind = "franchise" | "installment" | "similar-title" | "short-title" | "long-title" | "memory" | "color-similar" | "face-layout" | "text-layout";
type MaliciousVisualCue = "character" | "color" | "composition" | "text";
type MaliciousConfidence = "snap" | "normal" | "hesitant";
type QuizAnswerStats = {
  wrong: number;
  timedOut: number;
  hesitantWrong: number;
  snapWrong: number;
};
type QuizTimeoutPenalty = "none" | "score" | "time" | "both";
type MaliciousPhase = "probe" | "bait" | "trap" | "counter";
type FatigueStage = "none" | "light" | "moderate" | "high";
type FatigueAttackAxis = "title" | "memory" | "visual" | "position";
type MaliciousVisualRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};
type MaliciousVisualFeature = {
  analysisVersion?: number;
  hue: number;
  saturation: number;
  brightness: number;
  horizontalBalance: number;
  verticalBalance: number;
  faceRegion?: MaliciousVisualRegion;
  textRegion?: MaliciousVisualRegion;
  faceRegions?: MaliciousVisualRegion[];
  textRegions?: MaliciousVisualRegion[];
  informativeTiles?: Partial<Record<2 | 3 | 4 | 5, number[]>>;
};
type MaliciousPointerTrajectory = {
  sampleCount: number;
  pathLength: number;
  directness: number;
  directionChanges: number;
  firstOptionIndex: number;
  dwellOptionIndex: number;
  lastOptionIndex: number;
};
type MaliciousPointerSample = {
  x: number;
  y: number;
  timestamp: number;
  optionIndex: number;
};
type MaliciousObservation = {
  questionId: number;
  questionTitle: string;
  selectedId?: number;
  selectedTitle: string;
  selectedIndex: number;
  correctIndex: number;
  correct: boolean;
  timedOut: boolean;
  responseRatio: number;
  confidence: MaliciousConfidence;
  phase?: MaliciousPhase;
  trapKinds: MaliciousTrapKind[];
  trapHits?: MaliciousTrapKind[];
  treatmentFamilies: QuizTreatmentFamily[];
  visitOrder?: number[];
  pointerTrajectory?: MaliciousPointerTrajectory;
  visualFeature?: MaliciousVisualFeature | null;
  timestamp: number;
  source?: MaliciousPoolSource;
  unfamiliarity?: number;
  tactics?: MaliciousTactic[];
  tacticHits?: MaliciousTactic[];
  franchiseKey?: string;
  seasonKey?: string;
};
type MaliciousTactic = "position-conditioning" | "position-reversal" | "title-counter" | "weakness-targeting" | "guess-counter";
type MaliciousTacticTarget = {
  position?: number;
  decoyId?: number;
  decoyIds?: number[];
};
type MaliciousBayesianStat = {
  alpha: number;
  beta: number;
  alertness: number;
  resistedStreak: number;
  hitCount: number;
  lastHitQuestion: number;
};
type MaliciousAnalysisProfile = {
  version: 2;
  recent: MaliciousObservation[];
  cueStats: Record<MaliciousVisualCue, QuizBehaviorStat>;
  trapBeliefs: Record<MaliciousTrapKind, MaliciousBayesianStat>;
};
type MaliciousRunObservation = {
  observation: MaliciousObservation;
  attackStrength: number;
};
type FatigueRoundObservation = {
  questionNumber: number;
  stage: FatigueStage;
  fatigue: number;
  pressure: number;
  responseMs: number;
  correct: boolean;
  highPressure: boolean;
  optionDwellMs: number;
  pointerComplexity: number;
  titlePollutionHit: boolean;
  confidenceTrap: boolean;
  confidenceTrapHit: boolean;
};
type MaliciousEchoState = {
  subjectId: number;
  targetIndex: number;
  originalDisplayTitle: string;
  originalOptionIds: number[];
  originalTreatmentFamilies: QuizTreatmentFamily[];
};
type MaliciousReportItem = {
  label: string;
  value: string;
  detail: string;
  level: "neutral" | "notice" | "danger";
};
type QuizTreatment = {
  id: string;
  blur: number;
  zoom: number;
  grayscale: number;
  invert: number;
  hueRotate: number;
  saturate: number;
  sepia: number;
  brightness: number;
  mirror: boolean;
  tileSize: number;
  singleTile: boolean;
  movingTiles: boolean;
  occlusion: "face" | "text" | "both" | null;
};
type QuizDifficultyConfig = {
  label: string;
  optionCount: number;
  timeLimitMs: number;
  baseScore: number;
  similarDistractors: number;
  alternateTitles: boolean;
  treatments: QuizTreatment[];
  tileSwapIntervalMs: number;
  tileSwapPairs: number;
};

const treatment = (
  id: string,
  options: Partial<Omit<QuizTreatment, "id">> = {},
): QuizTreatment => ({
  id,
  blur: 0,
  zoom: 1,
  grayscale: 0,
  invert: 0,
  hueRotate: 0,
  saturate: 1,
  sepia: 0,
  brightness: 1,
  mirror: false,
  tileSize: 0,
  singleTile: false,
  movingTiles: false,
  occlusion: null,
  ...options,
});

const QUIZ_DIFFICULTIES: Record<QuizDifficulty, QuizDifficultyConfig> = {
  relaxed: {
    label: "轻松", optionCount: 4, timeLimitMs: 15_000, baseScore: 100, similarDistractors: 0, alternateTitles: false,
    tileSwapIntervalMs: 600, tileSwapPairs: 1,
    treatments: [
      treatment("gentle-zoom", { zoom: 1.2 }),
      treatment("soft-blur", { blur: 3.2, zoom: 1.08 }),
      treatment("soft-gray", { grayscale: .78, zoom: 1.14 }),
      treatment("soft-invert", { invert: .82, zoom: 1.06 }),
      treatment("warm-filter", { hueRotate: -18, saturate: 1.35, sepia: .28 }),
      treatment("single-tile-2", { tileSize: 2, singleTile: true }),
    ],
  },
  normal: {
    label: "普通", optionCount: 5, timeLimitMs: 12_000, baseScore: 160, similarDistractors: 2, alternateTitles: true,
    tileSwapIntervalMs: 600, tileSwapPairs: 1,
    treatments: [
      treatment("blur", { blur: 6, zoom: 1.12 }),
      treatment("deep-zoom", { zoom: 1.52 }),
      treatment("gray-zoom", { blur: 1.5, grayscale: 1, zoom: 1.22 }),
      treatment("mirror", { blur: 2, mirror: true, zoom: 1.18 }),
      treatment("tiles-2", { blur: 1.2, tileSize: 2 }),
      treatment("moving-tiles-2", { blur: 2, zoom: 1.06, tileSize: 2, movingTiles: true }),
      treatment("invert", { invert: 1, zoom: 1.08 }),
      treatment("color-shift", { hueRotate: 105, saturate: 1.45, sepia: .12, zoom: 1.06 }),
      treatment("single-tile-2", { blur: .8, tileSize: 2, singleTile: true }),
    ],
  },
  hard: {
    label: "困难", optionCount: 6, timeLimitMs: 10_000, baseScore: 240, similarDistractors: 4, alternateTitles: true,
    tileSwapIntervalMs: 500, tileSwapPairs: 1,
    treatments: [
      treatment("blur-zoom", { blur: 5.5, zoom: 1.42 }),
      treatment("tiles-3", { blur: 1.5, zoom: 1.05, tileSize: 3 }),
      treatment("blur-tiles-3", { blur: 3.4, zoom: 1.1, tileSize: 3 }),
      treatment("gray-tiles-3", { blur: 1.5, grayscale: 1, tileSize: 3 }),
      treatment("moving-tiles-3", { blur: 2.5, zoom: 1.08, tileSize: 3, movingTiles: true }),
      treatment("mirror-blur", { blur: 4, zoom: 1.28, mirror: true }),
      treatment("invert-filter", { invert: 1, hueRotate: 48, saturate: 1.5, zoom: 1.18 }),
      treatment("single-tile-3", { blur: 1, tileSize: 3, singleTile: true }),
    ],
  },
  expert: {
    label: "极限", optionCount: 8, timeLimitMs: 8_000, baseScore: 360, similarDistractors: 6, alternateTitles: true,
    tileSwapIntervalMs: 400, tileSwapPairs: 2,
    treatments: [
      treatment("moving-tiles-4", { blur: 1.5, tileSize: 4, movingTiles: true }),
      treatment("moving-blur-3", { blur: 4, zoom: 1.08, tileSize: 3, movingTiles: true }),
      treatment("gray-tiles-4", { blur: 2, grayscale: 1, tileSize: 4 }),
      treatment("moving-gray-4", { grayscale: .85, zoom: 1.06, tileSize: 4, movingTiles: true }),
      treatment("heavy-blur-zoom", { blur: 9, zoom: 1.38 }),
      treatment("mirror-blur-zoom", { blur: 4, zoom: 1.45, mirror: true }),
      treatment("filtered-tiles-4", { hueRotate: 145, saturate: 1.7, sepia: .18, tileSize: 4 }),
      treatment("single-tile-4", { invert: .3, tileSize: 4, singleTile: true }),
    ],
  },
  nightmare: {
    label: "噩梦", optionCount: 10, timeLimitMs: 6_000, baseScore: 500, similarDistractors: 8, alternateTitles: true,
    tileSwapIntervalMs: 280, tileSwapPairs: 3,
    treatments: [
      treatment("nightmare-moving-4", { blur: 3, zoom: 1.08, tileSize: 4, movingTiles: true }),
      treatment("nightmare-moving-gray-4", { blur: 2, grayscale: 1, tileSize: 4, movingTiles: true }),
      treatment("nightmare-moving-5", { blur: 1.5, tileSize: 5, movingTiles: true }),
      treatment("nightmare-blur-zoom", { blur: 11, zoom: 1.52 }),
      treatment("nightmare-mirror", { blur: 6, zoom: 1.55, mirror: true }),
      treatment("nightmare-static-5", { blur: 3, grayscale: .75, tileSize: 5 }),
      treatment("nightmare-invert", { blur: 2, invert: 1, hueRotate: 120, saturate: 1.8, zoom: 1.2 }),
      treatment("nightmare-single-tile-5", { blur: 1.2, tileSize: 5, singleTile: true }),
    ],
  },
  adaptive: {
    label: "恶意", optionCount: 12, timeLimitMs: 4_000, baseScore: 900, similarDistractors: 11, alternateTitles: true,
    tileSwapIntervalMs: 280, tileSwapPairs: 3,
    treatments: [
      treatment("adaptive-false-easy", { zoom: 1.04 }),
      treatment("adaptive-soft-crop", { blur: .8, zoom: 1.2 }),
      treatment("adaptive-moving-4", { blur: 1.2, zoom: 1.05, tileSize: 4, movingTiles: true }),
      treatment("adaptive-moving-gray-4", { blur: 1, grayscale: .68, zoom: 1.04, tileSize: 4, movingTiles: true }),
      treatment("adaptive-moving-mirror-4", { blur: 1.5, zoom: 1.08, mirror: true, tileSize: 4, movingTiles: true }),
      treatment("adaptive-moving-5", { blur: 1, zoom: 1.06, tileSize: 5, movingTiles: true }),
      treatment("adaptive-gray-mirror", { blur: 2, zoom: 1.2, grayscale: .72, mirror: true }),
      treatment("adaptive-static-5", { blur: 1.5, zoom: 1.08, grayscale: .5, tileSize: 5 }),
      treatment("adaptive-invert-filter", { blur: 1, invert: 1, hueRotate: 75, saturate: 1.6, zoom: 1.12 }),
      treatment("adaptive-color-filter", { hueRotate: 160, saturate: 1.75, sepia: .25, zoom: 1.08 }),
      treatment("adaptive-face-occlusion", { blur: .8, zoom: 1.04, occlusion: "face" }),
      treatment("adaptive-text-occlusion", { blur: .8, zoom: 1.04, occlusion: "text" }),
      treatment("adaptive-single-tile-5", { blur: .8, tileSize: 5, singleTile: true }),
    ],
  },
};
const QUIZ_DIFFICULTY_ORDER = Object.keys(QUIZ_DIFFICULTIES) as QuizDifficulty[];
const MALICIOUS_ECHO_TREATMENTS: QuizTreatment[] = [
  treatment("adaptive-echo-gray-mirror-crop", { blur: .8, zoom: 1.42, grayscale: 1, mirror: true }),
  treatment("adaptive-echo-invert-tiles", { blur: .8, invert: 1, hueRotate: 120, saturate: 1.7, tileSize: 4, movingTiles: true }),
  treatment("adaptive-echo-single-tile", { hueRotate: -90, saturate: 1.8, tileSize: 5, singleTile: true }),
];
const QUIZ_QUESTION_COUNT_OPTIONS = [10, 15, 20, 30, 50] as const;
type QuizQuestionCount = typeof QUIZ_QUESTION_COUNT_OPTIONS[number];
const QUIZ_MIN_POOL_SIZE = 8;
const QUIZ_FORCE_EXPANSION_THRESHOLD = 20;
const QUIZ_ADAPTIVE_MIN_ANSWERS = 20;
const QUIZ_ADAPTIVE_MIN_FAMILIES = 4;
const QUIZ_BONUS_PER_SOURCE = .1;
const QUIZ_TIMEOUT_SCORE_PENALTY_MULTIPLIER = 1;
const QUIZ_TIMEOUT_TIME_REDUCTION_RATIO = .25;
const QUIZ_BEHAVIOR_PROFILE_KEY = "bangumi.games.quiz.behaviorProfile";
const MALICIOUS_POOL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MALICIOUS_NORMAL_BLOCK_SIZE = 120;
const MALICIOUS_UNKNOWN_BLOCK_SIZE = 240;
const MALICIOUS_SERIES_BLOCK_SIZE = 80;
const MALICIOUS_HISTORY_SIZE = 500;
const UNKNOWN_CHALLENGE_MIN_COMPLETIONS = 20;

type MaliciousProgress = { completions: number; answers: number };
type MaliciousHistoryEntry = { id: number; title: string; timestamp: number; franchiseKey?: string; seasonKey?: string };
type MaliciousExposure = Record<string, { total: number; unknown: number; lastSeenAt: number }>;
type MaliciousPoolCache = { version: 1; updatedAt: number; popular: GameSubject[]; obscure: GameSubject[]; explore: GameSubject[] };

type QuizHighScores = Record<string, number>;
type QuizBestStreaks = Record<string, number>;
type QuizAudioMarks = Record<string, "muted" | "low-volume">;
const QUIZ_AUDIO_MARKS_KEY = "bangumi.games.quiz.audioMarks";
const MALICIOUS_LOW_SYSTEM_VOLUME = .1;

function normalizeStoredScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
}

function readMemoryHighScore(): number {
  try {
    return normalizeStoredScore(localStorage.getItem(MEMORY_GAME_HIGH_SCORE_KEY));
  } catch {
    return 0;
  }
}

function readQuizHighScores(): QuizHighScores {
  const defaults: QuizHighScores = {};
  try {
    const stored = JSON.parse(localStorage.getItem(QUIZ_GAME_HIGH_SCORES_KEY) || "{}") as QuizHighScores;
    for (const [key, score] of Object.entries(stored)) defaults[key] = normalizeStoredScore(score);
  } catch { /* ignore invalid local data */ }
  return defaults;
}

function readQuizBestStreaks(): QuizBestStreaks {
  const stored = readLocalJson<QuizBestStreaks>(QUIZ_GAME_BEST_STREAKS_KEY, {});
  return Object.fromEntries(Object.entries(stored).map(([key, streak]) => [key, normalizeStoredScore(streak)]));
}

function readUnknownChallengeHighScores(): Record<string, number> {
  const raw = localStorage.getItem(QUIZ_UNKNOWN_CHALLENGE_HIGH_SCORE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as number | Record<string, number>;
    if (typeof parsed === "number") return { "10": normalizeStoredScore(parsed) };
    return Object.fromEntries(Object.entries(parsed).map(([key, score]) => [key, normalizeStoredScore(score)]));
  } catch {
    return { "10": normalizeStoredScore(raw) };
  }
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as T | null;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function readMaliciousProgress(): MaliciousProgress {
  const stored = readLocalJson<Partial<MaliciousProgress>>(QUIZ_MALICIOUS_PROGRESS_KEY, {});
  return { completions: normalizeStoredScore(stored.completions), answers: normalizeStoredScore(stored.answers) };
}

function readMaliciousHistory(): MaliciousHistoryEntry[] {
  return readLocalJson<MaliciousHistoryEntry[]>(QUIZ_MALICIOUS_HISTORY_KEY, [])
    .filter((item) => Number.isFinite(item?.id) && Number.isFinite(item?.timestamp))
    .slice(-MALICIOUS_HISTORY_SIZE);
}

function readMaliciousExposure(): MaliciousExposure {
  const stored = readLocalJson<MaliciousExposure>(QUIZ_MALICIOUS_EXPOSURE_KEY, {});
  const valid: MaliciousExposure = {};
  for (const [id, entry] of Object.entries(stored)) {
    if (!Number.isFinite(Number(id)) || !entry) continue;
    valid[id] = {
      total: normalizeStoredScore(entry.total),
      unknown: normalizeStoredScore(entry.unknown),
      lastSeenAt: Number.isFinite(entry.lastSeenAt) ? entry.lastSeenAt : 0,
    };
  }
  // Seed the lifetime ledger from the existing rolling history during migration.
  for (const item of readMaliciousHistory()) {
    const current = valid[String(item.id)] ?? { total: 0, unknown: 0, lastSeenAt: 0 };
    valid[String(item.id)] = {
      ...current,
      total: Math.max(current.total, 1),
      lastSeenAt: Math.max(current.lastSeenAt, item.timestamp),
    };
  }
  return valid;
}

function readMaliciousPoolCache(): MaliciousPoolCache | null {
  const cache = readLocalJson<MaliciousPoolCache | null>(QUIZ_MALICIOUS_POOL_CACHE_KEY, null);
  return cache?.version === 1 && Array.isArray(cache.popular) && Array.isArray(cache.obscure) && Array.isArray(cache.explore)
    ? cache
    : null;
}

function emptyBehaviorStat(): QuizBehaviorStat {
  return { seen: 0, correct: 0, responseRatioTotal: 0 };
}

function emptyMaliciousAnalysisProfile(): MaliciousAnalysisProfile {
  const emptyBelief = (): MaliciousBayesianStat => ({
    // A mildly skeptical prior prevents an unseen tactic from dominating.
    alpha: 1.35,
    beta: 1.65,
    alertness: 0,
    resistedStreak: 0,
    hitCount: 0,
    lastHitQuestion: -1,
  });
  return {
    version: 2,
    recent: [],
    cueStats: {
      character: emptyBehaviorStat(),
      color: emptyBehaviorStat(),
      composition: emptyBehaviorStat(),
      text: emptyBehaviorStat(),
    },
    trapBeliefs: {
      franchise: emptyBelief(),
      installment: emptyBelief(),
      "similar-title": emptyBelief(),
      "short-title": emptyBelief(),
      "long-title": emptyBelief(),
      memory: emptyBelief(),
      "color-similar": emptyBelief(),
      "face-layout": emptyBelief(),
      "text-layout": emptyBelief(),
    },
  };
}

function validMaliciousBayesianStat(value: unknown, fallback: MaliciousBayesianStat): MaliciousBayesianStat {
  const stat = value as Partial<MaliciousBayesianStat> | null;
  const finite = (candidate: unknown, defaultValue: number) => Number.isFinite(Number(candidate))
    ? Number(candidate)
    : defaultValue;
  return {
    alpha: Math.max(.25, finite(stat?.alpha, fallback.alpha)),
    beta: Math.max(.25, finite(stat?.beta, fallback.beta)),
    alertness: Math.max(0, Math.min(1, finite(stat?.alertness, fallback.alertness))),
    resistedStreak: Math.max(0, Math.floor(finite(stat?.resistedStreak, fallback.resistedStreak))),
    hitCount: Math.max(0, Math.floor(finite(stat?.hitCount, fallback.hitCount))),
    lastHitQuestion: Math.floor(finite(stat?.lastHitQuestion, fallback.lastHitQuestion)),
  };
}

function validBehaviorStat(value: unknown): QuizBehaviorStat {
  const stat = value as Partial<QuizBehaviorStat> | null;
  return {
    seen: normalizeStoredScore(stat?.seen),
    correct: normalizeStoredScore(stat?.correct),
    responseRatioTotal: Number.isFinite(Number(stat?.responseRatioTotal))
      ? Math.max(0, Number(stat?.responseRatioTotal))
      : 0,
  };
}

function readMaliciousAnalysisProfile(): MaliciousAnalysisProfile {
  const fallback = emptyMaliciousAnalysisProfile();
  try {
    const stored = JSON.parse(localStorage.getItem(QUIZ_MALICIOUS_ANALYSIS_KEY) || "null") as Partial<MaliciousAnalysisProfile> | null;
    if (!stored) return fallback;
    const recent = Array.isArray(stored.recent)
      ? stored.recent.filter((item): item is MaliciousObservation => (
        !!item && Number.isFinite(item.questionId) && Number.isFinite(item.correctIndex)
      )).slice(-48)
      : [];
    return {
      version: 2,
      recent,
      cueStats: {
        character: validBehaviorStat(stored.cueStats?.character),
        color: validBehaviorStat(stored.cueStats?.color),
        composition: validBehaviorStat(stored.cueStats?.composition),
        text: validBehaviorStat(stored.cueStats?.text),
      },
      trapBeliefs: Object.fromEntries((Object.keys(fallback.trapBeliefs) as MaliciousTrapKind[]).map((kind) => [
        kind,
        validMaliciousBayesianStat(stored.trapBeliefs?.[kind], fallback.trapBeliefs[kind]),
      ])) as Record<MaliciousTrapKind, MaliciousBayesianStat>,
    };
  } catch {
    return fallback;
  }
}

function readQuizBehaviorProfile(): QuizBehaviorProfile {
  const fallback: QuizBehaviorProfile = {
    answered: 0,
    correct: 0,
    treatmentStats: {},
    languageStats: { original: emptyBehaviorStat(), translated: emptyBehaviorStat() },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(QUIZ_BEHAVIOR_PROFILE_KEY) || "null") as Partial<QuizBehaviorProfile> | null;
    if (!stored) return fallback;
    return {
      answered: normalizeStoredScore(stored.answered),
      correct: normalizeStoredScore(stored.correct),
      treatmentStats: stored.treatmentStats && typeof stored.treatmentStats === "object" ? stored.treatmentStats : {},
      languageStats: {
        original: stored.languageStats?.original ?? emptyBehaviorStat(),
        translated: stored.languageStats?.translated ?? emptyBehaviorStat(),
      },
    };
  } catch {
    return fallback;
  }
}

const emit = defineEmits<{ close: [] }>();
const bangumi = useBangumi();
const mode = ref<GameMode>("menu");
const gameShellRef = ref<HTMLElement | null>(null);
const quizQuestionLayoutRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const error = ref("");
const subjects = ref<GameSubject[]>([]);

const memoryCards = ref<MemoryCard[]>([]);
const openCardIds = ref<string[]>([]);
const matchedSubjectIds = ref<number[]>([]);
const memoryMoves = ref(0);
const memoryStartedAt = ref(0);
const elapsedSeconds = ref(0);
const memoryScore = ref(0);
const memoryHighScore = ref(readMemoryHighScore());
const memoryNewRecord = ref(false);
const memoryIncludeSeasonalTop = ref(false);
const memoryIncludeGlobalTop = ref(false);
let memoryClock: number | undefined;
let flipTimer: number | undefined;

const quizQuestions = ref<GameSubject[]>([]);
const quizPool = ref<GameSubject[]>([]);
const quizOptionsRef = ref<HTMLElement | null>(null);
const quizSeasonalSubjectIds = ref<number[]>([]);
const quizGlobalSubjectIds = ref<number[]>([]);
const quizMaliciousDecoyIds = ref<number[]>([]);
const maliciousPools = ref<Record<MaliciousPoolSource, GameSubject[]>>({ collection: [], popular: [], obscure: [], explore: [] });
const maliciousHistory = ref<MaliciousHistoryEntry[]>(readMaliciousHistory());
const maliciousExposure = ref<MaliciousExposure>(readMaliciousExposure());
const maliciousProgress = ref<MaliciousProgress>(readMaliciousProgress());
const unknownChallenge = ref(false);
const unknownChallengeHighScores = ref<Record<string, number>>(readUnknownChallengeHighScores());
const quizDifficulty = ref<QuizDifficulty>("normal");
const quizQuestionCount = ref<QuizQuestionCount>(10);
const quizIncludeSeasonalTop = ref(false);
const quizIncludeGlobalTop = ref(false);
const quizForcedExpansion = ref(false);
const quizBehaviorProfile = ref<QuizBehaviorProfile>(readQuizBehaviorProfile());
const quizMaliciousAnalysis = ref<MaliciousAnalysisProfile>(readMaliciousAnalysisProfile());
const adaptivePressure = ref(.72);
const quizDifficultyTabsRef = ref<HTMLElement | null>(null);
const quizDifficultyIndicatorStyle = ref({ left: "0px", width: "0px" });
const quizDifficultyIndicatorReady = ref(false);
const quizIndex = ref(0);
const quizOptions = ref<QuizOption[]>([]);
const quizSelectedId = ref<number | null>(null);
const quizScore = ref(0);
const quizCorrectCount = ref(0);
const quizCorrectStreak = ref(0);
const quizBestStreak = ref(0);
const quizLastBrokenStreak = ref(0);
const quizAnswerStats = ref<QuizAnswerStats>({ wrong: 0, timedOut: 0, hesitantWrong: 0, snapWrong: 0 });
const quizEarnedPoints = ref(0);
const quizRemainingMs = ref(0);
const quizCurrentTimeLimitMs = ref(QUIZ_DIFFICULTIES.normal.timeLimitMs);
const quizNextTimeReductionMs = ref(0);
const quizTimeoutPenalty = ref<QuizTimeoutPenalty>("none");
const quizTimeoutScoreDeduction = ref(0);
const quizTimeoutTimeReduction = ref(0);
const quizQuestionReady = ref(false);
const quizImageReady = ref(false);
const quizOptionShuffleAnimating = ref(false);
const quizCoverRevealReady = ref(false);
const quizCoverRevealAnimating = ref(false);
const maliciousSoundEnabled = ref(true);
const quizAnswerReveal = ref(false);
const quizTransitioning = ref(false);
const quizTimedOut = ref(false);
const quizFinished = ref(false);
const quizInitializationProgress = ref(0);
const quizInitializationMessage = ref("");
const quizInitializationCompleted = ref(0);
const quizInitializationTotal = ref(0);
const quizInitializationElapsedSeconds = ref(0);
const quizHighScores = ref<QuizHighScores>(readQuizHighScores());
const quizBestStreaks = ref<QuizBestStreaks>(readQuizBestStreaks());
const quizAudioMarks = ref<QuizAudioMarks>(readLocalJson<QuizAudioMarks>(QUIZ_AUDIO_MARKS_KEY, {}));
const maliciousRunAudioMark = ref<"muted" | "low-volume" | null>(null);
const quizNewRecord = ref(false);
const activeQuizTreatment = ref<QuizTreatment>(QUIZ_DIFFICULTIES.normal.treatments[0]);
const quizTilePositions = ref<number[]>([]);
const quizSingleTileSource = ref(0);
const quizFocus = ref({ x: 50, y: 50 });
const quizVisitedOptionIndexes = ref<number[]>([]);
const currentQuizVisualFeature = ref<MaliciousVisualFeature | null>(null);
const maliciousPhase = ref<MaliciousPhase>("probe");
const maliciousRunObservations = ref<MaliciousRunObservation[]>([]);
const fatigueRunObservations = ref<FatigueRoundObservation[]>([]);
const currentConfidenceTrap = ref(false);
const currentConfidenceBaitApplied = ref(false);
const currentMaliciousTactics = ref<MaliciousTactic[]>([]);
const currentMaliciousTacticTargets = ref<Partial<Record<MaliciousTactic, MaliciousTacticTarget>>>({});
const maliciousRunAnchorPosition = ref(-1);
const currentGuessCounterPosition = ref(-1);
const maliciousEchoState = ref<MaliciousEchoState | null>(null);
const maliciousEchoCount = ref(0);
const showMaliciousReport = ref(false);
const maliciousImpact = ref(false);
let quizStartedAt = 0;
let fatigueRunStartedAt = 0;
let quizClock: number | undefined;
let quizAdvanceTimer: number | undefined;
let quizAnswerAnalysisTimer: number | undefined;
let quizAnswerRevealTimer: number | undefined;
let quizReorderTimer: number | undefined;
let quizOptionShuffleRunId = 0;
let quizCoverRevealRunId = 0;
let maliciousAudioContext: AudioContext | null = null;
let maliciousCountdownStep = -1;
let quizTileMotionClock: number | undefined;
let maliciousImpactTimer: number | undefined;
let maliciousImpactFrame: number | undefined;
let shellHeightFrame: number | undefined;
let shellHeightResetTimer: number | undefined;
let lastStableShellHeight = 0;
let lastStableShellWidth = 0;
let maliciousReportExpandedBounds: { width: number; height: number } | undefined;
let quizPointerSamples: MaliciousPointerSample[] = [];
let lastQuizPointerSampleAt = 0;
let quizInitializationRunId = 0;
let quizInitializationClock: number | undefined;
type OpenCvRuntime = Record<string, any>;
let openCvRuntimePromise: Promise<OpenCvRuntime | null> | null = null;
let animeFaceCascadePromise: Promise<boolean> | null = null;

const memoryComplete = computed(() => memoryCards.value.length > 0 && matchedSubjectIds.value.length === memoryCards.value.length / 2);
const currentQuestion = computed(() => quizQuestions.value[quizIndex.value] ?? null);
const quizConfig = computed(() => QUIZ_DIFFICULTIES[quizDifficulty.value]);
const adaptiveObservedFamilies = computed(() => Object.values(quizBehaviorProfile.value.treatmentStats)
  .filter((stat) => stat && stat.seen > 0).length);
const adaptiveUnlocked = computed(() => (
  quizBehaviorProfile.value.answered >= QUIZ_ADAPTIVE_MIN_ANSWERS
  && adaptiveObservedFamilies.value >= QUIZ_ADAPTIVE_MIN_FAMILIES
));
const unknownChallengeUnlocked = computed(() => maliciousProgress.value.completions >= UNKNOWN_CHALLENGE_MIN_COMPLETIONS);
const unknownChallengeCompletionsRemaining = computed(() => Math.max(
  0,
  UNKNOWN_CHALLENGE_MIN_COMPLETIONS - maliciousProgress.value.completions,
));
const adaptiveAnswersRemaining = computed(() => Math.max(
  0,
  QUIZ_ADAPTIVE_MIN_ANSWERS - quizBehaviorProfile.value.answered,
));
const quizBonusActive = computed(() => quizDifficulty.value !== "adaptive"
  && (quizIncludeSeasonalTop.value || quizIncludeGlobalTop.value));
const quizBonusPercent = computed(() => (
  quizForcedExpansion.value || quizDifficulty.value === "adaptive"
    ? 0
    : Number(quizIncludeSeasonalTop.value) + Number(quizIncludeGlobalTop.value)
) * 10);
const quizScoreMultiplier = computed(() => 1 + quizBonusPercent.value / 100);
const maliciousMaximumRiskMultiplier = computed(() => unknownChallenge.value ? 1.68 : 1.5);
const quizStreakMultiplier = computed(() => 1 + Math.min(Math.max(0, quizCorrectStreak.value - 1), 9) * .05);
const quizEffectiveSeasonalTop = computed(() => (
  quizIncludeSeasonalTop.value || quizForcedExpansion.value || quizDifficulty.value === "adaptive"
));
const quizEffectiveGlobalTop = computed(() => (
  quizIncludeGlobalTop.value || quizForcedExpansion.value || quizDifficulty.value === "adaptive"
));
const quizTimeLimitMs = computed(() => quizConfig.value.timeLimitMs);
const quizOptionCount = computed(() => quizDifficulty.value === "adaptive"
  ? 12
  : quizConfig.value.optionCount);
const quizSimilarDistractors = computed(() => quizDifficulty.value === "adaptive"
  ? quizOptionCount.value - 1
  : quizConfig.value.similarDistractors);
const quizTileSwapIntervalMs = computed(() => quizDifficulty.value === "adaptive"
  ? QUIZ_DIFFICULTIES.nightmare.tileSwapIntervalMs
  : quizConfig.value.tileSwapIntervalMs);
const quizTileSwapPairs = computed(() => quizDifficulty.value === "adaptive"
  ? 3
  : quizConfig.value.tileSwapPairs);
const quizSeconds = computed(() => (quizRemainingMs.value / 1000).toFixed(1));
const quizTransitionCorrectAnswer = computed(() => {
  if ((!quizTransitioning.value && !quizAnswerReveal.value) || !currentQuestion.value) return "";
  return quizOptions.value.find((option) => option.id === currentQuestion.value?.id)?.displayTitle
    ?? currentQuestion.value.title;
});
const quizTransitionSelectedAnswer = computed(() => {
  if (!quizTransitioning.value && !quizAnswerReveal.value) return "";
  if (quizTimedOut.value || quizSelectedId.value === -1) return "未作答";
  return quizOptions.value.find((option) => option.id === quizSelectedId.value)?.displayTitle ?? "未作答";
});
const quizInitializationElapsedLabel = computed(() => {
  const minutes = Math.floor(quizInitializationElapsedSeconds.value / 60);
  const seconds = quizInitializationElapsedSeconds.value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
});
const quizTimePercent = computed(() => Math.max(0, Math.min(100, quizRemainingMs.value / quizCurrentTimeLimitMs.value * 100)));
const fatigueQuestionNumber = computed(() => quizIndex.value + 1);
const fatigueValue = computed(() => quizDifficulty.value === "adaptive"
  ? Math.max(0, Math.min(1, fatigueQuestionNumber.value / Math.max(1, quizQuestions.value.length || quizQuestionCount.value)))
  : 0);
const fatigueStage = computed<FatigueStage>(() => {
  if (quizDifficulty.value !== "adaptive" || fatigueQuestionNumber.value <= 5) return "none";
  if (fatigueQuestionNumber.value <= 10) return "light";
  if (fatigueQuestionNumber.value <= 15) return "moderate";
  return "high";
});
const fatiguePressureThreshold = computed(() => ({ none: 35, light: 44, moderate: 53, high: 62 })[fatigueStage.value]);
const fatigueCriticalThreshold = computed(() => ({ none: 15, light: 19, moderate: 23, high: 28 })[fatigueStage.value]);
const maliciousPressureActive = computed(() => quizDifficulty.value === "adaptive"
  && mode.value === "quiz"
  && !quizFinished.value
  && quizQuestionReady.value
  && quizSelectedId.value === null
  && quizTimePercent.value <= fatiguePressureThreshold.value);
const maliciousPressureCritical = computed(() => maliciousPressureActive.value && quizTimePercent.value <= fatigueCriticalThreshold.value);
const maliciousPressureMessage = computed(() => maliciousPressureCritical.value
  ? "现在。别想太久。"
  : maliciousPressureActive.value ? "你开始犹豫了。" : "");
const quizMaximumScore = computed(() => Math.round(
  quizConfig.value.baseScore
    * 2
    * Array.from({ length: quizQuestions.value.length }, (_, index) => 1 + Math.min(index, 9) * .05)
      .reduce((total, multiplier) => total + multiplier, 0)
    * quizScoreMultiplier.value
    * (quizDifficulty.value === "adaptive" ? maliciousMaximumRiskMultiplier.value : 1),
));
const quizHighScoreKey = computed(() => `${quizDifficulty.value}:${quizQuestionCount.value}`);
const quizHighScore = computed(() => unknownChallenge.value
  ? unknownChallengeHighScores.value[String(quizQuestionCount.value)] ?? 0
  : quizHighScores.value[quizHighScoreKey.value]
    ?? (quizQuestionCount.value === 10 ? quizHighScores.value[quizDifficulty.value] ?? 0 : 0));
const quizAudioMarkKey = computed(() => unknownChallenge.value
  ? `unknown:${quizQuestionCount.value}`
  : quizHighScoreKey.value);
const quizHighScoreAudioMark = computed(() => quizAudioMarks.value[quizAudioMarkKey.value] ?? null);
const quizBestStreakKey = computed(() => unknownChallenge.value
  ? `unknown:${quizQuestionCount.value}`
  : quizHighScoreKey.value);
const quizSavedBestStreak = computed(() => quizBestStreaks.value[quizBestStreakKey.value] ?? 0);
const maliciousCorrectStreak = computed(() => maliciousStreak((item) => item.correct));
const maliciousFastCorrectStreak = computed(() => maliciousStreak((item) => item.correct && item.confidence === "snap"));
const maliciousConfidenceState = computed(() => quizDifficulty.value === "adaptive" && (
  maliciousCorrectStreak.value >= 3
  || maliciousFastCorrectStreak.value >= 2
));
const maliciousReportSampleSize = computed(() => quizMaliciousAnalysis.value.recent.length);
const isCurrentMaliciousEcho = computed(() => (
  quizDifficulty.value === "adaptive"
  && maliciousEchoState.value !== null
  && quizIndex.value === maliciousEchoState.value.targetIndex
  && currentQuestion.value?.id === maliciousEchoState.value.subjectId
));
const maliciousAfterActionReport = computed(() => {
  const rounds = maliciousRunObservations.value;
  const fatigueRounds = fatigueRunObservations.value;
  const titleTrapKinds = new Set<MaliciousTrapKind>([
    "franchise",
    "installment",
    "similar-title",
    "short-title",
    "long-title",
  ]);
  const intensity = rounds.length
    ? Math.round(Math.max(
      rounds.reduce((total, round) => total + round.attackStrength, 0) / rounds.length,
      fatigueRounds.at(-1)?.pressure ?? 0,
    ) * 100)
    : 0;
  const tacticStats = (predicate: (observation: MaliciousObservation) => boolean, tactic?: MaliciousTactic) => {
    const matched = rounds.filter(({ observation }) => predicate(observation));
    return {
      rounds: matched.length,
      losses: tactic
        ? matched.filter(({ observation }) => observation.tacticHits?.includes(tactic)).length
        : matched.filter(({ observation }) => observation.trapHits?.some((kind) => predicate({
          ...observation,
          trapKinds: [kind],
        }))).length,
    };
  };
  const titleStats = tacticStats((observation) => observation.trapKinds.some((kind) => titleTrapKinds.has(kind)));
  const memoryStats = tacticStats((observation) => observation.trapKinds.includes("memory"));
  const conditioningStats = tacticStats((observation) => !!observation.tactics?.includes("position-conditioning"), "position-conditioning");
  const reversalStats = tacticStats((observation) => !!observation.tactics?.includes("position-reversal"), "position-reversal");
  const targetedRounds = rounds.filter(({ observation }) => observation.tactics?.some((tactic) => (
    tactic === "title-counter" || tactic === "weakness-targeting"
  )));
  const targetedStats = {
    rounds: targetedRounds.length,
    losses: targetedRounds.filter(({ observation }) => observation.tacticHits?.some((tactic) => (
      tactic === "title-counter" || tactic === "weakness-targeting"
    ))).length,
  };
  const guessCounterStats = tacticStats((observation) => !!observation.tactics?.includes("guess-counter"), "guess-counter");
  const attackStats = {
    rounds: rounds.filter(({ observation }) => observation.trapKinds.length > 0).length,
    losses: rounds.filter(({ observation }) => (observation.trapHits?.length ?? 0) > 0).length,
  };
  const firstResponses = fatigueRounds.slice(0, 5).filter((round) => !round.highPressure || round.responseMs > 0);
  const finalResponses = fatigueRounds.slice(-5).filter((round) => round.responseMs > 0);
  const averageResponse = (items: FatigueRoundObservation[]) => items.length
    ? items.reduce((sum, item) => sum + item.responseMs, 0) / items.length
    : 0;
  const baselineResponse = averageResponse(firstResponses);
  const finalResponse = averageResponse(finalResponses);
  const reactionDecline = baselineResponse > 0
    ? Math.max(0, Math.round((finalResponse / baselineResponse - 1) * 100))
    : 0;
  const highestStage = fatigueRounds.reduce<FatigueStage>((stage, round) => {
    const rank: Record<FatigueStage, number> = { none: 0, light: 1, moderate: 2, high: 3 };
    return rank[round.stage] > rank[stage] ? round.stage : stage;
  }, "none");
  return {
    intensity,
    filledSegments: Math.round(intensity / 10),
    resistedAttacks: rounds.filter(({ observation }) => observation.correct && observation.trapKinds.length > 0).length,
    attackStats,
    memoryStats,
    titleStats,
    conditioningStats,
    reversalStats,
    targetedStats,
    guessCounterStats,
    fatigueStage: ({ none: "观察阶段", light: "轻度", moderate: "中度", high: "高度" })[highestStage],
    titlePollutionHits: fatigueRounds.filter((round) => round.titlePollutionHit).length,
    confidenceTrapHits: fatigueRounds.filter((round) => round.confidenceTrapHit).length,
    reactionDecline,
  };
});
const maliciousReportItems = computed<MaliciousReportItem[]>(() => {
  const recent = quizMaliciousAnalysis.value.recent;
  if (!recent.length) return [];
  const answered = recent.filter((item) => !item.timedOut);
  const correctCount = recent.filter((item) => item.correct).length;
  const averageResponseRatio = recent.reduce((total, item) => total + item.responseRatio, 0) / recent.length;
  const positionCounts = Array.from({ length: 12 }, () => 0);
  const traversalCounts = Array.from({ length: 12 }, () => 0);
  const trajectoryApproachCounts = Array.from({ length: 12 }, () => 0);
  const trajectoryDwellCounts = Array.from({ length: 12 }, () => 0);
  const trajectories = recent.flatMap((item) => item.pointerTrajectory ? [item.pointerTrajectory] : []);
  answered.forEach((item) => {
    if (item.selectedIndex >= 0 && item.selectedIndex < 12) positionCounts[item.selectedIndex] += 1;
    item.visitOrder?.forEach((position, order) => {
      if (position >= 0 && position < 12) traversalCounts[position] += 1 / (order + 1);
    });
    const trajectory = item.pointerTrajectory;
    if (trajectory?.firstOptionIndex !== undefined && trajectory.firstOptionIndex >= 0 && trajectory.firstOptionIndex < 12) {
      trajectoryApproachCounts[trajectory.firstOptionIndex] += 1;
    }
    if (trajectory?.dwellOptionIndex !== undefined && trajectory.dwellOptionIndex >= 0 && trajectory.dwellOptionIndex < 12) {
      trajectoryDwellCounts[trajectory.dwellOptionIndex] += 1;
    }
  });
  const preferredPosition = positionCounts.indexOf(Math.max(...positionCounts));
  const preferredRate = answered.length ? positionCounts[preferredPosition] / answered.length : 0;
  const traversalPosition = traversalCounts.indexOf(Math.max(...traversalCounts));
  const trajectoryApproachPosition = trajectoryApproachCounts.indexOf(Math.max(...trajectoryApproachCounts));
  const trajectoryDwellPosition = trajectoryDwellCounts.indexOf(Math.max(...trajectoryDwellCounts));
  const averageTrajectoryDirectness = trajectories.length
    ? trajectories.reduce((total, item) => total + item.directness, 0) / trajectories.length
    : 0;
  const averageDirectionChanges = trajectories.length
    ? trajectories.reduce((total, item) => total + item.directionChanges, 0) / trajectories.length
    : 0;
  const firstRate = answered.length ? positionCounts[0] / answered.length : 0;
  const lastRate = answered.length ? positionCounts[11] / answered.length : 0;
  let avoidedPreviousCorrect = 0;
  let avoidanceOpportunities = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index - 1].correctIndex < 0 || recent[index].selectedIndex < 0) continue;
    avoidanceOpportunities += 1;
    if (recent[index].selectedIndex !== recent[index - 1].correctIndex) avoidedPreviousCorrect += 1;
  }
  const trapLabels: Record<MaliciousTrapKind, string> = {
    franchise: "同系列作品",
    installment: "续作／剧场版",
    "similar-title": "相似标题",
    "short-title": "短标题混淆",
    "long-title": "长标题结构",
    memory: "上一题记忆残留",
    "color-similar": "相似封面配色",
    "face-layout": "相似人脸构图",
    "text-layout": "相似文字布局",
  };
  const trapCounts = new Map<MaliciousTrapKind, number>();
  recent.filter((item) => !item.correct).forEach((item) => item.trapKinds.forEach((kind) => (
    trapCounts.set(kind, (trapCounts.get(kind) ?? 0) + 1)
  )));
  const weakestTrap = [...trapCounts.entries()].sort((first, second) => second[1] - first[1])[0];
  const cueLabels: Record<MaliciousVisualCue, string> = {
    character: "角色与局部特征",
    color: "颜色信息",
    composition: "整体构图",
    text: "Logo 与文字区域",
  };
  const weakestCue = (Object.entries(quizMaliciousAnalysis.value.cueStats) as Array<[MaliciousVisualCue, QuizBehaviorStat]>)
    .filter(([, stat]) => stat.seen > 0)
    .sort((first, second) => behaviorStatWeakness(second[1]) - behaviorStatWeakness(first[1]))[0];
  const original = quizBehaviorProfile.value.languageStats.original;
  const translated = quizBehaviorProfile.value.languageStats.translated;
  const originalWeakness = behaviorStatWeakness(original);
  const translatedWeakness = behaviorStatWeakness(translated);
  const weakerLanguage = Math.abs(originalWeakness - translatedWeakness) <= .04
    ? "暂无明显差异"
    : originalWeakness > translatedWeakness ? "原名" : "译名";
  const snapErrors = recent.filter((item) => !item.correct && item.confidence === "snap").length;
  const hesitantErrors = recent.filter((item) => !item.correct && item.confidence === "hesitant").length;
  const avoidanceRate = avoidanceOpportunities ? avoidedPreviousCorrect / avoidanceOpportunities : 0;
  return [
    {
      label: "近期命中率",
      value: `${Math.round(correctCount / recent.length * 100)}%`,
      detail: `根据最近 ${recent.length} 道恶意题；SimpBangumi 会据此调整收网频率。`,
      level: correctCount / recent.length >= .65 ? "danger" : "neutral",
    },
    {
      label: "答题节奏",
      value: averageResponseRatio <= .38 ? "偏快" : averageResponseRatio >= .68 ? "偏谨慎" : "中等",
      detail: `秒答错误 ${snapErrors} 次，犹豫错误或超时 ${hesitantErrors} 次。`,
      level: snapErrors || hesitantErrors ? "notice" : "neutral",
    },
    {
      label: "位置偏好",
      value: preferredRate >= .2 ? `第 ${preferredPosition + 1} 项` : "较分散",
      detail: preferredRate >= .2
        ? `该位置占近期有效点击的 ${Math.round(preferredRate * 100)}%， SimpBangumi 会优先在这里布置诱饵，但仍可能放置正确答案。`
        : "尚未发现足够稳定的固定点击位置。",
      level: preferredRate >= .28 ? "danger" : preferredRate >= .2 ? "notice" : "neutral",
    },
    {
      label: "扫描起点",
      value: traversalCounts.some((value) => value > 0) ? `第 ${traversalPosition + 1} 项附近` : "样本不足",
      detail: `首项点击率 ${Math.round(firstRate * 100)}%，末项点击率 ${Math.round(lastRate * 100)}%。`,
      level: Math.max(firstRate, lastRate) >= .22 ? "notice" : "neutral",
    },
    {
      label: "鼠标轨迹",
      value: trajectories.length < 3
        ? "样本不足"
        : averageTrajectoryDirectness >= .72 ? "直奔目标" : averageDirectionChanges >= 3 ? "反复折返" : "逐项排查",
      detail: trajectories.length
        ? `首次靠近第 ${trajectoryApproachPosition + 1} 项最多，停留重心偏向第 ${trajectoryDwellPosition + 1} 项；后续强诱饵会优先埋在这些路径上。`
        : "尚未记录到可用的鼠标移动轨迹；键盘或触控答题不会产生轨迹样本。",
      level: trajectories.length >= 5 ? "danger" : trajectories.length ? "notice" : "neutral",
    },
    {
      label: "反避让倾向",
      value: avoidanceOpportunities < 4 ? "样本不足" : avoidanceRate >= .75 ? "明显" : avoidanceRate >= .58 ? "可能存在" : "未发现",
      detail: avoidanceOpportunities
        ? `有 ${Math.round(avoidanceRate * 100)}% 的机会没有选择上一题正确答案所在位置。`
        : "还没有足够的连续题目用于判断。",
      level: avoidanceRate >= .75 ? "danger" : avoidanceRate >= .58 ? "notice" : "neutral",
    },
    {
      label: "最有效诱饵",
      value: weakestTrap ? trapLabels[weakestTrap[0]] : "尚未识别",
      detail: weakestTrap ? `近期错误中有 ${weakestTrap[1]} 次与该类诱导有关。` : " SimpBangumi 还没有观察到稳定的受骗类型。",
      level: weakestTrap && weakestTrap[1] >= 2 ? "danger" : "neutral",
    },
    {
      label: "视觉依赖推测",
      value: weakestCue ? cueLabels[weakestCue[0]] : "样本不足",
      detail: weakestCue
        ? `${weakestCue[0] === "color" ? "后续题目会提高相似封面配色干扰项的权重。" : "依据该类封面处理下的正确率和反应时间推测。"} 这不是图像识别结论。`
        : "需要经历更多不同封面处理。",
      level: weakestCue ? "notice" : "neutral",
    },
    {
      label: "名称形式弱点",
      value: weakerLanguage,
      detail: weakerLanguage === "暂无明显差异"
        ? "原名与译名下的表现接近。"
        : ` SimpBangumi 会提高使用${weakerLanguage}显示正确项与干扰项的概率。`,
      level: weakerLanguage === "暂无明显差异" ? "neutral" : "notice",
    },
  ];
});
const quizTileSources = computed(() => Array.from(
  { length: activeQuizTreatment.value.tileSize ** 2 },
  (_, index) => index,
));
const quizVisibleTileSources = computed(() => (
  activeQuizTreatment.value.singleTile
    ? [quizSingleTileSource.value]
    : quizTileSources.value
));
const quizTreatmentStyle = computed(() => {
  const current = activeQuizTreatment.value;
  return {
    "--quiz-blur": `${current.blur}px`,
    "--quiz-zoom": String(current.zoom),
    "--quiz-gray": String(current.grayscale),
    "--quiz-invert": String(current.invert),
    "--quiz-hue": `${current.hueRotate}deg`,
    "--quiz-saturate": String(current.saturate),
    "--quiz-sepia": String(current.sepia),
    "--quiz-brightness": String(current.brightness),
    "--quiz-mirror": current.mirror ? "-1" : "1",
    "--quiz-focus-x": `${quizFocus.value.x}%`,
    "--quiz-focus-y": `${quizFocus.value.y}%`,
  };
});
const quizOcclusionRegions = computed(() => {
  if (quizDifficulty.value !== "adaptive" || !activeQuizTreatment.value.occlusion || activeQuizTreatment.value.tileSize > 0) return [];
  const feature = currentQuizVisualFeature.value ?? quizVisualFeatureCache.get(currentQuestion.value?.id ?? -1);
  if (!feature) return [];
  const faceRegions = featureVisualRegions(feature, "face");
  const textRegions = featureVisualRegions(feature, "text");
  if (activeQuizTreatment.value.occlusion === "face") {
    return faceRegions.map((region) => {
      const paddingX = Math.max(.035, region.width * .28);
      const paddingTop = Math.max(.035, region.height * .24);
      const paddingBottom = Math.max(.055, region.height * .46);
      return {
        x: Math.max(0, region.x - paddingX),
        y: Math.max(0, region.y - paddingTop),
        width: Math.min(1, region.width + paddingX * 2),
        height: Math.min(1, region.height + paddingTop + paddingBottom),
        confidence: region.confidence,
      };
    });
  }
  if (activeQuizTreatment.value.occlusion === "text") {
    const candidates = textRegions.map((region) => {
      const paddingX = Math.max(.018, region.width * .08);
      const paddingY = Math.max(.012, region.height * .18);
      const left = Math.max(0, region.x - paddingX);
      const top = Math.max(0, region.y - paddingY);
      const width = Math.min(1 - left, region.width + paddingX * 2);
      const expandedHeight = Math.min(1 - top, region.height + paddingY * 2);
      const height = Math.min(.24, expandedHeight);
      return {
        x: left,
        y: Math.max(0, top + (expandedHeight - height) / 2),
        width,
        height,
        confidence: region.confidence,
      };
    }).sort((first, second) => {
      const firstEdge = Math.abs(first.y + first.height / 2 - .5);
      const secondEdge = Math.abs(second.y + second.height / 2 - .5);
      return second.confidence + second.width * .08 + secondEdge * .08
        - (first.confidence + first.width * .08 + firstEdge * .08);
    });
    const selected: MaliciousVisualRegion[] = [];
    let coveredArea = 0;
    for (const candidate of candidates) {
      if (selected.some((region) => regionOverlap(region, candidate) >= .5)) continue;
      const area = candidate.width * candidate.height;
      if (selected.length && coveredArea + area > .36) continue;
      selected.push(candidate);
      coveredArea += area;
      if (selected.length >= 3) break;
    }
    return selected;
  }
  return [];
});
function quizOcclusionStyle(region: MaliciousVisualRegion) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function drawQuizQuestions(
  pool: GameSubject[],
  count: number,
  requiredGroups: Array<{ ids: Set<number>; count: number }> = [],
): GameSubject[] {
  const subjectsById = new Map(pool.map((subject) => [subject.id, subject]));
  const poolIds = [...subjectsById.keys()];
  const poolSignature = [...poolIds].sort((first, second) => first - second).join(",");

  if (quizDeckPoolSignature !== poolSignature) {
    quizQuestionDeckIds = shuffle(poolIds);
    quizRecentlyUsedIds = [];
    quizDeckPoolSignature = poolSignature;
  } else {
    quizQuestionDeckIds = quizQuestionDeckIds.filter((id) => subjectsById.has(id));
  }

  const selectedIds: number[] = [];
  for (const group of requiredGroups) {
    for (let requiredIndex = 0; requiredIndex < group.count; requiredIndex += 1) {
      let deckIndex = quizQuestionDeckIds.findIndex((id) => group.ids.has(id) && !selectedIds.includes(id));
      if (deckIndex < 0) {
        const recentIds = new Set(quizRecentlyUsedIds);
        const refill = shuffle(poolIds.filter((id) => (
          group.ids.has(id) && !selectedIds.includes(id) && !recentIds.has(id)
        )));
        const fallback = refill.length ? refill : shuffle(poolIds.filter((id) => (
          group.ids.has(id) && !selectedIds.includes(id)
        )));
        quizQuestionDeckIds.unshift(...fallback);
        deckIndex = quizQuestionDeckIds.findIndex((id) => group.ids.has(id) && !selectedIds.includes(id));
      }
      if (deckIndex < 0) break;
      selectedIds.push(quizQuestionDeckIds.splice(deckIndex, 1)[0]);
    }
  }
  while (selectedIds.length < Math.min(count, poolIds.length)) {
    if (!quizQuestionDeckIds.length) {
      const excluded = new Set([...selectedIds, ...quizRecentlyUsedIds]);
      const fresh = shuffle(poolIds.filter((id) => !excluded.has(id)));
      const recent = shuffle(poolIds.filter((id) => !selectedIds.includes(id) && !fresh.includes(id)));
      quizQuestionDeckIds = [...fresh, ...recent];
    }
    const nextId = quizQuestionDeckIds.shift();
    if (nextId !== undefined && !selectedIds.includes(nextId)) selectedIds.push(nextId);
  }
  quizRecentlyUsedIds = [...selectedIds];
  return selectedIds.flatMap((id) => {
    const subject = subjectsById.get(id);
    return subject ? [subject] : [];
  });
}

function getSubjectImage(item: SubjectCollection): string {
  const images = item.subject?.images;
  const image = images?.large || images?.common || images?.medium || images?.small || "";
  return image.startsWith("//") ? `https:${image}` : image;
}

function collectionFamiliarity(type: number | undefined): number {
  if (type === 2) return 1;
  if (type === 3) return .5;
  if (type === 1) return .3;
  return type ? .8 : 0;
}

function normalizeSubject(item: SubjectCollection): GameSubject | null {
  const id = item.subject_id ?? item.subject?.id;
  const image = getSubjectImage(item);
  const originalTitle = item.subject?.name?.trim() || "";
  const translatedTitle = item.subject?.name_cn?.trim() || "";
  const title = translatedTitle || originalTitle;
  if (!id || !image || !title) return null;
  return {
    id, image, title, originalTitle: originalTitle || title, translatedTitle,
    source: "collection", familiarity: collectionFamiliarity(item.type), airDate: item.subject?.date,
  };
}

function normalizeSearchSubject(item: SearchSubject): GameSubject | null {
  if (item.type !== 2) return null;
  const imageValue = item.images?.large || item.images?.common || item.images?.medium || item.images?.small || "";
  const image = imageValue.startsWith("//") ? `https:${imageValue}` : imageValue;
  const originalTitle = item.name?.trim() || "";
  const translatedTitle = item.name_cn?.trim() || "";
  const title = translatedTitle || originalTitle;
  if (!item.id || !image || !title) return null;
  return {
    id: item.id,
    image,
    title,
    originalTitle: originalTitle || title,
    translatedTitle,
    source: "explore",
    airDate: item.date,
    collectionTotal: item.collection_total ?? 0,
    hasRatingData: Number.isFinite(item.score) && (item.score ?? 0) > 0,
  };
}

function maliciousDecoySearchTerms(subject: GameSubject): string[] {
  const variants = quizTitleVariants(subject)
    .map((title) => title.trim())
    .filter((title) => title.length >= 2);
  const installmentStripped = variants.map((title) => title
    .replace(/(?:\s+(?:season|part)\s*\d+|\s*第?[一二三四五六七八九十\d]+[季期部]|\s*(?:ova|oad|sp|剧场版|劇場版))$/iu, "")
    .trim())
    .filter((title) => title.length >= 2);
  const franchiseCores = variants.map(quizFranchiseCore).filter((title) => title.length >= 2);
  const subtitleHeads = variants.flatMap((title) => title.split(/[:：~～—-]/u).map((part) => part.trim()))
    .filter((title) => title.length >= 3);
  return [...new Set([...franchiseCores, ...installmentStripped, ...subtitleHeads, ...variants])].slice(0, 4);
}

function maliciousLocalMaterialCoverage(question: GameSubject, pool: GameSubject[]) {
  let franchise = 0;
  let fatigue = 0;
  const questionFeature = quizVisualFeatureCache.get(question.id);
  for (const candidate of pool) {
    if (candidate.id === question.id) continue;
    const titleKinds = quizTitleVariants(question).flatMap((questionTitle) => (
      quizTitleVariants(candidate).flatMap((candidateTitle) => maliciousTrapKinds(questionTitle, candidateTitle))
    ));
    const sameFranchise = titleKinds.includes("franchise") || titleKinds.includes("installment");
    const visualSimilarity = visualFeatureSimilarity(questionFeature, quizVisualFeatureCache.get(candidate.id));
    if (sameFranchise) franchise += 1;
    if (sameFranchise || titleKinds.includes("similar-title") || visualSimilarity >= .68) fatigue += 1;
  }
  return { franchise, fatigue };
}

async function loadExternalMaliciousDecoys(questions: GameSubject[], runId: number): Promise<GameSubject[]> {
  const searchTargets = questions.map((question) => ({
    question,
    coverage: maliciousLocalMaterialCoverage(question, quizPool.value),
  })).filter(({ coverage }) => coverage.franchise < 2 || coverage.fatigue < 6)
    .sort((first, second) => (
      first.coverage.franchise - second.coverage.franchise
      || first.coverage.fatigue - second.coverage.fatigue
    ));
  const searchesByTarget = searchTargets.map(({ question, coverage }) => {
    const terms = maliciousDecoySearchTerms(question);
    const limit = coverage.franchise < 2 ? 4 : coverage.fatigue < 6 ? 3 : 2;
    return terms.slice(0, limit).map((term) => ({ question, term }));
  });
  // Take one query from every weak question before taking its second query.
  // The old flat slice let the first dozen questions consume the whole request
  // budget in a 30/50-question run, leaving the rest with no external decoys.
  const searches: Array<{ question: GameSubject; term: string }> = [];
  const maxQueriesPerTarget = Math.max(0, ...searchesByTarget.map((items) => items.length));
  for (let queryIndex = 0; queryIndex < maxQueriesPerTarget && searches.length < 48; queryIndex += 1) {
    for (const targetSearches of searchesByTarget) {
      const search = targetSearches[queryIndex];
      if (search) searches.push(search);
      if (searches.length >= 48) break;
    }
  }
  const unique = new Map<number, GameSubject>();
  if (!searches.length) return [];
  updateQuizInitialization(74, "正在搜索缓存外的系列与相似标题干扰项…", 0, searches.length);
  for (let offset = 0; offset < searches.length; offset += 3) {
    const batch = searches.slice(offset, offset + 3);
    const results = await Promise.all(batch.map(({ term }) => bangumi.searchSubjects(term, {
      subject_types: [2],
      sort: "match",
      limit: 20,
    })));
    results.forEach((result, resultIndex) => {
      if (!result.ok) return;
      const question = batch[resultIndex].question;
      const term = batch[resultIndex].term;
      const rankedMatches = result.data.data.flatMap((item, resultRank) => {
        const subject = normalizeSearchSubject(item);
        if (!subject || subject.id === question.id) return [];
        const bestConfusability = Math.max(...quizTitleVariants(question).flatMap((questionTitle) => (
          quizTitleVariants(subject).map((decoyTitle) => titleConfusability(questionTitle, decoyTitle))
        )));
        const termAffinity = Math.max(...quizTitleVariants(subject).map((title) => titleSimilarity(term, title)));
        const sameFranchise = quizTitleVariants(question).some((questionTitle) => (
          quizTitleVariants(subject).some((candidateTitle) => {
            const questionCore = quizFranchiseCore(questionTitle);
            return !!questionCore && questionCore === quizFranchiseCore(candidateTitle);
          })
        ));
        return [{ subject, bestConfusability, termAffinity, sameFranchise, resultRank }];
      }).sort((first, second) => (
        Number(second.sameFranchise) - Number(first.sameFranchise)
        || second.bestConfusability - first.bestConfusability
        || second.termAffinity - first.termAffinity
        || first.resultRank - second.resultRank
      ));
      // Keep every strong match and a small fuzzy tail from Bangumi's own
      // match-ranked results. A single title threshold commonly reduced valid
      // sequel or translated-name searches to only one or two subjects.
      const accepted = rankedMatches.filter((match, index) => (
        match.sameFranchise
        || match.bestConfusability >= .18
        || (index < 6 && (match.bestConfusability >= .1 || match.termAffinity >= .2))
      ));
      for (const { subject } of accepted) unique.set(subject.id, subject);
    });
    updateQuizInitialization(74 + Math.min(searches.length, offset + batch.length) / Math.max(1, searches.length) * 8, "正在搜索缓存外的系列与相似标题干扰项…", Math.min(searches.length, offset + batch.length), searches.length);
    await waitForAnimationFrame();
    if (runId !== quizInitializationRunId) return [];
  }
  return [...unique.values()];
}

function promoteExternalMaliciousQuestions(
  questions: GameSubject[],
  externalSubjects: GameSubject[],
): GameSubject[] {
  if (!externalSubjects.length) return questions;
  const blockSize = maliciousHistoryBlockSize();
  const blocked = new Set(maliciousHistory.value.slice(-blockSize).map((item) => item.id));
  const usedIds = new Set(questions.map((question) => question.id));
  const result = [...questions];
  let promoted = 0;
  const promotionLimit = unknownChallenge.value
    ? Math.max(2, Math.ceil(questions.length * .12))
    : Math.max(1, Math.ceil(questions.length * .08));
  for (const questionIndex of shuffle(Array.from({ length: questions.length }, (_, index) => index))) {
    if (promoted >= promotionLimit) break;
    const question = questions[questionIndex];
    const candidates = externalSubjects
      .filter((subject) => !blocked.has(subject.id) && !usedIds.has(subject.id))
      .map((subject) => ({
        subject,
        similarity: Math.max(...quizTitleVariants(question).flatMap((questionTitle) => (
          quizTitleVariants(subject).map((candidateTitle) => titleConfusability(questionTitle, candidateTitle))
        ))),
        exposure: maliciousExposure.value[String(subject.id)]?.total ?? 0,
      }))
      .filter((item) => item.similarity >= .34)
      .sort((first, second) => first.exposure - second.exposure || second.similarity - first.similarity);
    const candidateBand = candidates.filter((item) => item.exposure === (candidates[0]?.exposure ?? -1)).slice(0, 4);
    const selected = shuffle(candidateBand)[0]?.subject;
    if (!selected) continue;
    result[questionIndex] = { ...selected, source: "explore" };
    usedIds.add(selected.id);
    promoted += 1;
  }
  return result;
}

function parseBangumiBrowserPage(html: string): GameSubject[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const items = document.querySelectorAll<HTMLElement>("#browserItemList > li, li[id^='item_']");
  const subjects: GameSubject[] = [];
  for (const item of items) {
    const id = Number(item.id.match(/^item_(\d+)$/)?.[1]);
    const titleAnchor = item.querySelector<HTMLAnchorElement>("h3 a[href*='/subject/']")
      ?? item.querySelector<HTMLAnchorElement>("a[href*='/subject/']");
    const translatedTitle = titleAnchor?.textContent?.trim() || "";
    const originalTitle = item.querySelector("h3 small")?.textContent?.trim().replace(/^[/·\s]+/, "") || translatedTitle;
    const imageElement = item.querySelector<HTMLImageElement>(".subjectCover img, img");
    const imageContainer = item.querySelector<HTMLElement>(".subjectCover .image, .cover .image");
    const imageAttribute = imageElement?.getAttribute("data-src")
      || imageElement?.getAttribute("src")
      || imageContainer?.style.backgroundImage.match(/url\(["']?(.+?)["']?\)/)?.[1]
      || "";
    let image = "";
    try {
      image = imageAttribute ? new URL(imageAttribute, "https://bangumi.tv").href : "";
    } catch { /* ignore malformed cover URLs */ }
    if (!id || !translatedTitle || !image) continue;
    const text = item.textContent || "";
    const airDate = text.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/u)?.[0];
    const collectionTotal = Number(text.match(/([\d,]+)\s*人收藏/iu)?.[1]?.replace(/,/g, "")) || 0;
    const ratingTotal = Number(text.match(/([\d,]+)\s*人评分/iu)?.[1]?.replace(/,/g, "")) || 0;
    const hasRatingData = !!item.querySelector(".rateInfo, .starstop-s, .fade") || ratingTotal > 0;
    subjects.push({
      id,
      image,
      title: translatedTitle,
      originalTitle,
      translatedTitle: originalTitle === translatedTitle ? "" : translatedTitle,
      collectionTotal,
      ratingTotal,
      hasRatingData,
      airDate,
    });
  }
  return subjects;
}

function validCachedSubjects(items: GameSubject[], source: MaliciousPoolSource): GameSubject[] {
  return items.filter((item) => item.id > 0 && !!item.image && !!item.title).map((item) => ({ ...item, source }));
}

function mergeMaliciousSubjects(source: MaliciousPoolSource, ...groups: GameSubject[][]): GameSubject[] {
  const unique = new Map<number, GameSubject>();
  for (const subject of groups.flat()) {
    if (subject.id > 0 && subject.image && subject.title) unique.set(subject.id, { ...subject, source });
  }
  return [...unique.values()];
}

async function loadMaliciousSubjectPools(): Promise<boolean> {
  maliciousPools.value.collection = subjects.value.map((subject) => ({ ...subject, source: "collection" }));
  const cached = readMaliciousPoolCache();
  const cachedPopular = cached ? validCachedSubjects(cached.popular, "popular") : [];
  const cachedObscure = cached ? validCachedSubjects(cached.obscure, "obscure") : [];
  const cachedExplore = cached ? validCachedSubjects(cached.explore, "explore") : [];
  const cacheHealthy = !!cached
    && Date.now() - cached.updatedAt < MALICIOUS_POOL_CACHE_TTL
    && cachedPopular.length >= 250
    && cachedObscure.length >= 80
    && cachedExplore.length >= 100;

  updateQuizInitialization(14, cacheHealthy ? "正在探索新的动画候选…" : "正在更新恶意题库的本地候选缓存…");
  const randomStart = 40 + Math.floor(Math.random() * 260);
  // Refresh the obscure band on every run from a different rank window so
  // the pool does not remain stale for the full cache TTL.
  const obscureStart = 24 + Math.floor(Math.random() * 180);
  const [popularRaw, obscureRaw, exploreRaw] = await Promise.all([
    cacheHealthy ? Promise.resolve([]) : fetchBangumiBrowserPageRange("rank", Array.from({ length: 22 }, (_, index) => index + 1)),
    fetchBangumiBrowserPageRange("rank", Array.from({ length: 8 }, (_, index) => obscureStart + index * 2)),
    fetchBangumiBrowserPageRange("rank", Array.from({ length: 4 }, (_, index) => randomStart + index * 11)),
  ]);
  const popular = mergeMaliciousSubjects("popular", cachedPopular, popularRaw).slice(0, 500);
  const popularTailStart = Math.min(300, Math.floor(popularRaw.length * .6));
  const obscureBase = [...obscureRaw, ...popularRaw.slice(popularTailStart)];
  const newObscure = [...new Map(obscureBase.map((item) => [item.id, item])).values()]
    .filter((item) => item.hasRatingData && ((item.collectionTotal ?? 0) > 0 || (item.ratingTotal ?? 0) > 0 || item.hasRatingData))
    .map((item) => ({ ...item, source: "obscure" as const }));
  // Fresh candidates take priority; retain a bounded tail of the old cache as
  // a fallback so transient API failures do not collapse the pool.
  const obscure = mergeMaliciousSubjects("obscure", newObscure, cachedObscure).slice(0, 400);
  const explorationBase = exploreRaw.length >= quizQuestionCount.value
    ? exploreRaw
    : shuffle([...obscureRaw, ...popularRaw.slice(popularTailStart)]).slice(0, 80);
  const explore = mergeMaliciousSubjects("explore", explorationBase, cachedExplore).slice(0, 800);
  if (popular.length < quizQuestionCount.value || obscure.length < quizQuestionCount.value || explore.length < quizQuestionCount.value) {
    if (!cached) return false;
    maliciousPools.value = {
      collection: maliciousPools.value.collection,
      popular: validCachedSubjects(cached.popular, "popular"),
      obscure: validCachedSubjects(cached.obscure, "obscure"),
      explore: validCachedSubjects(cached.explore, "explore"),
    };
    return true;
  }
  maliciousPools.value = { collection: maliciousPools.value.collection, popular, obscure, explore };
  try {
    localStorage.setItem(QUIZ_MALICIOUS_POOL_CACHE_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), popular, obscure, explore }));
  } catch { /* cache is best effort */ }
  return true;
}

async function fetchBangumiBrowserPageRange(
  sort: "trends" | "rank",
  pages: number[],
): Promise<GameSubject[]> {
  const unique = new Map<number, GameSubject>();
  // Small batches avoid turning a partial rate-limit response into a total first-run failure.
  for (let offset = 0; offset < pages.length; offset += 4) {
    const results = await Promise.all(pages.slice(offset, offset + 4).map((page) => (
      bangumi.fetchAnimeBrowserPage(sort, page)
    )));
    for (const result of results) {
      if (!result.ok) continue;
      for (const subject of parseBangumiBrowserPage(result.data)) unique.set(subject.id, subject);
    }
  }
  return [...unique.values()];
}

async function fetchBangumiBrowserSubjects(
  sort: "trends" | "rank",
  pages: number,
  limit: number,
): Promise<GameSubject[] | null> {
  const subjects = await fetchBangumiBrowserPageRange(
    sort,
    Array.from({ length: pages }, (_, index) => index + 1),
  );
  return subjects.length ? subjects.slice(0, limit) : null;
}

async function loadBonusSubjectGroups(
  includeSeasonal: boolean,
  includeGlobal: boolean,
): Promise<{ seasonal: GameSubject[]; global: GameSubject[] } | null> {
  if (!includeSeasonal && !includeGlobal) return { seasonal: [], global: [] };
  loading.value = true;
  error.value = "";
  const [seasonalSubjects, globalSubjects] = await Promise.all([
    includeSeasonal
      ? fetchBangumiBrowserSubjects("trends", 3, 50)
      : Promise.resolve([]),
    includeGlobal
      ? fetchBangumiBrowserSubjects("rank", 3, 50)
      : Promise.resolve([]),
  ]);
  loading.value = false;
  if (seasonalSubjects === null || globalSubjects === null) {
    error.value = "暂时无法读取所选榜单题库，请稍后再试或取消勾选。";
    return null;
  }
  return { seasonal: seasonalSubjects, global: globalSubjects };
}

async function loadQuizBonusSubjects(): Promise<GameSubject[] | null> {
  const groups = await loadBonusSubjectGroups(
    quizEffectiveSeasonalTop.value,
    quizEffectiveGlobalTop.value,
  );
  if (!groups) return null;
  const { seasonal: seasonalSubjects, global: globalSubjects } = groups;
  quizSeasonalSubjectIds.value = seasonalSubjects.map((subject) => subject.id);
  quizGlobalSubjectIds.value = globalSubjects.map((subject) => subject.id);
  return [...seasonalSubjects, ...globalSubjects];
}

async function loadAnimeCollections(minimum = 6, shortageMessage = ""): Promise<boolean> {
  if (subjects.value.length >= minimum) return true;
  loading.value = true;
  error.value = "";
  const loaded: SubjectCollection[] = [];
  const limit = 100;

  for (let offset = 0; offset < 1000; offset += limit) {
    const result = await bangumi.getCollections({ subject_type: 2, limit, offset });
    if (!result.ok) {
      error.value = "暂时无法读取收藏，请确认已登录后再试。";
      loading.value = false;
      return false;
    }
    loaded.push(...result.data.data);
    const total = result.data.total;
    if (result.data.data.length < limit || (typeof total === "number" && loaded.length >= total)) break;
  }

  const unique = new Map<number, GameSubject>();
  for (const item of loaded) {
    const subject = normalizeSubject(item);
    if (subject) unique.set(subject.id, subject);
  }
  subjects.value = [...unique.values()];
  loading.value = false;

  if (subjects.value.length < minimum) {
    error.value = shortageMessage || `收藏中至少需要 ${minimum} 部带封面的动画才能开始当前模式。`;
    return false;
  }
  return true;
}

async function startMemory() {
  if (!await loadAnimeCollections()) return;
  const bonusGroups = await loadBonusSubjectGroups(
    memoryIncludeSeasonalTop.value,
    memoryIncludeGlobalTop.value,
  );
  if (!bonusGroups) return;
  clearGameTimers();
  const bonusSubjects = [...bonusGroups.seasonal, ...bonusGroups.global];
  const pool = [...new Map<number, GameSubject>([...subjects.value, ...bonusSubjects].map((subject) => [subject.id, subject])).values()];
  const enabledGroups = [
    memoryIncludeSeasonalTop.value ? bonusGroups.seasonal : [],
    memoryIncludeGlobalTop.value ? bonusGroups.global : [],
  ].filter((group) => group.length > 0);
  const guaranteedPerGroup = enabledGroups.length === 1 ? 2 : 1;
  const selected: GameSubject[] = [];
  for (const group of enabledGroups) {
    selected.push(...shuffle(group)
      .filter((subject) => !selected.some((selectedSubject) => selectedSubject.id === subject.id))
      .slice(0, guaranteedPerGroup));
  }
  selected.push(...shuffle(pool)
    .filter((subject) => !selected.some((selectedSubject) => selectedSubject.id === subject.id))
    .slice(0, 6 - selected.length));
  memoryCards.value = shuffle(selected.flatMap((subject) => [
    { ...subject, cardId: `${subject.id}-a` },
    { ...subject, cardId: `${subject.id}-b` },
  ]));
  openCardIds.value = [];
  matchedSubjectIds.value = [];
  memoryMoves.value = 0;
  elapsedSeconds.value = 0;
  memoryScore.value = 0;
  memoryNewRecord.value = false;
  memoryStartedAt.value = Date.now();
  mode.value = "memory";
  memoryClock = window.setInterval(() => {
    elapsedSeconds.value = Math.floor((Date.now() - memoryStartedAt.value) / 1000);
  }, 1000);
}

function flipCard(card: MemoryCard) {
  if (openCardIds.value.length >= 2 || openCardIds.value.includes(card.cardId) || matchedSubjectIds.value.includes(card.id)) return;
  openCardIds.value = [...openCardIds.value, card.cardId];
  if (openCardIds.value.length < 2) return;

  memoryMoves.value += 1;
  const [firstId, secondId] = openCardIds.value;
  const first = memoryCards.value.find((item) => item.cardId === firstId);
  const second = memoryCards.value.find((item) => item.cardId === secondId);
  if (first && second && first.id === second.id) {
    matchedSubjectIds.value = [...matchedSubjectIds.value, first.id];
    openCardIds.value = [];
    if (matchedSubjectIds.value.length === memoryCards.value.length / 2) finishMemoryGame();
    return;
  }

  flipTimer = window.setTimeout(() => {
    openCardIds.value = [];
  }, 720);
}

function finishMemoryGame() {
  stopMemoryClock();
  const extraMoves = Math.max(0, memoryMoves.value - memoryCards.value.length / 2);
  memoryScore.value = Math.max(0, 10_000 - extraMoves * 300 - elapsedSeconds.value * 20);
  if (memoryScore.value <= memoryHighScore.value) return;
  memoryHighScore.value = memoryScore.value;
  memoryNewRecord.value = true;
  try {
    localStorage.setItem(MEMORY_GAME_HIGH_SCORE_KEY, String(memoryScore.value));
  } catch { /* local persistence is best effort */ }
}

function isCardVisible(card: MemoryCard): boolean {
  return openCardIds.value.includes(card.cardId) || matchedSubjectIds.value.includes(card.id);
}

function updateQuizInitialization(progress: number, message: string, completed = 0, total = 0) {
  quizInitializationProgress.value = Math.max(0, Math.min(100, Math.round(progress)));
  quizInitializationMessage.value = message;
  quizInitializationCompleted.value = completed;
  quizInitializationTotal.value = total;
}

function startQuizInitializationClock() {
  if (quizInitializationClock !== undefined) window.clearInterval(quizInitializationClock);
  const startedAt = Date.now();
  quizInitializationElapsedSeconds.value = 0;
  quizInitializationClock = window.setInterval(() => {
    quizInitializationElapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000);
  }, 250);
}

function stopQuizInitializationClock() {
  if (quizInitializationClock !== undefined) window.clearInterval(quizInitializationClock);
  quizInitializationClock = undefined;
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function paintQuizInitialization(): Promise<void> {
  await nextTick();
  // Two frames ensure the mode switch is composited before cached synchronous work starts.
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}

function maliciousVisualIndexCandidates(candidates: GameSubject[], pool: GameSubject[], limit = 96): GameSubject[] {
  const selected = new Map<number, GameSubject>();
  for (const candidate of candidates) selected.set(candidate.id, candidate);
  for (const question of candidates) {
    const confusing = pool
      .filter((subject) => subject.id !== question.id && !selected.has(subject.id))
      .sort((first, second) => (
        titleConfusability(question.title, second.title) - titleConfusability(question.title, first.title)
      ))
      .slice(0, 5);
    for (const subject of confusing) selected.set(subject.id, subject);
  }
  for (const subject of shuffle(pool)) {
    if (selected.size >= limit) break;
    selected.set(subject.id, subject);
  }
  return [...selected.values()].slice(0, Math.max(limit, candidates.length));
}

async function initializeMaliciousVisualIndex(
  candidates: GameSubject[],
  pool: GameSubject[],
  runId: number,
): Promise<boolean> {
  const visualCandidates = maliciousVisualIndexCandidates(candidates, pool);
  let completed = 0;
  updateQuizInitialization(20, "正在建立封面视觉索引…", completed, visualCandidates.length);
  const workers = Array.from({ length: Math.min(8, visualCandidates.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < visualCandidates.length; index += 8) {
      if (runId !== quizInitializationRunId) return;
      await loadVisualFeature(visualCandidates[index]);
      if (runId !== quizInitializationRunId) return;
      completed += 1;
      updateQuizInitialization(
        20 + completed / Math.max(1, visualCandidates.length) * 48,
        "正在分析封面配色、人脸候选区与文字带…",
        completed,
        visualCandidates.length,
      );
    }
  });
  await Promise.all(workers);
  return runId === quizInitializationRunId;
}

async function initializeExactVisualFeatures(
  candidates: GameSubject[],
  runId: number,
): Promise<boolean> {
  const pending = candidates.filter((subject) => !quizVisualFeatureCache.has(subject.id));
  let completed = 0;
  updateQuizInitialization(82, "正在分析新发现的候选封面（已有候选不重复分析）…", completed, pending.length);
  for (let offset = 0; offset < pending.length; offset += 6) {
    const batch = pending.slice(offset, offset + 6);
    await Promise.all(batch.map(loadVisualFeature));
    completed += batch.length;
    updateQuizInitialization(82 + completed / Math.max(1, pending.length) * 16, "正在分析新发现的候选封面（已有候选不重复分析）…", completed, pending.length);
    await waitForAnimationFrame();
    if (runId !== quizInitializationRunId) return false;
  }
  return runId === quizInitializationRunId;
}

async function startQuiz() {
  if (quizDifficulty.value === "adaptive" && !adaptiveUnlocked.value) return;
  if (quizDifficulty.value === "adaptive" && maliciousSoundEnabled.value) {
    void ensureMaliciousAudio().then(() => playMaliciousSound("arm"));
  }
  maliciousRunAudioMark.value = quizDifficulty.value === "adaptive" && !maliciousSoundEnabled.value ? "muted" : null;
  if (quizDifficulty.value === "adaptive") void sampleMaliciousSystemAudio();
  const runId = ++quizInitializationRunId;
  mode.value = "quiz-initializing";
  startQuizInitializationClock();
  error.value = "";
  updateQuizInitialization(3, "正在读取动画收藏…");
  await paintQuizInitialization();
  if (runId !== quizInitializationRunId) return;
  const hasEnoughSubjects = await loadAnimeCollections(
    QUIZ_MIN_POOL_SIZE,
    `你的「收藏」中带封面的动画还不够多。等收藏到至少 ${QUIZ_MIN_POOL_SIZE} 部后再来吧。`,
  );
  if (runId !== quizInitializationRunId) return;
  if (!hasEnoughSubjects) {
    updateQuizInitialization(0, "初始化未完成");
    return;
  }
  updateQuizInitialization(12, "正在准备本局题库…");
  // Long games need a broader local pool to avoid recycling the same titles.
  // This only expands the source pool; malicious treatments remain adaptive-only.
  quizForcedExpansion.value = subjects.value.length < Math.max(QUIZ_FORCE_EXPANSION_THRESHOLD, quizQuestionCount.value);
  let bonusSubjects: GameSubject[] | null;
  if (quizDifficulty.value === "adaptive") {
    const loadedPools = await loadMaliciousSubjectPools();
    bonusSubjects = loadedPools
      ? [...maliciousPools.value.popular, ...maliciousPools.value.obscure, ...maliciousPools.value.explore]
      : null;
    if (!loadedPools) error.value = "恶意题库暂时无法更新，且本机没有可用缓存，请稍后再试。";
  } else {
    bonusSubjects = await loadQuizBonusSubjects();
  }
  if (runId !== quizInitializationRunId) return;
  if (bonusSubjects === null) {
    updateQuizInitialization(0, "初始化未完成");
    return;
  }
  clearGameTimers();
  const combinedPool = new Map<number, GameSubject>();
  for (const subject of [...subjects.value, ...bonusSubjects]) combinedPool.set(subject.id, subject);
  quizPool.value = [...combinedPool.values()];
  if (quizDifficulty.value === "adaptive") {
    maliciousQuestionTrapScoreCache.clear();
    maliciousOptionCandidateCache.clear();
    maliciousOptionSubjectCache.clear();
  }
  const enabledBonusGroupCount = Number(quizEffectiveSeasonalTop.value) + Number(quizEffectiveGlobalTop.value);
  const guaranteedCount = enabledBonusGroupCount === 1 ? 4 : 3;
  const requiredGroups: Array<{ ids: Set<number>; count: number }> = [];
  if (quizEffectiveSeasonalTop.value) {
    requiredGroups.push({ ids: new Set(quizSeasonalSubjectIds.value), count: guaranteedCount });
  }
  if (quizEffectiveGlobalTop.value) {
    requiredGroups.push({ ids: new Set(quizGlobalSubjectIds.value), count: guaranteedCount });
  }
  const candidateCount = quizDifficulty.value === "adaptive"
    ? Math.min(quizPool.value.length, Math.max(quizQuestionCount.value * 4, 36))
    : quizQuestionCount.value;
  const drawnCandidates = quizDifficulty.value === "adaptive"
    ? weightedMaliciousCandidates(candidateCount)
    : drawQuizQuestions(quizPool.value, candidateCount, requiredGroups);
  if (quizDifficulty.value === "adaptive") {
    const indexed = await initializeMaliciousVisualIndex(drawnCandidates, quizPool.value, runId);
    if (!indexed) return;
  } else {
    updateQuizInitialization(88, "正在排列题目与选项…");
    await nextTick();
  }
  let drawnQuestions = quizDifficulty.value === "adaptive"
    ? await selectMaliciousQuestions(drawnCandidates, quizQuestionCount.value, requiredGroups, runId)
    : drawnCandidates;
  if (runId !== quizInitializationRunId) return;
  if (quizDifficulty.value === "adaptive") {
    const externalDecoys = await loadExternalMaliciousDecoys(drawnQuestions, runId);
    if (runId !== quizInitializationRunId) return;
    const expandedPool = new Map(quizPool.value.map((subject) => [subject.id, subject]));
    for (const decoy of externalDecoys) if (!expandedPool.has(decoy.id)) expandedPool.set(decoy.id, decoy);
    quizPool.value = [...expandedPool.values()];
    drawnQuestions = promoteExternalMaliciousQuestions(drawnQuestions, externalDecoys);
    // A 30/50-question run should not silently shrink when the cached pools
    // are thin. Search results are valid question material as well as decoys.
    if (drawnQuestions.length < quizQuestionCount.value) {
      const used = new Set(drawnQuestions.map((question) => question.id));
      const supplemental = shuffle(externalDecoys.filter((subject) => !used.has(subject.id)))
        .slice(0, quizQuestionCount.value - drawnQuestions.length);
      drawnQuestions = [...drawnQuestions, ...supplemental];
    }
    if (drawnQuestions.length < quizQuestionCount.value) {
      const used = new Set(drawnQuestions.map((question) => question.id));
      const supplemental = shuffle(quizPool.value.filter((subject) => !used.has(subject.id)))
        .slice(0, quizQuestionCount.value - drawnQuestions.length);
      drawnQuestions = [...drawnQuestions, ...supplemental];
    }
    if (externalDecoys.length) {
      const exactDecoys = [...new Map([...externalDecoys, ...drawnQuestions].map((subject) => [subject.id, subject])).values()]
        .sort((first, second) => Math.max(...drawnQuestions.map((question) => titleConfusability(question.title, second.title)))
          - Math.max(...drawnQuestions.map((question) => titleConfusability(question.title, first.title))))
        .slice(0, 48);
      if (!await initializeExactVisualFeatures(exactDecoys, runId)) return;
    }
    drawnQuestions = await applyMaliciousSeasonSwitches(drawnQuestions, runId);
    if (runId !== quizInitializationRunId) return;
  }
  updateQuizInitialization(98, quizDifficulty.value === "adaptive" ? "正在编排题目与干扰项…" : "正在完成初始化…");
  quizQuestions.value = quizDifficulty.value === "adaptive"
    ? await arrangeMaliciousQuestionSequence(drawnQuestions)
    : drawnQuestions;
  if (runId !== quizInitializationRunId) return;
  if (quizDifficulty.value === "adaptive") {
    const profileAccuracy = quizBehaviorProfile.value.answered
      ? quizBehaviorProfile.value.correct / quizBehaviorProfile.value.answered
      : 0;
    adaptivePressure.value = Math.max(.82, Math.min(.97, .82 + profileAccuracy * .15));
    for (const question of quizQuestions.value) {
      if (!maliciousQuestionTrapScoreCache.has(question.id)) {
        maliciousQuestionTrapScoreCache.set(question.id, maliciousQuestionTrapScore(question, quizPool.value));
      }
    }
    buildMaliciousOptionCandidateIndex(quizQuestions.value, quizPool.value);
    preloadQuizCover(quizQuestions.value[0]);
    preloadQuizCover(quizQuestions.value[1]);
  }
  quizIndex.value = 0;
  quizScore.value = 0;
  quizMaliciousDecoyIds.value = quizMaliciousAnalysis.value.recent
    .filter((item) => !item.correct && Number.isFinite(item.selectedId))
    .map((item) => item.selectedId as number)
    .reverse()
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 6);
  quizVisitedOptionIndexes.value = [];
  currentQuizVisualFeature.value = null;
  maliciousPhase.value = "probe";
  maliciousRunObservations.value = [];
  fatigueRunObservations.value = [];
  currentConfidenceTrap.value = false;
  fatigueRunStartedAt = performance.now();
  maliciousRunAnchorPosition.value = -1;
  maliciousEchoState.value = null;
  maliciousEchoCount.value = 0;
  quizCorrectCount.value = 0;
  quizCorrectStreak.value = 0;
  quizBestStreak.value = 0;
  quizLastBrokenStreak.value = 0;
  quizAnswerStats.value = { wrong: 0, timedOut: 0, hesitantWrong: 0, snapWrong: 0 };
  quizEarnedPoints.value = 0;
  quizCurrentTimeLimitMs.value = quizTimeLimitMs.value;
  quizNextTimeReductionMs.value = 0;
  quizTimeoutPenalty.value = "none";
  quizTimeoutScoreDeduction.value = 0;
  quizTimeoutTimeReduction.value = 0;
  quizNewRecord.value = false;
  quizFinished.value = false;
  quizSelectedId.value = null;
  quizAnswerReveal.value = false;
  quizTransitioning.value = false;
  prepareQuizOptions();
  updateQuizInitialization(100, "初始化完成");
  stopQuizInitializationClock();
  mode.value = "quiz";
}

function selectQuizDifficulty(difficulty: QuizDifficulty) {
  if (difficulty === "adaptive" && !adaptiveUnlocked.value) return;
  quizDifficulty.value = difficulty;
  if (difficulty !== "adaptive") unknownChallenge.value = false;
  if (difficulty !== "adaptive") showMaliciousReport.value = false;
}

function toggleMaliciousReport() {
  const previousBounds = gameShellRef.value?.getBoundingClientRect();
  if (showMaliciousReport.value) {
    maliciousReportExpandedBounds = previousBounds ? {
      width: previousBounds.width,
      height: previousBounds.height,
    } : undefined;
    showMaliciousReport.value = false;
    return;
  }
  showMaliciousReport.value = !showMaliciousReport.value;
  void nextTick(() => animateGameShellBounds(previousBounds ? {
    width: previousBounds.width,
    height: previousBounds.height,
  } : undefined));
}

function animateMaliciousReportCollapse() {
  animateGameShellBounds(maliciousReportExpandedBounds);
  maliciousReportExpandedBounds = undefined;
}

function updateQuizDifficultyIndicator() {
  const container = quizDifficultyTabsRef.value;
  const activeTab = container?.querySelector<HTMLElement>(`[data-difficulty="${quizDifficulty.value}"]`);
  if (!container || !activeTab) return;
  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  quizDifficultyIndicatorStyle.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
  quizDifficultyIndicatorReady.value = true;
}

function normalizeQuizTitle(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function titleSimilarity(firstTitle: string, secondTitle: string): number {
  const first = normalizeQuizTitle(firstTitle);
  const second = normalizeQuizTitle(secondTitle);
  if (!first || !second) return 0;
  if (first === second) return 1;
  const firstPairs = new Set(Array.from({ length: Math.max(1, first.length - 1) }, (_, index) => first.slice(index, index + 2)));
  const secondPairs = new Set(Array.from({ length: Math.max(1, second.length - 1) }, (_, index) => second.slice(index, index + 2)));
  let shared = 0;
  for (const pair of firstPairs) if (secondPairs.has(pair)) shared += 1;
  const pairScore = 2 * shared / Math.max(1, firstPairs.size + secondPairs.size);
  let prefixLength = 0;
  while (prefixLength < Math.min(first.length, second.length) && first[prefixLength] === second[prefixLength]) prefixLength += 1;
  const prefixScore = prefixLength / Math.max(first.length, second.length);
  const lengthScore = Math.min(first.length, second.length) / Math.max(first.length, second.length);
  return pairScore * .62 + prefixScore * .28 + lengthScore * .1;
}

function quizTitleVariants(subject: GameSubject): string[] {
  return [...new Set([
    subject.title,
    subject.originalTitle,
    subject.translatedTitle,
  ].map((title) => title.trim()).filter(Boolean))];
}

function behaviorStatWeakness(stat: QuizBehaviorStat | undefined): number {
  if (!stat || stat.seen === 0) return 1.15;
  const accuracy = stat.correct / stat.seen;
  const averageResponseRatio = stat.responseRatioTotal / stat.seen;
  return (1 - accuracy) * .72 + averageResponseRatio * .28;
}

function quizTreatmentFamilies(current: QuizTreatment): QuizTreatmentFamily[] {
  const families: QuizTreatmentFamily[] = [];
  if (current.blur > 0) families.push("blur");
  if (current.zoom > 1) families.push("zoom");
  if (current.grayscale > 0) families.push("grayscale");
  if (current.invert > 0) families.push("invert");
  if (current.hueRotate !== 0 || current.saturate !== 1 || current.sepia > 0) families.push("color-filter");
  if (current.mirror) families.push("mirror");
  if (current.tileSize > 0) families.push("tiles");
  if (current.singleTile) families.push("single-tile");
  if (current.movingTiles) families.push("moving");
  return families;
}

function adaptiveTreatmentWeakness(current: QuizTreatment): number {
  const families = quizTreatmentFamilies(current);
  const cues = maliciousTreatmentCues(current);
  if (!families.length && !cues.length) return 0;
  const familyWeakness = families.length
    ? families.reduce((total, family) => (
      total + behaviorStatWeakness(quizBehaviorProfile.value.treatmentStats[family])
    ), 0) / families.length + families.length * .035
    : 0;
  const cueWeakness = cues.length
    ? cues.reduce((total, cue) => total + behaviorStatWeakness(quizMaliciousAnalysis.value.cueStats[cue]), 0) / cues.length
    : 0;
  return familyWeakness + cueWeakness * .42;
}

function maliciousTreatmentCues(current: QuizTreatment): MaliciousVisualCue[] {
  const cues: MaliciousVisualCue[] = [];
  if (current.zoom >= 1.35 || current.blur >= 8 || current.occlusion === "face" || current.occlusion === "both") cues.push("character");
  if (current.grayscale >= .7 || current.invert > 0 || current.hueRotate !== 0 || current.saturate !== 1 || current.sepia > 0) cues.push("color");
  if (current.mirror || current.tileSize > 0 || current.singleTile) cues.push("composition");
  if ((current.zoom >= 1.55 && current.blur >= 5) || current.occlusion === "text" || current.occlusion === "both") cues.push("text");
  return [...new Set(cues)];
}

function quizFranchiseCore(title: string): string {
  return normalizeQuizTitle(title)
    .replace(/(?:第?[一二三四五六七八九十百\d]+(?:季|期|章|篇|部)|season\d*|\d+(?:st|nd|rd|th)season|part\d+|剧场版|劇場版|总集篇|總集篇|续篇|續篇|完结篇|完結篇|finalseason|thefinal)$/giu, "")
    .replace(/[一二三四五六七八九十\d]+$/gu, "");
}

function subjectFranchiseKeys(subject: GameSubject): string[] {
  return [...new Set(quizTitleVariants(subject)
    .map(quizFranchiseCore)
    .filter((core) => core.length >= 2))];
}

function subjectFranchiseKey(subject: GameSubject): string {
  return subjectFranchiseKeys(subject).sort((first, second) => first.length - second.length)[0] ?? "";
}

function subjectsShareFranchise(first: GameSubject, second: GameSubject): boolean {
  const firstKeys = new Set(subjectFranchiseKeys(first));
  return subjectFranchiseKeys(second).some((key) => firstKeys.has(key));
}

function subjectSeasonKey(subject: GameSubject): string {
  const match = subject.airDate?.match(/^(\d{4})-(\d{2})/u);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}-Q${Math.floor((month - 1) / 3) + 1}`;
}

type MaliciousSeasonMastery = {
  franchiseKey: string;
  seasonKey: string;
  seen: number;
  correct: number;
};

function maliciousSeasonMasteries(): MaliciousSeasonMastery[] {
  const grouped = new Map<string, MaliciousSeasonMastery>();
  for (const observation of maliciousRecent(48)) {
    const franchiseKey = observation.franchiseKey || quizFranchiseCore(observation.questionTitle);
    const seasonKey = observation.seasonKey || "";
    if (!franchiseKey || !seasonKey) continue;
    const key = `${franchiseKey}\u0000${seasonKey}`;
    const current = grouped.get(key) ?? { franchiseKey, seasonKey, seen: 0, correct: 0 };
    current.seen += 1;
    current.correct += Number(observation.correct);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .filter((item) => item.seen >= 3 && item.correct >= 2 && item.correct / item.seen >= 2 / 3)
    .sort((first, second) => (
      second.correct / second.seen - first.correct / first.seen
      || second.seen - first.seen
    ));
}

async function applyMaliciousSeasonSwitches(questions: GameSubject[], runId: number): Promise<GameSubject[]> {
  const masteries = maliciousSeasonMasteries();
  if (!masteries.length) return questions;
  const pool = quizPool.value;
  const usedIds = new Set(questions.map((question) => question.id));
  const switchLimit = Math.max(1, Math.ceil(questions.length * .12));
  const plans: Array<{ mastery: MaliciousSeasonMastery; reference: GameSubject; alternatives: GameSubject[] }> = [];
  for (const mastery of masteries) {
    if (plans.length >= switchLimit) break;
    const series = pool.filter((subject) => subjectFranchiseKeys(subject).includes(mastery.franchiseKey));
    const references = series.filter((subject) => subjectSeasonKey(subject) === mastery.seasonKey);
    const alternatives = series.filter((subject) => {
      const season = subjectSeasonKey(subject);
      return season && season !== mastery.seasonKey && !usedIds.has(subject.id);
    });
    if (!references.length || !alternatives.length) continue;
    const reference = references.sort((first, second) => (
      (maliciousExposure.value[String(second.id)]?.total ?? 0)
      - (maliciousExposure.value[String(first.id)]?.total ?? 0)
    ))[0];
    plans.push({ mastery, reference, alternatives });
  }
  if (!plans.length) return questions;
  const visualSubjects = [...new Map(plans.flatMap((plan) => [plan.reference, ...plan.alternatives])
    .map((subject) => [subject.id, subject])).values()];
  if (!await initializeExactVisualFeatures(visualSubjects, runId)) return questions;

  const result = [...questions];
  let replaced = 0;
  for (const plan of plans) {
    if (replaced >= switchLimit) break;
    const referenceFeature = quizVisualFeatureCache.get(plan.reference.id);
    const ranked = plan.alternatives.map((subject) => ({
      subject,
      visual: visualFeatureSimilarity(referenceFeature, quizVisualFeatureCache.get(subject.id)),
      exposure: maliciousExposure.value[String(subject.id)]?.total ?? 0,
    })).sort((first, second) => second.visual - first.visual || first.exposure - second.exposure);
    const selected = ranked.find(({ subject }) => !usedIds.has(subject.id))?.subject;
    if (!selected) continue;
    const replaceableIndexes = result.map((question, index) => ({ question, index }))
      .filter(({ question }) => !question.disguiseReferenceId && !subjectsShareFranchise(question, selected));
    const target = shuffle(replaceableIndexes)[0];
    if (!target) continue;
    usedIds.delete(target.question.id);
    usedIds.add(selected.id);
    result[target.index] = { ...selected, disguiseReferenceId: plan.reference.id };
    replaced += 1;
  }
  return result;
}

function titleConfusability(firstTitle: string, secondTitle: string): number {
  const similarity = titleSimilarity(firstTitle, secondTitle);
  const firstCore = quizFranchiseCore(firstTitle);
  const secondCore = quizFranchiseCore(secondTitle);
  if (!firstCore || !secondCore) return similarity;
  if (firstCore === secondCore) return similarity + .72;
  if (firstCore.length >= 3 && secondCore.length >= 3 && (
    firstCore.startsWith(secondCore) || secondCore.startsWith(firstCore)
  )) return similarity + .38;
  return similarity;
}

function maliciousRecent(limit = 24): MaliciousObservation[] {
  return quizMaliciousAnalysis.value.recent.slice(-limit);
}

function maliciousBayesianMean(kind: MaliciousTrapKind): number {
  const belief = quizMaliciousAnalysis.value.trapBeliefs[kind];
  return belief.alpha / Math.max(.001, belief.alpha + belief.beta);
}

function maliciousTrapAttackWeight(kind: MaliciousTrapKind): number {
  const belief = quizMaliciousAnalysis.value.trapBeliefs[kind];
  const posterior = maliciousBayesianMean(kind);
  const relaxedAfterStreak = maliciousCorrectStreak.value >= 5;
  const questionsSinceHit = belief.lastHitQuestion < 0
    ? Number.POSITIVE_INFINITY
    : maliciousProgress.value.answers - belief.lastHitQuestion;
  // Long-term susceptibility survives while short-term vigilance suppresses
  // immediate repetition. A five-answer recovery reopens proven old weaknesses.
  const effectiveAlertness = belief.alertness * (relaxedAfterStreak ? .28 : 1);
  const secondStrike = relaxedAfterStreak && belief.hitCount > 0 && questionsSinceHit >= 5
    ? Math.min(.38, .16 + belief.hitCount * .055)
    : 0;
  const colorResistanceTransfer = kind !== "color-similar"
    && (kind === "franchise" || kind === "installment" || kind === "similar-title" || kind === "short-title" || kind === "long-title")
    && quizMaliciousAnalysis.value.trapBeliefs["color-similar"].resistedStreak >= 3
      ? .26
      : 0;
  return Math.max(.16, Math.min(1.55, .22 + posterior * 1.25 - effectiveAlertness * .72 + secondStrike + colorResistanceTransfer));
}

function updateMaliciousTrapBeliefs(
  availableKinds: MaliciousTrapKind[],
  hitKinds: MaliciousTrapKind[],
  responseRatio: number,
  correct: boolean,
): Record<MaliciousTrapKind, MaliciousBayesianStat> {
  const available = new Set(availableKinds);
  const hits = new Set(hitKinds);
  const fiveCorrect = correct && maliciousStreak((item) => item.correct) >= 4;
  const updated = {} as Record<MaliciousTrapKind, MaliciousBayesianStat>;
  for (const kind of Object.keys(quizMaliciousAnalysis.value.trapBeliefs) as MaliciousTrapKind[]) {
    const previous = quizMaliciousAnalysis.value.trapBeliefs[kind];
    // Alertness naturally fades; sustained success makes the player relax much faster.
    const decay = fiveCorrect ? .52 : .91;
    let alertness = previous.alertness * decay;
    let alpha = previous.alpha;
    let beta = previous.beta;
    let resistedStreak = previous.resistedStreak;
    let hitCount = previous.hitCount;
    let lastHitQuestion = previous.lastHitQuestion;
    if (available.has(kind)) {
      if (hits.has(kind)) {
        // Fast bait selection is stronger evidence of a genuine blind spot.
        alpha += .8 + (1 - responseRatio) * .9;
        alertness = Math.min(1, alertness + .42);
        resistedStreak = 0;
        hitCount += 1;
        lastHitQuestion = maliciousProgress.value.answers + 1;
      } else {
        // Resisting quickly is stronger negative evidence than barely surviving.
        beta += .55 + (1 - responseRatio) * .75 + Number(correct) * .18;
        resistedStreak += 1;
        alertness = Math.min(1, alertness + .13 + Math.min(.24, resistedStreak * .045));
        if (resistedStreak >= 3) alertness = Math.max(alertness, .78);
      }
    }
    // Discount ancient evidence without erasing the learned shape of the profile.
    if (alpha + beta > 34) {
      alpha = 1.35 + (alpha - 1.35) * .94;
      beta = 1.65 + (beta - 1.65) * .94;
    }
    updated[kind] = { alpha, beta, alertness, resistedStreak, hitCount, lastHitQuestion };
  }
  return updated;
}

function fatigueAttackStrength(): number {
  if (quizDifficulty.value !== "adaptive" || fatigueStage.value === "none") return 0;
  const stageBase = { none: 0, light: .2, moderate: .45, high: .7 }[fatigueStage.value];
  const recent = fatigueRunObservations.value;
  const errorPressure = Math.min(.18, recent.slice(-3).filter((round) => !round.correct).length * .06);
  const pressureStreak = Math.min(.14, recent.slice(-3).filter((round) => round.highPressure).length * .047);
  const dwellPressure = Math.min(.12, (recent.at(-1)?.optionDwellMs ?? 0) / 6500 * .12);
  const complexityPressure = Math.min(.1, (recent.at(-1)?.pointerComplexity ?? 0) * .04);
  const sessionPressure = Math.min(.12, (performance.now() - fatigueRunStartedAt) / 240000 * .12);
  return Math.min(1, stageBase + errorPressure + pressureStreak + dwellPressure + complexityPressure + sessionPressure);
}

function fatigueAxisWeights(): Record<FatigueAttackAxis, number> {
  const strength = fatigueAttackStrength();
  const weights: Record<FatigueAttackAxis, number> = {
    title: strength * 1.05,
    memory: strength * .95,
    visual: strength * .88,
    position: strength * .7,
  };
  const recentRounds = fatigueRunObservations.value.slice(-4);
  const recentAttacks = maliciousRunObservations.value.slice(-4).map(({ observation }) => observation);
  const titleKinds = new Set<MaliciousTrapKind>(["franchise", "installment", "similar-title", "short-title", "long-title"]);
  const resistedTitle = recentAttacks.filter((observation) => observation.correct && observation.trapKinds.some((kind) => titleKinds.has(kind))).length;
  const resistedMemory = recentAttacks.filter((observation) => observation.correct && observation.trapKinds.includes("memory")).length;
  const resistedVisual = recentAttacks.filter((observation) => observation.correct && observation.treatmentFamilies.some((family) => (
    family === "grayscale" || family === "mirror" || family === "zoom" || family === "tiles"
  ))).length;
  const recentPositions = recentAttacks.map((observation) => observation.selectedIndex).filter((index) => index >= 0);
  const positionVariation = recentPositions.length >= 3 ? new Set(recentPositions).size / recentPositions.length : 0;
  weights.title *= Math.max(.45, 1 - resistedTitle * .16);
  weights.memory *= Math.max(.45, 1 - resistedMemory * .18);
  weights.visual *= Math.max(.45, 1 - resistedVisual * .14);
  weights.position *= positionVariation >= .75 ? .48 : 1;
  if (recentRounds.slice(-3).every((round) => round.correct)) weights.memory *= 1.12;
  return weights;
}

function maliciousTitleLengthKind(title: string): "short" | "normal" | "long" {
  const length = normalizeQuizTitle(title).length;
  return length <= 6 ? "short" : length >= 16 ? "long" : "normal";
}

function maliciousTitleStructure(title: string): string {
  const normalized = title.normalize("NFKC").toLocaleLowerCase();
  if (/^(关于|關於|关於|關于)/u.test(normalized)) return "about";
  if (/(的|の).+(的|の)/u.test(normalized)) return "nested-of";
  if (/[:：~～—-]/u.test(normalized)) return "subtitle";
  return maliciousTitleLengthKind(title);
}

function isInstallmentTitle(title: string): boolean {
  return /(?:ova|oad|sp|special|特典|外传|外傳|剧场版|劇場版|重制|重製|remake|总集篇|總集篇|第?[一二三四五六七八九十百\d]+(?:季|期|章|篇|部)|season|part|final)/iu.test(title);
}

function maliciousTrapKinds(questionTitle: string, decoyTitle: string): MaliciousTrapKind[] {
  if (!decoyTitle) return [];
  const kinds: MaliciousTrapKind[] = [];
  const questionCore = quizFranchiseCore(questionTitle);
  const decoyCore = quizFranchiseCore(decoyTitle);
  const confusability = titleConfusability(questionTitle, decoyTitle);
  if (questionCore && questionCore === decoyCore) kinds.push("franchise");
  if (isInstallmentTitle(decoyTitle) && (questionCore === decoyCore || confusability >= .48)) kinds.push("installment");
  if (confusability >= .42) kinds.push("similar-title");
  const lengthKind = maliciousTitleLengthKind(questionTitle);
  if (lengthKind === "short" && maliciousTitleLengthKind(decoyTitle) === "short") kinds.push("short-title");
  if (lengthKind === "long" && maliciousTitleStructure(questionTitle) === maliciousTitleStructure(decoyTitle)) kinds.push("long-title");
  const previousTitle = maliciousRecent(1)[0]?.questionTitle;
  if (previousTitle && titleConfusability(previousTitle, decoyTitle) >= .48) kinds.push("memory");
  return [...new Set(kinds)];
}

function maliciousStreak(predicate: (item: MaliciousObservation) => boolean): number {
  let count = 0;
  for (const item of [...maliciousRecent(8)].reverse()) {
    if (!predicate(item)) break;
    count += 1;
  }
  return count;
}

function maliciousVisualCueReliance(cue: MaliciousVisualCue): number {
  const stat = quizMaliciousAnalysis.value.cueStats[cue];
  if (!stat.seen) return .38;
  const trapKind: MaliciousTrapKind = cue === "color"
    ? "color-similar"
    : cue === "character" ? "face-layout" : cue === "text" ? "text-layout" : "memory";
  return Math.max(.12, Math.min(1.15, behaviorStatWeakness(stat) * maliciousTrapAttackWeight(trapKind)));
}

function maliciousLongRunTitlePressure(): number {
  if (quizDifficulty.value !== "adaptive") return 0;
  const total = quizQuestions.value.length || quizQuestionCount.value;
  const questionNumber = quizIndex.value + 1;
  if (questionNumber <= 5) return 0;
  const stage = total >= 50
    ? questionNumber <= 15 ? .28 : questionNumber <= 30 ? .56 : .86
    : total >= 30
      ? questionNumber <= 10 ? .24 : questionNumber <= 20 ? .5 : .78
      : questionNumber <= 10 ? .12 : .28;
  // A small wave prevents the player from learning a fixed every-question rhythm.
  const wave = total >= 30 ? (Math.floor(Math.max(0, questionNumber - 6) / (total >= 50 ? 5 : 4)) % 3) : 0;
  return Math.max(.08, stage * (wave === 1 ? .86 : wave === 2 ? 1.08 : 1));
}

function maliciousDecoyScore(questionTitle: string, option: QuizOption): number {
  const kinds = maliciousTrapKinds(questionTitle, option.displayTitle);
  const bayesianTrapPressure = kinds.reduce((total, kind) => total + maliciousTrapAttackWeight(kind), 0)
    / Math.max(1, kinds.length);
  const fatigueWeights = fatigueAxisWeights();
  const recent = maliciousRecent(20);
  const colorSimilarity = visualFeatureSimilarity(
    quizVisualFeatureCache.get(currentQuestion.value?.id ?? -1),
    quizVisualFeatureCache.get(option.id),
  );
  const colorTrapErrors = recent.filter((item) => !item.correct && item.trapKinds.includes("color-similar")).length;
  const colorPressure = colorSimilarity >= .64
    ? colorSimilarity * (.42 + maliciousVisualCueReliance("color") * .9 + Math.min(3, colorTrapErrors) * .1)
      * maliciousTrapAttackWeight("color-similar")
    : 0;
  const questionFeature = quizVisualFeatureCache.get(currentQuestion.value?.id ?? -1);
  const optionFeature = quizVisualFeatureCache.get(option.id);
  const faceSimilarity = visualRegionSetSimilarity(
    featureVisualRegions(questionFeature, "face"),
    featureVisualRegions(optionFeature, "face"),
  );
  const textSimilarity = visualRegionSetSimilarity(
    featureVisualRegions(questionFeature, "text"),
    featureVisualRegions(optionFeature, "text"),
  );
  const faceTrapErrors = recent.filter((item) => !item.correct && item.trapKinds.includes("face-layout")).length;
  const textTrapErrors = recent.filter((item) => !item.correct && item.trapKinds.includes("text-layout")).length;
  const semanticPressure = faceSimilarity * (.24 + maliciousVisualCueReliance("character") * .5 + Math.min(3, faceTrapErrors) * .08)
      * maliciousTrapAttackWeight("face-layout")
    + textSimilarity * (.28 + maliciousVisualCueReliance("text") * .58 + Math.min(3, textTrapErrors) * .09)
      * maliciousTrapAttackWeight("text-layout");
  const repeatedErrorScore = kinds.reduce((total, kind) => total + recent.filter((item) => (
    !item.correct && item.trapKinds.includes(kind)
  )).length * .16, 0);
  const learnedPenalty = kinds.reduce((total, kind) => total + recent.slice(-6).filter((item) => (
    item.correct && item.trapKinds.includes(kind)
  )).length * .12, 0);
  const fastCorrectBoost = Math.min(3, maliciousStreak((item) => item.correct && item.confidence === "snap")) * .16;
  const phaseBoost = maliciousPhase.value === "trap"
    ? (kinds.includes("franchise") || kinds.includes("installment") ? .65 : kinds.includes("similar-title") ? .28 : 0)
    : maliciousPhase.value === "counter"
      ? (kinds.includes("memory") || kinds.includes("similar-title") ? .38 : 0)
      : maliciousPhase.value === "bait" && kinds.length === 0 ? -.18 : 0;
  const previousWrongReuse = maliciousRunObservations.value.slice(-5).some(({ observation }) => (
    !observation.correct && observation.selectedId === option.id
  ));
  const previousRelated = maliciousRunObservations.value.at(-1)?.observation.questionTitle
    ? titleConfusability(maliciousRunObservations.value.at(-1)!.observation.questionTitle, option.displayTitle)
    : 0;
  const titlePressure = maliciousLongRunTitlePressure();
  return titleConfusability(questionTitle, option.displayTitle) * (1 + titlePressure * .72)
      * (kinds.length ? bayesianTrapPressure : 1)
    + kinds.reduce((total, kind) => total + maliciousTrapAttackWeight(kind) * .11, 0)
    + repeatedErrorScore
    + (kinds.includes("franchise") || kinds.includes("installment") ? (.36 + fastCorrectBoost) * (1 + fatigueWeights.title) : 0)
    + (kinds.includes("memory") ? .42 * (1 + fatigueWeights.memory) : 0)
    + (previousRelated >= .48 ? .24 * (1 + fatigueWeights.memory) : 0)
    + (previousWrongReuse ? .2 * (1 + fatigueWeights.memory) : 0)
    + colorPressure
    + semanticPressure * (1 + fatigueWeights.visual)
    + phaseBoost
    + titlePressure * (kinds.includes("franchise") || kinds.includes("installment") || kinds.includes("similar-title") ? .34 : 0)
    - learnedPenalty;
}

function maliciousQuestionTrapScore(question: GameSubject, pool: GameSubject[]): number {
  const questionTitles = quizTitleVariants(question);
  const questionFeature = quizVisualFeatureCache.get(question.id);
  const questionFaceRegions = featureVisualRegions(questionFeature, "face");
  const questionTextRegions = featureVisualRegions(questionFeature, "text");
  const colorWeight = .2 + maliciousVisualCueReliance("color") * .28;
  const faceWeight = .14 + maliciousVisualCueReliance("character") * .18;
  const textWeight = .16 + maliciousVisualCueReliance("text") * .2;
  const topTitleScores: number[] = [];
  const topColorScores: number[] = [];
  const topRegionScores: number[] = [];
  let strongDecoys = 0;
  const addTopScore = (scores: number[], score: number, limit: number) => {
    const position = scores.findIndex((item) => score > item);
    if (position < 0) {
      if (scores.length < limit) scores.push(score);
      return;
    }
    scores.splice(position, 0, score);
    if (scores.length > limit) scores.pop();
  };

  for (const item of pool) {
    if (item.id === question.id) continue;
    let bestTitleScore = 0;
    for (const questionTitle of questionTitles) {
      for (const decoyTitle of quizTitleVariants(item)) {
        const kinds = maliciousTrapKinds(questionTitle, decoyTitle);
        const score = titleConfusability(questionTitle, decoyTitle)
          + (kinds.includes("franchise") ? .65 * maliciousTrapAttackWeight("franchise") : 0)
          + (kinds.includes("installment") ? .52 * maliciousTrapAttackWeight("installment") : 0)
          + (kinds.includes("similar-title") ? .2 * maliciousTrapAttackWeight("similar-title") : 0)
          + (kinds.includes("short-title") ? .16 * maliciousTrapAttackWeight("short-title") : 0)
          + (kinds.includes("long-title") ? .16 * maliciousTrapAttackWeight("long-title") : 0);
        bestTitleScore = Math.max(bestTitleScore, score);
      }
    }
    if (bestTitleScore >= .68) strongDecoys += 1;
    addTopScore(topTitleScores, bestTitleScore, 5);

    const feature = quizVisualFeatureCache.get(item.id);
    addTopScore(topColorScores, visualFeatureSimilarity(questionFeature, feature), 4);
    addTopScore(topRegionScores,
      visualRegionSetSimilarity(questionFaceRegions, featureVisualRegions(feature, "face")) * faceWeight
        + visualRegionSetSimilarity(questionTextRegions, featureVisualRegions(feature, "text")) * textWeight,
      4);
  }
  const topPressure = topTitleScores.reduce((total, score) => total + score, 0);
  const colorPressure = topColorScores.reduce((total, score) => total + score, 0) * colorWeight;
  const faceAndTextPressure = topRegionScores.reduce((total, score) => total + score, 0);
  const previous = maliciousRecent(1)[0];
  const memoryPressure = previous
    ? titleConfusability(previous.questionTitle, question.title)
      + visualFeatureSimilarity(previous.visualFeature, quizVisualFeatureCache.get(question.id)) * .55
    : 0;
  return topPressure + Math.min(6, strongDecoys) * .22 + colorPressure + faceAndTextPressure
    + memoryPressure * maliciousTrapAttackWeight("memory");
}

function maliciousPoolWeights(): Record<MaliciousPoolSource, number> {
  const weights: Record<MaliciousPoolSource, number> = unknownChallenge.value
    ? { collection: .08, popular: .17, obscure: .48, explore: .27 }
    : { collection: .45, popular: .35, obscure: .15, explore: .05 };
  const recent = maliciousRecent(48);
  for (const source of ["collection", "popular", "obscure", "explore"] as MaliciousPoolSource[]) {
    const observations = recent.filter((item) => item.source === source);
    if (observations.length < 4) continue;
    const accuracy = observations.filter((item) => item.correct).length / observations.length;
    if (accuracy >= .72) {
      weights[source] *= .7;
      if (source === "collection" || source === "popular") {
        weights.obscure *= 1.18;
        weights.explore *= 1.12;
      } else if (source === "obscure") {
        weights.explore *= 1.22;
      }
    }
    if (accuracy <= .35) {
      weights[source] *= .76;
      weights.popular *= 1.12;
    }
  }
  const unfamiliar = recent.filter((item) => (item.unfamiliarity ?? 0) >= .8);
  if (unfamiliar.length >= 8 && unfamiliar.filter((item) => item.correct).length / unfamiliar.length < .3) {
    weights.popular *= 1.35;
    weights.obscure *= .82;
    weights.explore *= .72;
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const source of Object.keys(weights) as MaliciousPoolSource[]) weights[source] /= total;
  return weights;
}

function subjectFamiliarity(subject: GameSubject): number {
  const collectionSubject = maliciousPools.value.collection.find((item) => item.id === subject.id);
  return Math.max(0, Math.min(1, collectionSubject?.familiarity ?? subject.familiarity ?? 0));
}

function maliciousHistoryBlockSize(): number {
  const base = unknownChallenge.value ? MALICIOUS_UNKNOWN_BLOCK_SIZE : MALICIOUS_NORMAL_BLOCK_SIZE;
  const perRun = quizQuestionCount.value * (unknownChallenge.value ? 12 : 8);
  return Math.min(MALICIOUS_HISTORY_SIZE, Math.max(base, perRun));
}

function maliciousRecentSeries(limit = MALICIOUS_SERIES_BLOCK_SIZE): Set<string> {
  return new Set(maliciousHistory.value.slice(-limit)
    .map((item) => quizFranchiseCore(item.title))
    .filter((core) => core.length >= 2));
}

function weightedMaliciousCandidates(count: number): GameSubject[] {
  const weights = maliciousPoolWeights();
  const blockSize = maliciousHistoryBlockSize();
  const blocked = new Set(maliciousHistory.value.slice(-blockSize).map((item) => item.id));
  const penalized = new Set(maliciousHistory.value.slice(-Math.min(MALICIOUS_HISTORY_SIZE, blockSize * 2)).map((item) => item.id));
  const recentSeries = maliciousRecentSeries();
  const sources = Object.keys(maliciousPools.value) as MaliciousPoolSource[];
  const selected: GameSubject[] = [];
  const selectedIds = new Set<number>();
  const weightedSample = (subjects: GameSubject[], source: MaliciousPoolSource, amount: number) => {
    const eligible = subjects.filter((subject) => !blocked.has(subject.id) && !selectedIds.has(subject.id));
    const novelSeries = eligible.filter((subject) => !recentSeries.has(quizFranchiseCore(subject.title)));
    // Prefer unseen series whenever the source has enough material. Recently
    // used series remain a fallback so small collections can still start.
    const available = novelSeries.length >= amount ? novelSeries : [
      ...novelSeries,
      ...eligible.filter((subject) => !novelSeries.some((fresh) => fresh.id === subject.id)),
    ];
    const exposureCount = (subject: GameSubject) => {
      const exposure = maliciousExposure.value[String(subject.id)];
      return unknownChallenge.value ? exposure?.unknown ?? 0 : exposure?.total ?? 0;
    };
    const chosen: GameSubject[] = [];
    const exposureLayers = [...new Set(available.map(exposureCount))].sort((first, second) => first - second);
    for (const exposureLayer of exposureLayers) {
      if (chosen.length >= amount) break;
      const layer = available.filter((subject) => exposureCount(subject) === exposureLayer);
      const rankedLayer = layer.map((subject) => {
      const candidate = { ...subject, source: subject.source ?? source };
      const unfamiliarity = 1 - subjectFamiliarity(candidate);
      const recentPenalty = penalized.has(candidate.id) ? .18 : 1;
      const candidateCore = quizFranchiseCore(candidate.title);
      const sameSeriesPenalty = recentSeries.has(candidateCore) ? .12 : 1;
      const exposure = maliciousExposure.value[String(candidate.id)] ?? { total: 0, unknown: 0 };
      const exposurePenalty = unknownChallenge.value
        ? 1 / Math.pow(1 + exposure.unknown * 4 + exposure.total, 2.2)
        : 1 / Math.sqrt(1 + exposure.total * .45);
      const entropy = unknownChallenge.value
        ? .35 + unfamiliarity * .65
        : .55 + (1 - unfamiliarity) * .45;
      return {
        subject: candidate,
        key: Math.pow(Math.max(Number.EPSILON, Math.random()), 1 / Math.max(.001, entropy * recentPenalty * sameSeriesPenalty * exposurePenalty)),
      };
      }).sort((first, second) => second.key - first.key);
      const usedSeries = new Set([...selected, ...chosen].map((item) => quizFranchiseCore(item.title)).filter(Boolean));
      const diverse: typeof rankedLayer = [];
      const repeated: typeof rankedLayer = [];
      for (const item of rankedLayer) {
        const core = quizFranchiseCore(item.subject.title);
        if (core && !usedSeries.has(core)) {
          diverse.push(item);
          usedSeries.add(core);
        } else {
          repeated.push(item);
        }
      }
      const layerSelection = [...diverse, ...repeated].slice(0, amount - chosen.length).map(({ subject }) => subject);
      chosen.push(...layerSelection);
    }
    return chosen;
  };

  // Allocate candidates by source first so large pools cannot drown out the configured ratios.
  const quotas = sources.map((source) => ({
    source,
    exact: count * weights[source],
    count: Math.floor(count * weights[source]),
  }));
  let unassigned = count - quotas.reduce((sum, quota) => sum + quota.count, 0);
  for (const quota of [...quotas].sort((first, second) => (second.exact % 1) - (first.exact % 1))) {
    if (unassigned-- <= 0) break;
    quota.count += 1;
  }
  for (const quota of quotas) {
    const drawn = weightedSample(maliciousPools.value[quota.source], quota.source, quota.count);
    drawn.forEach((subject) => selectedIds.add(subject.id));
    selected.push(...drawn);
  }
  if (selected.length < count) {
    const fallback = sources.flatMap((source) => maliciousPools.value[source].map((subject) => ({ ...subject, source })));
    for (const subject of weightedSample(fallback, "explore", count - selected.length)) {
      if (!selectedIds.has(subject.id)) {
        selectedIds.add(subject.id);
        selected.push(subject);
      }
    }
  }
  if (selected.length < count) {
    // Hard guarantee for long runs: once fresh and unblocked candidates are
    // exhausted, relax the cooldown and reuse the oldest/least exposed titles.
    // This fallback changes recency only; it never duplicates an ID in a run.
    const relaxed = shuffle(sources
      .flatMap((source) => maliciousPools.value[source].map((subject) => ({ ...subject, source })))
      .filter((subject) => !selectedIds.has(subject.id))
    ).sort((first, second) => {
        const firstExposure = maliciousExposure.value[String(first.id)] ?? { total: 0, unknown: 0, lastSeenAt: 0 };
        const secondExposure = maliciousExposure.value[String(second.id)] ?? { total: 0, unknown: 0, lastSeenAt: 0 };
        const firstCount = unknownChallenge.value ? firstExposure.unknown * 3 + firstExposure.total : firstExposure.total;
        const secondCount = unknownChallenge.value ? secondExposure.unknown * 3 + secondExposure.total : secondExposure.total;
        return firstExposure.lastSeenAt - secondExposure.lastSeenAt || firstCount - secondCount;
      });
    for (const subject of relaxed) {
      if (selected.length >= count) break;
      if (selectedIds.has(subject.id)) continue;
      selectedIds.add(subject.id);
      selected.push(subject);
    }
  }
  return shuffle(selected).slice(0, count);
}

async function selectMaliciousQuestions(
  candidates: GameSubject[],
  count: number,
  requiredGroups: Array<{ ids: Set<number>; count: number }>,
  runId: number,
): Promise<GameSubject[]> {
  const recentErrors = maliciousRecent(24).filter((item) => !item.correct);
  const recentSeries = maliciousRecentSeries();
  const scored: Array<{ subject: GameSubject; value: number }> = [];
  updateQuizInitialization(68, "正在评估题目价值…", 0, candidates.length);
  for (let index = 0; index < candidates.length; index += 1) {
    const subject = candidates[index];
    const unfamiliarity = 1 - subjectFamiliarity(subject);
    const weakMatch = recentErrors.filter((item) => item.source === subject.source).length * .08;
    const exposure = maliciousExposure.value[String(subject.id)] ?? { total: 0, unknown: 0, lastSeenAt: 0 };
    const exposureCount = unknownChallenge.value ? exposure.unknown * 3 + exposure.total : exposure.total;
    const recentSeriesPenalty = recentSeries.has(quizFranchiseCore(subject.title)) ? 2.4 : 0;
    const trapScore = maliciousQuestionTrapScore(subject, quizPool.value);
    maliciousQuestionTrapScoreCache.set(subject.id, trapScore);
    scored.push({
      subject,
      value: trapScore
        + (unknownChallenge.value ? unfamiliarity * 1.25 : subjectFamiliarity(subject) * .65)
        + weakMatch
        - Math.log2(1 + exposureCount) * 1.15 - recentSeriesPenalty,
    });
    if ((index + 1) % 3 === 0 || index === candidates.length - 1) {
      updateQuizInitialization(68 + (index + 1) / Math.max(1, candidates.length) * 6, "正在评估题目价值…", index + 1, candidates.length);
      await waitForAnimationFrame();
      if (runId !== quizInitializationRunId) return [];
    }
  }
  const minimumValue = Math.min(...scored.map((item) => item.value));
  const maximumValue = Math.max(...scored.map((item) => item.value));
  const valueRange = Math.max(.01, maximumValue - minimumValue);
  const ranked = scored.map((item) => {
    const normalizedValue = (item.value - minimumValue) / valueRange;
    const selectionWeight = .28 + normalizedValue * 1.32;
    return {
      subject: item.subject,
      key: Math.pow(Math.max(Number.EPSILON, Math.random()), 1 / selectionWeight),
    };
  }).sort((first, second) => second.key - first.key).map(({ subject }) => subject);
  const selected: GameSubject[] = [];
  const appendDiverse = (items: GameSubject[], amount: number) => {
    if (amount <= 0) return;
    const selectedIds = new Set(selected.map((item) => item.id));
    const selectedSeries = new Set(selected.map((item) => quizFranchiseCore(item.title)).filter(Boolean));
    const uniqueSeries: GameSubject[] = [];
    const repeatedSeries: GameSubject[] = [];
    for (const item of items) {
      if (selectedIds.has(item.id)) continue;
      const core = quizFranchiseCore(item.title);
      if (core && !selectedSeries.has(core)) {
        uniqueSeries.push(item);
        selectedSeries.add(core);
      } else {
        repeatedSeries.push(item);
      }
    }
    selected.push(...[...uniqueSeries, ...repeatedSeries].slice(0, amount));
  };
  for (const group of requiredGroups) {
    const groupCandidates = ranked.filter((item) => group.ids.has(item.id));
    appendDiverse(unknownChallenge.value
      ? [
          ...groupCandidates.filter((item) => subjectFamiliarity(item) <= .05),
          ...groupCandidates.filter((item) => subjectFamiliarity(item) > .05),
        ]
      : groupCandidates, group.count);
  }
  if (unknownChallenge.value) {
    const unfamiliarTarget = Math.ceil(count * .7);
    const unfamiliarSelected = selected.filter((item) => subjectFamiliarity(item) <= .05).length;
    appendDiverse(
      ranked.filter((item) => subjectFamiliarity(item) <= .05),
      Math.min(count - selected.length, Math.max(0, unfamiliarTarget - unfamiliarSelected)),
    );
  } else {
    // Ordinary malicious mode needs new game material, not necessarily obscure
    // material. Reserve part of each run for subjects never used by the quiz,
    // preferring the user's own collection before popular external titles.
    const unseenTarget = Math.ceil(count * .3);
    const unseenSelected = selected.filter((item) => !maliciousExposure.value[String(item.id)]?.total).length;
    const unseen = ranked.filter((item) => !maliciousExposure.value[String(item.id)]?.total);
    const unseenCollection = unseen.filter((item) => subjectFamiliarity(item) > 0);
    const unseenExternal = unseen.filter((item) => subjectFamiliarity(item) <= 0);
    appendDiverse(
      [...unseenCollection, ...unseenExternal],
      Math.min(count - selected.length, Math.max(0, unseenTarget - unseenSelected)),
    );
  }
  appendDiverse(ranked, count - selected.length);
  return selected.slice(0, count);
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return [hue, maximum ? delta / maximum : 0, maximum];
}

async function getOpenCvRuntime(): Promise<OpenCvRuntime | null> {
  if (openCvRuntimePromise) return openCvRuntimePromise;
  openCvRuntimePromise = (async () => {
    try {
      const imported = await import("@techstark/opencv-js");
      let module: unknown = imported;
      for (let depth = 0; depth < 4; depth += 1) {
        if (module && typeof (module as PromiseLike<unknown>).then === "function") {
          module = await module as PromiseLike<unknown>;
          continue;
        }
        const nestedDefault = (module as { default?: unknown } | null)?.default;
        if (nestedDefault === undefined || nestedDefault === module) break;
        module = nestedDefault;
      }
      const cv = module as OpenCvRuntime;
      if (cv.Mat) return cv;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("OpenCV initialization timed out")), 12_000);
        cv.onRuntimeInitialized = () => {
          window.clearTimeout(timeout);
          resolve();
        };
      });
      return cv.Mat ? cv : null;
    } catch {
      return null;
    }
  })();
  return openCvRuntimePromise;
}

async function ensureAnimeFaceCascade(cv: OpenCvRuntime): Promise<boolean> {
  if (animeFaceCascadePromise) return animeFaceCascadePromise;
  animeFaceCascadePromise = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}models/animeface/lbpcascade_animeface.xml`);
      if (!response.ok) return false;
      const data = new Uint8Array(await response.arrayBuffer());
      try { cv.FS_unlink("/lbpcascade_animeface.xml"); } catch { /* file may not exist */ }
      cv.FS_createDataFile("/", "lbpcascade_animeface.xml", data, true, false, false);
      return true;
    } catch {
      return false;
    }
  })();
  return animeFaceCascadePromise;
}

async function detectOpenCvAnimeFaces(canvas: HTMLCanvasElement): Promise<MaliciousVisualRegion[]> {
  const cv = await getOpenCvRuntime();
  if (!cv || typeof cv.CascadeClassifier !== "function" || !await ensureAnimeFaceCascade(cv)) return [];
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  const faces = new cv.RectVector();
  const classifier = new cv.CascadeClassifier();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(gray, gray);
    if (!classifier.load("lbpcascade_animeface.xml")) return [];
    classifier.detectMultiScale(
      gray,
      faces,
      1.08,
      4,
      0,
      new cv.Size(Math.max(20, Math.round(canvas.width * .08)), Math.max(20, Math.round(canvas.width * .08))),
    );
    const regions: MaliciousVisualRegion[] = [];
    for (let index = 0; index < faces.size(); index += 1) {
      const face = faces.get(index);
      regions.push({
        x: face.x / canvas.width,
        y: face.y / canvas.height,
        width: face.width / canvas.width,
        height: face.height / canvas.height,
        confidence: .98,
      });
    }
    return regions;
  } catch {
    return [];
  } finally {
    source.delete();
    gray.delete();
    faces.delete();
    classifier.delete();
  }
}

function collectOpenCvTextContours(
  cv: OpenCvRuntime,
  edges: any,
  canvas: HTMLCanvasElement,
  vertical: boolean,
): MaliciousVisualRegion[] {
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernelWidth = vertical ? 3 : Math.max(9, Math.round(canvas.width * .075));
  const kernelHeight = vertical ? Math.max(9, Math.round(canvas.height * .055)) : 3;
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelWidth, kernelHeight));
  try {
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const regions: MaliciousVisualRegion[] = [];
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const bounds = cv.boundingRect(contour);
      contour.delete();
      const widthRatio = bounds.width / canvas.width;
      const heightRatio = bounds.height / canvas.height;
      const aspectRatio = bounds.width / Math.max(1, bounds.height);
      const valid = vertical
        ? heightRatio >= .13 && widthRatio >= .035 && widthRatio <= .36 && aspectRatio <= 1.15
        : widthRatio >= .13 && heightRatio >= .025 && heightRatio <= .3 && aspectRatio >= 1.25;
      if (!valid) continue;
      const areaRatio = widthRatio * heightRatio;
      if (areaRatio < .004 || areaRatio > .3) continue;
      regions.push({
        x: bounds.x / canvas.width,
        y: bounds.y / canvas.height,
        width: widthRatio,
        height: heightRatio,
        confidence: Math.min(.96, .56 + Math.sqrt(areaRatio) * .9),
      });
    }
    return regions;
  } finally {
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

async function detectOpenCvTextRegions(canvas: HTMLCanvasElement): Promise<MaliciousVisualRegion[]> {
  const cv = await getOpenCvRuntime();
  if (!cv) return [];
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    cv.Canny(gray, edges, 60, 160);
    return mergeVisualRegions(
      collectOpenCvTextContours(cv, edges, canvas, false),
      collectOpenCvTextContours(cv, edges, canvas, true),
      5,
    );
  } catch {
    return [];
  } finally {
    source.delete();
    gray.delete();
    edges.delete();
  }
}

type VisualAnalysisMaps = {
  luminance: Float32Array;
  edge: Float32Array;
  skin: Uint8Array;
};

function buildVisualAnalysisMaps(pixels: Uint8ClampedArray, width: number, height: number): VisualAnalysisMaps {
  const luminance = new Float32Array(width * height);
  const edge = new Float32Array(width * height);
  const skin = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      luminance[index] = (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255;
      const [hue, saturation, brightness] = rgbToHsv(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      skin[index] = Number((hue <= 58 || hue >= 342) && saturation >= .055 && saturation <= .76 && brightness >= .42);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      edge[index] = Math.max(
        Math.abs(luminance[index + 1] - luminance[index - 1]),
        Math.abs(luminance[index + width] - luminance[index - width]),
      );
    }
  }
  return { luminance, edge, skin };
}

function regionOverlap(first: MaliciousVisualRegion, second: MaliciousVisualRegion): number {
  const overlapWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  const intersection = overlapWidth * overlapHeight;
  const union = first.width * first.height + second.width * second.height - intersection;
  return union ? intersection / union : 0;
}

function textRegionBucketScore(region: MaliciousVisualRegion, bucket: number): number {
  const centerY = region.y + region.height / 2;
  const boundaryAffinity = bucket === 0
    ? 1 - centerY
    : bucket === 2 ? centerY : 1 - Math.abs(centerY - .5) * 2;
  const horizontalCoverage = Math.min(1, region.width / .72);
  return region.confidence + boundaryAffinity * .24 + horizontalCoverage * .1;
}

function detectFaceLikeRegions(maps: VisualAnalysisMaps, width: number, height: number): MaliciousVisualRegion[] {
  const candidates: MaliciousVisualRegion[] = [];
  const windowSizes = [18, 24, 30, 36].filter((size) => size < width * .72);
  for (const size of windowSizes) {
    const windowHeight = Math.round(size * 1.04);
    const step = Math.max(3, Math.round(size / 7));
    for (let top = 1; top <= Math.min(height - windowHeight - 1, Math.round(height * .78)); top += step) {
      for (let left = 1; left <= width - size - 1; left += step) {
        let skinCount = 0;
        let edgeCount = 0;
        let symmetryDifference = 0;
        let symmetrySamples = 0;
        let windowLuminance = 0;
        const eyeValues: number[] = [];
        const eyeStart = top + Math.round(windowHeight * .28);
        const eyeEnd = top + Math.round(windowHeight * .58);
        for (let y = top; y < top + windowHeight; y += 1) {
          for (let x = left; x < left + size; x += 1) {
            const index = y * width + x;
            skinCount += maps.skin[index];
            edgeCount += Number(maps.edge[index] >= .16);
            windowLuminance += maps.luminance[index];
            if (y >= eyeStart && y <= eyeEnd) eyeValues.push(maps.luminance[index]);
          }
          for (let offsetX = 0; offsetX < Math.floor(size / 2); offsetX += 1) {
            const first = maps.luminance[y * width + left + offsetX];
            const second = maps.luminance[y * width + left + size - 1 - offsetX];
            symmetryDifference += Math.abs(first - second);
            symmetrySamples += 1;
          }
        }
        const area = size * windowHeight;
        const averageLuminance = windowLuminance / area;
        eyeValues.sort((first, second) => first - second);
        const darkEyeMean = eyeValues.slice(0, Math.max(2, Math.round(eyeValues.length * .12)))
          .reduce((total, value) => total + value, 0) / Math.max(1, Math.round(eyeValues.length * .12));
        const skinScore = Math.min(1, skinCount / area / .42);
        const symmetryScore = Math.max(0, 1 - symmetryDifference / Math.max(1, symmetrySamples) / .28);
        const eyeScore = Math.max(0, Math.min(1, (averageLuminance - darkEyeMean - .05) / .26));
        const edgeRatio = edgeCount / area;
        const edgeScore = Math.max(0, 1 - Math.abs(edgeRatio - .22) / .22);
        // A cover can place characters anywhere. Location must not influence detection.
        const confidence = skinScore * .3 + symmetryScore * .27 + eyeScore * .33 + edgeScore * .1;
        if (confidence < .48 || eyeScore < .18) continue;
        const paddingX = size * .1;
        const paddingY = windowHeight * .08;
        candidates.push({
          x: Math.max(0, (left - paddingX) / width),
          y: Math.max(0, (top - paddingY) / height),
          width: Math.min(1, (size + paddingX * 2) / width),
          height: Math.min(1, (windowHeight + paddingY * 2) / height),
          confidence,
        });
      }
    }
  }
  const selected: MaliciousVisualRegion[] = [];
  for (const candidate of candidates.sort((first, second) => second.confidence - first.confidence)) {
    if (selected.some((region) => regionOverlap(region, candidate) >= .28)) continue;
    selected.push(candidate);
    if (selected.length >= 5) break;
  }
  return selected;
}

function detectTextLikeRegions(maps: VisualAnalysisMaps, width: number, height: number): MaliciousVisualRegion[] {
  const integral = new Float32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < width; x += 1) {
      rowTotal += Number(maps.edge[y * width + x] >= .16);
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowTotal;
    }
  }
  const edgeDensity = (left: number, top: number, boxWidth: number, boxHeight: number) => {
    const stride = width + 1;
    const right = left + boxWidth;
    const bottom = top + boxHeight;
    const count = integral[bottom * stride + right] - integral[top * stride + right]
      - integral[bottom * stride + left] + integral[top * stride + left];
    return count / Math.max(1, boxWidth * boxHeight);
  };
  const candidates: MaliciousVisualRegion[] = [];
  const horizontalWidths = [.2, .3, .44, .62, .82, .96];
  const horizontalHeights = [.055, .085, .13, .19, .25];
  for (const widthRatio of horizontalWidths) {
    for (const heightRatio of horizontalHeights) {
      const boxWidth = Math.max(6, Math.round(width * widthRatio));
      const boxHeight = Math.max(4, Math.round(height * heightRatio));
      for (let top = 1; top < height - boxHeight; top += 4) {
        for (let left = 1; left < width - boxWidth; left += 4) {
          const density = edgeDensity(left, top, boxWidth, boxHeight);
          const confidence = Math.min(1, (density - .105) / .2);
          if (confidence < .24) continue;
          candidates.push({
            x: left / width,
            y: top / height,
            width: boxWidth / width,
            height: boxHeight / height,
            confidence,
          });
        }
      }
    }
  }
  const verticalWidths = [.1, .16, .23];
  const verticalHeights = [.3, .48, .66];
  for (const widthRatio of verticalWidths) {
    for (const heightRatio of verticalHeights) {
      const boxWidth = Math.max(5, Math.round(width * widthRatio));
      const boxHeight = Math.max(8, Math.round(height * heightRatio));
      for (let top = 1; top < height - boxHeight; top += 5) {
        for (let left = 1; left < width - boxWidth; left += 3) {
          const density = edgeDensity(left, top, boxWidth, boxHeight);
          const confidence = Math.min(1, (density - .12) / .21);
          if (confidence < .28) continue;
          candidates.push({ x: left / width, y: top / height, width: boxWidth / width, height: boxHeight / height, confidence });
        }
      }
    }
  }
  const ranked = candidates.sort((first, second) => second.confidence - first.confidence);
  const selected: MaliciousVisualRegion[] = [];
  for (let bucket = 0; bucket < 3; bucket += 1) {
    const candidate = ranked
      .filter((region) => {
        const centerY = region.y + region.height / 2;
        return Math.min(2, Math.floor(centerY * 3)) === bucket
          && !selected.some((existing) => regionOverlap(existing, region) >= .32);
      })
      .sort((first, second) => textRegionBucketScore(second, bucket) - textRegionBucketScore(first, bucket))[0];
    if (candidate) selected.push(candidate);
  }
  for (const candidate of ranked) {
    if (selected.some((region) => regionOverlap(region, candidate) >= .32)) continue;
    const bucket = Math.min(2, Math.floor((candidate.y + candidate.height / 2) * 3));
    const bucketCount = selected.filter((region) => (
      Math.min(2, Math.floor((region.y + region.height / 2) * 3)) === bucket
    )).length;
    if (bucketCount >= 3) continue;
    selected.push(candidate);
    if (selected.length >= 8) break;
  }
  return selected;
}

type NativeDetectedShape = { boundingBox: { x: number; y: number; width: number; height: number } };
type NativeShapeDetector = { detect(source: CanvasImageSource): Promise<NativeDetectedShape[]> };
type NativeShapeDetectorConstructor = new (options?: Record<string, unknown>) => NativeShapeDetector;

async function detectNativeVisualRegions(
  image: HTMLImageElement,
  detectorName: "FaceDetector" | "TextDetector",
): Promise<MaliciousVisualRegion[]> {
  const Detector = (window as unknown as Record<string, NativeShapeDetectorConstructor | undefined>)[detectorName];
  if (!Detector || !image.naturalWidth || !image.naturalHeight) return [];
  try {
    const detector = new Detector(detectorName === "FaceDetector" ? { fastMode: true, maxDetectedFaces: 3 } : undefined);
    const shapes = await detector.detect(image);
    return shapes.slice(0, 4).map(({ boundingBox }) => ({
      x: Math.max(0, boundingBox.x / image.naturalWidth),
      y: Math.max(0, boundingBox.y / image.naturalHeight),
      width: Math.min(1, boundingBox.width / image.naturalWidth),
      height: Math.min(1, boundingBox.height / image.naturalHeight),
      confidence: 1,
    })).filter((region) => region.width >= .04 && region.height >= .03);
  } catch {
    return [];
  }
}

async function detectNativeVisualRegionsWithDeadline(
  image: HTMLImageElement,
  detectorName: "FaceDetector" | "TextDetector",
): Promise<MaliciousVisualRegion[]> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      detectNativeVisualRegions(image, detectorName),
      new Promise<MaliciousVisualRegion[]>((resolve) => {
        timeout = window.setTimeout(() => resolve([]), 320);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function mergeVisualRegions(primary: MaliciousVisualRegion[], fallback: MaliciousVisualRegion[], limit: number): MaliciousVisualRegion[] {
  const merged: MaliciousVisualRegion[] = [];
  for (const candidate of [...primary, ...fallback].sort((first, second) => second.confidence - first.confidence)) {
    if (merged.some((region) => regionOverlap(region, candidate) >= .34)) continue;
    merged.push(candidate);
    if (merged.length >= limit) break;
  }
  return merged;
}

function coalesceNearbyVisualRegions(regions: MaliciousVisualRegion[], limit: number): MaliciousVisualRegion[] {
  const merged = [...regions];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let firstIndex = 0; firstIndex < merged.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < merged.length; secondIndex += 1) {
        const first = merged[firstIndex];
        const second = merged[secondIndex];
        const horizontalGap = Math.max(0, Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width));
        const verticalGap = Math.max(0, Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height));
        if (horizontalGap > .045 || verticalGap > .045) continue;
        const left = Math.min(first.x, second.x);
        const top = Math.min(first.y, second.y);
        const right = Math.max(first.x + first.width, second.x + second.width);
        const bottom = Math.max(first.y + first.height, second.y + second.height);
        if ((right - left) * (bottom - top) > .34) continue;
        merged.splice(secondIndex, 1);
        merged[firstIndex] = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          confidence: Math.max(first.confidence, second.confidence),
        };
        changed = true;
        break outer;
      }
    }
  }
  return merged.sort((first, second) => second.confidence - first.confidence).slice(0, limit);
}

function selectSpatiallyDiverseVisualRegions(regions: MaliciousVisualRegion[], limit: number): MaliciousVisualRegion[] {
  const ranked = [...regions].sort((first, second) => second.confidence - first.confidence);
  const selected: MaliciousVisualRegion[] = [];
  for (let bucket = 0; bucket < 3; bucket += 1) {
    const candidate = ranked
      .filter((region) => (
        Math.min(2, Math.floor((region.y + region.height / 2) * 3)) === bucket
        && !selected.includes(region)
      ))
      .sort((first, second) => textRegionBucketScore(second, bucket) - textRegionBucketScore(first, bucket))[0];
    if (candidate) selected.push(candidate);
  }
  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.slice(0, limit);
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
}

function informativeTileIndexes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  size: 2 | 3 | 4 | 5,
  regions: MaliciousVisualRegion[],
): number[] {
  const scores = Array.from({ length: size * size }, (_, tileIndex) => {
    const tileX = tileIndex % size;
    const tileY = Math.floor(tileIndex / size);
    const startX = Math.floor(tileX * width / size);
    const endX = Math.floor((tileX + 1) * width / size);
    const startY = Math.floor(tileY * height / size);
    const endY = Math.floor((tileY + 1) * height / size);
    let luminanceTotal = 0;
    let luminanceSquaredTotal = 0;
    let edgeTotal = 0;
    let saturationTotal = 0;
    let count = 0;
    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const index = (y * width + x) * 4;
        const luminance = pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722;
        luminanceTotal += luminance;
        luminanceSquaredTotal += luminance * luminance;
        const [, saturation] = rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]);
        saturationTotal += saturation;
        if (x + 2 < endX) {
          const rightIndex = (y * width + x + 2) * 4;
          const rightLuminance = pixels[rightIndex] * .2126 + pixels[rightIndex + 1] * .7152 + pixels[rightIndex + 2] * .0722;
          edgeTotal += Math.abs(luminance - rightLuminance) / 255;
        }
        count += 1;
      }
    }
    const average = luminanceTotal / Math.max(1, count);
    const variance = Math.max(0, luminanceSquaredTotal / Math.max(1, count) - average * average) / (255 * 255);
    const tileRegion = { x: tileX / size, y: tileY / size, width: 1 / size, height: 1 / size, confidence: 1 };
    const semanticOverlap = Math.max(0, ...regions.map((region) => regionOverlap(tileRegion, region)));
    const information = variance * 4.2 + edgeTotal / Math.max(1, count) * 3 + saturationTotal / Math.max(1, count) * .4;
    return { tileIndex, information, semanticOverlap };
  });
  const maximum = Math.max(...scores.map((item) => item.information));
  const safe = scores.filter((item) => item.semanticOverlap < .16 && item.information >= maximum * .3);
  const candidates = safe.length >= 2
    ? safe
    : [...scores].sort((first, second) => first.semanticOverlap - second.semanticOverlap).slice(0, Math.max(2, size));
  // Prefer medium-high information instead of the most obvious logo/character crop.
  return candidates
    .filter((item) => item.information <= maximum * .88 || candidates.length <= 2)
    .sort((first, second) => second.information - first.information)
    .slice(0, Math.max(2, Math.ceil(size * size * .28)))
    .map((item) => item.tileIndex);
}

async function loadVisualFeature(subject: GameSubject): Promise<MaliciousVisualFeature | null> {
  const cached = quizVisualFeatureCache.get(subject.id);
  if (cached?.analysisVersion === 14 || (quizVisualFeatureCache.has(subject.id) && cached === null)) return cached ?? null;
  quizVisualFeatureCache.delete(subject.id);
  let imageDataUrl = "";
  try {
    imageDataUrl = await invoke<string>("bangumi_fetch_image_data_url", { url: subject.image });
  } catch {
    quizVisualFeatureCache.set(subject.id, null);
    return null;
  }
  const feature = await new Promise<MaliciousVisualFeature | null>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: MaliciousVisualFeature | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), 12_000);
    image.onload = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 72;
        canvas.height = 96;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return finish(null);
        drawImageCover(context, image, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const analysisMaps = buildVisualAnalysisMaps(pixels, canvas.width, canvas.height);
        const heuristicFaceRegions = detectFaceLikeRegions(analysisMaps, canvas.width, canvas.height);
        const detectionCanvas = document.createElement("canvas");
        detectionCanvas.width = 216;
        detectionCanvas.height = 288;
        const detectionContext = detectionCanvas.getContext("2d", { willReadFrequently: true });
        if (!detectionContext) return finish(null);
        drawImageCover(detectionContext, image, detectionCanvas.width, detectionCanvas.height);
        const detectionPixels = detectionContext.getImageData(0, 0, detectionCanvas.width, detectionCanvas.height).data;
        const detectionMaps = buildVisualAnalysisMaps(detectionPixels, detectionCanvas.width, detectionCanvas.height);
        const heuristicTextRegions = detectTextLikeRegions(detectionMaps, detectionCanvas.width, detectionCanvas.height);
        const [openCvFaceRegions, openCvTextRegions] = await Promise.all([
          detectOpenCvAnimeFaces(detectionCanvas),
          detectOpenCvTextRegions(detectionCanvas),
        ]);
        // Use OpenCV regions first; high-confidence local analysis keeps masking
        // functional on browsers where the cascade or contour pass finds nothing.
        const reliableHeuristicFaces = heuristicFaceRegions.filter((region) => region.confidence >= .52);
        const reliableHeuristicText = heuristicTextRegions.filter((region) => region.confidence >= .34);
        const fallbackFaces = reliableHeuristicFaces.length
          ? reliableHeuristicFaces
          : heuristicFaceRegions.slice(0, 1);
        const fallbackText = reliableHeuristicText.length
          ? reliableHeuristicText
          : heuristicTextRegions.slice(0, 1);
        const faceRegions = openCvFaceRegions.length
          ? mergeVisualRegions(openCvFaceRegions, [], 3)
          : mergeVisualRegions([], fallbackFaces, 5);
        const textRegions = selectSpatiallyDiverseVisualRegions(
          coalesceNearbyVisualRegions(
            mergeVisualRegions(openCvTextRegions, fallbackText, 12),
            10,
          ),
          7,
        );
        let hueX = 0;
        let hueY = 0;
        let saturation = 0;
        let brightness = 0;
        let horizontalWeight = 0;
        let verticalWeight = 0;
        let weightTotal = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const pixelIndex = index / 4;
          const x = pixelIndex % canvas.width;
          const y = Math.floor(pixelIndex / canvas.width);
          const [hue, sat, value] = rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]);
          const chromaWeight = .18 + sat * value;
          hueX += Math.cos(hue * Math.PI / 180) * chromaWeight;
          hueY += Math.sin(hue * Math.PI / 180) * chromaWeight;
          saturation += sat;
          brightness += value;
          horizontalWeight += x / (canvas.width - 1) * value;
          verticalWeight += y / (canvas.height - 1) * value;
          weightTotal += value;
        }
        const count = pixels.length / 4;
        const semanticRegions = [...faceRegions, ...textRegions];
        finish({
          analysisVersion: 14,
          hue: (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360,
          saturation: saturation / count,
          brightness: brightness / count,
          horizontalBalance: weightTotal ? horizontalWeight / weightTotal : .5,
          verticalBalance: weightTotal ? verticalWeight / weightTotal : .5,
          faceRegion: faceRegions[0],
          textRegion: textRegions[0],
          faceRegions,
          textRegions,
          informativeTiles: {
            2: informativeTileIndexes(pixels, canvas.width, canvas.height, 2, semanticRegions),
            3: informativeTileIndexes(pixels, canvas.width, canvas.height, 3, semanticRegions),
            4: informativeTileIndexes(pixels, canvas.width, canvas.height, 4, semanticRegions),
            5: informativeTileIndexes(pixels, canvas.width, canvas.height, 5, semanticRegions),
          },
        });
      } catch {
        finish(null);
      }
    };
    image.onerror = () => finish(null);
    image.src = imageDataUrl;
  });
  quizVisualFeatureCache.set(subject.id, feature);
  return feature;
}

function visualFeatureSimilarity(first: MaliciousVisualFeature | null | undefined, second: MaliciousVisualFeature | null | undefined): number {
  if (!first || !second) return 0;
  const hueDistance = Math.min(Math.abs(first.hue - second.hue), 360 - Math.abs(first.hue - second.hue)) / 180;
  return Math.max(0, 1 - (
    hueDistance * .42
    + Math.abs(first.saturation - second.saturation) * .2
    + Math.abs(first.brightness - second.brightness) * .18
    + Math.abs(first.horizontalBalance - second.horizontalBalance) * .13
    + Math.abs(first.verticalBalance - second.verticalBalance) * .07
  ));
}

function visualRegionSimilarity(first: MaliciousVisualRegion | undefined, second: MaliciousVisualRegion | undefined): number {
  if (!first || !second || first.confidence < .18 || second.confidence < .18) return 0;
  const firstCenterX = first.x + first.width / 2;
  const firstCenterY = first.y + first.height / 2;
  const secondCenterX = second.x + second.width / 2;
  const secondCenterY = second.y + second.height / 2;
  const positionDistance = Math.hypot(firstCenterX - secondCenterX, firstCenterY - secondCenterY);
  const sizeDistance = Math.abs(first.width - second.width) + Math.abs(first.height - second.height);
  return Math.max(0, 1 - positionDistance * 1.25 - sizeDistance * .65)
    * Math.min(first.confidence, second.confidence);
}

function visualRegionSetSimilarity(
  first: MaliciousVisualRegion[] | undefined,
  second: MaliciousVisualRegion[] | undefined,
): number {
  if (!first?.length || !second?.length) return 0;
  let best = 0;
  for (const firstRegion of first) {
    for (const secondRegion of second) best = Math.max(best, visualRegionSimilarity(firstRegion, secondRegion));
  }
  return best;
}

function featureVisualRegions(feature: MaliciousVisualFeature | null | undefined, kind: "face" | "text"): MaliciousVisualRegion[] {
  if (!feature) return [];
  if (kind === "face") return feature.faceRegions ?? (feature.faceRegion ? [feature.faceRegion] : []);
  return feature.textRegions ?? (feature.textRegion ? [feature.textRegion] : []);
}

async function arrangeMaliciousQuestionSequence(questions: GameSubject[]): Promise<GameSubject[]> {
  if (questions.length < 2) return questions;
  await Promise.all(questions.map(loadVisualFeature));
  const remaining = [...questions];
  const arranged: GameSubject[] = [];
  const previousObservation = maliciousRecent(1)[0];
  const previousTitle = previousObservation?.questionTitle;
  const previousFeature = previousObservation?.visualFeature;
  if (previousTitle) {
    remaining.sort((first, second) => (
      titleConfusability(previousTitle, second.title) - titleConfusability(previousTitle, first.title)
      + visualFeatureSimilarity(previousFeature, quizVisualFeatureCache.get(second.id))
      - visualFeatureSimilarity(previousFeature, quizVisualFeatureCache.get(first.id))
    ));
    arranged.push(remaining.splice(Math.floor(Math.random() * Math.min(2, remaining.length)), 1)[0]);
  } else {
    arranged.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]);
  }
  while (remaining.length) {
    const anchor = arranged[arranged.length - 1];
    const anchorFeature = quizVisualFeatureCache.get(anchor.id);
    const total = questions.length;
    const position = arranged.length;
    const longRun = total >= 30;
    const lateRun = position >= 20;
    // Long games alternate the dominant cue every few questions. This keeps
    // title pollution effective without making one repeated pattern learnable.
    const wave = longRun ? Math.floor(Math.max(0, position - 5) / (total >= 50 ? 5 : 4)) % 3 : 0;
    const titleWeight = longRun
      ? (wave === 0 ? 1.45 : wave === 1 ? .72 : 1.08) * (lateRun ? 1.12 : 1)
      : 1;
    const visualWeight = longRun
      ? (wave === 1 ? 1.42 : wave === 2 ? .76 : 1.04)
      : 1;
    const residueRun = arranged.length >= 3 && arranged.slice(-3).every((item, index, tail) => (
      index === 0 || visualFeatureSimilarity(
        quizVisualFeatureCache.get(tail[index - 1].id),
        quizVisualFeatureCache.get(item.id),
      ) >= .78
    ));
    const ranked = [...remaining].sort((first, second) => (
      (titleConfusability(anchor.title, second.title) * titleWeight + (residueRun
        ? 1 - visualFeatureSimilarity(anchorFeature, quizVisualFeatureCache.get(second.id))
        : visualFeatureSimilarity(anchorFeature, quizVisualFeatureCache.get(second.id)) * visualWeight))
      - (titleConfusability(anchor.title, first.title) * titleWeight + (residueRun
        ? 1 - visualFeatureSimilarity(anchorFeature, quizVisualFeatureCache.get(first.id))
        : visualFeatureSimilarity(anchorFeature, quizVisualFeatureCache.get(first.id)) * visualWeight))
    ));
    const selectionBand = longRun
      ? Math.min(ranked.length, wave === 0 ? 2 : wave === 1 ? 3 : 4)
      : Math.min(3, ranked.length);
    const next = ranked[Math.floor(Math.random() * selectionBand)];
    arranged.push(next);
    remaining.splice(remaining.findIndex((item) => item.id === next.id), 1);
  }
  return arranged;
}

function mostMisleadingQuizTitle(subject: GameSubject, questionTitle: string): string {
  return quizTitleVariants(subject).reduce((best, candidate) => (
    titleConfusability(questionTitle, candidate) > titleConfusability(questionTitle, best)
      ? candidate
      : best
  ));
}

function buildMaliciousOptionCandidateIndex(questions: GameSubject[], pool: GameSubject[]) {
  maliciousOptionCandidateCache.clear();
  maliciousOptionSubjectCache.clear();
  for (const subject of pool) maliciousOptionSubjectCache.set(subject.id, subject);
  const limit = Math.min(pool.length, 72);
  for (const question of questions) {
    const questionFeature = quizVisualFeatureCache.get(question.id);
    const ranked = pool
      .filter((candidate) => candidate.id !== question.id)
      .map((candidate) => ({
        id: candidate.id,
        score: Math.max(...quizTitleVariants(question).flatMap((questionTitle) => (
          quizTitleVariants(candidate).map((candidateTitle) => titleConfusability(questionTitle, candidateTitle))
        ))) * 1.25 + visualFeatureSimilarity(questionFeature, quizVisualFeatureCache.get(candidate.id)) * .72,
      }))
      .sort((first, second) => second.score - first.score)
      .slice(0, limit)
      .map(({ id }) => id);
    maliciousOptionCandidateCache.set(question.id, ranked);
  }
}

function quizDisplayTitle(subject: GameSubject): string {
  if (!quizConfig.value.alternateTitles || !subject.translatedTitle || subject.translatedTitle === subject.originalTitle) {
    return subject.title;
  }
  if (quizDifficulty.value === "adaptive") {
    const originalWeakness = behaviorStatWeakness(quizBehaviorProfile.value.languageStats.original);
    const translatedWeakness = behaviorStatWeakness(quizBehaviorProfile.value.languageStats.translated);
    if (Math.abs(originalWeakness - translatedWeakness) > .04) {
      return originalWeakness > translatedWeakness ? subject.originalTitle : subject.translatedTitle;
    }
  }
  return Math.random() < .5 ? subject.originalTitle : subject.translatedTitle;
}

function maliciousEchoDisplayTitle(subject: GameSubject): string {
  const echo = maliciousEchoState.value;
  if (!echo || !isCurrentMaliciousEcho.value) return quizDisplayTitle(subject);
  const originalWasShown = normalizeQuizTitle(echo.originalDisplayTitle) === normalizeQuizTitle(subject.originalTitle);
  return (originalWasShown ? subject.translatedTitle : subject.originalTitle) || subject.title;
}

function chooseWeightedPosition(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(.001, weight), 0);
  let target = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    target -= Math.max(.001, weights[index]);
    if (target <= 0) return index;
  }
  return weights.length - 1;
}

function maliciousGuessProfile(optionCount: number) {
  const snap = maliciousRecent(32).filter((item) => item.confidence === "snap" && item.selectedIndex >= 0);
  if (snap.length < 4) return null;
  const positions = Array.from({ length: optionCount }, () => 0);
  const titleKinds = new Map<string, number>();
  let installmentSelections = 0;
  snap.forEach((item, index) => {
    const recency = .45 + (index + 1) / snap.length;
    if (item.selectedIndex < optionCount) positions[item.selectedIndex] += recency;
    const kind = `${maliciousTitleLengthKind(item.selectedTitle)}:${maliciousTitleStructure(item.selectedTitle)}`;
    titleKinds.set(kind, (titleKinds.get(kind) ?? 0) + recency);
    if (isInstallmentTitle(item.selectedTitle)) installmentSelections += recency;
  });
  const preferredKind = [...titleKinds.entries()].sort((first, second) => second[1] - first[1])[0]?.[0] ?? "";
  return {
    position: positions.indexOf(Math.max(...positions)),
    preferredKind,
    installmentRate: installmentSelections / snap.reduce((sum, _, index) => sum + .45 + (index + 1) / snap.length, 0),
  };
}

function maliciousGuessDecoyScore(option: QuizOption, profile: NonNullable<ReturnType<typeof maliciousGuessProfile>>): number {
  const kind = `${maliciousTitleLengthKind(option.displayTitle)}:${maliciousTitleStructure(option.displayTitle)}`;
  return Number(kind === profile.preferredKind) * .9
    + Number(isInstallmentTitle(option.displayTitle)) * profile.installmentRate * .8
    + maliciousDecoyScore(currentQuestion.value?.title ?? "", option);
}

function maliciousRoundWindow(index = quizIndex.value, total = quizQuestions.value.length || quizQuestionCount.value) {
  const conditioningWindows = total >= 50
    ? [[2, 4], [9, 11], [17, 19], [27, 29], [38, 40]]
    : total >= 30
      ? [[2, 4], [9, 11], [18, 20], [25, 26]]
      : total >= 20
        ? [[2, 4], [8, 10], [14, 15]]
        : total >= 15 ? [[2, 4], [8, 10]] : [[2, 4]];
  const conditioningWindow = conditioningWindows.find(([start, end]) => index >= start && index <= end);
  const latestConditioningStart = [...conditioningWindows]
    .reverse()
    .find(([start]) => index >= start)?.[0] ?? 2;
  return {
    conditioning: !!conditioningWindow,
    conditioningStart: conditioningWindow?.[0] === index,
    reversal: index >= 5 && !conditioningWindow && index > latestConditioningStart
      && (total < 30 || index - latestConditioningStart <= (total >= 50 ? 3 : 2)),
    openingEnd: total >= 30 ? 5 : total >= 20 ? 5 : total >= 15 ? 4 : 4,
    endgameStart: Math.max(total >= 50 ? 34 : total >= 30 ? 22 : 7, Math.floor(total * .72)),
  };
}

function arrangeMaliciousOptions(questionOption: QuizOption, decoys: QuizOption[]): QuizOption[] {
  const optionCount = decoys.length + 1;
  const recent = maliciousRecent(24);
  const clickWeights = Array.from({ length: optionCount }, () => 0);
  const traversalWeights = Array.from({ length: optionCount }, () => 0);
  const trajectoryApproachWeights = Array.from({ length: optionCount }, () => 0);
  const trajectoryDwellWeights = Array.from({ length: optionCount }, () => 0);
  const correctPositionCounts = Array.from({ length: optionCount }, () => 0);
  recent.forEach((item, observationIndex) => {
    const recency = .35 + (observationIndex + 1) / Math.max(1, recent.length);
    if (item.selectedIndex >= 0 && item.selectedIndex < optionCount) clickWeights[item.selectedIndex] += recency;
    if (item.correctIndex >= 0 && item.correctIndex < optionCount) correctPositionCounts[item.correctIndex] += recency;
    item.visitOrder?.forEach((position, orderIndex) => {
      if (position >= 0 && position < optionCount) traversalWeights[position] += recency / (orderIndex + 1);
    });
    const trajectory = item.pointerTrajectory;
    if (trajectory && trajectory.firstOptionIndex >= 0 && trajectory.firstOptionIndex < optionCount) {
      trajectoryApproachWeights[trajectory.firstOptionIndex] += recency * (.65 + trajectory.directness * .55);
    }
    if (trajectory && trajectory.dwellOptionIndex >= 0 && trajectory.dwellOptionIndex < optionCount) {
      trajectoryDwellWeights[trajectory.dwellOptionIndex] += recency;
    }
  });
  const clicked = clickWeights.reduce((sum, value) => sum + value, 0);
  const preferenceWeights = clickWeights.map((weight, index) => (
    weight
    + traversalWeights[index] * .55
    + trajectoryApproachWeights[index] * .9
    + trajectoryDwellWeights[index] * .6
  ));
  const preferredPosition = clicked > 0 || preferenceWeights.some((weight) => weight > 0)
    ? preferenceWeights.indexOf(Math.max(...preferenceWeights))
    : Math.floor(Math.random() * optionCount);
  const roundWindow = maliciousRoundWindow();
  if ((maliciousRunAnchorPosition.value < 0 && quizIndex.value >= 2) || roundWindow.conditioningStart) {
    maliciousRunAnchorPosition.value = preferredPosition;
  }
  const anchorPosition = maliciousRunAnchorPosition.value >= 0
    ? maliciousRunAnchorPosition.value
    : preferredPosition;
  const guessProfile = maliciousGuessProfile(optionCount);
  const guessCounterRound = !!guessProfile
    && quizIndex.value >= 4
    && !roundWindow.conditioning
    && (maliciousPhase.value === "counter" || maliciousPhase.value === "trap" || quizIndex.value >= roundWindow.endgameStart);
  currentGuessCounterPosition.value = guessCounterRound ? guessProfile.position : -1;
  const trajectoryPosition = trajectoryApproachWeights.some((weight) => weight > 0)
    ? trajectoryApproachWeights.indexOf(Math.max(...trajectoryApproachWeights))
    : -1;
  const dwellPosition = trajectoryDwellWeights.some((weight) => weight > 0)
    ? trajectoryDwellWeights.indexOf(Math.max(...trajectoryDwellWeights))
    : -1;
  const latestSelections = [...recent].reverse().filter((item) => item.selectedIndex >= 0);
  const repeatedSelectionPosition = latestSelections.length >= 3
    && latestSelections.slice(0, 3).every((item) => item.selectedIndex === latestSelections[0].selectedIndex)
    ? latestSelections[0].selectedIndex
    : -1;
  let avoidedPreviousCorrectStreak = 0;
  for (let index = recent.length - 1; index >= 1; index -= 1) {
    if (recent[index].selectedIndex === recent[index - 1].correctIndex) break;
    avoidedPreviousCorrectStreak += 1;
  }
  const recoveryPosition = avoidedPreviousCorrectStreak >= 3
    ? recent[recent.length - 1]?.correctIndex ?? -1
    : -1;
  const conditioningRound = roundWindow.conditioning;
  const reversalRound = roundWindow.reversal || (maliciousPhase.value === "counter" && !conditioningRound);
  const correctWeights = Array.from({ length: optionCount }, (_, index) => {
    const recentCorrectRepeat = recent.slice(-3).filter((item) => item.correctIndex === index).length;
    const repeatPenalty = correctPositionCounts[index] * .22 + recentCorrectRepeat * 1.4;
    const antiAvoidanceBoost = index === recoveryPosition
      ? (maliciousPhase.value === "trap" ? 6.2 : 3.8)
      : 0;
    const uncertaintyBoost = index === repeatedSelectionPosition && Math.random() < .22 ? 1.4 : 0;
    const phasePositionBoost = conditioningRound && index === anchorPosition
      ? 18
      : reversalRound && index === anchorPosition ? -4 : 0;
    const guessPositionPenalty = guessCounterRound && index === guessProfile.position ? -6 : 0;
    const trajectoryPositionBias = index === trajectoryPosition || index === dwellPosition
      ? maliciousPhase.value === "bait" ? .5 : maliciousPhase.value === "trap" ? -.48 : -.16
      : 0;
    return Math.max(.04, 1 / (1 + repeatPenalty) + antiAvoidanceBoost + uncertaintyBoost + phasePositionBoost + guessPositionPenalty + trajectoryPositionBias + Math.random() * .18);
  });
  const correctPosition = chooseWeightedPosition(correctWeights);
  const slots: Array<QuizOption | undefined> = Array.from({ length: optionCount });
  slots[correctPosition] = questionOption;
  const remaining = [...decoys].sort((first, second) => (
    maliciousDecoyScore(questionOption.displayTitle, second)
      - maliciousDecoyScore(questionOption.displayTitle, first)
  ));
  const averageClicks = clicked / optionCount;
  const firstBiased = clickWeights[0] > averageClicks * 1.25;
  const lastBiased = clickWeights[optionCount - 1] > averageClicks * 1.25;
  const attackPositions = [
    trajectoryPosition,
    dwellPosition,
    anchorPosition,
    repeatedSelectionPosition,
    ...(firstBiased ? [0] : []),
    ...(lastBiased ? [optionCount - 1] : []),
    ...recent.filter((item) => !item.correct && item.selectedIndex >= 0).reverse().map((item) => item.selectedIndex),
  ].filter((position, index, all) => position !== correctPosition && all.indexOf(position) === index);
  if (maliciousPhase.value === "trap") {
    const neighbors = [correctPosition - 1, correctPosition + 1]
      .filter((position) => position >= 0 && position < optionCount && position !== anchorPosition);
    attackPositions.unshift(...shuffle(neighbors));
  }
  if (reversalRound && anchorPosition !== correctPosition && remaining.length && !slots[anchorPosition]) {
    // Put the strongest plausible decoy where the player has learned to look first.
    slots[anchorPosition] = remaining.shift();
    currentMaliciousTactics.value.push("position-conditioning", "position-reversal");
    currentMaliciousTacticTargets.value["position-conditioning"] = {
      position: anchorPosition,
      decoyId: slots[anchorPosition]?.id,
    };
    currentMaliciousTacticTargets.value["position-reversal"] = {
      position: anchorPosition,
      decoyId: slots[anchorPosition]?.id,
    };
  }
  if (guessCounterRound && guessProfile.position !== correctPosition && remaining.length) {
    const existing = slots[guessProfile.position];
    if (existing) remaining.push(existing);
    remaining.sort((first, second) => maliciousGuessDecoyScore(second, guessProfile) - maliciousGuessDecoyScore(first, guessProfile));
    slots[guessProfile.position] = remaining.shift();
    if (slots[guessProfile.position]) {
      currentMaliciousTactics.value.push("guess-counter");
      currentMaliciousTacticTargets.value["guess-counter"] = {
        position: guessProfile.position,
        decoyId: slots[guessProfile.position]?.id,
      };
    }
  }
  for (const position of attackPositions) {
    if (!remaining.length || slots[position]) continue;
    const desiredKind: MaliciousTrapKind | null = position === optionCount - 1 && lastBiased
      ? "installment"
      : position === 0 && firstBiased ? "similar-title" : null;
    const decoyIndex = desiredKind
      ? remaining.findIndex((item) => maliciousTrapKinds(questionOption.displayTitle, item.displayTitle).includes(desiredKind))
      : 0;
    slots[position] = remaining.splice(decoyIndex >= 0 ? decoyIndex : 0, 1)[0];
  }
  for (const position of shuffle(Array.from({ length: optionCount }, (_, index) => index))) {
    if (!slots[position]) slots[position] = remaining.shift();
  }
  for (const tactic of ["position-conditioning", "position-reversal", "guess-counter"] as const) {
    const target = currentMaliciousTacticTargets.value[tactic];
    if (target?.position === undefined) continue;
    const placedOption = slots[target.position];
    if (!placedOption || placedOption.id === questionOption.id) {
      currentMaliciousTactics.value = currentMaliciousTactics.value.filter((item) => item !== tactic);
      delete currentMaliciousTacticTargets.value[tactic];
    } else {
      target.decoyId = placedOption.id;
    }
  }
  return slots.filter((item): item is QuizOption => !!item);
}

function prepareQuizOptions() {
  stopQuizClock();
  stopQuizTileMotion();
  const question = currentQuestion.value;
  if (!question) return;
  const recentRoundTimes = fatigueRunObservations.value.slice(-3).map((round) => round.responseMs).filter((value) => value > 0);
  currentConfidenceTrap.value = quizDifficulty.value === "adaptive"
    && fatigueStage.value !== "none"
    && fatigueRunObservations.value.slice(-3).filter((round) => round.correct).length >= 3
    && recentRoundTimes.length >= 3
    && recentRoundTimes.reduce((sum, value) => sum + value, 0) / recentRoundTimes.length < 1400;
  currentConfidenceBaitApplied.value = false;
  currentQuizVisualFeature.value = quizDifficulty.value === "adaptive"
    ? quizVisualFeatureCache.get(question.id) ?? null
    : null;
  prepareQuizTreatment();
  const optionCount = quizOptionCount.value;
  const echo = isCurrentMaliciousEcho.value ? maliciousEchoState.value : null;
  const questionOption: QuizOption = {
    ...question,
    displayTitle: echo ? maliciousEchoDisplayTitle(question) : quizDisplayTitle(question),
  };
  currentMaliciousTactics.value = [];
  currentMaliciousTacticTargets.value = {};
  currentGuessCounterPosition.value = -1;
  const seenTitles = new Set([normalizeQuizTitle(questionOption.displayTitle)]);
  const cachedCandidateIds = maliciousOptionCandidateCache.get(question.id);
  const forcedCandidateIds = new Set([
    ...quizMaliciousDecoyIds.value,
    ...maliciousRunObservations.value.slice(-6).flatMap(({ observation }) => [observation.selectedId, observation.questionId])
      .filter((id): id is number => Number.isFinite(id)),
  ]);
  const candidateSource = quizDifficulty.value === "adaptive" && cachedCandidateIds?.length
    ? [...new Set([...cachedCandidateIds, ...forcedCandidateIds])]
        .flatMap((id) => {
          const subject = maliciousOptionSubjectCache.get(id);
          return subject ? [subject] : [];
        })
    : quizPool.value;
  const candidates = candidateSource.reduce<QuizOption[]>((result, item) => {
    if (item.id === question.id) return result;
    const displayTitle = quizSimilarDistractors.value > 0
      ? mostMisleadingQuizTitle(item, questionOption.displayTitle)
      : quizDisplayTitle(item);
    const title = normalizeQuizTitle(displayTitle);
    if (!title || seenTitles.has(title)) return result;
    seenTitles.add(title);
    result.push({ ...item, displayTitle });
    return result;
  }, []);
  // Score each candidate once. The previous comparator recomputed the full
  // adaptive score for every comparison, which made option preparation grow
  // to O(n log n) expensive score evaluations.
  const adaptiveScores = quizDifficulty.value === "adaptive"
    ? new Map(candidates.map((option) => {
      const kinds = maliciousTrapKinds(questionOption.displayTitle, option.displayTitle);
      const echoTrapBoost = echo
        ? Number(kinds.includes("franchise")) * .8 + Number(kinds.includes("installment")) * .7
          - Number(echo.originalOptionIds.includes(option.id)) * 1.25
        : 0;
      return [option.id, maliciousDecoyScore(questionOption.displayTitle, option) + echoTrapBoost] as const;
    }))
    : null;
  const ranked = [...candidates].sort((first, second) => {
    const difference = quizDifficulty.value === "adaptive"
      ? (adaptiveScores!.get(second.id)! - adaptiveScores!.get(first.id)!)
      : titleConfusability(questionOption.displayTitle, second.displayTitle)
        - titleConfusability(questionOption.displayTitle, first.displayTitle);
    return difference || first.id - second.id;
  });
  const phaseSimilarCount = quizDifficulty.value === "adaptive"
    ? echo ? optionCount - 1
      : maliciousPhase.value === "probe" ? 8
      : maliciousPhase.value === "bait" ? 5
        : maliciousPhase.value === "counter" ? 9 : optionCount - 1
    : quizSimilarDistractors.value;
  const longRunTitleBoost = quizDifficulty.value === "adaptive"
    ? Math.round(maliciousLongRunTitlePressure() * (quizQuestionCount.value >= 50 ? 3 : 2))
    : 0;
  const fatigueSimilarBoost = Math.round(fatigueAxisWeights().title * 2);
  const similarCount = Math.min(phaseSimilarCount + fatigueSimilarBoost + longRunTitleBoost, optionCount - 1);
  const runMemoryIds = quizDifficulty.value === "adaptive" && !echo
    ? maliciousRunObservations.value.slice(-5).flatMap(({ observation }) => [observation.selectedId, observation.questionId]).filter((id): id is number => Number.isFinite(id) && id !== question.id)
    : [];
  const provenDecoys = quizDifficulty.value === "adaptive" && !echo
    ? shuffle(candidates.filter((item) => quizMaliciousDecoyIds.value.includes(item.id))).slice(0, 2)
    : [];
  const fatigueDecoys = quizDifficulty.value === "adaptive" && fatigueStage.value !== "none" && !echo
    ? shuffle(candidates.filter((item) => runMemoryIds.includes(item.id) && item.id !== question.id && !provenDecoys.some((decoy) => decoy.id === item.id))).slice(0, Math.min(2, Math.ceil(fatigueAttackStrength() * 2)))
    : [];
  const decoyIds = new Set([...provenDecoys, ...fatigueDecoys].map((item) => item.id));
  const similarPoolExtra = quizDifficulty.value === "adaptive" && maliciousPhase.value === "trap"
    ? (quizQuestionCount.value >= 30 ? 1 : 0)
    : quizDifficulty.value === "adaptive" && quizQuestionCount.value >= 30 ? 3 : 2;
  const similarPool = ranked
    .filter((item) => !decoyIds.has(item.id))
    .slice(0, Math.min(ranked.length, Math.max(0, similarCount - provenDecoys.length - fatigueDecoys.length) + similarPoolExtra));
  const similar = shuffle(similarPool).slice(0, Math.max(0, similarCount - provenDecoys.length - fatigueDecoys.length));
  const selectedIds = new Set([...provenDecoys, ...fatigueDecoys, ...similar].map((item) => item.id));
  const remaining = shuffle(candidates.filter((item) => !selectedIds.has(item.id)))
    .slice(0, optionCount - 1 - provenDecoys.length - fatigueDecoys.length - similar.length);
  const decoys = [...provenDecoys, ...fatigueDecoys, ...similar, ...remaining];
  quizOptions.value = quizDifficulty.value === "adaptive"
    ? arrangeMaliciousOptions(questionOption, decoys)
    : shuffle([questionOption, ...decoys]);
  if (quizDifficulty.value === "adaptive") {
    const optionIds = new Set(quizOptions.value.map((option) => option.id));
    const placedWeaknessIds = provenDecoys.filter((option) => optionIds.has(option.id)).map((option) => option.id);
    if (placedWeaknessIds.length) {
      currentMaliciousTactics.value.push("weakness-targeting");
      currentMaliciousTacticTargets.value["weakness-targeting"] = { decoyIds: placedWeaknessIds };
    }
    if (maliciousPhase.value === "counter") {
      const titleDecoyIds = quizOptions.value.filter((option) => (
        option.id !== question.id
        && maliciousTrapKinds(questionOption.displayTitle, option.displayTitle).some((kind) => (
          kind === "franchise" || kind === "installment" || kind === "similar-title"
          || kind === "short-title" || kind === "long-title"
        ))
      )).map((option) => option.id);
      if (titleDecoyIds.length) {
        currentMaliciousTactics.value.push("title-counter");
        currentMaliciousTacticTargets.value["title-counter"] = { decoyIds: titleDecoyIds };
      }
    }
    if (currentConfidenceTrap.value && fatigueStage.value !== "none") {
      currentMaliciousTactics.value.push("title-counter");
      currentMaliciousTacticTargets.value["title-counter"] = {
        decoyIds: quizOptions.value.filter((option) => option.id !== question.id && maliciousTrapKinds(questionOption.displayTitle, option.displayTitle).length >= 2).map((option) => option.id),
      };
    }
  }
  quizSelectedId.value = null;
  quizVisitedOptionIndexes.value = [];
  resetQuizPointerTrajectory();
  quizEarnedPoints.value = 0;
  quizCurrentTimeLimitMs.value = Math.max(1_000, quizTimeLimitMs.value - quizNextTimeReductionMs.value);
  quizNextTimeReductionMs.value = 0;
  quizRemainingMs.value = quizCurrentTimeLimitMs.value;
  quizQuestionReady.value = false;
  quizImageReady.value = false;
  quizOptionShuffleAnimating.value = quizDifficulty.value === "adaptive";
  quizCoverRevealReady.value = quizDifficulty.value !== "adaptive";
  quizCoverRevealAnimating.value = false;
  quizTimedOut.value = false;
  quizTimeoutPenalty.value = drawQuizTimeoutPenalty();
  quizTimeoutScoreDeduction.value = 0;
  quizTimeoutTimeReduction.value = 0;
  maliciousCountdownStep = -1;
  if (quizDifficulty.value === "adaptive") void animateMaliciousOptionShuffle();
}

type MaliciousSoundKind = "arm" | "reveal" | "tick" | "critical" | "correct" | "combo" | "wrong" | "timeout";

async function ensureMaliciousAudio(): Promise<AudioContext | null> {
  if (!maliciousSoundEnabled.value) return null;
  maliciousAudioContext ??= new AudioContext();
  if (maliciousAudioContext.state === "suspended") await maliciousAudioContext.resume();
  return maliciousAudioContext;
}

async function sampleMaliciousSystemAudio() {
  if (quizDifficulty.value !== "adaptive" || maliciousRunAudioMark.value === "muted") return;
  try {
    const status = await invoke<{ muted: boolean; volume: number }>("system_audio_output_status");
    if (status.muted) maliciousRunAudioMark.value = "muted";
    else if (status.volume < MALICIOUS_LOW_SYSTEM_VOLUME) maliciousRunAudioMark.value = "low-volume";
  } catch { /* unavailable audio status does not mark the score */ }
}

function maliciousTone(
  context: AudioContext,
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  delay = 0,
  endFrequency = frequency,
) {
  const startedAt = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startedAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), startedAt + duration);
  gain.gain.setValueAtTime(.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume), startedAt + Math.min(.018, duration * .2));
  gain.gain.exponentialRampToValueAtTime(.0001, startedAt + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + duration + .02);
}

function playMaliciousSound(kind: MaliciousSoundKind, pressure = 0) {
  if (!maliciousSoundEnabled.value || (quizDifficulty.value !== "adaptive" && kind !== "combo")) return;
  void ensureMaliciousAudio().then((context) => {
    if (!context) return;
    if (kind === "arm") {
      maliciousTone(context, 110, .18, .025, "sine", 0, 165);
      maliciousTone(context, 220, .1, .012, "triangle", .08, 260);
    } else if (kind === "reveal") {
      maliciousTone(context, 150, .22, .032, "sawtooth", 0, 480);
      maliciousTone(context, 300, .16, .018, "triangle", .05, 760);
    } else if (kind === "tick" || kind === "critical") {
      const critical = kind === "critical";
      maliciousTone(context, (critical ? 760 : 430) + pressure * 180, critical ? .07 : .055, critical ? .045 : .028, "square");
      if (critical) maliciousTone(context, 920 + pressure * 220, .045, .025, "square", .075);
    } else if (kind === "correct") {
      maliciousTone(context, 520, .075, .025, "triangle", 0, 720);
      maliciousTone(context, 760, .07, .018, "triangle", .055, 920);
    } else if (kind === "combo") {
      const streak = Math.max(2, Math.round(pressure));
      const root = Math.min(920, 420 + streak * 38);
      maliciousTone(context, root, .08, .025, "triangle", 0, root * 1.25);
      maliciousTone(context, root * 1.25, .09, .02, "sine", .055, root * 1.55);
      if (streak >= 5) maliciousTone(context, root * 1.55, .12, .016, "triangle", .11, root * 1.9);
    } else if (kind === "wrong") {
      maliciousTone(context, 170, .2, .05, "sawtooth", 0, 70);
      maliciousTone(context, 95, .24, .032, "square", .035, 48);
    } else {
      maliciousTone(context, 240, .12, .052, "square", 0, 150);
      maliciousTone(context, 180, .14, .052, "square", .13, 90);
    }
  });
}

async function animateMaliciousOptionShuffle() {
  const runId = ++quizOptionShuffleRunId;
  await nextTick();
  await waitForAnimationFrame();
  if (runId !== quizOptionShuffleRunId) return;
  const buttons = [...(quizOptionsRef.value?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  if (buttons.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    quizOptionShuffleAnimating.value = false;
    startQuizQuestionIfReady();
    return;
  }
  const rects = buttons.map((button) => button.getBoundingClientRect());
  let permutation = shuffle(buttons.map((_, index) => index));
  if (permutation.every((value, index) => value === index)) permutation = [...permutation.slice(1), permutation[0]];
  const animations = buttons.map((button, index) => {
    const origin = rects[permutation[index]];
    const target = rects[index];
    return button.animate([
      { transform: `translate3d(${origin.left - target.left}px, ${origin.top - target.top}px, 0) scale(.97)`, opacity: .58 },
      { transform: "translate3d(0, 0, 0) scale(1.015)", opacity: 1, offset: .78 },
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
    ], {
      duration: 260,
      delay: (index % 4) * 8,
      easing: "cubic-bezier(.22,.8,.24,1)",
    }).finished.catch(() => undefined);
  });
  await Promise.all(animations);
  if (runId !== quizOptionShuffleRunId) return;
  quizOptionShuffleAnimating.value = false;
  startQuizQuestionIfReady();
}

function prepareQuizTreatment() {
  const pool = quizConfig.value.treatments;
  const alternatives = pool.filter((item) => item.id !== activeQuizTreatment.value.id);
  let available = alternatives.length ? alternatives : pool;
  if (quizDifficulty.value === "adaptive" && isCurrentMaliciousEcho.value && maliciousEchoState.value) {
    const originalFamilies = new Set(maliciousEchoState.value.originalTreatmentFamilies);
    const selected = shuffle(MALICIOUS_ECHO_TREATMENTS).sort((first, second) => (
      quizTreatmentFamilies(first).filter((family) => originalFamilies.has(family)).length
      - quizTreatmentFamilies(second).filter((family) => originalFamilies.has(family)).length
    ))[0];
    activeQuizTreatment.value = {
      ...selected,
      blur: Math.min(3, selected.blur + adaptivePressure.value * .35),
    };
  } else if (quizDifficulty.value === "adaptive") {
    const lastObservation = maliciousRecent(1)[0];
    const snapWrong = !!lastObservation && !lastObservation.correct && lastObservation.confidence === "snap";
    const visualFeature = quizVisualFeatureCache.get(currentQuestion.value?.id ?? -1);
    const previousWasOcclusion = activeQuizTreatment.value.occlusion !== null;
    if (previousWasOcclusion) {
      const nonOcclusionTreatments = available.filter((item) => item.occlusion === null);
      if (nonOcclusionTreatments.length) available = nonOcclusionTreatments;
    }
    const faceAttackScore = Math.max(0, ...featureVisualRegions(visualFeature, "face").map((region) => region.confidence))
      * (.7 + maliciousVisualCueReliance("character"));
    const textAttackScore = Math.max(0, ...featureVisualRegions(visualFeature, "text").map((region) => region.confidence))
      * (.7 + maliciousVisualCueReliance("text"));
    const targetOcclusion = textAttackScore >= faceAttackScore ? "text" : "face";
    const targetedOcclusions = available.filter((item) => item.occlusion === targetOcclusion);
    const shouldOcclude = !previousWasOcclusion
      && (maliciousPhase.value === "trap" || maliciousPhase.value === "counter")
      && Math.max(faceAttackScore, textAttackScore) >= .55;
    if (shouldOcclude && targetedOcclusions.length) {
      available = targetedOcclusions;
    } else if (maliciousPhase.value === "trap" && !snapWrong) {
      const falseEasy = pool.filter((item) => item.id === "adaptive-false-easy" || item.id === "adaptive-soft-crop");
      if (falseEasy.length) available = falseEasy;
    } else if (maliciousPhase.value === "counter" || snapWrong) {
      const surfaceCounter = available.filter((item) => item.mirror || item.zoom >= 1.15);
      if (surfaceCounter.length) available = surfaceCounter;
    } else if (maliciousPhase.value === "bait") {
      const baitTreatments = available.filter((item) => item.id === "adaptive-soft-crop" || (
        item.tileSize > 0 && item.blur <= 1.5
      ));
      if (baitTreatments.length) available = baitTreatments;
    }
    const hesitationStreak = maliciousStreak((item) => item.confidence === "hesitant");
    if (hesitationStreak >= 2) {
      const lastFamilies = new Set(maliciousRecent(1)[0]?.treatmentFamilies ?? []);
      const redirected = available.filter((item) => (
        quizTreatmentFamilies(item).every((family) => !lastFamilies.has(family))
      ));
      if (redirected.length) available = redirected;
    }
    const ranked = [...available].sort((first, second) => (
      adaptiveTreatmentWeakness(second) - adaptiveTreatmentWeakness(first)
    ));
    const confidenceEasy = currentConfidenceTrap.value && Math.random() < .28;
    currentConfidenceBaitApplied.value = confidenceEasy;
    const selected = confidenceEasy
      ? pool.find((item) => item.id === "adaptive-false-easy" || item.id === "adaptive-soft-crop") ?? shuffle(ranked.slice(0, Math.min(2, ranked.length)))[0]
      : shuffle(ranked.slice(0, Math.min(2, ranked.length)))[0];
    const fatigueVisual = fatigueAxisWeights().visual;
    const baseBlur = selected.blur + adaptivePressure.value * .55 + (maliciousPhase.value === "counter" ? .65 : 0);
    const baseZoom = selected.zoom + adaptivePressure.value * .025 + (maliciousPhase.value === "counter" ? .04 : 0);
    activeQuizTreatment.value = {
      ...selected,
      // Fatigue preserves readable evidence: it favors crop/mirror/gray and caps blur.
      blur: fatigueStage.value === "none" ? Math.min(6, baseBlur) : Math.min(3.6, baseBlur - fatigueVisual * .8),
      zoom: fatigueStage.value === "none" ? Math.min(1.48, baseZoom) : Math.min(1.52, baseZoom + fatigueVisual * .12),
      grayscale: Math.min(.88, selected.grayscale + fatigueVisual * .16 + (snapWrong && selected.grayscale > 0 ? .08 : 0)),
      mirror: selected.mirror || (fatigueVisual > .56 && Math.random() < .34),
      tileSize: selected.tileSize
        ? Math.min(5, selected.tileSize)
        : selected.tileSize,
    };
    const disguiseReference = currentQuestion.value?.disguiseReferenceId !== undefined
      ? quizPool.value.find((subject) => subject.id === currentQuestion.value?.disguiseReferenceId)
      : undefined;
    const disguiseFeature = disguiseReference ? quizVisualFeatureCache.get(disguiseReference.id) : null;
    if (visualFeature && disguiseFeature) {
      const hueDelta = ((disguiseFeature.hue - visualFeature.hue + 540) % 360) - 180;
      activeQuizTreatment.value = {
        ...activeQuizTreatment.value,
        hueRotate: activeQuizTreatment.value.hueRotate + Math.max(-42, Math.min(42, hueDelta)),
        saturate: Math.max(.55, Math.min(1.65,
          activeQuizTreatment.value.saturate * disguiseFeature.saturation / Math.max(.12, visualFeature.saturation),
        )),
        brightness: Math.max(.78, Math.min(1.22,
          disguiseFeature.brightness / Math.max(.18, visualFeature.brightness),
        )),
        zoom: Math.max(1.14, activeQuizTreatment.value.zoom),
      };
    }
  } else {
    activeQuizTreatment.value = shuffle(available)[0];
  }
  const focusEdge = quizDifficulty.value === "adaptive" ? 22 : 28;
  const targetsTextDependency = quizDifficulty.value === "adaptive"
    && maliciousTreatmentCues(activeQuizTreatment.value).includes("text");
  quizFocus.value = targetsTextDependency
    ? {
      x: Math.random() < .5 ? 28 + Math.round(Math.random() * 14) : 58 + Math.round(Math.random() * 14),
      y: 26 + Math.round(Math.random() * 20),
    }
    : {
      x: focusEdge + Math.round(Math.random() * (100 - focusEdge * 2)),
      y: focusEdge + Math.round(Math.random() * (100 - focusEdge * 2)),
    };
  const disguiseReference = currentQuestion.value?.disguiseReferenceId !== undefined
    ? quizVisualFeatureCache.get(currentQuestion.value.disguiseReferenceId)
    : null;
  if (quizDifficulty.value === "adaptive" && currentQuizVisualFeature.value && disguiseReference) {
    const horizontalShift = (currentQuizVisualFeature.value.horizontalBalance - disguiseReference.horizontalBalance) * 54;
    const verticalShift = (currentQuizVisualFeature.value.verticalBalance - disguiseReference.verticalBalance) * 54;
    quizFocus.value = {
      x: Math.max(22, Math.min(78, Math.round(50 + horizontalShift))),
      y: Math.max(22, Math.min(78, Math.round(50 + verticalShift))),
    };
  }
  const tileCount = activeQuizTreatment.value.tileSize ** 2;
  quizTilePositions.value = tileCount ? ensureScrambledPositions(tileCount) : [];
  const informativeTiles = currentQuizVisualFeature.value?.informativeTiles?.[
    activeQuizTreatment.value.tileSize as 2 | 3 | 4 | 5
  ] ?? [];
  quizSingleTileSource.value = tileCount
    ? shuffle(informativeTiles)[0] ?? Math.floor(Math.random() * tileCount)
    : 0;
}

function ensureScrambledPositions(tileCount: number): number[] {
  const positions = shuffle(Array.from({ length: tileCount }, (_, index) => index));
  if (tileCount > 1 && positions.every((position, index) => position === index)) {
    [positions[0], positions[1]] = [positions[1], positions[0]];
  }
  return positions;
}

function answerQuiz(subject: GameSubject) {
  if (quizSelectedId.value !== null || !quizQuestionReady.value || !currentQuestion.value) return;
  finishQuizAnswer(subject);
}

function noteQuizOptionVisit(index: number) {
  if (quizDifficulty.value !== "adaptive" || quizSelectedId.value !== null) return;
  if (!quizVisitedOptionIndexes.value.includes(index)) {
    quizVisitedOptionIndexes.value = [...quizVisitedOptionIndexes.value, index];
  }
}

function resetQuizPointerTrajectory() {
  quizPointerSamples = [];
  lastQuizPointerSampleAt = 0;
}

function captureQuizPointerSample(event: PointerEvent, forcedOptionIndex = -1, force = false) {
  if (
    quizDifficulty.value !== "adaptive"
    || !quizQuestionReady.value
    || quizSelectedId.value !== null
    || event.pointerType !== "mouse"
  ) return;
  const layout = quizQuestionLayoutRef.value;
  if (!layout) return;
  const timestamp = performance.now();
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-option-index]") : null;
  const optionIndex = forcedOptionIndex >= 0 ? forcedOptionIndex : Number(target?.dataset.optionIndex ?? -1);
  const previous = quizPointerSamples[quizPointerSamples.length - 1];
  if (!force && timestamp - lastQuizPointerSampleAt < 40 && previous?.optionIndex === optionIndex) return;
  const bounds = layout.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  quizPointerSamples.push({
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    timestamp,
    optionIndex: Number.isInteger(optionIndex) ? optionIndex : -1,
  });
  if (quizPointerSamples.length > 180) quizPointerSamples.shift();
  lastQuizPointerSampleAt = timestamp;
}

function summarizeQuizPointerTrajectory(): MaliciousPointerTrajectory | undefined {
  if (quizPointerSamples.length < 3) return undefined;
  let pathLength = 0;
  let directionChanges = 0;
  let previousDirection: { x: number; y: number } | null = null;
  const dwellDurations = Array.from({ length: quizOptionCount.value }, () => 0);
  for (let index = 1; index < quizPointerSamples.length; index += 1) {
    const previous = quizPointerSamples[index - 1];
    const current = quizPointerSamples[index];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    pathLength += distance;
    if (previous.optionIndex >= 0 && previous.optionIndex < dwellDurations.length) {
      dwellDurations[previous.optionIndex] += Math.min(250, current.timestamp - previous.timestamp);
    }
    if (distance < .012) continue;
    const direction = { x: dx / distance, y: dy / distance };
    if (previousDirection && previousDirection.x * direction.x + previousDirection.y * direction.y < .45) {
      directionChanges += 1;
    }
    previousDirection = direction;
  }
  const first = quizPointerSamples[0];
  const last = quizPointerSamples[quizPointerSamples.length - 1];
  const displacement = Math.hypot(last.x - first.x, last.y - first.y);
  const optionSamples = quizPointerSamples.filter((sample) => sample.optionIndex >= 0);
  const dwellMaximum = Math.max(...dwellDurations);
  return {
    sampleCount: quizPointerSamples.length,
    pathLength: Math.round(pathLength * 1000) / 1000,
    directness: Math.round((pathLength ? displacement / pathLength : 1) * 1000) / 1000,
    directionChanges,
    firstOptionIndex: optionSamples[0]?.optionIndex ?? -1,
    dwellOptionIndex: dwellMaximum > 0 ? dwellDurations.indexOf(dwellMaximum) : -1,
    lastOptionIndex: optionSamples[optionSamples.length - 1]?.optionIndex ?? -1,
  };
}

function recordFatigueObservation(correct: boolean, subject: GameSubject | null) {
  if (quizDifficulty.value !== "adaptive" || !currentQuestion.value) return;
  const responseMs = Math.max(0, performance.now() - quizStartedAt);
  const trajectory = summarizeQuizPointerTrajectory();
  const latest = maliciousRunObservations.value.at(-1)?.observation;
  const optionDwellMs = quizPointerSamples.reduce((total, sample, index) => {
    const next = quizPointerSamples[index + 1];
    return total + (sample.optionIndex >= 0 && next ? Math.min(250, next.timestamp - sample.timestamp) : 0);
  }, 0);
  const pointerComplexity = trajectory
    ? Math.min(1, trajectory.pathLength * .32 + trajectory.directionChanges * .045 + (1 - trajectory.directness) * .28)
    : 0;
  const responseRatio = Math.max(0, Math.min(1, responseMs / quizCurrentTimeLimitMs.value));
  const highPressure = responseRatio >= .65 || subject === null;
  const fatigue = fatigueValue.value;
  const titlePollutionHit = !correct && !!latest?.trapHits?.some((kind) => (
    kind === "franchise" || kind === "installment" || kind === "similar-title" || kind === "short-title" || kind === "long-title"
  ));
  fatigueRunObservations.value.push({
    questionNumber: quizIndex.value + 1,
    stage: fatigueStage.value,
    fatigue,
    pressure: Math.min(1, fatigueAttackStrength() + Number(currentConfidenceTrap.value) * .08),
    responseMs,
    correct,
    highPressure,
    optionDwellMs,
    pointerComplexity,
    titlePollutionHit,
    confidenceTrap: currentConfidenceBaitApplied.value,
    confidenceTrapHit: currentConfidenceBaitApplied.value && !correct
      && !!latest?.tacticHits?.includes("title-counter"),
  });
}

function handleQuizImageReady() {
  quizImageReady.value = true;
  startQuizQuestionIfReady();
}

function startQuizQuestionIfReady() {
  if (quizQuestionReady.value || quizSelectedId.value !== null || !quizImageReady.value || quizOptionShuffleAnimating.value) return;
  if (quizDifficulty.value === "adaptive" && !quizCoverRevealReady.value) {
    if (!quizCoverRevealAnimating.value) void revealMaliciousQuizCover();
    return;
  }
  quizQuestionReady.value = true;
  void sampleMaliciousSystemAudio();
  quizStartedAt = performance.now();
  quizRemainingMs.value = quizCurrentTimeLimitMs.value;
  quizClock = window.setInterval(updateQuizClock, 50);
  if (activeQuizTreatment.value.movingTiles) {
    quizTileMotionClock = window.setInterval(
      swapQuizTilePositions,
      quizTileSwapIntervalMs.value,
    );
  }
}

async function revealMaliciousQuizCover() {
  const runId = ++quizCoverRevealRunId;
  quizCoverRevealAnimating.value = true;
  playMaliciousSound("reveal", adaptivePressure.value);
  await nextTick();
  await waitForAnimationFrame();
  if (runId !== quizCoverRevealRunId) return;
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;
  await new Promise<void>((resolve) => window.setTimeout(resolve, duration));
  if (runId !== quizCoverRevealRunId) return;
  quizCoverRevealAnimating.value = false;
  quizCoverRevealReady.value = true;
  startQuizQuestionIfReady();
}

function updateQuizClock() {
  if (!quizQuestionReady.value || quizSelectedId.value !== null) return;
  quizRemainingMs.value = Math.max(0, quizCurrentTimeLimitMs.value - (performance.now() - quizStartedAt));
  if (quizDifficulty.value === "adaptive" && quizRemainingMs.value <= 2200) {
    const interval = quizRemainingMs.value <= 900 ? 180 : quizRemainingMs.value <= 1500 ? 260 : 400;
    const step = Math.floor((quizCurrentTimeLimitMs.value - quizRemainingMs.value) / interval);
    if (step !== maliciousCountdownStep) {
      maliciousCountdownStep = step;
      playMaliciousSound(quizRemainingMs.value <= 900 ? "critical" : "tick", 1 - quizRemainingMs.value / 2200);
    }
  }
  if (quizRemainingMs.value <= 0) finishQuizAnswer(null);
}

function addBehaviorObservation(
  stat: QuizBehaviorStat | undefined,
  correct: boolean,
  responseRatio: number,
): QuizBehaviorStat {
  const current = stat ?? emptyBehaviorStat();
  return {
    seen: current.seen + 1,
    correct: current.correct + Number(correct),
    responseRatioTotal: current.responseRatioTotal + responseRatio,
  };
}

function recordQuizBehavior(correct: boolean) {
  const responseRatio = Math.max(0, Math.min(1, 1 - quizRemainingMs.value / quizCurrentTimeLimitMs.value));
  const treatmentStats = { ...quizBehaviorProfile.value.treatmentStats };
  for (const family of quizTreatmentFamilies(activeQuizTreatment.value)) {
    treatmentStats[family] = addBehaviorObservation(treatmentStats[family], correct, responseRatio);
  }
  const languageStats = { ...quizBehaviorProfile.value.languageStats };
  const question = currentQuestion.value;
  const displayedTitle = quizOptions.value.find((option) => option.id === question?.id)?.displayTitle;
  const language = question?.translatedTitle && displayedTitle === question.translatedTitle
    ? "translated"
    : "original";
  languageStats[language] = addBehaviorObservation(languageStats[language], correct, responseRatio);
  quizBehaviorProfile.value = {
    answered: quizBehaviorProfile.value.answered + 1,
    correct: quizBehaviorProfile.value.correct + Number(correct),
    treatmentStats,
    languageStats,
  };
  try {
    localStorage.setItem(QUIZ_BEHAVIOR_PROFILE_KEY, JSON.stringify(quizBehaviorProfile.value));
  } catch { /* local behavior persistence is best effort */ }
}

function recordMaliciousAnalysis(subject: GameSubject | null, correct: boolean) {
  if (quizDifficulty.value !== "adaptive" || !currentQuestion.value) return;
  const responseRatio = Math.max(0, Math.min(1, 1 - quizRemainingMs.value / quizCurrentTimeLimitMs.value));
  const correctIndex = quizOptions.value.findIndex((option) => option.id === currentQuestion.value?.id);
  const selectedIndex = subject ? quizOptions.value.findIndex((option) => option.id === subject.id) : -1;
  const correctOption = quizOptions.value[correctIndex];
  const selectedOption = selectedIndex >= 0 ? quizOptions.value[selectedIndex] : null;
  const confidence: MaliciousConfidence = responseRatio <= .3
    ? "snap"
    : responseRatio >= .72 ? "hesitant" : "normal";
  const cues = maliciousTreatmentCues(activeQuizTreatment.value);
  const cueStats = { ...quizMaliciousAnalysis.value.cueStats };
  for (const cue of cues) cueStats[cue] = addBehaviorObservation(cueStats[cue], correct, responseRatio);
  const kindsForDecoy = (decoy: QuizOption) => {
    const kinds = maliciousTrapKinds(correctOption?.displayTitle ?? currentQuestion.value?.title ?? "", decoy.displayTitle);
    const feature = quizVisualFeatureCache.get(decoy.id);
    if (visualFeatureSimilarity(currentQuizVisualFeature.value, feature) >= .72) kinds.push("color-similar");
    if (visualRegionSetSimilarity(
      featureVisualRegions(currentQuizVisualFeature.value, "face"),
      featureVisualRegions(feature, "face"),
    ) >= .48) kinds.push("face-layout");
    if (visualRegionSetSimilarity(
      featureVisualRegions(currentQuizVisualFeature.value, "text"),
      featureVisualRegions(feature, "text"),
    ) >= .48) kinds.push("text-layout");
    return kinds;
  };
  const availableDecoys = quizOptions.value.filter((option) => option.id !== currentQuestion.value?.id);
  const trapKinds = availableDecoys.flatMap(kindsForDecoy);
  const trapHits = !correct && selectedOption ? kindsForDecoy(selectedOption) : [];
  if (isCurrentMaliciousEcho.value) {
    trapKinds.push("memory");
    if (
      !correct
      && selectedOption
      && maliciousEchoState.value?.originalOptionIds.includes(selectedOption.id)
    ) trapHits.push("memory");
  }
  const observation: MaliciousObservation = {
    questionId: currentQuestion.value.id,
    questionTitle: correctOption?.displayTitle ?? currentQuestion.value.title,
    selectedId: selectedOption?.id,
    selectedTitle: selectedOption?.displayTitle ?? "",
    selectedIndex,
    correctIndex,
    correct,
    timedOut: subject === null,
    responseRatio,
    confidence,
    phase: maliciousPhase.value,
    trapKinds: [...new Set(trapKinds)],
    trapHits: [...new Set(trapHits)],
    treatmentFamilies: quizTreatmentFamilies(activeQuizTreatment.value),
    visitOrder: [...quizVisitedOptionIndexes.value],
    pointerTrajectory: summarizeQuizPointerTrajectory(),
    visualFeature: currentQuizVisualFeature.value,
    timestamp: Date.now(),
    source: currentQuestion.value.source ?? "collection",
    unfamiliarity: 1 - subjectFamiliarity(currentQuestion.value),
    tactics: [...new Set(currentMaliciousTactics.value)],
    tacticHits: [...new Set(currentMaliciousTactics.value.filter((tactic) => {
      if (correct || !selectedOption) return false;
      const target = currentMaliciousTacticTargets.value[tactic];
      if (!target) return false;
      if (target.decoyId !== undefined) {
        return selectedIndex === target.position && selectedOption.id === target.decoyId;
      }
      if (target.decoyIds) return target.decoyIds.includes(selectedOption.id);
      return false;
    }))],
    franchiseKey: subjectFranchiseKey(currentQuestion.value),
    seasonKey: subjectSeasonKey(currentQuestion.value),
  };
  maliciousRunObservations.value.push({
    observation,
    attackStrength: Math.min(1, adaptivePressure.value + fatigueAttackStrength() * .12),
  });
  const trapBeliefs = updateMaliciousTrapBeliefs(
    [...new Set(trapKinds)],
    [...new Set(trapHits)],
    responseRatio,
    correct,
  );
  quizMaliciousAnalysis.value = {
    version: 2,
    recent: [...quizMaliciousAnalysis.value.recent, observation].slice(-48),
    cueStats,
    trapBeliefs,
  };
  try {
    localStorage.setItem(QUIZ_MALICIOUS_ANALYSIS_KEY, JSON.stringify(quizMaliciousAnalysis.value));
  } catch { /* local behavior persistence is best effort */ }
  maliciousProgress.value = { ...maliciousProgress.value, answers: maliciousProgress.value.answers + 1 };
  maliciousHistory.value = [
    ...maliciousHistory.value,
    {
      id: currentQuestion.value.id,
      title: currentQuestion.value.title,
      timestamp: Date.now(),
      franchiseKey: subjectFranchiseKey(currentQuestion.value),
      seasonKey: subjectSeasonKey(currentQuestion.value),
    },
  ].slice(-MALICIOUS_HISTORY_SIZE);
  const exposureKey = String(currentQuestion.value.id);
  const previousExposure = maliciousExposure.value[exposureKey] ?? { total: 0, unknown: 0, lastSeenAt: 0 };
  maliciousExposure.value = {
    ...maliciousExposure.value,
    [exposureKey]: {
      total: previousExposure.total + 1,
      unknown: previousExposure.unknown + Number(unknownChallenge.value),
      lastSeenAt: Date.now(),
    },
  };
  try {
    localStorage.setItem(QUIZ_MALICIOUS_PROGRESS_KEY, JSON.stringify(maliciousProgress.value));
    localStorage.setItem(QUIZ_MALICIOUS_HISTORY_KEY, JSON.stringify(maliciousHistory.value));
    localStorage.setItem(QUIZ_MALICIOUS_EXPOSURE_KEY, JSON.stringify(maliciousExposure.value));
  } catch { /* local history persistence is best effort */ }
}

function chooseNextMaliciousPhase(correct: boolean, subject: GameSubject | null) {
  const responseRatio = Math.max(0, Math.min(1, 1 - quizRemainingMs.value / quizCurrentTimeLimitMs.value));
  const snap = responseRatio <= .3;
  const hesitant = responseRatio >= .72 || subject === null;
  const nextIndex = quizIndex.value + 1;
  const roundWindow = maliciousRoundWindow(nextIndex);
  if (nextIndex <= 1) {
    maliciousPhase.value = "probe";
    return;
  }
  if (roundWindow.conditioning && !snap) {
    maliciousPhase.value = "bait";
    return;
  }
  if (nextIndex >= roundWindow.endgameStart && correct) {
    maliciousPhase.value = snap ? "trap" : "counter";
    return;
  }
  if (!correct && snap) {
    maliciousPhase.value = "counter";
    return;
  }
  if (maliciousConfidenceState.value || (correct && snap && maliciousCorrectStreak.value >= 2)) {
    maliciousPhase.value = "trap";
    return;
  }
  if (!correct || hesitant) {
    maliciousPhase.value = "counter";
    return;
  }
  maliciousPhase.value = nextIndex <= roundWindow.openingEnd || roundWindow.conditioning
    ? "bait"
    : maliciousPhase.value === "bait" ? "trap" : "bait";
}

function reorderRemainingMaliciousQuestions() {
  if (quizDifficulty.value !== "adaptive" || quizIndex.value >= quizQuestions.value.length - 1) return;
  const completed = quizQuestions.value.slice(0, quizIndex.value + 1);
  const remaining = quizQuestions.value.slice(quizIndex.value + 1);
  const latest = maliciousRecent(1)[0];
  // Compute the expensive trap score and memory score once per question. The
  // old sort comparator recalculated both scores repeatedly (O(n log n)),
  // causing visible multi-second pauses on long runs and large pools.
  const trapScores = new Map(remaining.map((question) => {
    const cached = maliciousQuestionTrapScoreCache.get(question.id);
    const score = cached ?? maliciousQuestionTrapScore(question, quizPool.value);
    if (cached === undefined) maliciousQuestionTrapScoreCache.set(question.id, score);
    return [question.id, score] as const;
  }));
  const memoryScores = new Map(remaining.map((question) => [
    question.id,
    latest
      ? titleConfusability(latest.questionTitle, question.title)
        + visualFeatureSimilarity(latest.visualFeature, quizVisualFeatureCache.get(question.id))
      : 0,
  ] as const));
  const ranked = [...remaining].sort((first, second) => {
    const trapDifference = trapScores.get(second.id)! - trapScores.get(first.id)!;
    const memoryDifference = memoryScores.get(second.id)! - memoryScores.get(first.id)!;
    if (maliciousPhase.value === "trap") return trapDifference + memoryDifference * .5;
    if (maliciousPhase.value === "counter") return trapDifference * .55 + memoryDifference * .9;
    if (maliciousPhase.value === "bait") return memoryDifference * .7 - trapDifference * .12;
    return trapDifference * .28 + memoryDifference * .35;
  });
  const selectionBand = maliciousPhase.value === "trap" ? 2 : maliciousPhase.value === "counter" ? 3 : 4;
  if (ranked.length > 1) {
    const selectedIndex = Math.floor(Math.random() * Math.min(selectionBand, ranked.length));
    [ranked[0], ranked[selectedIndex]] = [ranked[selectedIndex], ranked[0]];
  }
  const echo = maliciousEchoState.value;
  if (echo && echo.targetIndex > quizIndex.value) {
    const echoIndex = ranked.findIndex((item) => item.id === echo.subjectId);
    if (echoIndex >= 0) {
      const [echoQuestion] = ranked.splice(echoIndex, 1);
      const relativeTarget = Math.min(ranked.length, echo.targetIndex - completed.length);
      ranked.splice(relativeTarget, 0, echoQuestion);
    }
  }
  quizQuestions.value = [...completed, ...ranked];
  preloadQuizCover(ranked[0]);
  preloadQuizCover(ranked[1]);
}

function preloadQuizCover(subject: GameSubject | undefined) {
  if (!subject?.image || quizCoverPreloadCache.has(subject.image)) return;
  quizCoverPreloadCache.add(subject.image);
  const image = new Image();
  image.decoding = "async";
  image.src = subject.image;
  void image.decode().catch(() => quizCoverPreloadCache.delete(subject.image));
}

function scheduleMaliciousEcho(question: GameSubject, correct: boolean) {
  const total = quizQuestions.value.length;
  const completedEchoes = maliciousEchoCount.value;
  const maxEchoes = total >= 50 ? 5 : total >= 30 ? 4 : total >= 15 ? 2 : 1;
  const minimumGap = total >= 50 ? 6 : total >= 30 ? 5 : total >= 20 ? 4 : 3;
  if (
    quizDifficulty.value !== "adaptive"
    || !correct
    || maliciousEchoState.value
    || completedEchoes >= maxEchoes
    || quizIndex.value + minimumGap >= total
  ) return;
  const longRunMilestones = total >= 50
    ? [.24, .4, .56, .72, .86]
    : total >= 30
      ? [.28, .46, .64, .82]
      : [];
  const targetFloor = longRunMilestones[completedEchoes] !== undefined
    ? Math.floor(total * longRunMilestones[completedEchoes])
    : completedEchoes === 0
      ? total <= 10 ? 7 : Math.floor(total * .5)
      : Math.floor(total * .76);
  const earliestTarget = Math.max(targetFloor, quizIndex.value + minimumGap);
  if (earliestTarget >= quizQuestions.value.length) return;
  const latestTarget = Math.min(total - 1, earliestTarget + Math.max(1, Math.floor(total * (total >= 50 ? .1 : .14))));
  const targetIndex = earliestTarget + Math.floor(Math.random() * (latestTarget - earliestTarget + 1));
  const originalDisplayTitle = quizOptions.value.find((option) => option.id === question.id)?.displayTitle ?? question.title;
  maliciousEchoState.value = {
    subjectId: question.id,
    targetIndex,
    originalDisplayTitle,
    originalOptionIds: quizOptions.value.map((option) => option.id),
    originalTreatmentFamilies: quizTreatmentFamilies(activeQuizTreatment.value),
  };
  const questions = [...quizQuestions.value];
  questions[targetIndex] = question;
  quizQuestions.value = questions;
}

function finishQuizAnswer(subject: GameSubject | null) {
  const question = currentQuestion.value;
  if (!question || quizSelectedId.value !== null) return;
  updateRemainingTime();
  stopQuizClock();
  stopQuizTileMotion();
  quizSelectedId.value = subject?.id ?? -1;
  quizTimedOut.value = subject === null;
  quizAnswerReveal.value = true;
  quizTransitioning.value = false;
  const correct = subject?.id === question.id;
  quizLastBrokenStreak.value = 0;
  if (!correct) {
    quizLastBrokenStreak.value = quizCorrectStreak.value;
    quizCorrectStreak.value = 0;
    const responseRatio = Math.max(0, Math.min(1, 1 - quizRemainingMs.value / quizCurrentTimeLimitMs.value));
    quizAnswerStats.value = {
      wrong: quizAnswerStats.value.wrong + 1,
      timedOut: quizAnswerStats.value.timedOut + Number(subject === null),
      hesitantWrong: quizAnswerStats.value.hesitantWrong + Number(subject !== null && responseRatio >= .72),
      snapWrong: quizAnswerStats.value.snapWrong + Number(subject !== null && responseRatio <= .3),
    };
  }
  if (subject === null) applyQuizTimeoutPenalty();
  playMaliciousSound(correct ? "correct" : subject === null ? "timeout" : "wrong", adaptivePressure.value);
  const answeredEcho = isCurrentMaliciousEcho.value;
  if (quizDifficulty.value === "adaptive" && !correct) triggerMaliciousImpact();
  const speedRatio = quizRemainingMs.value / quizCurrentTimeLimitMs.value;
  const nextAdaptivePressure = quizDifficulty.value === "adaptive"
    ? Math.min(1, adaptivePressure.value + (correct ? .035 + speedRatio * .05 : .018))
    : adaptivePressure.value;
  if (correct) {
    quizCorrectStreak.value += 1;
    quizBestStreak.value = Math.max(quizBestStreak.value, quizCorrectStreak.value);
    const timeRatio = quizRemainingMs.value / quizCurrentTimeLimitMs.value;
    // Four seconds includes visual acquisition and scanning twelve options.
    // A small reaction reserve keeps mid-window answers worthwhile while the
    // full bonus remains reserved for genuinely immediate recognition.
    const decisionRatio = Math.max(0, Math.min(1, (timeRatio - .06) / .94));
    const speedBonus = Math.round(quizConfig.value.baseScore * Math.pow(decisionRatio, 1.15));
    const riskMultiplier = quizDifficulty.value === "adaptive"
      ? (1.2 + nextAdaptivePressure * .3) * (unknownChallenge.value ? 1.12 : 1)
      : 1;
    quizEarnedPoints.value = Math.round(
      (quizConfig.value.baseScore + speedBonus)
        * quizScoreMultiplier.value
        * riskMultiplier
        * quizStreakMultiplier.value,
    );
    quizScore.value += quizEarnedPoints.value;
    quizCorrectCount.value += 1;
    if (quizCorrectStreak.value >= 2) playMaliciousSound("combo", quizCorrectStreak.value);
  }
  if (quizIndex.value >= quizQuestions.value.length - 1) void saveQuizHighScore();
  // Let Vue paint the answer state before local analysis and question reordering.
  quizAnswerAnalysisTimer = window.setTimeout(() => {
    quizAnswerAnalysisTimer = undefined;
    recordQuizBehavior(correct);
    recordMaliciousAnalysis(subject, correct);
    recordFatigueObservation(correct, subject);
    if (quizDifficulty.value !== "adaptive") return;
    if (!correct && subject) {
      quizMaliciousDecoyIds.value = [
        subject.id,
        ...quizMaliciousDecoyIds.value.filter((id) => id !== subject.id),
      ].slice(0, 6);
    }
    adaptivePressure.value = nextAdaptivePressure;
    chooseNextMaliciousPhase(correct, subject);
    if (answeredEcho) {
      maliciousEchoCount.value += 1;
      maliciousEchoState.value = null;
    }
    else scheduleMaliciousEcho(question, correct);
  }, 32);
  const revealDelay = subject === null ? 2_400 : quizDifficulty.value === "adaptive" ? (correct ? 280 : 440) : 1000;
  const advanceDelay = subject === null ? 3_000 : quizDifficulty.value === "adaptive" ? (correct ? 470 : 680) : 1820;
  quizAnswerRevealTimer = window.setTimeout(() => {
    quizAnswerRevealTimer = undefined;
    quizAnswerReveal.value = false;
    quizTransitioning.value = quizIndex.value < quizQuestions.value.length - 1;
    if (quizTransitioning.value) {
      // Show the pressure page first; large-pool sorting must not delay the transition.
      quizReorderTimer = window.setTimeout(() => {
        quizReorderTimer = undefined;
        reorderRemainingMaliciousQuestions();
      }, 32);
    }
  }, revealDelay);
  quizAdvanceTimer = window.setTimeout(
    advanceQuiz,
    quizIndex.value >= quizQuestions.value.length - 1 ? Math.max(620, revealDelay) : advanceDelay,
  );
}

function drawQuizTimeoutPenalty(): QuizTimeoutPenalty {
  const roll = Math.random();
  return roll < .45 ? "score" : roll < .9 ? "time" : "both";
}

function applyQuizTimeoutPenalty() {
  // Each question receives its own draw during preparation. The fallback only
  // covers an unexpected direct call before a question has been prepared.
  const penalty = quizTimeoutPenalty.value === "none"
    ? drawQuizTimeoutPenalty()
    : quizTimeoutPenalty.value;
  quizTimeoutPenalty.value = penalty;
  if (penalty === "score" || penalty === "both") {
    const deduction = Math.round(quizConfig.value.baseScore * QUIZ_TIMEOUT_SCORE_PENALTY_MULTIPLIER);
    quizTimeoutScoreDeduction.value = deduction;
    quizScore.value -= deduction;
  }
  if (penalty === "time" || penalty === "both") {
    const reduction = Math.round(quizTimeLimitMs.value * QUIZ_TIMEOUT_TIME_REDUCTION_RATIO);
    quizTimeoutTimeReduction.value = reduction;
    if (quizIndex.value < quizQuestions.value.length - 1) quizNextTimeReductionMs.value = reduction;
  }
}

function triggerMaliciousImpact() {
  if (maliciousImpactTimer !== undefined) window.clearTimeout(maliciousImpactTimer);
  if (maliciousImpactFrame !== undefined) window.cancelAnimationFrame(maliciousImpactFrame);
  maliciousImpact.value = false;
  maliciousImpactFrame = window.requestAnimationFrame(() => {
    maliciousImpactFrame = undefined;
    maliciousImpact.value = true;
    maliciousImpactTimer = window.setTimeout(() => {
      maliciousImpact.value = false;
      maliciousImpactTimer = undefined;
    }, 460);
  });
}

function updateRemainingTime() {
  if (!quizQuestionReady.value) return;
  quizRemainingMs.value = Math.max(0, quizCurrentTimeLimitMs.value - (performance.now() - quizStartedAt));
}

function advanceQuiz() {
  if (quizIndex.value >= quizQuestions.value.length - 1) {
    quizAnswerReveal.value = false;
    quizTransitioning.value = false;
    quizFinished.value = true;
    if (quizDifficulty.value === "adaptive") {
      maliciousProgress.value = { ...maliciousProgress.value, completions: maliciousProgress.value.completions + 1 };
      try {
        localStorage.setItem(QUIZ_MALICIOUS_PROGRESS_KEY, JSON.stringify(maliciousProgress.value));
      } catch { /* local progress persistence is best effort */ }
    }
    return;
  }
  quizIndex.value += 1;
  prepareQuizOptions();
  quizAnswerReveal.value = false;
  quizTransitioning.value = false;
}

async function saveQuizHighScore() {
  if (quizDifficulty.value === "adaptive") await sampleMaliciousSystemAudio();
  if (quizBestStreak.value > quizSavedBestStreak.value) {
    quizBestStreaks.value = { ...quizBestStreaks.value, [quizBestStreakKey.value]: quizBestStreak.value };
    try {
      localStorage.setItem(QUIZ_GAME_BEST_STREAKS_KEY, JSON.stringify(quizBestStreaks.value));
    } catch { /* local persistence is best effort */ }
  }
  if (quizScore.value <= quizHighScore.value) return;
  if (quizDifficulty.value === "adaptive") {
    const marks = { ...quizAudioMarks.value };
    if (maliciousRunAudioMark.value) marks[quizAudioMarkKey.value] = maliciousRunAudioMark.value;
    else delete marks[quizAudioMarkKey.value];
    quizAudioMarks.value = marks;
    try {
      localStorage.setItem(QUIZ_AUDIO_MARKS_KEY, JSON.stringify(marks));
    } catch { /* local persistence is best effort */ }
  }
  if (unknownChallenge.value) {
    unknownChallengeHighScores.value = {
      ...unknownChallengeHighScores.value,
      [String(quizQuestionCount.value)]: quizScore.value,
    };
    quizNewRecord.value = true;
    try {
      localStorage.setItem(QUIZ_UNKNOWN_CHALLENGE_HIGH_SCORE_KEY, JSON.stringify(unknownChallengeHighScores.value));
    } catch { /* local persistence is best effort */ }
    return;
  }
  quizHighScores.value = { ...quizHighScores.value, [quizHighScoreKey.value]: quizScore.value };
  quizNewRecord.value = true;
  try {
    localStorage.setItem(QUIZ_GAME_HIGH_SCORES_KEY, JSON.stringify(quizHighScores.value));
  } catch { /* local persistence is best effort */ }
}

function swapQuizTilePositions() {
  const positions = [...quizTilePositions.value];
  if (positions.length < 2 || quizSelectedId.value !== null) return;
  const pairCount = Math.min(
    quizTileSwapPairs.value,
    Math.floor(positions.length / 2),
  );
  const sourceIndexes = shuffle(Array.from({ length: positions.length }, (_, index) => index));
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const first = sourceIndexes[pairIndex * 2];
    const second = sourceIndexes[pairIndex * 2 + 1];
    [positions[first], positions[second]] = [positions[second], positions[first]];
  }
  quizTilePositions.value = positions;
}

function quizTileStyle(sourceIndex: number) {
  const size = activeQuizTreatment.value.tileSize;
  const targetSlot = activeQuizTreatment.value.singleTile
    ? sourceIndex
    : quizTilePositions.value[sourceIndex] ?? sourceIndex;
  const targetX = targetSlot % size;
  const targetY = Math.floor(targetSlot / size);
  const x = sourceIndex % size;
  const y = Math.floor(sourceIndex / size);
  const positionX = size <= 1 ? 0 : x / (size - 1) * 100;
  const positionY = size <= 1 ? 0 : y / (size - 1) * 100;
  return {
    backgroundImage: `url(${JSON.stringify(currentQuestion.value?.image ?? "")})`,
    backgroundSize: `${size * 100}% ${size * 100}%`,
    backgroundPosition: `${positionX}% ${positionY}%`,
    width: `${100 / size}%`,
    height: `${100 / size}%`,
    transform: `translate(${targetX * 100}%, ${targetY * 100}%)`,
  };
}

function quizOptionClass(subject: GameSubject) {
  if (quizSelectedId.value === null || !currentQuestion.value) return {};
  return {
    "is-correct": subject.id === currentQuestion.value.id,
    "is-wrong": subject.id === quizSelectedId.value && subject.id !== currentQuestion.value.id,
    "is-dimmed": subject.id !== currentQuestion.value.id && subject.id !== quizSelectedId.value,
  };
}

function stopMemoryClock() {
  if (memoryStartedAt.value) {
    elapsedSeconds.value = Math.floor((Date.now() - memoryStartedAt.value) / 1000);
  }
  if (memoryClock !== undefined) window.clearInterval(memoryClock);
  memoryClock = undefined;
}

function stopQuizClock() {
  if (quizClock !== undefined) window.clearInterval(quizClock);
  quizClock = undefined;
}

function stopQuizTileMotion() {
  if (quizTileMotionClock !== undefined) window.clearInterval(quizTileMotionClock);
  quizTileMotionClock = undefined;
}

function clearGameTimers() {
  quizOptionShuffleRunId += 1;
  quizCoverRevealRunId += 1;
  stopMemoryClock();
  stopQuizClock();
  stopQuizTileMotion();
  if (flipTimer !== undefined) window.clearTimeout(flipTimer);
  if (quizAdvanceTimer !== undefined) window.clearTimeout(quizAdvanceTimer);
  if (quizAnswerAnalysisTimer !== undefined) window.clearTimeout(quizAnswerAnalysisTimer);
  if (quizAnswerRevealTimer !== undefined) window.clearTimeout(quizAnswerRevealTimer);
  if (quizReorderTimer !== undefined) window.clearTimeout(quizReorderTimer);
  quizAnswerReveal.value = false;
  quizTransitioning.value = false;
  quizOptionShuffleAnimating.value = false;
  quizImageReady.value = false;
  quizCoverRevealAnimating.value = false;
  quizCoverRevealReady.value = false;
  if (maliciousImpactTimer !== undefined) window.clearTimeout(maliciousImpactTimer);
  if (maliciousImpactFrame !== undefined) window.cancelAnimationFrame(maliciousImpactFrame);
  flipTimer = undefined;
  quizAdvanceTimer = undefined;
  quizAnswerAnalysisTimer = undefined;
  quizAnswerRevealTimer = undefined;
  quizReorderTimer = undefined;
  maliciousImpactTimer = undefined;
  maliciousImpactFrame = undefined;
  maliciousImpact.value = false;
  resetQuizPointerTrajectory();
}

function returnToMenu() {
  quizInitializationRunId += 1;
  stopQuizInitializationClock();
  clearGameTimers();
  mode.value = "menu";
  error.value = "";
}

function openGameDetails(game: "memory" | "quiz") {
  quizInitializationRunId += 1;
  stopQuizInitializationClock();
  clearGameTimers();
  error.value = "";
  if (game === "quiz") quizDifficultyIndicatorReady.value = false;
  if (game !== "quiz" || quizDifficulty.value !== "adaptive") showMaliciousReport.value = false;
  mode.value = game === "memory" ? "memory-detail" : "quiz-detail";
}

function refreshQuizDifficultyIndicatorAfterResize() {
  if (mode.value !== "quiz-detail") return;
  void nextTick(() => window.requestAnimationFrame(updateQuizDifficultyIndicator));
}

function animateGameShellBounds(fromBounds = {
  width: lastStableShellWidth,
  height: lastStableShellHeight,
}) {
  const shell = gameShellRef.value;
  if (!shell) return;
  if (shellHeightFrame !== undefined) window.cancelAnimationFrame(shellHeightFrame);
  if (shellHeightResetTimer !== undefined) window.clearTimeout(shellHeightResetTimer);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shell.style.width = "";
    shell.style.height = "";
    shell.style.maxHeight = "";
    shell.classList.remove("is-size-animating");
    const bounds = shell.getBoundingClientRect();
    lastStableShellWidth = bounds.width;
    lastStableShellHeight = bounds.height;
    refreshQuizDifficultyIndicatorAfterResize();
    return;
  }

  const renderedBounds = shell.getBoundingClientRect();
  const currentWidth = fromBounds.width || renderedBounds.width;
  const currentHeight = fromBounds.height || renderedBounds.height;
  shell.style.transition = "none";
  shell.style.width = "";
  shell.style.height = "";
  shell.style.maxHeight = "";
  void shell.offsetHeight;
  const targetWidth = shell.getBoundingClientRect().width;
  const computedMaxHeight = Number.parseFloat(window.getComputedStyle(shell).maxHeight);
  const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : window.innerHeight;
  const targetHeight = Math.min(shell.scrollHeight, maxHeight);
  if (Math.abs(targetHeight - currentHeight) < 1 && Math.abs(targetWidth - currentWidth) < 1) {
    lastStableShellWidth = targetWidth;
    lastStableShellHeight = targetHeight;
    shell.style.transition = "";
    shell.classList.remove("is-size-animating");
    refreshQuizDifficultyIndicatorAfterResize();
    return;
  }

  shell.classList.add("is-size-animating");
  shell.style.maxHeight = `${Math.max(currentHeight, targetHeight)}px`;
  shell.style.width = `${currentWidth}px`;
  shell.style.height = `${currentHeight}px`;
  void shell.offsetHeight;
  shell.style.transition = "";
  shellHeightFrame = window.requestAnimationFrame(() => {
    shell.style.width = `${targetWidth}px`;
    shell.style.height = `${targetHeight}px`;
    shellHeightResetTimer = window.setTimeout(() => {
      const finalBounds = shell.getBoundingClientRect();
      lastStableShellWidth = finalBounds.width;
      lastStableShellHeight = finalBounds.height;
      shell.style.width = "";
      shell.style.height = "";
      shell.style.maxHeight = "";
      shell.classList.remove("is-size-animating");
      refreshQuizDifficultyIndicatorAfterResize();
    }, 300);
  });
}

function close() {
  quizInitializationRunId += 1;
  stopQuizInitializationClock();
  clearGameTimers();
  emit("close");
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(quizDifficulty, () => {
  const previousBounds = gameShellRef.value?.getBoundingClientRect();
  void nextTick(() => {
    animateGameShellBounds(previousBounds ? {
      width: previousBounds.width,
      height: previousBounds.height,
    } : undefined);
    updateQuizDifficultyIndicator();
  });
});
watch(mode, (value) => {
  const previousBounds = gameShellRef.value?.getBoundingClientRect();
  void nextTick(() => {
    animateGameShellBounds(previousBounds ? {
      width: previousBounds.width,
      height: previousBounds.height,
    } : undefined);
  });
});

function handleGameWindowResize() {
  if (mode.value === "quiz-detail") quizDifficultyIndicatorReady.value = false;
  animateGameShellBounds();
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleGameWindowResize);
  void nextTick(() => {
    updateQuizDifficultyIndicator();
    const bounds = gameShellRef.value?.getBoundingClientRect();
    lastStableShellWidth = bounds?.width || 0;
    lastStableShellHeight = bounds?.height || 0;
    window.requestAnimationFrame(updateQuizDifficultyIndicator);
  });
});
onBeforeUnmount(() => {
  stopQuizInitializationClock();
  clearGameTimers();
  if (shellHeightFrame !== undefined) window.cancelAnimationFrame(shellHeightFrame);
  if (shellHeightResetTimer !== undefined) window.clearTimeout(shellHeightResetTimer);
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", handleGameWindowResize);
});
</script>

<template>
  <Transition name="collection-game" appear>
    <div class="collection-game-overlay" role="dialog" aria-modal="true" aria-labelledby="collection-game-title">
      <section
        ref="gameShellRef"
        class="collection-game-shell"
        :class="[
          `is-${mode}`,
          {
            'is-malicious-pressure': maliciousPressureActive,
            'is-malicious-critical': maliciousPressureCritical,
            'is-malicious-impact': maliciousImpact,
          },
        ]"
      >
        <header class="collection-game-header">
          <div>
            <p class="collection-game-kicker">COLLECTION PLAY</p>
            <h2 id="collection-game-title">{{ mode === "memory" || mode === "memory-detail" ? "封面记忆翻牌" : mode === "quiz" || mode === "quiz-detail" || mode === "quiz-initializing" ? "封面猜番" : "收藏小游戏" }}</h2>
          </div>
          <button class="collection-game-close" type="button" title="关闭" aria-label="关闭游戏" @click="close">×</button>
        </header>

        <main v-if="mode === 'menu'" class="collection-game-menu">
          <div class="collection-game-notice">
            <span class="collection-game-notice__mark" aria-hidden="true">i</span>
            <p>游戏会从你的「收藏」中随机抽取动画及其封面。收藏内容将在本地处理，仅用于本次游戏。</p>
          </div>
          <div class="collection-game-modes">
            <button type="button" class="collection-game-mode" :disabled="loading" @click="openGameDetails('memory')">
              <span class="collection-game-mode__preview memory-preview" aria-hidden="true">
                <i></i><i></i><i></i><i></i>
              </span>
              <span><strong>封面记忆翻牌</strong><small>找出 6 组相同封面 · {{ memoryHighScore ? `最高 ${memoryHighScore} 分` : "暂无记录" }}</small></span>
              <b aria-hidden="true">›</b>
            </button>
            <button type="button" class="collection-game-mode" :disabled="loading" @click="openGameDetails('quiz')">
              <span class="collection-game-mode__preview quiz-preview" aria-hidden="true">?</span>
              <span><strong>封面猜番</strong><small>{{ quizQuestionCount }} 题 · {{ quizOptionCount }} 个选项 · {{ quizHighScore ? `最高 ${quizHighScore} 分` : "暂无记录" }}{{ quizSavedBestStreak ? ` · 最佳连对 ${quizSavedBestStreak}` : '' }}</small></span>
              <b aria-hidden="true">›</b>
            </button>
          </div>
          <div class="collection-game-status" aria-live="polite">
            <span v-if="loading" class="collection-game-loader"></span>
            <span v-if="loading">正在读取动画收藏…</span>
            <span v-else-if="error" class="collection-game-error">{{ error }}</span>
          </div>
        </main>

        <main v-else-if="mode === 'memory-detail' || mode === 'quiz-detail'" class="collection-game-detail">
          <button class="collection-game-back" type="button" @click="returnToMenu">‹ 选择游戏</button>
          <div class="collection-game-detail__hero">
            <span v-if="mode === 'memory-detail'" class="collection-game-mode__preview memory-preview" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span v-else class="collection-game-mode__preview quiz-preview" aria-hidden="true">?</span>
            <div>
              <h3>{{ mode === 'memory-detail' ? '封面记忆翻牌' : '封面猜番' }}</h3>
              <p v-if="mode === 'memory-detail'">翻开卡片，找出 6 组相同封面。步数和用时越少，得分越高。</p>
              <p v-else>每局 10 题，从你的「收藏」中抽取带封面的动画；每题限时，答得越快分数越高。</p>
            </div>
          </div>
          <div class="collection-game-notice">
            <span class="collection-game-notice__mark" aria-hidden="true">i</span>
            <p>开始后会从你的「收藏」里抽取番剧及封面。收藏内容只在本地处理，不会上传。</p>
          </div>
          <div v-if="mode === 'quiz-detail'" class="quiz-difficulty-picker">
            <div class="quiz-timeout-rule" role="note">
              <span aria-hidden="true">!</span>
              <p><strong>超时未作答，将会受到随机惩罚！</strong><small>45% 扣 {{ quizConfig.baseScore }} 分，45% 下一题限时减少 25%，10% 两项同时触发。</small></p>
            </div>
            <div class="quiz-difficulty-picker__header">
              <span>选择难度</span>
              <small>{{ quizOptionCount }} 个选项 · {{ (quizTimeLimitMs / 1000).toFixed(1) }} 秒 · 基础 {{ quizConfig.baseScore }} 分</small>
            </div>
            <div ref="quizDifficultyTabsRef" class="quiz-difficulty-tabs" role="tablist" aria-label="猜番难度">
              <button v-for="difficulty in QUIZ_DIFFICULTY_ORDER" :key="difficulty" role="tab" type="button" :data-difficulty="difficulty" :class="{ 'is-active': quizDifficulty === difficulty, 'is-locked': difficulty === 'adaptive' && !adaptiveUnlocked }" :aria-selected="quizDifficulty === difficulty" :disabled="loading || (difficulty === 'adaptive' && !adaptiveUnlocked)" :title="difficulty === 'adaptive' && !adaptiveUnlocked ? '收集足够答题行为后解锁' : ''" @click="selectQuizDifficulty(difficulty)">{{ QUIZ_DIFFICULTIES[difficulty].label }}</button>
              <i class="quiz-difficulty-indicator" :class="{ 'is-ready': quizDifficultyIndicatorReady }" :style="quizDifficultyIndicatorStyle" aria-hidden="true"></i>
            </div>
            <p v-if="!adaptiveUnlocked" class="quiz-adaptive-lock">「恶意」难度尚未解锁：还需 {{ adaptiveAnswersRemaining }} 道有效答题，并覆盖 {{ Math.max(0, QUIZ_ADAPTIVE_MIN_FAMILIES - adaptiveObservedFamilies) }} 类封面处理。</p>
            <template v-else-if="quizDifficulty === 'adaptive'">
              <div class="quiz-adaptive-summary">
                <p class="quiz-adaptive-warning">{{ unknownChallenge ? '未知挑战：系统将主要从冷门与探索题库寻找你的知识边界，成绩独立记录。' : '恶意模式已启用：系统会动态混合收藏、热门、冷门与探索题库，并持续寻找你的能力边界。' }}</p>
                <button class="secondary-button quiz-adaptive-report-toggle" type="button" :aria-expanded="showMaliciousReport" @click="toggleMaliciousReport">
                  {{ showMaliciousReport ? '收起分析报告' : '查看玩家分析' }}
                </button>
              </div>
              <div class="quiz-malicious-sound-warning" role="note">
                <span aria-hidden="true">♪</span>
                <p><strong>音效警告</strong><small>此难度可能播放倒计时、正误等音效。</small></p>
                <label><input v-model="maliciousSoundEnabled" type="checkbox" /><b>{{ maliciousSoundEnabled ? '本局开启' : '本局静音' }}</b></label>
              </div>
              <label class="quiz-unknown-challenge" :class="{ 'is-locked': !unknownChallengeUnlocked }">
                <input v-model="unknownChallenge" type="checkbox" :disabled="!unknownChallengeUnlocked || loading" />
                <span><strong>未知挑战</strong><small v-if="unknownChallengeUnlocked">已解锁 · 冷门与随机探索为主 · 本档最高 {{ unknownChallengeHighScores[String(quizQuestionCount)] ?? 0 }} 分</small><small v-else>再完成 {{ unknownChallengeCompletionsRemaining }} 局恶意难度即可解锁（{{ maliciousProgress.completions }} / {{ UNKNOWN_CHALLENGE_MIN_COMPLETIONS }}）</small></span>
              </label>
              <Transition name="result-rise" @after-leave="animateMaliciousReportCollapse">
                <section v-if="showMaliciousReport" class="malicious-report" aria-label="恶意模式玩家分析报告">
                  <div class="malicious-report__header">
                    <div><strong> SimpBangumi 对你的判断</strong><small>基于当前设备最近 {{ maliciousReportSampleSize }} 道恶意题</small></div>
                    <span>仅供博弈参考</span>
                  </div>
                  <div v-if="maliciousReportItems.length" class="malicious-report__grid">
                    <article v-for="item in maliciousReportItems" :key="item.label" :class="`is-${item.level}`">
                      <span>{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                      <p>{{ item.detail }}</p>
                    </article>
                  </div>
                  <div v-else class="malicious-report__empty">还没有恶意模式答题记录。完成一局后， SimpBangumi 才会形成可展示的近期判断。</div>
                  <p class="malicious-report__note">报告展示的是已记录的历史统计和推测，不会公开下一题的攻防阶段、正确答案位置或诱饵布局。</p>
                </section>
              </Transition>
            </template>
          </div>
          <div v-if="mode === 'quiz-detail'" class="quiz-question-count-picker">
            <span>本局题数</span>
            <div role="group" aria-label="选择本局题数">
              <button
                v-for="count in QUIZ_QUESTION_COUNT_OPTIONS"
                :key="count"
                type="button"
                :class="{ 'is-active': quizQuestionCount === count }"
                :disabled="loading"
                @click="quizQuestionCount = count"
              >{{ count }} 题</button>
            </div>
          </div>
          <div v-if="mode === 'memory-detail'" class="quiz-bonus-picker">
            <div class="quiz-bonus-picker__header">
              <span>扩充题库</span>
            </div>
            <div class="quiz-bonus-options">
              <label>
                <input v-model="memoryIncludeSeasonalTop" type="checkbox" :disabled="loading" />
                <span><strong>当季新番 Top 50</strong><small>Bangumi 趋势榜 · 前 50 名</small></span>
              </label>
              <label>
                <input v-model="memoryIncludeGlobalTop" type="checkbox" :disabled="loading" />
                <span><strong>Bangumi 全站 Top 50</strong><small>Bangumi 排行榜 · 前 50 名</small></span>
              </label>
            </div>
          </div>
          <div v-if="mode === 'quiz-detail'" class="quiz-bonus-picker">
            <div class="quiz-bonus-picker__header">
              <span>加成题库</span>
              <small>{{ quizDifficulty === 'adaptive' ? '恶意难度已强制包含，不计额外加成' : '每项 +10%' }}</small>
            </div>
            <div class="quiz-bonus-options">
              <label :class="{ 'is-disabled': quizDifficulty === 'adaptive' }">
                <input v-model="quizIncludeSeasonalTop" type="checkbox" :disabled="loading || quizDifficulty === 'adaptive'" />
                <span><strong>当季新番 Top 50</strong><small>Bangumi 趋势榜 · 前 50 名</small></span>
                <b>{{ quizDifficulty === 'adaptive' ? '已包含' : '+10%' }}</b>
              </label>
              <label :class="{ 'is-disabled': quizDifficulty === 'adaptive' }">
                <input v-model="quizIncludeGlobalTop" type="checkbox" :disabled="loading || quizDifficulty === 'adaptive'" />
                <span><strong>Bangumi 全站 Top 50</strong><small>Bangumi 排行榜 · 前 50 名</small></span>
                <b>{{ quizDifficulty === 'adaptive' ? '已包含' : '+10%' }}</b>
              </label>
            </div>
          </div>
          <p v-if="mode === 'quiz-detail'" class="quiz-pool-threshold-note">收藏少于 {{ QUIZ_FORCE_EXPANSION_THRESHOLD }} 部时将强制启用两个榜单题库，且不提供题库分数加成；最低需要 {{ QUIZ_MIN_POOL_SIZE }} 部收藏。</p>
          <div class="collection-game-detail__facts">
            <span>{{ mode === 'memory-detail' ? '12 张牌面' : `${quizQuestionCount} 道题` }}</span>
            <span>{{ mode === 'memory-detail' ? '本地最高分' : `答对得分 · 最高 ${quizHighScore} · 最佳连对 ${quizSavedBestStreak}${quizForcedExpansion ? ' · 强制扩充无加成' : quizBonusActive ? ` · 本局 ×${quizScoreMultiplier.toFixed(1)}` : ''}` }}</span>
          </div>
          <div class="collection-game-status" aria-live="polite">
            <span v-if="loading" class="collection-game-loader"></span>
            <span v-if="loading">正在读取动画收藏…</span>
            <span v-else-if="error" class="collection-game-error">{{ error }}</span>
          </div>
          <button class="primary-button collection-game-detail__start" type="button" :disabled="loading" @click="mode === 'memory-detail' ? startMemory() : startQuiz()">{{ loading ? '读取中…' : '开始游戏' }}</button>
        </main>

        <main v-else-if="mode === 'quiz-initializing'" class="quiz-initialization" aria-live="polite">
          <div class="quiz-initialization__status">
            <span class="quiz-initialization__mark" :class="{ 'is-error': !!error }" aria-hidden="true">
              <span v-if="!error" class="collection-game-loader"></span>
              <b v-else>!</b>
            </span>
            <div>
              <p>{{ quizDifficulty === 'adaptive' ? '恶意题局初始化' : '题局初始化' }}</p>
              <h3>{{ error || quizInitializationMessage }}</h3>
            </div>
            <strong>{{ quizInitializationProgress }}%</strong>
          </div>
          <div class="quiz-initialization__progress" role="progressbar" :aria-valuenow="quizInitializationProgress" aria-valuemin="0" aria-valuemax="100">
            <i :style="{ width: `${quizInitializationProgress}%` }"></i>
          </div>
          <div class="quiz-initialization__meta">
            <span v-if="quizInitializationTotal">已分析 {{ quizInitializationCompleted }} / {{ quizInitializationTotal }} 张候选封面</span>
            <span v-else>{{ quizInitializationMessage }}</span>
            <span>本机处理 · {{ quizInitializationElapsedLabel }}</span>
          </div>
          <div v-if="error" class="quiz-initialization__actions">
            <button class="secondary-button" type="button" @click="openGameDetails('quiz')">返回设置</button>
            <button class="primary-button" type="button" @click="startQuiz">重试</button>
          </div>
          <button v-else class="collection-game-back quiz-initialization__cancel" type="button" @click="openGameDetails('quiz')">取消初始化</button>
        </main>

        <main v-else-if="mode === 'memory'" class="memory-game">
          <div class="collection-game-toolbar">
            <button class="collection-game-back" type="button" @click="returnToMenu">‹ 选择游戏</button>
            <div class="collection-game-stats"><span>{{ memoryMoves }} 次</span><span>{{ elapsedSeconds }} 秒</span><span>最高 {{ memoryHighScore }}</span></div>
          </div>
          <div class="memory-grid" :class="{ 'is-complete': memoryComplete }">
            <button
              v-for="card in memoryCards"
              :key="card.cardId"
              class="memory-card"
              :class="{ 'is-visible': isCardVisible(card), 'is-matched': matchedSubjectIds.includes(card.id) }"
              type="button"
              :aria-label="isCardVisible(card) ? card.title : '未翻开的卡片'"
              @click="flipCard(card)"
            >
              <span class="memory-card__inner">
                <span class="memory-card__back"><i></i><img :src="appLogo" alt="" /></span>
                <span class="memory-card__front"><img :src="card.image" :alt="card.title" /><small>{{ card.title }}</small></span>
              </span>
            </button>
          </div>
          <Transition name="result-rise">
            <div v-if="memoryComplete" class="collection-game-result" role="status">
              <div><strong>全部找到了 <em v-if="memoryNewRecord" class="collection-game-record">新纪录</em></strong><span>本局 {{ memoryScore }} 分 · 最高 {{ memoryHighScore }} 分</span></div>
              <button class="primary-button" type="button" @click="startMemory">再玩一次</button>
            </div>
          </Transition>
        </main>

        <main v-else class="quiz-game">
          <div class="collection-game-toolbar">
            <button class="collection-game-back" type="button" @click="returnToMenu">‹ 选择游戏</button>
            <div class="collection-game-stats"><span>{{ quizConfig.label }}{{ quizForcedExpansion ? ' · 强制扩充' : quizBonusActive ? ` · +${quizBonusPercent}%` : '' }} · {{ Math.min(quizIndex + 1, quizQuestionCount) }} / {{ quizQuestionCount }}</span><span>{{ quizScore }} 分</span><span>最高 {{ quizHighScore }}<em v-if="quizHighScoreAudioMark" class="quiz-audio-score-mark">{{ quizHighScoreAudioMark === 'muted' ? '静音成绩' : '低音量成绩' }}</em></span></div>
          </div>
          <template v-if="!quizFinished && currentQuestion">
            <div class="quiz-streak" :class="{ 'is-active': quizCorrectStreak >= 2, 'is-hot': quizCorrectStreak >= 5 }" aria-live="polite">
              <span>连对</span>
              <strong :key="quizCorrectStreak">{{ quizCorrectStreak }}</strong>
              <em>{{ quizCorrectStreak >= 2 ? `得分 ×${quizStreakMultiplier.toFixed(2)}` : `最佳 ${Math.max(quizBestStreak, quizSavedBestStreak)}` }}</em>
            </div>
            <div class="quiz-timer" :class="{ 'is-low': quizTimePercent <= (quizDifficulty === 'adaptive' && fatigueStage !== 'none' ? fatiguePressureThreshold : 25), 'is-paused': !quizQuestionReady, 'is-malicious': maliciousPressureActive, 'is-critical': maliciousPressureCritical, 'is-fatigued': quizDifficulty === 'adaptive' && fatigueStage !== 'none' }">
              <div class="quiz-timer__label">
                <span>{{ quizQuestionReady ? (quizTimedOut ? "时间到" : `${quizSeconds} 秒`) : "准备题目…" }}<b v-if="quizCurrentTimeLimitMs < quizTimeLimitMs"> · 超时惩罚：本题限时 -25%</b></span>
                <em v-if="maliciousPressureMessage" class="quiz-timer__pressure" aria-hidden="true">{{ maliciousPressureMessage }}</em>
                <strong v-if="quizEarnedPoints > 0">+{{ quizEarnedPoints }}</strong>
              </div>
              <div class="quiz-timer__track"><i :style="{ width: `${quizTimePercent}%` }"></i></div>
            </div>
            <div
              ref="quizQuestionLayoutRef"
              class="quiz-question-layout"
              :class="{ 'is-dense': quizOptionCount >= 8 }"
              @pointermove="captureQuizPointerSample"
            >
              <div
                class="quiz-cover-wrap"
                :class="{ 'has-answer': quizSelectedId !== null, 'is-waiting': !quizQuestionReady, 'has-tiles': activeQuizTreatment.tileSize > 0, 'is-logo-stage': quizDifficulty === 'adaptive' && !quizCoverRevealReady, 'is-revealing': quizCoverRevealAnimating }"
                :style="quizTreatmentStyle"
              >
                <img
                  :key="currentQuestion.id"
                  class="quiz-cover"
                  :src="currentQuestion.image"
                  alt="待猜动画封面"
                  @load="handleQuizImageReady"
                />
                <div v-if="quizDifficulty === 'adaptive' && !quizCoverRevealReady" class="quiz-cover-logo-stage" aria-hidden="true">
                  <span><img :src="appLogo" alt="" /></span>
                </div>
                <div v-if="activeQuizTreatment.tileSize" class="quiz-cover-tiles" aria-hidden="true">
                  <i
                    v-for="sourceIndex in quizVisibleTileSources"
                    :key="`${currentQuestion.id}-${sourceIndex}`"
                    :style="quizTileStyle(sourceIndex)"
                  ></i>
                </div>
                <div
                  v-for="(region, regionIndex) in quizOcclusionRegions"
                  :key="`${activeQuizTreatment.occlusion}-${regionIndex}-${region.x}-${region.y}`"
                  class="quiz-cover-occlusion"
                  :class="`is-${activeQuizTreatment.occlusion}`"
                  :style="quizOcclusionStyle(region)"
                  aria-hidden="true"
                ></div>
              </div>
              <div ref="quizOptionsRef" class="quiz-options" :class="{ 'is-shuffling': quizOptionShuffleAnimating }">
                <button
                  v-for="(option, optionIndex) in quizOptions"
                  :key="option.id"
                  type="button"
                  :data-option-index="optionIndex"
                  :class="quizOptionClass(option)"
                  :disabled="quizSelectedId !== null || !quizQuestionReady || quizOptionShuffleAnimating"
                  @pointerenter="noteQuizOptionVisit(optionIndex)"
                  @pointerdown="captureQuizPointerSample($event, optionIndex, true)"
                  @focus="noteQuizOptionVisit(optionIndex)"
                  @click="answerQuiz(option)"
                >
                  <span>{{ option.displayTitle }}</span><b aria-hidden="true">{{ quizSelectedId !== null && option.id === currentQuestion.id ? "✓" : "" }}</b>
                </button>
              </div>
            </div>
            <Transition name="quiz-intermission">
              <div
                v-if="quizAnswerReveal || quizTransitioning"
                class="quiz-intermission"
                :class="{
                  'is-result': quizAnswerReveal,
                  'is-ready': quizTransitioning,
                  'is-timeout': quizAnswerReveal && quizTimedOut,
                  'is-correct': quizAnswerReveal && quizTransitionSelectedAnswer === quizTransitionCorrectAnswer,
                  'is-wrong': quizAnswerReveal && !quizTimedOut && quizTransitionSelectedAnswer !== quizTransitionCorrectAnswer,
                }"
                role="status"
                aria-live="polite"
              >
                <template v-if="quizAnswerReveal && quizTimedOut">
                  <span class="quiz-intermission__result-mark" aria-hidden="true">⌛</span>
                  <strong>未作答，时间耗尽</strong>
                  <p v-if="quizLastBrokenStreak >= 2" class="quiz-intermission__streak is-broken">{{ quizLastBrokenStreak }} 连对中断</p>
                  <div class="quiz-timeout-result">
                    <p :class="{ 'is-applied': quizTimeoutPenalty === 'score' || quizTimeoutPenalty === 'both' }">
                      <span>扣分惩罚</span><strong>{{ quizTimeoutPenalty === 'score' || quizTimeoutPenalty === 'both' ? `-${quizTimeoutScoreDeduction} 分` : '本次未触发' }}</strong><small>单独触发概率 45%</small>
                    </p>
                    <p :class="{ 'is-applied': quizTimeoutPenalty === 'time' || quizTimeoutPenalty === 'both' }">
                      <span>下一题限时</span><strong>{{ quizTimeoutPenalty === 'time' || quizTimeoutPenalty === 'both' ? (quizIndex < quizQuestionCount - 1 ? `减少 ${(quizTimeoutTimeReduction / 1000).toFixed(1)} 秒` : '已抽中（本局无下一题）') : '本次未触发' }}</strong><small>单独触发概率 45%</small>
                    </p>
                  </div>
                  <p class="quiz-timeout-result__roll">本次结果：{{ quizTimeoutPenalty === 'both' ? '双重惩罚（10%）' : quizTimeoutPenalty === 'score' ? '扣分（45%）' : '下一题减时（45%）' }}</p>
                  <div class="quiz-intermission__answers">
                    <p class="is-correct"><span>正确答案</span><b>{{ quizTransitionCorrectAnswer }}</b></p>
                  </div>
                </template>
                <template v-else-if="quizAnswerReveal">
                  <span class="quiz-intermission__result-mark" aria-hidden="true">{{ quizTransitionSelectedAnswer === quizTransitionCorrectAnswer ? "✓" : "×" }}</span>
                  <strong>{{ quizTransitionSelectedAnswer === quizTransitionCorrectAnswer ? "回答正确" : "回答错误" }}</strong>
                  <p v-if="quizTransitionSelectedAnswer === quizTransitionCorrectAnswer && quizCorrectStreak >= 2" :key="quizCorrectStreak" class="quiz-intermission__streak">{{ quizCorrectStreak }} 连对 · 本题 ×{{ quizStreakMultiplier.toFixed(2) }}</p>
                  <p v-else-if="quizLastBrokenStreak >= 2" class="quiz-intermission__streak is-broken">{{ quizLastBrokenStreak }} 连对中断</p>
                  <div class="quiz-intermission__answers">
                    <p class="is-correct"><span>正确答案</span><b>{{ quizTransitionCorrectAnswer }}</b></p>
                    <p :class="{ 'is-wrong': quizTransitionSelectedAnswer !== quizTransitionCorrectAnswer }"><span>{{ quizTimedOut ? '你的答案' : '你的选择' }}</span><b>{{ quizTransitionSelectedAnswer }}</b></p>
                  </div>
                </template>
                <template v-else>
                  <span class="quiz-intermission__pulse" aria-hidden="true"><i></i><i></i><i></i></span>
                  <strong>准备好……</strong>
                </template>
              </div>
            </Transition>
          </template>
          <Transition name="result-rise">
            <div v-if="quizFinished" class="quiz-finish" role="status">
              <div class="quiz-finish__score"><strong>{{ quizScore }}</strong><span>/ {{ quizMaximumScore }}</span><em v-if="maliciousRunAudioMark" class="quiz-audio-score-mark">{{ maliciousRunAudioMark === 'muted' ? '静音成绩' : '低音量成绩' }}</em></div>
              <div class="quiz-finish__streak"><span>本局最高连对</span><strong>{{ quizBestStreak }}</strong><em>历史最佳 {{ Math.max(quizBestStreak, quizSavedBestStreak) }}</em></div>
              <h3>{{ quizCorrectCount === quizQuestionCount ? "全答对了" : quizCorrectCount >= Math.ceil(quizQuestionCount * .6) ? "记得很清楚" : "再看一眼收藏吧" }} <em v-if="quizNewRecord" class="collection-game-record">新纪录</em></h3>
              <p>{{ unknownChallenge ? '未知挑战' : `${quizConfig.label}难度` }}{{ quizForcedExpansion ? ' · 强制扩充无加成' : quizBonusActive ? ` · 加成题库 ×${quizScoreMultiplier.toFixed(1)}` : '' }} · 答对 {{ quizCorrectCount }} / {{ quizQuestionCount }} · 最高 {{ quizHighScore }} 分 · 最佳连对 {{ Math.max(quizBestStreak, quizSavedBestStreak) }}</p>
              <p class="quiz-finish__answer-stats">答错 {{ quizAnswerStats.wrong }} 题：超时 {{ quizAnswerStats.timedOut }} 题，犹豫选错 {{ quizAnswerStats.hesitantWrong }} 题，秒选错 {{ quizAnswerStats.snapWrong }} 题</p>
              <section v-if="quizDifficulty === 'adaptive'" class="malicious-after-action" aria-label="恶意模式本局事后报告">
                <div class="malicious-after-action__header">
                  <span>最终攻击强度</span>
                  <strong>{{ maliciousAfterActionReport.intensity }}%</strong>
                </div>
                <div
                  class="malicious-after-action__meter"
                  role="meter"
                  aria-label="本局攻击强度"
                  :aria-valuenow="maliciousAfterActionReport.intensity"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <i
                    v-for="segment in 10"
                    :key="segment"
                    :class="{ 'is-filled': segment <= maliciousAfterActionReport.filledSegments }"
                    aria-hidden="true"
                  ></i>
                </div>
                <div class="malicious-after-action__evaluation">
                  <span>系统评价</span>
                  <p>疲劳阶段 <strong>{{ maliciousAfterActionReport.fatigueStage }}</strong></p>
                  <p>被标题污染 <strong>{{ maliciousAfterActionReport.titlePollutionHits }}</strong> 次</p>
                  <p>被连续诱导影响 <strong>{{ maliciousAfterActionReport.confidenceTrapHits }}</strong> 次</p>
                  <p>最后阶段反应下降 <strong>{{ maliciousAfterActionReport.reactionDecline }}%</strong></p>
                  <p>诱导攻击 <strong>{{ maliciousAfterActionReport.attackStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.attackStats.losses }} 次</p>
                  <p>记忆污染 <strong>{{ maliciousAfterActionReport.memoryStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.memoryStats.losses }} 次</p>
                  <p>标题陷阱 <strong>{{ maliciousAfterActionReport.titleStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.titleStats.losses }} 次</p>
                  <p>点击习惯培养 <strong>{{ maliciousAfterActionReport.conditioningStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.conditioningStats.losses }} 次</p>
                  <p>位置规律反转 <strong>{{ maliciousAfterActionReport.reversalStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.reversalStats.losses }} 次</p>
                  <p>历史弱点针对 <strong>{{ maliciousAfterActionReport.targetedStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.targetedStats.losses }} 次</p>
                  <p>反蒙预测布局 <strong>{{ maliciousAfterActionReport.guessCounterStats.rounds }}</strong> 轮 · 中招 {{ maliciousAfterActionReport.guessCounterStats.losses }} 次</p>
                </div>
              </section>
              <div><button class="primary-button" type="button" @click="startQuiz">再玩一次</button><button class="secondary-button" type="button" @click="openGameDetails('quiz')">返回游戏详情</button><button class="secondary-button" type="button" @click="returnToMenu">选择游戏</button></div>
            </div>
          </Transition>
        </main>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.collection-game-overlay { position: fixed; inset: var(--titlebar-height) 0 0; z-index: 220; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, #000 48%, transparent); }
.collection-game-shell { position: relative; width: min(720px, 100%); max-height: calc(100vh - var(--titlebar-height) - 36px); overflow: auto; scrollbar-gutter: stable; scrollbar-color: var(--scrollbar-thumb) var(--surface); scrollbar-width: thin; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 24px 64px rgba(8, 15, 25, .28); transition: height 260ms cubic-bezier(.2,.7,.2,1), width 260ms cubic-bezier(.2,.7,.2,1), border-color 220ms ease, box-shadow 220ms ease; }
.collection-game-shell::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
.collection-game-shell::-webkit-scrollbar-track { background: var(--surface); }
.collection-game-shell::-webkit-scrollbar-thumb { border: 2px solid var(--surface); border-radius: 999px; background: var(--scrollbar-thumb); }
.collection-game-shell::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
.collection-game-shell.is-malicious-pressure { border-color: color-mix(in srgb, var(--danger) 42%, var(--border)); box-shadow: 0 24px 64px rgba(8, 15, 25, .28), 0 0 28px color-mix(in srgb, var(--danger) 10%, transparent); }
.collection-game-shell.is-malicious-critical { border-color: color-mix(in srgb, var(--danger) 72%, var(--border)); box-shadow: 0 24px 64px rgba(8, 15, 25, .3), 0 0 36px color-mix(in srgb, var(--danger) 22%, transparent); animation: malicious-window-pulse 620ms ease-in-out infinite alternate; }
.collection-game-shell.is-malicious-impact { animation: malicious-window-impact 420ms cubic-bezier(.36,.07,.19,.97) both; }
.collection-game-shell.is-malicious-impact::after { content: ""; position: absolute; z-index: 10; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--danger) 82%, transparent), inset 0 0 46px color-mix(in srgb, var(--danger) 24%, transparent); pointer-events: none; animation: malicious-impact-flash 460ms ease-out both; }
.collection-game-shell.is-size-animating { scrollbar-color: var(--scrollbar-thumb) var(--surface); }
.collection-game-shell.is-size-animating::-webkit-scrollbar-track { background: var(--surface); }
.collection-game-shell.is-size-animating::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--scrollbar-thumb) 55%, var(--surface)); }
.collection-game-shell.is-memory, .collection-game-shell.is-memory-detail { width: min(780px, 100%); }
.collection-game-shell.is-quiz, .collection-game-shell.is-quiz-detail { width: min(980px, 100%); }
.collection-game-header { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px 14px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(12px); }
.collection-game-header h2 { margin: 2px 0 0; font-size: 19px; letter-spacing: 0; }
.collection-game-kicker { margin: 0; color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 1.1px; }
.collection-game-close { width: 34px; height: 34px; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; font-size: 24px; line-height: 1; cursor: pointer; }
.collection-game-close:hover { color: var(--text); background: var(--surface-muted); }
.collection-game-menu { display: grid; gap: 18px; padding: 20px; }
.collection-game-notice { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border-left: 3px solid var(--accent); background: var(--surface-muted); }
.collection-game-notice p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
.collection-game-notice__mark { display: grid; width: 19px; height: 19px; flex: 0 0 auto; place-items: center; border: 1px solid var(--accent); border-radius: 50%; color: var(--accent); font: 700 12px/1 Georgia, serif; }
.collection-game-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.collection-game-mode { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 13px; min-height: 92px; padding: 13px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--surface); text-align: left; cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease; }
.collection-game-mode:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 5%, var(--surface)); transform: translateY(-2px); }
.collection-game-mode:active:not(:disabled) { transform: translateY(0); }
.collection-game-mode:disabled { opacity: .58; }
.collection-game-mode > span:nth-child(2) { display: grid; gap: 5px; min-width: 0; }
.collection-game-mode strong { font-size: 14px; }
.collection-game-mode small { color: var(--muted); font-size: 12px; }
.collection-game-mode > b { color: var(--muted); font-size: 24px; font-weight: 400; }
.collection-game-mode__preview { width: 64px; height: 64px; border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border)); border-radius: 7px; background: var(--surface-muted); }
.memory-preview { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 8px; }
.memory-preview i { border-radius: 3px; background: color-mix(in srgb, var(--accent) 24%, var(--surface)); }
.memory-preview i:nth-child(2), .memory-preview i:nth-child(3) { background: var(--accent); }
.quiz-preview { display: grid; place-items: center; color: var(--accent); font: 700 29px/1 Georgia, serif; }
.collection-game-detail { display: grid; gap: 16px; padding: 18px 20px 20px; }
.collection-game-detail__hero { display: flex; align-items: center; gap: 14px; }
.collection-game-detail__hero h3 { margin: 0 0 5px; font-size: 18px; }
.collection-game-detail__hero p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
.collection-game-detail__facts { display: flex; flex-wrap: wrap; gap: 7px; color: var(--muted); font-size: 12px; }
.collection-game-detail__facts span { padding: 6px 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-muted); }
.collection-game-detail__start { justify-self: end; min-width: 120px; }
.quiz-initialization { display: grid; gap: 18px; min-height: 300px; align-content: center; padding: 34px clamp(22px, 6vw, 64px) 26px; }
.quiz-initialization__status { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 13px; }
.quiz-initialization__status p { margin: 0 0 4px; color: var(--muted); font-size: 11px; font-weight: 700; }
.quiz-initialization__status h3 { margin: 0; font-size: 16px; line-height: 1.4; }
.quiz-initialization__status > strong { min-width: 46px; color: var(--accent); font-size: 17px; text-align: right; }
.quiz-initialization__mark { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border)); border-radius: 7px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.quiz-initialization__mark.is-error { border-color: color-mix(in srgb, var(--danger) 58%, var(--border)); color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); }
.quiz-initialization__progress { height: 8px; overflow: hidden; border-radius: 4px; background: var(--surface-muted); box-shadow: inset 0 0 0 1px var(--border); }
.quiz-initialization__progress i { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--accent); transition: width 160ms ease; }
.quiz-initialization__meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; }
.quiz-initialization__meta span:last-child { flex: 0 0 auto; color: var(--accent); font-weight: 600; }
.quiz-initialization__actions { display: flex; justify-content: flex-end; gap: 8px; }
.quiz-initialization__cancel { justify-self: start; }
.quiz-difficulty-picker { display: grid; gap: 9px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-muted); }
.quiz-difficulty-picker__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.quiz-difficulty-picker__header span { font-size: 13px; font-weight: 600; }
.quiz-question-count-picker { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-muted); }
.quiz-question-count-picker > span { font-size: 13px; font-weight: 600; }
.quiz-question-count-picker > div { display: flex; gap: 5px; }
.quiz-question-count-picker button { min-width: 58px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: var(--surface); font-size: 11px; cursor: pointer; }
.quiz-question-count-picker button.is-active { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.quiz-difficulty-picker__header small { color: var(--muted); font-size: 11px; }
.quiz-difficulty-tabs { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.quiz-difficulty-tabs button { position: relative; z-index: 1; min-height: 34px; padding: 0 12px; border: 0; border-radius: 6px; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; transition: color 140ms ease; }
.quiz-difficulty-tabs button:hover:not(:disabled):not(.is-active) { color: var(--text); }
.quiz-difficulty-tabs button.is-active { color: #ffffff; background: transparent; }
.quiz-difficulty-tabs button.is-locked { opacity: .46; cursor: not-allowed; }
.quiz-difficulty-indicator { position: absolute; z-index: 0; top: 4px; height: calc(100% - 8px); border-radius: 6px; opacity: 0; background: var(--accent); box-shadow: 0 2px 7px color-mix(in srgb, var(--accent) 24%, transparent); pointer-events: none; transition: left .3s ease, width .3s ease, opacity 120ms ease; }
.quiz-difficulty-indicator.is-ready { opacity: 1; }
.quiz-adaptive-lock, .quiz-adaptive-warning, .quiz-pool-threshold-note { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.45; }
.quiz-adaptive-warning { color: color-mix(in srgb, var(--danger) 72%, var(--text)); }
.quiz-adaptive-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.quiz-adaptive-summary p { flex: 1; }
.quiz-adaptive-report-toggle { min-height: 30px; flex: 0 0 auto; padding: 5px 9px; font-size: 11px; }
.quiz-malicious-sound-warning { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-radius: 6px; background: color-mix(in srgb, var(--danger) 5%, var(--surface)); }
.quiz-malicious-sound-warning > span { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 50%; color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); font-weight: 800; }
.quiz-malicious-sound-warning p { display: grid; gap: 1px; margin: 0; }
.quiz-malicious-sound-warning strong { font-size: 11px; }
.quiz-malicious-sound-warning small { color: var(--muted); font-size: 10px; }
.quiz-malicious-sound-warning label { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; cursor: pointer; white-space: nowrap; }
.quiz-malicious-sound-warning input { accent-color: var(--danger); }
.quiz-audio-score-mark { display: inline-flex; margin-left: 5px; padding: 2px 5px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-radius: 999px; color: color-mix(in srgb, var(--danger) 72%, var(--text)); background: color-mix(in srgb, var(--danger) 6%, var(--surface)); font-size: 9px; font-style: normal; font-weight: 700; vertical-align: middle; }
.quiz-unknown-challenge { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border)); border-radius: 6px; background: var(--surface-muted); cursor: pointer; }
.quiz-unknown-challenge.is-locked { opacity: .62; cursor: not-allowed; }
.quiz-unknown-challenge span { display: grid; gap: 2px; }
.quiz-unknown-challenge strong { font-size: 12px; }
.quiz-unknown-challenge small { color: var(--muted); font-size: 10px; }
.malicious-report { display: grid; gap: 10px; padding: 11px; border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--danger) 3%, var(--surface)); }
.malicious-report__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.malicious-report__header > div { display: grid; gap: 3px; }
.malicious-report__header strong { font-size: 13px; }
.malicious-report__header small, .malicious-report__header > span { color: var(--muted); font-size: 10px; }
.malicious-report__header > span { padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-muted); }
.malicious-report__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.malicious-report__grid article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; min-height: 74px; padding: 8px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.malicious-report__grid article > span { color: var(--muted); font-size: 10px; }
.malicious-report__grid article > strong { color: var(--text); font-size: 12px; text-align: right; }
.malicious-report__grid article > p { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 10px; line-height: 1.45; }
.malicious-report__grid article.is-notice { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.malicious-report__grid article.is-danger { border-color: color-mix(in srgb, var(--danger) 42%, var(--border)); background: color-mix(in srgb, var(--danger) 4%, var(--surface)); }
.malicious-report__grid article.is-danger > strong { color: color-mix(in srgb, var(--danger) 76%, var(--text)); }
.malicious-report__empty { padding: 14px 10px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); font-size: 11px; text-align: center; }
.malicious-report__note { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.quiz-bonus-picker { display: grid; gap: 9px; }
.quiz-timeout-rule { display: flex; align-items: center; gap: 10px; padding: 10px 11px; border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border)); border-left-width: 3px; border-radius: 6px; background: color-mix(in srgb, var(--danger) 6%, var(--surface)); }
.quiz-timeout-rule > span { display: grid; width: 22px; height: 22px; flex: 0 0 auto; place-items: center; border: 1px solid var(--danger); border-radius: 50%; color: var(--danger); font-size: 13px; font-weight: 800; }
.quiz-timeout-rule p { display: grid; gap: 2px; margin: 0; }
.quiz-timeout-rule strong { color: var(--danger); font-size: 12px; }
.quiz-timeout-rule small { color: var(--muted); font-size: 10px; line-height: 1.45; }
.quiz-bonus-picker__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.quiz-bonus-picker__header span { font-size: 13px; font-weight: 600; }
.quiz-bonus-picker__header small { color: var(--muted); font-size: 11px; }
.quiz-bonus-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.quiz-bonus-options label { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 54px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-muted); cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease; }
.quiz-bonus-options label:has(input:checked) { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.quiz-bonus-options label.is-disabled { opacity: .62; cursor: not-allowed; }
.quiz-bonus-options input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
.quiz-bonus-options label > span { display: grid; gap: 3px; min-width: 0; }
.quiz-bonus-options strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.quiz-bonus-options small { color: var(--muted); font-size: 10px; }
.quiz-bonus-options b { color: var(--accent); font-size: 11px; }
.collection-game-status { min-height: 22px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 12px; }
.collection-game-loader { width: 15px; height: 15px; border: 2px solid color-mix(in srgb, var(--accent) 20%, var(--border)); border-top-color: var(--accent); border-radius: 50%; animation: game-spin 650ms linear infinite; }
.collection-game-error { color: var(--danger); }
.memory-game, .quiz-game { display: grid; gap: 14px; padding: 16px 18px 18px; }
.quiz-game { position: relative; transition: background-color 260ms ease, background-image 260ms ease; }
.is-malicious-pressure .quiz-game { background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 5%, var(--surface)), var(--surface) 52%); }
.is-malicious-critical .quiz-game { background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 11%, var(--surface)), color-mix(in srgb, var(--danger) 3%, var(--surface)) 58%, var(--surface)); }
.collection-game-toolbar { display: flex; min-height: 28px; align-items: center; justify-content: space-between; gap: 12px; }
.collection-game-back { padding: 4px 2px; border: 0; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; }
.collection-game-back:hover { color: var(--accent); }
.collection-game-stats { display: flex; gap: 6px; }
.collection-game-stats span { min-width: 62px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: var(--surface-muted); font-size: 11px; text-align: center; font-variant-numeric: tabular-nums; }
.quiz-streak { position: absolute; z-index: 3; top: 58px; right: 18px; display: grid; min-width: 92px; justify-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: 0 6px 18px rgba(8, 15, 25, .1); font-variant-numeric: tabular-nums; backdrop-filter: blur(8px); transition: border-color 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease; }
.quiz-streak span { font-size: 10px; font-weight: 700; letter-spacing: .12em; }
.quiz-streak strong { color: var(--text); font-size: 30px; line-height: 1; }
.quiz-streak em { margin-top: 3px; font-size: 9px; font-style: normal; }
.quiz-streak.is-active { border-color: color-mix(in srgb, var(--accent) 62%, var(--border)); color: var(--accent); box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 16%, transparent); transform: translateY(-2px); }
.quiz-streak.is-active strong { color: var(--accent); animation: combo-pop 300ms cubic-bezier(.18,.8,.2,1); }
.quiz-streak.is-hot { background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), color-mix(in srgb, var(--danger) 7%, var(--surface))); animation: combo-glow 850ms ease-in-out infinite alternate; }
.memory-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 9px; }
.memory-card { aspect-ratio: 3 / 4; min-width: 0; padding: 0; border: 0; background: transparent; perspective: 900px; cursor: pointer; }
.memory-card__inner { position: relative; display: block; width: 100%; height: 100%; transition: transform 420ms cubic-bezier(.2,.7,.2,1); transform-style: preserve-3d; }
.memory-card.is-visible .memory-card__inner { transform: rotateY(180deg); }
.memory-card__back, .memory-card__front { position: absolute; inset: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 7px; backface-visibility: hidden; }
.memory-card__back { display: grid; place-items: center; color: var(--accent); background: var(--surface-muted); }
.memory-card__back i { position: absolute; inset: 7px; border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border)); border-radius: 4px; }
.memory-card__back img { width: 46%; aspect-ratio: 1; border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border)); border-radius: 50%; object-fit: cover; box-shadow: 0 3px 10px rgba(8, 15, 25, .14); }
.memory-card__front { display: grid; grid-template-rows: minmax(0, 1fr) auto; background: var(--surface); transform: rotateY(180deg); }
.memory-card__front img { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
.memory-card__front small { overflow: hidden; padding: 5px 5px 6px; color: var(--text); font-size: 10px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.memory-card.is-matched .memory-card__front { border-color: color-mix(in srgb, var(--accent) 68%, var(--border)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent); }
.collection-game-result { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 7px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.collection-game-result > div { display: grid; gap: 3px; }
.collection-game-result strong { font-size: 14px; }
.collection-game-result span { color: var(--muted); font-size: 12px; }
.collection-game-record { display: inline-block; margin-left: 5px; padding: 2px 5px; border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border)); border-radius: 4px; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); font-size: 10px; font-style: normal; font-weight: 600; vertical-align: middle; }
.quiz-timer { display: grid; gap: 5px; width: min(430px, 100%); justify-self: center; }
.quiz-timer__label { display: flex; min-height: 18px; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.quiz-timer__label span b { color: var(--danger); font-size: 10px; }
.quiz-timer__label strong { color: var(--accent); font-size: 12px; animation: score-pop 220ms cubic-bezier(.2,.8,.2,1); }
.quiz-timer__pressure { margin-left: auto; color: color-mix(in srgb, var(--danger) 78%, var(--text)); font-size: 10px; font-style: normal; font-weight: 700; letter-spacing: .08em; animation: malicious-copy-in 180ms ease-out both; }
.quiz-timer.is-critical .quiz-timer__label > span { color: var(--danger); font-weight: 700; }
.quiz-timer.is-critical .quiz-timer__pressure { animation: malicious-copy-pulse 520ms ease-in-out infinite alternate; }
.quiz-timer__track { height: 5px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--border) 74%, transparent); }
.quiz-timer__track i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 80ms linear, background-color 160ms ease; }
.quiz-timer.is-fatigued.is-malicious .quiz-timer__track { height: 7px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--danger) 13%, transparent); }
.quiz-timer.is-fatigued.is-malicious .quiz-timer__track i { background: color-mix(in srgb, var(--danger) 68%, var(--accent)); }
.quiz-timer.is-low .quiz-timer__track i { background: var(--danger); }
.quiz-timer.is-paused .quiz-timer__track i { opacity: .38; }
.quiz-timer__timeout-warning { margin: 0; color: color-mix(in srgb, var(--danger) 72%, var(--muted)); font-size: 9px; text-align: center; }
.quiz-cover-wrap { position: relative; width: min(230px, 42vw); aspect-ratio: 3 / 4; justify-self: center; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-muted); box-shadow: 0 8px 22px rgba(8, 15, 25, .14); }
.quiz-cover { display: block; width: 100%; height: 100%; object-fit: cover; transition: filter 240ms ease, opacity 240ms ease, transform 300ms ease; animation: quiz-cover-in 260ms cubic-bezier(.2,.7,.2,1); }
.quiz-cover-wrap.is-waiting .quiz-cover { opacity: .32; }
.quiz-cover-wrap.is-logo-stage .quiz-cover { opacity: 1; clip-path: circle(0% at 50% 50%); }
.quiz-cover-wrap.is-logo-stage.is-revealing .quiz-cover { animation: malicious-cover-reveal 300ms cubic-bezier(.18,.82,.25,1) forwards; }
.quiz-cover-logo-stage { position: absolute; z-index: 4; inset: 0; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--accent) 13%, var(--surface)) 0 24%, var(--surface-muted) 68%); pointer-events: none; }
.quiz-cover-logo-stage::before { content: ""; position: absolute; width: 34%; aspect-ratio: 1; border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent); border-radius: 50%; opacity: 0; }
.quiz-cover-logo-stage > span { display: grid; width: 43%; aspect-ratio: 1; place-items: center; border-radius: 24%; background: color-mix(in srgb, var(--surface) 76%, transparent); box-shadow: 0 8px 28px color-mix(in srgb, var(--accent) 18%, transparent); }
.quiz-cover-logo-stage img { display: block; width: 78%; height: 78%; object-fit: contain; }
.quiz-cover-wrap.is-revealing .quiz-cover-logo-stage { animation: malicious-logo-dissolve 300ms ease-out forwards; }
.quiz-cover-wrap.is-revealing .quiz-cover-logo-stage::before { animation: malicious-logo-ring 300ms ease-out forwards; }
.quiz-cover-wrap.is-revealing .quiz-cover-logo-stage > span { animation: malicious-logo-expand 300ms cubic-bezier(.2,.7,.2,1) forwards; }
.quiz-cover-wrap:not(.has-answer) .quiz-cover { filter: blur(var(--quiz-blur)) grayscale(var(--quiz-gray)) invert(var(--quiz-invert)) hue-rotate(var(--quiz-hue)) saturate(var(--quiz-saturate)) sepia(var(--quiz-sepia)) brightness(var(--quiz-brightness)); transform: scale(var(--quiz-zoom)) scaleX(var(--quiz-mirror)); transform-origin: var(--quiz-focus-x) var(--quiz-focus-y); }
.quiz-cover-wrap.has-tiles:not(.has-answer) .quiz-cover { opacity: 0; }
.quiz-cover-wrap.has-answer { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); }
.quiz-cover-tiles { position: absolute; inset: 0; overflow: hidden; opacity: 1; filter: blur(var(--quiz-blur)) grayscale(var(--quiz-gray)) invert(var(--quiz-invert)) hue-rotate(var(--quiz-hue)) saturate(var(--quiz-saturate)) sepia(var(--quiz-sepia)) brightness(var(--quiz-brightness)); transform: scale(var(--quiz-zoom)) scaleX(var(--quiz-mirror)); transform-origin: var(--quiz-focus-x) var(--quiz-focus-y); transition: opacity 220ms ease, filter 240ms ease, transform 300ms ease; }
.quiz-cover-tiles i { position: absolute; top: 0; left: 0; background-repeat: no-repeat; outline: 1px solid color-mix(in srgb, var(--surface) 34%, transparent); transition: transform 540ms cubic-bezier(.2,.72,.2,1); will-change: transform; }
.quiz-cover-wrap.has-answer .quiz-cover-tiles { opacity: 0; pointer-events: none; }
.quiz-cover-occlusion { position: absolute; z-index: 2; border: 1px solid color-mix(in srgb, var(--text) 22%, transparent); border-radius: 3px; background: color-mix(in srgb, var(--surface) 82%, #111); box-shadow: 0 2px 8px rgba(0, 0, 0, .18); backdrop-filter: blur(12px); transition: opacity 180ms ease; }
.quiz-cover-occlusion.is-text { border-radius: 2px; background: color-mix(in srgb, var(--surface) 88%, #111); }
.quiz-cover-wrap.has-answer .quiz-cover-occlusion { opacity: 0; pointer-events: none; }
.quiz-question-layout { display: grid; gap: 14px; }
.quiz-question-layout.is-dense { grid-template-columns: 220px minmax(0, 1fr); align-items: center; gap: 18px; }
.quiz-question-layout.is-dense .quiz-cover-wrap { width: 220px; }
.quiz-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.quiz-options.is-shuffling { pointer-events: none; }
.quiz-options.is-shuffling button { will-change: transform, opacity; }
.quiz-options button { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); text-align: left; cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease, opacity 150ms ease, transform 150ms ease; }
.quiz-options button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--surface-muted); }
.quiz-options button span { min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.35; white-space: normal; }
.quiz-options button b { flex: 0 0 auto; color: var(--accent); }
.quiz-options button.is-correct { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); transform: translateY(-1px); }
.quiz-options button.is-wrong { border-color: color-mix(in srgb, var(--danger) 58%, var(--border)); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); }
.quiz-options button.is-dimmed { opacity: .48; }
.quiz-intermission { position: absolute; z-index: 5; inset: 0; display: grid; place-content: center; justify-items: center; gap: 12px; color: var(--text); background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(5px); }
.quiz-intermission.is-result.is-correct { background: color-mix(in srgb, var(--accent) 13%, var(--surface) 86%); }
.quiz-intermission.is-result.is-wrong { background: color-mix(in srgb, var(--danger) 15%, var(--surface) 86%); }
.quiz-intermission.is-result.is-timeout { background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--danger) 16%, var(--surface)) 0, color-mix(in srgb, var(--surface) 91%, transparent) 62%); }
.quiz-intermission.is-ready { background: color-mix(in srgb, var(--danger) 9%, var(--surface) 86%); }
.quiz-intermission strong { font-size: 17px; letter-spacing: 0; }
.quiz-intermission__result-mark { display: grid; width: 42px; height: 42px; place-items: center; border: 2px solid currentColor; border-radius: 50%; font-size: 25px; font-weight: 800; line-height: 1; }
.quiz-intermission.is-correct .quiz-intermission__result-mark, .quiz-intermission.is-correct > strong { color: var(--accent); }
.quiz-intermission.is-wrong .quiz-intermission__result-mark, .quiz-intermission.is-wrong > strong { color: var(--danger); }
.quiz-intermission.is-timeout .quiz-intermission__result-mark, .quiz-intermission.is-timeout > strong { color: var(--danger); }
.quiz-intermission p.quiz-intermission__streak { margin: -5px 0 0; padding: 4px 9px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); font-size: 11px; font-weight: 700; animation: combo-pop 300ms cubic-bezier(.18,.8,.2,1); }
.quiz-intermission p.quiz-intermission__streak.is-broken { border-color: color-mix(in srgb, var(--danger) 42%, var(--border)); color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, transparent); animation: combo-break 320ms ease-out; }
.quiz-intermission__answers { display: grid; width: min(360px, 82vw); gap: 5px; }
.quiz-intermission__answers p { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; margin: 0; padding: 7px 9px; border: 1px solid var(--border); border-radius: 5px; background: color-mix(in srgb, var(--surface) 76%, transparent); text-align: left; }
.quiz-intermission__answers p span { color: var(--muted); font-size: 10px; white-space: nowrap; }
.quiz-intermission__answers p b { min-width: 0; overflow-wrap: anywhere; color: var(--text); font-size: 11px; font-weight: 600; }
.quiz-intermission__answers p.is-correct { border-color: color-mix(in srgb, var(--accent) 52%, var(--border)); }
.quiz-intermission__answers p.is-correct b { color: var(--accent); }
.quiz-intermission__answers p.is-wrong { border-color: color-mix(in srgb, var(--danger) 52%, var(--border)); }
.quiz-intermission__answers p.is-wrong b { color: color-mix(in srgb, var(--danger) 78%, var(--text)); }
.quiz-timeout-result { display: grid; width: min(430px, 86vw); grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.quiz-timeout-result p { display: grid; gap: 4px; margin: 0; padding: 11px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: color-mix(in srgb, var(--surface) 78%, transparent); text-align: left; }
.quiz-timeout-result p.is-applied { border-color: color-mix(in srgb, var(--danger) 58%, var(--border)); color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, var(--surface)); animation: timeout-penalty-in 340ms cubic-bezier(.2,.75,.2,1); }
.quiz-timeout-result span, .quiz-timeout-result small { font-size: 9px; }
.quiz-timeout-result strong { color: currentColor; font-size: 14px; }
.quiz-timeout-result__roll { margin: -4px 0 0; color: var(--danger); font-size: 11px; font-weight: 700; }
.quiz-intermission__pulse { display: flex; width: 54px; height: 18px; align-items: center; justify-content: space-between; }
.quiz-intermission__pulse i { width: 9px; height: 9px; border-radius: 50%; background: color-mix(in srgb, var(--danger) 72%, var(--accent)); animation: quiz-intermission-pulse 560ms ease-in-out infinite alternate; }
.quiz-intermission__pulse i:nth-child(2) { animation-delay: 120ms; }
.quiz-intermission__pulse i:nth-child(3) { animation-delay: 240ms; }
.quiz-intermission-enter-active, .quiz-intermission-leave-active { transition: opacity 120ms ease; }
.quiz-intermission-enter-from, .quiz-intermission-leave-to { opacity: 0; }
.quiz-finish { min-height: 370px; display: grid; width: min(560px, 100%); place-content: center; justify-items: center; justify-self: center; text-align: center; }
.quiz-finish__score { display: flex; align-items: baseline; color: var(--accent); }
.quiz-finish__score strong { font-size: 48px; line-height: 1; }
.quiz-finish__score span { color: var(--muted); font-size: 18px; }
.quiz-finish__streak { display: flex; align-items: baseline; gap: 7px; margin-top: 12px; padding: 8px 13px; border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.quiz-finish__streak span, .quiz-finish__streak em { color: var(--muted); font-size: 11px; font-style: normal; }
.quiz-finish__streak strong { color: var(--accent); font-size: 25px; line-height: 1; }
.quiz-finish h3 { margin: 14px 0 4px; font-size: 19px; }
.quiz-finish p { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
.quiz-finish p.quiz-finish__answer-stats { margin-top: -10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-muted); color: var(--text); font-size: 12px; }
.quiz-finish > div:last-child { display: flex; gap: 8px; }
.malicious-after-action { display: grid; width: 100%; gap: 9px; margin: 2px 0 18px; padding: 13px 0; border-block: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border)); text-align: left; }
.malicious-after-action__header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.malicious-after-action__header span, .malicious-after-action__evaluation > span { color: var(--muted); font-size: 11px; font-weight: 700; }
.malicious-after-action__header strong { color: color-mix(in srgb, var(--danger) 78%, var(--text)); font-size: 15px; }
.malicious-after-action__meter { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 4px; height: 8px; }
.malicious-after-action__meter i { border-radius: 2px; background: var(--surface-muted); }
.malicious-after-action__meter i.is-filled { background: color-mix(in srgb, var(--danger) 76%, var(--accent)); }
.malicious-after-action__evaluation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 4px; }
.malicious-after-action__evaluation > span { grid-column: 1 / -1; }
.quiz-finish .malicious-after-action__evaluation p { min-width: 0; margin: 0; padding-left: 8px; border-left: 2px solid var(--border); color: var(--muted); font-size: 11px; line-height: 1.45; }
.malicious-after-action__evaluation p strong { color: var(--text); font-size: 13px; }
.collection-game-enter-active, .collection-game-leave-active { transition: opacity 180ms ease; }
.collection-game-enter-active .collection-game-shell, .collection-game-leave-active .collection-game-shell { transition: transform 220ms cubic-bezier(.2,.75,.2,1), opacity 180ms ease; }
.collection-game-enter-from, .collection-game-leave-to { opacity: 0; }
.collection-game-enter-from .collection-game-shell, .collection-game-leave-to .collection-game-shell { opacity: 0; transform: translateY(8px) scale(.985); }
.result-rise-enter-active, .result-rise-leave-active { transition: opacity 180ms ease, transform 220ms ease; }
.result-rise-enter-from, .result-rise-leave-to { opacity: 0; transform: translateY(7px); }
@keyframes game-spin { to { transform: rotate(360deg); } }
@keyframes quiz-cover-in { from { opacity: .25; transform: scale(.975); } }
@keyframes malicious-cover-reveal { from { clip-path: circle(0% at 50% 50%); } to { clip-path: circle(76% at 50% 50%); } }
@keyframes malicious-logo-dissolve { 0%, 28% { opacity: 1; } 100% { opacity: 0; } }
@keyframes malicious-logo-expand { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(2.7); } }
@keyframes malicious-logo-ring { from { opacity: .8; transform: scale(.5); } to { opacity: 0; transform: scale(7); } }
@keyframes score-pop { from { opacity: 0; transform: translateY(4px); } }
@keyframes combo-pop { 0% { opacity: .3; transform: scale(.72); } 65% { transform: scale(1.16); } 100% { opacity: 1; transform: scale(1); } }
@keyframes combo-break { 25% { transform: translateX(-4px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
@keyframes combo-glow { to { box-shadow: 0 9px 28px color-mix(in srgb, var(--accent) 28%, transparent); } }
@keyframes timeout-penalty-in { from { opacity: .25; transform: translateY(7px) scale(.97); } }
@keyframes malicious-window-impact { 0%, 100% { transform: translate3d(0, 0, 0); } 12% { transform: translate3d(-7px, 2px, 0) rotate(-.18deg); } 28% { transform: translate3d(6px, -2px, 0) rotate(.16deg); } 44% { transform: translate3d(-5px, 1px, 0) rotate(-.1deg); } 60% { transform: translate3d(4px, 0, 0) rotate(.08deg); } 76% { transform: translate3d(-2px, 0, 0); } }
@keyframes malicious-impact-flash { from { opacity: 1; } to { opacity: 0; } }
@keyframes malicious-window-pulse { from { box-shadow: 0 24px 64px rgba(8, 15, 25, .3), 0 0 22px color-mix(in srgb, var(--danger) 14%, transparent); } to { box-shadow: 0 24px 64px rgba(8, 15, 25, .3), 0 0 42px color-mix(in srgb, var(--danger) 28%, transparent); } }
@keyframes malicious-copy-in { from { opacity: 0; transform: translateX(5px); } }
@keyframes malicious-copy-pulse { from { opacity: .66; } to { opacity: 1; } }
@keyframes quiz-intermission-pulse { from { opacity: .35; transform: translateY(3px) scale(.8); } to { opacity: 1; transform: translateY(-3px) scale(1); } }
@media (prefers-reduced-motion: reduce) { .quiz-intermission__pulse i { animation: none; opacity: .78; } .quiz-options.is-shuffling button { will-change: auto; } .quiz-cover-wrap.is-logo-stage.is-revealing .quiz-cover { animation-duration: 1ms; } .quiz-cover-wrap.is-revealing .quiz-cover-logo-stage, .quiz-cover-wrap.is-revealing .quiz-cover-logo-stage::before, .quiz-cover-wrap.is-revealing .quiz-cover-logo-stage > span { animation-duration: 1ms; } }
@media (max-width: 640px) { .collection-game-modes, .quiz-bonus-options, .malicious-report__grid, .malicious-after-action__evaluation, .quiz-timeout-result { grid-template-columns: 1fr; } .quiz-difficulty-picker__header, .quiz-bonus-picker__header, .quiz-adaptive-summary { align-items: flex-start; flex-direction: column; gap: 4px; } .quiz-difficulty-tabs button { padding-inline: 4px; } .memory-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } .quiz-streak { position: static; min-width: 0; grid-template-columns: auto auto auto; align-items: baseline; justify-content: center; gap: 7px; justify-self: center; padding: 5px 11px; } .quiz-streak strong { font-size: 22px; } .quiz-question-layout.is-dense { grid-template-columns: 1fr; } .quiz-options { grid-template-columns: 1fr; } .quiz-cover-wrap, .quiz-question-layout.is-dense .quiz-cover-wrap { width: min(190px, 56vw); } .collection-game-detail__start { justify-self: stretch; } .quiz-finish > div:last-child { flex-wrap: wrap; justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .collection-game-overlay *, .collection-game-overlay *::before, .collection-game-overlay *::after { scroll-behavior: auto !important; animation-duration: 1ms !important; transition-duration: 1ms !important; } }
</style>
