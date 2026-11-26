// Catalogue import, weekly refresh, purge, prune and the cron route, against
// local Supabase with provider HTTP stubbed (INV-003, INV-007).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test, vi } from "vitest";
import { importItem } from "../../src/lib/catalogue/import";
import { refreshStaleItems } from "../../src/lib/catalogue/refresh";
import { resetIgdbTokenForTests } from "../../src/lib/providers/igdb";
import { POST } from "../../src/app/api/cron/refresh/route";
import * as cronRoute from "../../src/app/api/cron/refresh/route";
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const TMDB = "http://tmdb.test/3";
const IGDB = "http://igdb.test/v4";
const TWITCH = "http://twitch.test/oauth2/token";
const CRON_SECRET = "invented-cron-secret";
const DAY = 24 * 60 * 60 * 1000;

// ---- Provider stub ----------------------------------------------------------

/** A response body, or a failure status. */
type Reply = unknown;
const fail = (status: number) => ({ __status: status });

let tmdbRoutes: Record<string, Reply> = {};
let igdbGames: Record<string, Reply> = {};
let igdbTtb: Record<string, Reply> = {};
const providerCalls: string[] = [];

function reply(body: Reply): Response {
  if (body === undefined) return new Response("{}", { status: 404 });
  if (body && typeof body === "object" && "__status" in body) {
    return new Response("{}", { status: (body as { __status: number }).__status });
  }
  return new Response(JSON.stringify(body), { status: 200 });
}

const realFetch = globalThis.fetch;

function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === new URL(inject("supabase").url).origin) return realFetch(input, init);
  providerCalls.push(url.href);

  if (url.href.startsWith(TWITCH)) {
    return Promise.resolve(reply({ access_token: "tok", expires_in: 3600 }));
  }
  if (url.href.startsWith(TMDB)) {
    return Promise.resolve(reply(tmdbRoutes[url.pathname.replace(/^\/3/, "")]));
  }
  if (url.href.startsWith(IGDB)) {
    const id = String(init?.body).match(/where (?:id|game_id) = (\d+);/)?.[1] ?? "";
    const table = url.pathname.endsWith("/game_time_to_beats") ? igdbTtb : igdbGames;
    return Promise.resolve(reply(table[id]));
  }
  // Never let a test reach a real provider.
  return Promise.reject(new Error(`unexpected request to ${url.host}`));
}

// ---- Invented provider data -------------------------------------------------

let nextId = 7_000_000 + Math.floor(Math.random() * 1_000_000);
const newId = () => String(nextId++);

type SeasonSpec = { n: number; runtimes: (number | null)[]; airDate?: string | null };

function stubShow(id: string, name: string, seasons: SeasonSpec[], extra: Record<string, unknown> = {}) {
  tmdbRoutes[`/tv/${id}`] = {
    id: Number(id),
    name,
    poster_path: `/show-${id}.jpg`,
    first_air_date: "2021-03-02",
    vote_average: 8.1,
    vote_count: 560,
    seasons: seasons.map((s) => ({
      season_number: s.n,
      name: s.n === 0 ? "Specials" : `Season ${s.n}`,
      episode_count: s.runtimes.length,
      air_date: s.airDate === undefined ? `202${s.n}-01-01` : s.airDate,
      overview: "INVENTED season overview",
    })),
    ...extra,
  };
  for (const s of seasons) {
    tmdbRoutes[`/tv/${id}/season/${s.n}`] = {
      season_number: s.n,
      episodes: s.runtimes.map((runtime, i) => ({ name: `Episode ${i + 1}`, runtime })),
    };
  }
}

function stubMovie(id: string, title: string, runtime = 101) {
  tmdbRoutes[`/movie/${id}`] = {
    id: Number(id),
    title,
    poster_path: `/movie-${id}.jpg`,
    release_date: "2019-06-14",
    runtime,
    vote_average: 7.25,
    vote_count: 1234,
  };
}

function stubGame(id: string, name: string, normally: number | null = 54000) {
  igdbGames[id] = [
    {
      id: Number(id),
      name,
      first_release_date: 1577836800,
      cover: { id: 1, image_id: `co${id}` },
      total_rating: 81.456,
      total_rating_count: 120,
    },
  ];
  igdbTtb[id] = [{ id: 1, game_id: Number(id), hastily: 36000, normally, completely: 108000, count: 42 }];
}

