export const MEMORY_GAME_HIGH_SCORE_KEY = "bangumi.games.memory.highScore";
export const QUIZ_GAME_HIGH_SCORES_KEY = "bangumi.games.quiz.highScores";
export const QUIZ_GAME_BEST_STREAKS_KEY = "bangumi.games.quiz.bestStreaks";
export const QUIZ_MALICIOUS_ANALYSIS_KEY = "bangumi.games.quiz.maliciousAnalysis";
export const QUIZ_UNKNOWN_CHALLENGE_HIGH_SCORE_KEY = "bangumi.games.quiz.unknownChallengeHighScore";
export const QUIZ_MALICIOUS_PROGRESS_KEY = "bangumi.games.quiz.maliciousProgress";
export const QUIZ_MALICIOUS_HISTORY_KEY = "bangumi.games.quiz.maliciousHistory";
export const QUIZ_MALICIOUS_POOL_CACHE_KEY = "bangumi.games.quiz.maliciousPoolCache";
export const QUIZ_MALICIOUS_EXPOSURE_KEY = "bangumi.games.quiz.maliciousExposure";

export type CollectionGameScoreKind = "memory" | "quiz";

export function clearCollectionGameHighScore(kind: CollectionGameScoreKind): void {
  localStorage.removeItem(
    kind === "memory" ? MEMORY_GAME_HIGH_SCORE_KEY : QUIZ_GAME_HIGH_SCORES_KEY,
  );
  if (kind === "quiz") localStorage.removeItem(QUIZ_GAME_BEST_STREAKS_KEY);
}

export function clearQuizMaliciousAnalysis(): void {
  localStorage.removeItem(QUIZ_MALICIOUS_ANALYSIS_KEY);
  localStorage.removeItem(QUIZ_MALICIOUS_HISTORY_KEY);
  localStorage.removeItem(QUIZ_MALICIOUS_POOL_CACHE_KEY);
  localStorage.removeItem(QUIZ_MALICIOUS_EXPOSURE_KEY);
}
