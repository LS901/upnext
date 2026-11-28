import { expect, test } from "vitest";
import type { ItemRow } from "@/lib/library/queries";
import { dragName } from "./drag-name";

const row = (version: ItemRow["version"]): ItemRow => ({
  kind: "item",
  entryId: "e",
  status: "backlog",
  playCount: 0,
  mediaType: "book",
  version,
  title: "The Lantern Tide",
  imageUrl: null,
  minutes: null,
  pages: null,
  narrators: null,
  providerName: "hardcover",
  score: null,
  scoreCount: null,
});

test("an audiobook's drag name matches its visible label", () => {
  expect(dragName(row("audio"))).toBe("The Lantern Tide · Audiobook");
});

test("a print book's drag name is its title", () => {
  expect(dragName(row("print"))).toBe("The Lantern Tide");
});
