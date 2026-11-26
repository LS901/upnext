/**
 * A show's progress, "X of Y seasons finished". Y is the show's seasons
 * numbered 1 or more, minus the user's exclusions; X is the user's finished
 * seasons among them. Specials (season 0) never count (ruling, owner may overrule).
 */
export function showProgress(
  seasonNumbers: { id: string; number: number }[],
  finishedSeasonIds: Set<string>,
  excludedSeasonIds: Set<string>,
): { finished: number; total: number } {
  const counted = seasonNumbers.filter((s) => s.number >= 1 && !excludedSeasonIds.has(s.id));
  return {
    finished: counted.filter((s) => finishedSeasonIds.has(s.id)).length,
    total: counted.length,
  };
}
