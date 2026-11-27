import type { Provider } from "../providers/types";

/** A provider's review score (0-100) with its vote count, or "No score". */
export function formatScore(score: number | null, count: number | null, provider?: Provider): string {
  if (score === null) return "No score";
  if (provider === "hardcover") {
    // Stored as 0-100; Hardcover rates out of 5. The label is mandatory.
    const shown = `Hardcover rating ${(score / 20).toFixed(1)}/5`;
    return count === null ? shown : `${shown} (${count.toLocaleString("en-GB")})`;
  }
  const shown = `Score ${Math.round(score)}/100`;
  if (count === null) return shown;
  return `${shown} (${count} ${count === 1 ? "vote" : "votes"})`;
}