// ---- Database helpers ---------------------------------------------------------

const createdItems: string[] = [];

async function track(itemId: string) {
  createdItems.push(itemId);
  return itemId;
}

async function setItem(id: string, patch: { refreshed_at?: string; created_at?: string }) {
  const { error } = await adminClient().from("items").update(patch).eq("id", id);
  expect(error).toBeNull();
}

const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

async function getItem(id: string) {
  const { data, error } = await adminClient().from("items").select("*").eq("id", id).maybeSingle();
  expect(error).toBeNull();
  return data;
}

async function getSeasons(showId: string) {
  const { data, error } = await adminClient()
    .from("seasons")
    .select("*")
    .eq("show_id", showId)
    .order("season_number");
  expect(error).toBeNull();
  return data!;
}

/** Every user row of user u, read with the service role so nothing is hidden. */
async function userRows(u: TestUser) {
  const admin = adminClient();
  const [entries, notes, exclusions] = await Promise.all([
    admin.from("library_entries").select("*").eq("user_id", u.id).order("id"),
    admin.from("entry_notes").select("*").eq("user_id", u.id).order("entry_id"),
    admin.from("progress_exclusions").select("*").eq("user_id", u.id).order("season_id"),
  ]);
  expect(entries.error ?? notes.error ?? exclusions.error).toBeNull();
  return { entries: entries.data, notes: notes.data, exclusions: exclusions.data };
}

async function addSeasonEntry(u: TestUser, seasonId: string, row: { status?: "backlog" | "in_progress" | "finished"; play_count?: number } = {}) {
  const { data, error } = await u.client
    .from("library_entries")
    .insert({ season_id: seasonId, ...row })
    .select()
    .single();
  expect(error).toBeNull();
  return data!;
}

async function addNote(u: TestUser, entryId: string, body: string) {
  const { error } = await u.client.from("entry_notes").insert({ entry_id: entryId, body });
  expect(error).toBeNull();
}

async function addExclusion(u: TestUser, seasonId: string) {
  const { error } = await u.client.from("progress_exclusions").insert({ season_id: seasonId });
  expect(error).toBeNull();
}

// ---- Setup --------------------------------------------------------------------

