/** A provider's review score (0-100) with its vote count, or "No score". */
export function formatScore(score: number | null, count: number | null): string {
  if (score === null) return "No score";
  const votes = count === null ? "votes unknown" : `${count} ${count === 1 ? "vote" : "votes"}`;
  return `Score ${Math.round(score)}/100 (${votes})`;
}
