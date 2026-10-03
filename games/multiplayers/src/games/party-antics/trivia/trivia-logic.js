// Pure scoring for Trivia Blitz (shared with unit tests).
export const QUESTION_SECONDS = 15;
export const ANSWER_SHAPES = ['▲', '◆', '●', '■'];
export const ANSWER_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

/** 500 for a correct answer + up to 500 for speed + 100 per extra streak step (max +400). */
export function scoreAnswer({ correct, msLeft, msTotal, streak }) {
  if (!correct) return 0;
  const speed = Math.max(0, Math.min(1, msLeft / msTotal));
  const streakBonus = Math.min(400, Math.max(0, streak - 1) * 100);
  return Math.round(500 + 500 * speed) + streakBonus;
}
