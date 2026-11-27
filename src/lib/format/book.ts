import type { Provider } from "../providers/types";
import { formatDuration } from "./duration";
import { formatScore } from "./score";
import { TYPE_LABELS } from "./type-labels";

/** "320 pages", or "1 page". */
export function formatPages(pages: number): string {
  return pages === 1 ? "1 page" : `${pages.toLocaleString("en-GB")} pages`;
}

type BookEntry = {
  version: "print" | "audio" | null;
  pages: number | null;
  minutes: number | null;
  narrators: string | null;
  score: number | null;
  scoreCount: number | null;
  providerName: Provider;
};

/**
 * A book entry's meta line. Print: "Book · 320 pages · Hardcover rating 4.2/5 (1,234)";
 * audio: "Audiobook · 11 h 20 min · Narrated by A, B". The version comes from the
 * entry, never from whether the book has an audiobook. Unknown parts are left out.
 */
export function bookMeta(book: BookEntry): string {
  const parts =
    book.version === "audio"
      ? [
          "Audiobook",
          book.minutes !== null ? formatDuration(book.minutes) : null,
          book.narrators ? `Narrated by ${book.narrators}` : null,
        ]
      : [
          TYPE_LABELS.book,
          book.pages !== null ? formatPages(book.pages) : null,
          formatScore(book.score, book.scoreCount, book.providerName),
        ];
  return parts.filter((p) => p !== null).join(" · ");
}