describe("catalogue import and refresh", () => {
  let a: TestUser;

  beforeAll(async () => {
    a = await createTestUser("importer");
  });

  beforeEach(async () => {
    tmdbRoutes = {};
    igdbGames = {};
    igdbTtb = {};
    providerCalls.length = 0;
    resetIgdbTokenForTests();
    const { url, serviceRoleKey } = inject("supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
    vi.stubEnv("TMDB_API_BASE_URL", TMDB);
    vi.stubEnv("IGDB_API_BASE_URL", IGDB);
    vi.stubEnv("TWITCH_TOKEN_URL", TWITCH);
    vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "tmdb-token");
    vi.stubEnv("IGDB_CLIENT_ID", "igdb-cid");
    vi.stubEnv("IGDB_CLIENT_SECRET", "igdb-csecret");
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubGlobal("fetch", providerFetch);

    // Only this test's items may be stale, so the refresh counts are exact.
    const { error } = await adminClient()
      .from("items")
      .update({ refreshed_at: new Date().toISOString() })
      .lt("refreshed_at", daysAgo(1));
    expect(error).toBeNull();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // Clear this test's user rows, then its items (restrict FKs need that order).
    const admin = adminClient();
    await admin.from("progress_exclusions").delete().eq("user_id", a.id);
    await admin.from("library_entries").delete().eq("user_id", a.id);
    if (createdItems.length) {
      const { error } = await admin.from("items").delete().in("id", createdItems);
      expect(error).toBeNull();
      createdItems.length = 0;
    }
  });

  afterAll(async () => {
    if (a) await deleteTestUsers([a]);
  });

  // ---- Import ---------------------------------------------------------------

  test("importing twice gives one item and one row per season", async () => {
    const id = newId();
    stubShow(id, "Invented Tides", [
      { n: 0, runtimes: [12] },
      { n: 1, runtimes: [45, 47] },
      { n: 2, runtimes: [50] },
    ]);

    const first = await importItem("tmdb", "show", id);
    await track(first.itemId);
    const second = await importItem("tmdb", "show", id);

    expect(second).toEqual(first);
    expect(first.seasons.map((s) => s.number)).toEqual([0, 1, 2]);

    const { data: items } = await adminClient()
      .from("items")
      .select("id")
      .eq("provider", "tmdb")
      .eq("media_type", "show")
      .eq("provider_id", id);
    expect(items).toHaveLength(1);

    const seasons = await getSeasons(first.itemId);
    expect(seasons.map((s) => [s.season_number, s.runtime_minutes, s.episode_count])).toEqual([
      [0, 12, 1],
      [1, 92, 2],
      [2, 50, 1],
    ]);
    const item = await getItem(first.itemId);
    expect(item).toMatchObject({
      title: "Invented Tides",
      image_ref: `/show-${id}.jpg`,
      release_date: "2021-03-02",
      score: 81,
      score_count: 560,
      provider_data_purged_at: null,
    });
  });

  test("a game imports its time to beat", async () => {
    const id = newId();
    stubGame(id, "Invented Keep");
    const { itemId, seasons } = await importItem("igdb", "game", id);
    await track(itemId);
    expect(seasons).toEqual([]);
    expect(await getItem(itemId)).toMatchObject({
      media_type: "game",
      title: "Invented Keep",
      image_ref: `co${id}`,
      ttb_hastily_s: 36000,
      ttb_normally_s: 54000,
      ttb_completely_s: 108000,
      ttb_count: 42,
    });
  });

  test("INV-003: refresh never touches user data", async () => {
    const id = newId();
    stubShow(id, "Invented Harbour", [
      { n: 1, runtimes: [40, 40] },
      { n: 2, runtimes: [30] },
      { n: 3, runtimes: [20] },
    ]);
    const { itemId, seasons } = await importItem("tmdb", "show", id);
    await track(itemId);
    const s = Object.fromEntries(seasons.map((x) => [x.number, x.id]));

    const e1 = await addSeasonEntry(a, s[1], { status: "finished", play_count: 2 });
    await addSeasonEntry(a, s[2], { status: "in_progress" });
    await addNote(a, e1.id, "INVENTED note: loved the finale");
    await addExclusion(a, s[2]);
    const before = await userRows(a);
    expect(before.entries).toHaveLength(2);
    expect(before.notes).toHaveLength(1);
    expect(before.exclusions).toHaveLength(1);

    // The provider renames the show, changes season 1's runtime, adds season 4
    // and drops season 2.
    tmdbRoutes = {};
    stubShow(id, "Invented Harbour (Renamed)", [
      { n: 1, runtimes: [55, 55] },
      { n: 3, runtimes: [20] },
      { n: 4, runtimes: [25, 25] },
    ]);
    const again = await importItem("tmdb", "show", id);

    expect(again.itemId).toBe(itemId);
    expect((await getItem(itemId))?.title).toBe("Invented Harbour (Renamed)");
    const after = await getSeasons(itemId);
    expect(after.map((x) => [x.season_number, x.runtime_minutes])).toEqual([
      [1, 110],
      [2, 30], // dropped by the provider, still present
      [3, 20],
      [4, 50],
    ]);
    const s4 = after.find((x) => x.season_number === 4)!;
    const { data: s4Entries } = await adminClient().from("library_entries").select("id").eq("season_id", s4.id);
    expect(s4Entries).toEqual([]);

    expect(await userRows(a)).toEqual(before);
  });

  test("a show is still added when one season request fails", async () => {
    const id = newId();
    stubShow(id, "Invented Lighthouse", [
      { n: 1, runtimes: [40] },
      { n: 2, runtimes: [60, 60] },
      { n: 3, runtimes: [30] },
    ]);
    tmdbRoutes[`/tv/${id}/season/2`] = fail(500);

    const { itemId, seasons } = await importItem("tmdb", "show", id);
    await track(itemId);
    expect(seasons.map((x) => x.number)).toEqual([1, 2, 3]);
    const rows = await getSeasons(itemId);
    expect(rows.map((x) => [x.season_number, x.runtime_minutes, x.episode_count])).toEqual([
      [1, 40, 1],
      [2, null, 2],
      [3, 30, 1],
    ]);
  });

  test("a failed main show request imports nothing", async () => {
    const id = newId();
    stubShow(id, "Invented Nothing", [{ n: 1, runtimes: [40] }]);
    tmdbRoutes[`/tv/${id}`] = fail(500);
    await expect(importItem("tmdb", "show", id)).rejects.toMatchObject({ name: "ProviderError" });
    const { data } = await adminClient().from("items").select("id").eq("provider_id", id);
    expect(data).toEqual([]);
  });

  // ---- Refresh --------------------------------------------------------------

  test("refreshStaleItems refreshes only stale items and survives a provider failure", async () => {
    const [staleId, failingId, freshId] = [newId(), newId(), newId()];
    stubMovie(staleId, "Invented Stale");
    stubMovie(failingId, "Invented Failing");
    stubMovie(freshId, "Invented Fresh");
    const stale = await track((await importItem("tmdb", "movie", staleId)).itemId);
    const failing = await track((await importItem("tmdb", "movie", failingId)).itemId);
    const fresh = await track((await importItem("tmdb", "movie", freshId)).itemId);
    await setItem(stale, { refreshed_at: daysAgo(8) });
    await setItem(failing, { refreshed_at: daysAgo(9) });
    await setItem(fresh, { refreshed_at: daysAgo(6) });
    const failingBefore = await getItem(failing);
    const freshBefore = await getItem(fresh);

    stubMovie(staleId, "Invented Stale (Renamed)", 120);
    stubMovie(freshId, "Invented Fresh (Renamed)");
    tmdbRoutes[`/movie/${failingId}`] = fail(429);
    providerCalls.length = 0;

    const result = await refreshStaleItems();

    expect(result).toMatchObject({ refreshed: 1, failed: 1, purged: 0 });
    const staleAfter = await getItem(stale);
    expect(staleAfter).toMatchObject({ title: "Invented Stale (Renamed)", runtime_minutes: 120 });
    expect(Date.now() - new Date(staleAfter!.refreshed_at).getTime()).toBeLessThan(60_000);
    expect(await getItem(failing)).toEqual(failingBefore);
    expect(await getItem(fresh)).toEqual(freshBefore);
    expect(providerCalls.some((u) => u.includes(`/movie/${freshId}`))).toBe(false);
  });

  test("refreshStaleItems takes the oldest first, up to the limit", async () => {
    const [olderId, newerId] = [newId(), newId()];
    stubMovie(olderId, "Invented Older");
    stubMovie(newerId, "Invented Newer");
    const older = await track((await importItem("tmdb", "movie", olderId)).itemId);
    const newer = await track((await importItem("tmdb", "movie", newerId)).itemId);
    await setItem(older, { refreshed_at: daysAgo(20) });
    await setItem(newer, { refreshed_at: daysAgo(10) });

    expect(await refreshStaleItems({ limit: 1 })).toMatchObject({ refreshed: 1, failed: 0 });
    expect(new Date((await getItem(older))!.refreshed_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(new Date((await getItem(newer))!.refreshed_at).getTime()).toBeLessThan(Date.now() - 9 * DAY);
  });

  test("a refresh with a failing season keeps the known runtime", async () => {
    const id = newId();
    stubShow(id, "Invented Long Show", [
      { n: 1, runtimes: [50] },
      { n: 2, runtimes: [200, 200] },
    ]);
    const { itemId } = await importItem("tmdb", "show", id);
    await track(itemId);
    expect((await getSeasons(itemId)).map((x) => x.runtime_minutes)).toEqual([50, 400]);
    await setItem(itemId, { refreshed_at: daysAgo(8) });

    stubShow(id, "Invented Long Show", [
      { n: 1, runtimes: [55] },
      { n: 2, runtimes: [200, 200] },
    ]);
    tmdbRoutes[`/tv/${id}/season/2`] = fail(500);
    expect(await refreshStaleItems()).toMatchObject({ refreshed: 1, failed: 0 });

    const rows = await getSeasons(itemId);
    expect(rows.map((x) => [x.season_number, x.runtime_minutes, x.episode_count])).toEqual([
      [1, 55, 1],
      [2, 400, 2],
    ]);
  });

  test("a refresh with a failing time-to-beat request keeps the known ttb", async () => {
    const id = newId();
    stubGame(id, "Invented Quest", 54000);
    const { itemId } = await importItem("igdb", "game", id);
    await track(itemId);
    await setItem(itemId, { refreshed_at: daysAgo(8) });

    stubGame(id, "Invented Quest (Remastered)");
    igdbTtb[id] = fail(500);
    expect(await refreshStaleItems()).toMatchObject({ refreshed: 1, failed: 0 });

    expect(await getItem(itemId)).toMatchObject({
      title: "Invented Quest (Remastered)",
      ttb_hastily_s: 36000,
      ttb_normally_s: 54000,
      ttb_completely_s: 108000,
      ttb_count: 42,
    });
  });

  // ---- Purge (TMDB's 6-month cache limit) -------------------------------------

  test("provider data older than 150 days is purged, user data kept", async () => {
    const [oldShowId, oldGameId, recentShowId] = [newId(), newId(), newId()];
    stubShow(oldShowId, "Invented Old Show", [
      { n: 1, runtimes: [40] },
      { n: 2, runtimes: [45] },
    ]);
    stubGame(oldGameId, "Invented Old Game");
    stubShow(recentShowId, "Invented Recent Show", [{ n: 1, runtimes: [30] }]);
    const oldShow = await importItem("tmdb", "show", oldShowId);
    await track(oldShow.itemId);
    const oldGame = await track((await importItem("igdb", "game", oldGameId)).itemId);
    const recent = await track((await importItem("tmdb", "show", recentShowId)).itemId);

    const s = Object.fromEntries(oldShow.seasons.map((x) => [x.number, x.id]));
    const entry = await addSeasonEntry(a, s[1], { status: "finished", play_count: 2 });
    await addNote(a, entry.id, "INVENTED note kept through a purge");
    await addExclusion(a, s[2]);
    const userBefore = await userRows(a);

    await setItem(oldShow.itemId, { refreshed_at: daysAgo(151) });
    await setItem(oldGame, { refreshed_at: daysAgo(151) });
    await setItem(recent, { refreshed_at: daysAgo(149) });
    const recentBefore = await getItem(recent);
    const recentSeasonsBefore = await getSeasons(recent);

    // Every provider request fails from now on.
    tmdbRoutes = {};
    igdbGames = {};
    igdbTtb = {};

    expect(await refreshStaleItems()).toMatchObject({ refreshed: 0, failed: 3, purged: 2 });

    const purgedFields = {
      image_ref: null,
      release_date: null,
      runtime_minutes: null,
      score: null,
      score_count: null,
      ttb_hastily_s: null,
      ttb_normally_s: null,
      ttb_completely_s: null,
      ttb_count: null,
    };
    const show = await getItem(oldShow.itemId);
    expect(show).toMatchObject({ title: "Invented Old Show", ...purgedFields });
    expect(show!.provider_data_purged_at).not.toBeNull();
    const game = await getItem(oldGame);
    expect(game).toMatchObject({ title: "Invented Old Game", ...purgedFields });
    expect(game!.provider_data_purged_at).not.toBeNull();

    expect((await getSeasons(oldShow.itemId)).map((x) => [x.id, x.season_number, x.title, x.episode_count, x.runtime_minutes, x.air_date])).toEqual([
      [s[1], 1, "Season 1", null, null, null],
      [s[2], 2, "Season 2", null, null, null],
    ]);

    expect(await getItem(recent)).toEqual(recentBefore);
    expect(await getSeasons(recent)).toEqual(recentSeasonsBefore);
    expect(await userRows(a)).toEqual(userBefore);
  });

  test("a purged item comes back on a successful refresh", async () => {
    const id = newId();
    const seasons = [
      { n: 1, runtimes: [40, 40] },
      { n: 2, runtimes: [45] },
    ];
    stubShow(id, "Invented Comeback", seasons);
    const { itemId } = await importItem("tmdb", "show", id);
    await track(itemId);
    const fullItem = await getItem(itemId);
    const fullSeasons = await getSeasons(itemId);
    await setItem(itemId, { refreshed_at: daysAgo(151) });

    tmdbRoutes = {};
    expect(await refreshStaleItems()).toMatchObject({ failed: 1, purged: 1 });
    expect((await getItem(itemId))!.provider_data_purged_at).not.toBeNull();

    stubShow(id, "Invented Comeback", seasons);
    expect(await refreshStaleItems()).toMatchObject({ refreshed: 1, failed: 0, purged: 0 });

    const restored = await getItem(itemId);
    expect(restored).toMatchObject({
      title: fullItem!.title,
      image_ref: fullItem!.image_ref,
      release_date: fullItem!.release_date,
      score: fullItem!.score,
      score_count: fullItem!.score_count,
      provider_data_purged_at: null,
    });
    const pick = (rows: typeof fullSeasons) =>
      rows.map((x) => [x.id, x.season_number, x.episode_count, x.runtime_minutes, x.air_date]);
    expect(pick(await getSeasons(itemId))).toEqual(pick(fullSeasons));
  });

  // ---- Prune ---------------------------------------------------------------

  test("untracked items older than 30 days are pruned", async () => {
    const ids = { untrackedOld: newId(), tracked: newId(), excludedOnly: newId(), untrackedYoung: newId(), movieTracked: newId() };
    for (const [key, id] of Object.entries(ids)) {
      if (key === "movieTracked") stubMovie(id, `Invented ${key}`);
      else stubShow(id, `Invented ${key}`, [{ n: 1, runtimes: [30] }, { n: 2, runtimes: [30] }]);
    }
    const imp = {
      untrackedOld: await importItem("tmdb", "show", ids.untrackedOld),
      tracked: await importItem("tmdb", "show", ids.tracked),
      excludedOnly: await importItem("tmdb", "show", ids.excludedOnly),
      untrackedYoung: await importItem("tmdb", "show", ids.untrackedYoung),
      movieTracked: await importItem("tmdb", "movie", ids.movieTracked),
    };
    for (const r of Object.values(imp)) await track(r.itemId);

    await addSeasonEntry(a, imp.tracked.seasons[1].id);
    await addExclusion(a, imp.excludedOnly.seasons[0].id);
    const { error } = await a.client.from("library_entries").insert({ item_id: imp.movieTracked.itemId, item_media_type: "movie" });
    expect(error).toBeNull();

    await setItem(imp.untrackedOld.itemId, { created_at: daysAgo(31) });
    await setItem(imp.tracked.itemId, { created_at: daysAgo(31) });
    await setItem(imp.excludedOnly.itemId, { created_at: daysAgo(31) });
    await setItem(imp.movieTracked.itemId, { created_at: daysAgo(31) });
    await setItem(imp.untrackedYoung.itemId, { created_at: daysAgo(29) });
    const userBefore = await userRows(a);

    const result = await refreshStaleItems();
    expect(result.pruned).toBeGreaterThanOrEqual(1);

    expect(await getItem(imp.untrackedOld.itemId)).toBeNull();
    expect(await getSeasons(imp.untrackedOld.itemId)).toEqual([]);
    for (const kept of [imp.tracked, imp.excludedOnly, imp.untrackedYoung]) {
      expect(await getItem(kept.itemId)).not.toBeNull();
      expect(await getSeasons(kept.itemId)).toHaveLength(2);
    }
    expect(await getItem(imp.movieTracked.itemId)).not.toBeNull();
    expect(await userRows(a)).toEqual(userBefore);
  });

  // ---- Cron route ---------------------------------------------------------

  test("the cron route rejects a missing or wrong secret", async () => {
    const id = newId();
    stubMovie(id, "Invented Cron");
    const itemId = await track((await importItem("tmdb", "movie", id)).itemId);
    await setItem(itemId, { refreshed_at: daysAgo(8) });
    const before = (await getItem(itemId))!.refreshed_at;
    providerCalls.length = 0;

    const url = "http://localhost/api/cron/refresh";
    const attempts = [
      new Request(url, { method: "POST" }),
      new Request(url, { method: "POST", headers: { Authorization: "Bearer wrong-secret" } }),
      new Request(url, { method: "POST", headers: { Authorization: CRON_SECRET } }),
      new Request(url, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}x` } }),
    ];
    for (const req of attempts) {
      const res = await POST(req);
      expect(res.status).toBe(401);
    }
    expect((await getItem(itemId))!.refreshed_at).toBe(before);
    expect(providerCalls).toEqual([]);
  });

  test("the cron route rejects everything when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(
      new Request("http://localhost/api/cron/refresh", { method: "POST", headers: { Authorization: "Bearer " } }),
    );
    expect(res.status).toBe(401);
  });

  test("the cron route refreshes with the right secret, and only POST is exported", async () => {
    const id = newId();
    stubMovie(id, "Invented Cron OK");
    const itemId = await track((await importItem("tmdb", "movie", id)).itemId);
    await setItem(itemId, { refreshed_at: daysAgo(8) });
    stubMovie(id, "Invented Cron OK (Renamed)");

    const res = await POST(
      new Request("http://localhost/api/cron/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: 1, failed: 0 });
    expect((await getItem(itemId))!.title).toBe("Invented Cron OK (Renamed)");
    expect(Object.keys(cronRoute)).toEqual(["POST"]);
  });
});
