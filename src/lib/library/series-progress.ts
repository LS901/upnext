/**
 * A book series' progress, "X of Y read", like a show's seasons. Y is the
 * series' primary book count (Hardcover's main-line count; unknown is 0) minus
 * the user's excluded main-line books. X is the distinct main-line books the
 * user has Finished in either version, not excluded: print and audio of one
 * book count once (Review Focus 5). Main-line means a whole-number position,
 * so a 2.5 novella never counts (ruling, owner may overrule).
 *
 * `books` lists the user's entries in the series, whatever their status, plus a
 * row for each excluded book they never added. A book is excluded when any of
 * its rows says so.
 */
export function seriesProgress(
  primaryBooksCount: number | null,
  books: { itemId: string; position: number | null; finished: boolean; excluded: boolean }[],
): { read: number; total: number } {
  const mainLine = books.filter((b) => b.position !== null && Number.isInteger(b.position));
  const excluded = new Set(mainLine.filter((b) => b.excluded).map((b) => b.itemId));
  const read = new Set(mainLine.filter((b) => b.finished && !excluded.has(b.itemId)).map((b) => b.itemId));
  return { read: read.size, total: Math.max(0, (primaryBooksCount ?? 0) - excluded.size) };
}
