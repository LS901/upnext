import { describe, expect, test } from "vitest";
import type { ItemRow, LibraryView, QueuedSeasonRow, SeasonRow, ShowRow } from "./queries";
import {
  RADAR_LIMIT,
  formatDay,
  summarise,
  timeLeftLabel,
  untilLabel,
  upcoming,
  type RadarEntry,
} from "./dashboard-summary";
import { filterView } from "./type-filter";

const item = (id: string, status: ItemRow["status"], minutes: number | null): ItemRow => ({
  kind: "item",
  entryId: id,
  status,
  playCount: 0,
  mediaType: "movie",
  version: null,
  title: id,
  imageUrl: null,
  minutes,
  pages: null,
  narrators: null,
  lengthNote: null,
  providerName: "tmdb",
  score: null,
  scoreCount: null,
});
const season = (id: string, status: SeasonRow["status"], runtimeMinutes: number | null): SeasonRow => ({
  entryId: id,
  status,
  playCount: 0,
  number: 1,
  episodeCount: null,
  airDate: null,
  runtimeMinutes,
});
const show = (seasons: SeasonRow[]): ShowRow => ({
  kind: "show",
  showId: "sh",
  title: "Show",
  imageUrl: null,
  score: null,
  scoreCount: null,
  progress: { finished: 0, total: 0 },
  seasons,
  allSeasons: [],
});
const queuedSeason = (id: string, runtimeMinutes: number | null): QueuedSeasonRow => ({
  ...season(id, "backlog", runtimeMinutes),
  kind: "season",
  showTitle: "Show",
  imageUrl: null,
  score: null,
  scoreCount: null,
});

describe("summarise", () => {
  test("an Other entry counts as without a time, never as time", () => {
    const other: ItemRow = { ...item("o1", "backlog", null), mediaType: "other", lengthNote: "24 episodes", providerName: "manual" };
    const view: LibraryView = { upNext: { movie: [], show: [], game: [], book: [], other: [other] }, groups: [] };
    expect(summarise(view)).toMatchObject({ backlog: 1, backlogMinutes: 0, backlogUnknownTime: 1 });
  });

  test("counts entries, backlog minutes and unknown times", () => {
    const view: LibraryView = {
      upNext: {
        movie: [item("q1", "backlog", 30), item("b1", "backlog", 100), item("b2", "backlog", null)],
        show: [queuedSeason("s1", 60), queuedSeason("s2", 40)],
        game: [],
        book: [],
        other: [],
      },
      groups: [
        { status: "in_progress", label: "In progress", rows: [item("p1", "in_progress", 90), show([season("ps", "in_progress", 50)])] },
        { status: "finished", label: "Finished", rows: [item("f1", "finished", 10), item("f2", "finished", 20)] },
      ],
    };
    expect(summarise(view)).toEqual({ backlog: 5, backlogMinutes: 230, backlogUnknownTime: 1, backlogPages: 0, inProgress: 2, finished: 2 });
  });

  test("a queued season counts as backlog", () => {
    const view: LibraryView = { upNext: { movie: [], show: [queuedSeason("qs", null)], game: [], book: [], other: [] }, groups: [] };
    expect(summarise(view)).toEqual({ backlog: 1, backlogMinutes: 0, backlogUnknownTime: 1, backlogPages: 0, inProgress: 0, finished: 0 });
  });
});

const book = (id: string, version: "print" | "audio", extra: Partial<ItemRow>): ItemRow => ({
  ...item(id, "backlog", null),
  mediaType: "book",
  version,
  providerName: "hardcover",
  ...extra,
});

describe("summarise with books", () => {
  test("print pages add to backlogPages and audio minutes to the time", () => {
    const view: LibraryView = {
      upNext: {
        movie: [],
        show: [],
        game: [],
        book: [
          book("p1", "print", { pages: 300 }),
          book("p2", "print", { pages: 940 }),
          book("a1", "audio", { minutes: 600 }),
          book("a2", "audio", { minutes: null }),
        ],
        other: [],
      },
      groups: [],
    };
    expect(summarise(view)).toEqual({
      backlog: 4,
      backlogMinutes: 600,
      backlogUnknownTime: 1,
      backlogPages: 1240,
      inProgress: 0,
      finished: 0,
    });
  });

  test("a print book with no page count never counts as unknown", () => {
    const view: LibraryView = { upNext: { movie: [], show: [], game: [], book: [book("p", "print", { pages: null })], other: [] }, groups: [] };
    expect(summarise(view)).toEqual({
      backlog: 1,
      backlogMinutes: 0,
      backlogUnknownTime: 0,
      backlogPages: 0,
      inProgress: 0,
      finished: 0,
    });
  });
});

