// A large library must load in full: more seasons than fit in one request's
// URL, and more entries than PostgREST returns in one page (max_rows = 1000
// in supabase/config.jsonc). Nothing may vanish or be undercounted.
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { inLibrary, itemKey } from "../../src/lib/library/in-library";
import { getMyLibrary, type ShowRow } from "../../src/lib/library/queries";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

// 110 shows x 3 seasons = 330 seasons (over 300, and over 100 shows);
// 330 season entries + 720 movie entries = 1050 entries (over 1000).
const SHOWS = 110;
const MOVIES = 720;
const CHUNK = 200;

const chunks = <T>(rows: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

describe("a large library", () => {
  let a: TestUser;
  const base = randomInt(10_000_000, 80_000_000);
  const pad = (n: number) => String(n).padStart(4, "0");
  const showIds: string[] = [];
  const movieIds: string[] = [];

  beforeAll(async () => {
    const admin = adminClient();
    a = await createTestUser("biglib");

    // Provider ids base .. base+SHOWS-1 are the shows, the rest the movies.
    const evenShows = new Set<string>();
    const insertItems = async (media_type: "show" | "movie", count: number, offset: number, label: string) => {
      const rows = Array.from({ length: count }, (_, i) => ({
        provider: "tmdb" as const,
        media_type,
        provider_id: String(base + offset + i),
        title: `Invented Biglib ${label} ${pad(i)}`,
      }));
      const ids: string[] = [];
      for (const part of chunks(rows)) {
        const { data, error } = await admin.from("items").insert(part).select("id, provider_id");
        if (error) throw error;
        for (const r of data) {
          ids.push(r.id);
          if (media_type === "show" && (Number(r.provider_id) - base) % 2 === 0) evenShows.add(r.id);
        }
      }
      return ids;
    };
    showIds.push(...(await insertItems("show", SHOWS, 0, "Show")));
    movieIds.push(...(await insertItems("movie", MOVIES, SHOWS, "Film")));

    const seasonRows = showIds.flatMap((show_id) => [0, 1, 2].map((season_number) => ({ show_id, season_number })));
    const seasons: { id: string; show_id: string; season_number: number }[] = [];
    for (const part of chunks(seasonRows)) {
      const { data, error } = await admin.from("seasons").insert(part).select("id, show_id, season_number");
      if (error) throw error;
      seasons.push(...data);
    }

    // Every season added; season 1 finished. The even shows (Show 0000,
    // Show 0002, ...) exclude season 2.
    const entries = [
      ...seasons.map((s) => ({
        user_id: a.id,
        season_id: s.id,
        status: s.season_number === 1 ? ("finished" as const) : ("backlog" as const),
      })),
      ...movieIds.map((item_id) => ({ user_id: a.id, item_id, item_media_type: "movie" as const, status: "backlog" as const })),
    ];
    for (const part of chunks(entries)) {
      const { error } = await admin.from("library_entries").insert(part);
      if (error) throw error;
    }
    const exclusions = seasons
      .filter((s) => s.season_number === 2 && evenShows.has(s.show_id))
      .map((s) => ({ user_id: a.id, season_id: s.id }));
    const { error } = await admin.from("progress_exclusions").insert(exclusions);
    if (error) throw error;
  }, 120_000);

  afterAll(async () => {
    // Entries and exclusions go with the user; then the catalogue rows (and
    // their seasons) can, in small batches so each URL stays short.
    if (a) await deleteTestUsers([a]);
    const admin = adminClient();
    for (const part of chunks([...showIds, ...movieIds], 100)) {
      const { error } = await admin.from("items").delete().in("id", part);
      if (error) throw error;
    }
  }, 120_000);

  test("getMyLibrary returns every entry, with the right progress for every show", async () => {
    const { groups } = await getMyLibrary(a.client, a.id);
    const rows = groups.flatMap((g) => g.rows);

    const movies = rows.filter((r) => r.kind === "item");
    expect(movies).toHaveLength(MOVIES);
    const seasonEntries = rows.flatMap((r) => (r.kind === "show" ? r.seasons : []));
    expect(seasonEntries).toHaveLength(SHOWS * 3);

    // A show appears in Backlog (seasons 0 and 2) and in Finished (season 1).
    const shows = rows.filter((r): r is ShowRow => r.kind === "show");
    const byTitle = new Map(shows.map((s) => [s.title, s]));
    expect(byTitle.size).toBe(SHOWS);
    for (let i = 0; i < SHOWS; i++) {
      // Seasons 1 and 2 count (Specials don't); even shows exclude season 2.
      const total = i % 2 === 0 ? 1 : 2;
      expect(byTitle.get(`Invented Biglib Show ${pad(i)}`)?.progress, `show ${i}`).toEqual({ finished: 1, total });
    }
    for (const show of shows) {
      expect(show.progress).toEqual(byTitle.get(show.title)!.progress);
    }
  });

  test("inLibrary finds every item and show at that size", async () => {
    const keys = [
      ...Array.from({ length: SHOWS }, (_, i) => itemKey("tmdb", "show", String(base + i))),
      ...Array.from({ length: MOVIES }, (_, i) => itemKey("tmdb", "movie", String(base + SHOWS + i))),
    ];
    expect(await inLibrary(a.client, a.id, keys)).toEqual(new Set(keys));
  });
});
