/** A provider's review score (0-100) with its vote count, or "No score". */
export function formatScore(score: number | null, count: number | null): string {
  if (score === null) return "No score";
  const shown = `Score ${Math.round(score)}/100`;
  if (count === null) return shown;
  return `${shown} (${count} ${count === 1 ? "vote" : "votes"})`;
}