describe("summarise on a type tab", () => {
  test("a filtered view counts only that type", () => {
    const view: LibraryView = {
      upNext: {
        movie: [item("m1", "backlog", 30)],
        show: [queuedSeason("s1", 60)],
        game: [],
        book: [book("p1", "print", { pages: 300 }), book("a1", "audio", { minutes: 600 })],
        other: [],
      },
      groups: [
        {
          status: "finished",
          label: "Finished",
          rows: [item("f1", "finished", 10), { ...book("fb", "print", {}), status: "finished" }],
        },
      ],
    };
    expect(summarise(filterView(view, "book"))).toEqual({
      backlog: 2,
      backlogMinutes: 600,
      backlogUnknownTime: 0,
      backlogPages: 300,
      inProgress: 0,
      finished: 1,
    });
    expect(summarise(filterView(view, "other"))).toEqual({
      backlog: 0,
      backlogMinutes: 0,
      backlogUnknownTime: 0,
      backlogPages: 0,
      inProgress: 0,
      finished: 0,
    });
  });
});

describe("timeLeftLabel", () => {
  test("pages", () => {
    expect(timeLeftLabel(600, 0, 1240)).toBe("about 10 h to finish · 1,240 pages to read");
    expect(timeLeftLabel(0, 0, 320)).toBe("320 pages to read");
    expect(timeLeftLabel(0, 0, 0)).toBeNull();
  });

  test("labels", () => {
    expect(timeLeftLabel(9420, 0)).toBe("about 157 h to finish");
    expect(timeLeftLabel(9420, 2)).toBe("about 157 h to finish · 2 without a time");
    expect(timeLeftLabel(20, 0)).toBe("under 1 h to finish");
    expect(timeLeftLabel(0, 3)).toBe("3 without a time");
    expect(timeLeftLabel(0, 0)).toBeNull();
  });
});

describe("untilLabel and formatDay", () => {
  test("untilLabel", () => {
    expect(untilLabel("2026-11-28", "2026-11-27")).toBe("tomorrow");
    expect(untilLabel("2026-12-09", "2026-11-27")).toBe("in 12 days");
    expect(untilLabel("2027-01-25", "2026-11-27")).toBe("in 59 days");
    expect(untilLabel("2027-01-26", "2026-11-27")).toBe("in 2 months");
  });
  test("formatDay", () => {
    expect(formatDay("2027-03-14", "2026-11-27")).toBe("14 Mar 2027");
    expect(formatDay("2026-12-03", "2026-11-27")).toBe("3 Dec");
  });
});

describe("upcoming", () => {
  const r = (title: string, releaseDate: string, seasonNumber: number | null = null): RadarEntry => ({
    entryId: `${title}-${releaseDate}`,
    title,
    mediaType: seasonNumber === null ? "movie" : "show",
    imageUrl: null,
    releaseDate,
    seasonNumber,
  });

  test("drops today and the past, sorts by date then title, keeps seasons", () => {
    const out = upcoming(
      [r("Z", "2026-12-01"), r("Past", "2026-11-01"), r("Today", "2026-11-27"), r("B", "2026-12-01"), r("Show", "2026-11-30", 2)],
      "2026-11-27",
    );
    expect(out.map((e) => e.title)).toEqual(["Show", "B", "Z"]);
    expect(out[0].seasonNumber).toBe(2);
  });

  test("caps at 8", () => {
    const many = Array.from({ length: 12 }, (_, n) => r(`T${String(n).padStart(2, "0")}`, `2027-01-${String(n + 1).padStart(2, "0")}`));
    const out = upcoming(many, "2026-11-27");
    expect(RADAR_LIMIT).toBe(8);
    expect(out.map((e) => e.title)).toEqual(many.slice(0, 8).map((e) => e.title));
  });
});
