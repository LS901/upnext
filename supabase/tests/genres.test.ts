// Genres on catalogue items (filled by the import and by the refresh, cleared by
// the purge) and a user's genre pins, which only their owner can read or write
// (INV-001, INV-002). Provider HTTP is stubbed; nothing reaches a real provider.
import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test, vi } from "vitest";
import { importItem } from "../../src/lib/catalogue/import";
import { refreshStaleItems } from "../../src/lib/catalogue/refresh";
import { resetHardcoverLimiterForTests } from "../../src/lib/providers/hardcover";
import { resetIgdbTokenForTests } from "../../src/lib/providers/igdb";
import { getGenreEntries, getPins } from "../../src/lib/recommendations/library";
import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const TMDB = "http://tmdb.test/3";
const IGDB = "http://igdb.test/v4";
const HARDCOVER = "http://hardcover.test/v1/graphql";
const TWITCH = "http://twitch.test/oauth2/token";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

let tmdbRoutes: Record<string, unknown> = {};
let igdbGames: Record<string, unknown> = {};
let hardcoverBooks: Record<string, unknown> = {};
const realFetch = globalThis.fetch;

function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === new URL(inject("supabase").url).origin) return realFetch(input, init);
  const reply = (body: unknown) =>
    Promise.resolve(body === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(body)));
  if (url.href.startsWith(TWITCH)) return reply({ access_token: "tok", expires_in: 3600 });
  if (url.href.startsWith(TMDB)) return reply(tmdbRoutes[url.pathname.replace(/^\/3/, "")]);
  if (url.href.startsWith(IGDB)) {
    if (url.pathname.endsWith("/game_time_to_beats")) return reply([]);
    const id = String(init?.body).match(/where id = (\d+);/)?.[1] ?? "";
    return reply(igdbGames[id]);
  }
  if (url.href.startsWith(HARDCOVER)) {
    const id = String(init?.body).match(/books_by_pk\(id: (\d+)\)/)?.[1] ?? "";
    return reply(hardcoverBooks[id]);
  }
  return Promise.reject(new Error(`unexpected request to ${url.host}`));
}

const newId = () => String(randomInt(60_000_000, 69_999_999));

describe("genres", () => {
  let owner: TestUser;
  let other: TestUser;
  const made: string[] = [];

  beforeAll(async () => {
    owner = await createTestUser("genres-owner");
    other = await createTestUser("genres-other");
  });

  beforeEach(async () => {
    tmdbRoutes = {};
    igdbGames = {};
    hardcoverBooks = {};
    resetIgdbTokenForTests();
    resetHardcoverLimiterForTests();
    const { url, serviceRoleKey } = inject("supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
    vi.stubEnv("TMDB_API_BASE_URL", TMDB);
    vi.stubEnv("IGDB_API_BASE_URL", IGDB);
    vi.stubEnv("TWITCH_TOKEN_URL", TWITCH);
    vi.stubEnv("HARDCOVER_API_URL", HARDCOVER);
    vi.stubEnv("TMDB_API_READ_ACCESS_TOKEN", "tmdb-token");
    vi.stubEnv("IGDB_CLIENT_ID", "igdb-cid");
    vi.stubEnv("IGDB_CLIENT_SECRET", "igdb-csecret");
    vi.stubEnv("HARDCOVER_API_TOKEN", "hardcover-token");
    vi.stubGlobal("fetch", providerFetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    const admin = adminClient();
    for (const u of [owner, other]) {
      await admin.from("user_genre_pins").delete().eq("user_id", u.id);
      await admin.from("library_entries").delete().eq("user_id", u.id);
    }
    await admin.from("profiles").update({ library_private: false }).in("id", [owner.id, other.id]);
    if (made.length) await admin.from("items").delete().in("id", made.splice(0));
  });

  afterAll(async () => {
    await deleteTestUsers([owner, other].filter(Boolean));
  });

  /** Only this test's items may be stale or old, so the refresh touches nothing else (see import-and-refresh). */
  async function onlyOursAreOld() {
    const admin = adminClient();
    const now = new Date().toISOString();
    expect((await admin.from("items").update({ refreshed_at: now }).lt("refreshed_at", daysAgo(1))).error).toBeNull();
    expect((await admin.from("items").update({ created_at: now }).lt("created_at", daysAgo(1))).error).toBeNull();
  }

  async function genresOf(itemId: string) {
    const { data, error } = await adminClient().from("items").select("genres").eq("id", itemId).single();
    expect(error).toBeNull();
    return data!.genres;
  }

  async function catalogueItem(row: { media_type: "movie" | "game" | "book" | "show"; genres: string[]; title: string }) {
    const provider = { movie: "tmdb", show: "tmdb", game: "igdb", book: "hardcover" }[row.media_type] as "tmdb" | "igdb" | "hardcover";
    const { data, error } = await adminClient()
      .from("items")
      .insert({ provider, provider_id: newId(), ...row })
      .select("id")
      .single();
    expect(error).toBeNull();
    made.push(data!.id);
    return data!.id;
  }

  // ---- items.genres ------------------------------------------------------------

  test("a new item has no genres, never null", async () => {
    const id = await catalogueItem({ media_type: "movie", genres: [], title: "Invented Genreless Film" });
    expect(await genresOf(id)).toEqual([]);
    const { error } = await adminClient().from("items").update({ genres: null as unknown as string[] }).eq("id", id);
    expect(error?.code).toBe("23502");
  });

  test("the import stores genres from TMDB, IGDB and Hardcover", async () => {
    const movieId = newId();
    tmdbRoutes[`/movie/${movieId}`] = {
      id: Number(movieId),
      title: "Invented Marsh Light",
      genres: [{ id: 27, name: "Horror" }, { id: 53, name: "Thriller" }],
    };
    const gameId = newId();
    igdbGames[gameId] = [{ id: Number(gameId), name: "Invented Cog Garden", genres: [{ id: 9, name: "Puzzle" }] }];
    const bookId = newId();
    hardcoverBooks[bookId] = {
      data: {
        books_by_pk: {
          id: Number(bookId),
          title: "Invented Paper Fox",
          cached_tags: { Genre: [{ tag: "Fantasy" }, { tag: "Mystery" }], Mood: [{ tag: "cosy" }] },
          book_series: [],
        },
      },
    };

    const movie = await importItem("tmdb", "movie", movieId);
    const game = await importItem("igdb", "game", gameId);
    const book = await importItem("hardcover", "book", bookId);
    made.push(movie.itemId, game.itemId, book.itemId);

    expect(await genresOf(movie.itemId)).toEqual(["Horror", "Thriller"]);
    expect(await genresOf(game.itemId)).toEqual(["Puzzle"]);
    expect(await genresOf(book.itemId)).toEqual(["Fantasy", "Mystery"]);
  });

  test("the refresh fills the genres of an item imported before genres existed", async () => {
    await onlyOursAreOld();
    const movieId = newId();
    const { data, error } = await adminClient()
      .from("items")
      .insert({
        provider: "tmdb",
        media_type: "movie",
        provider_id: movieId,
        title: "Invented Old Reel",
        refreshed_at: "1990-01-01T00:00:00Z",
        refresh_attempted_at: null,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    made.push(data!.id);
    tmdbRoutes[`/movie/${movieId}`] = { id: Number(movieId), title: "Invented Old Reel", genres: [{ id: 35, name: "Comedy" }] };

    const result = await refreshStaleItems({ limit: 1 });
    expect(result.refreshed).toBe(1);
    expect(await genresOf(data!.id)).toEqual(["Comedy"]);
  });

  test("the purge clears genres with the other provider data", async () => {
    await onlyOursAreOld();
    const { data, error } = await adminClient()
      .from("items")
      .insert({
        provider: "tmdb",
        media_type: "movie",
        provider_id: newId(),
        title: "Invented Faded Print",
        genres: ["Drama"],
        refreshed_at: daysAgo(200),
        refresh_attempted_at: daysAgo(200),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    made.push(data!.id);
    // Its refresh fails (no stub route), so the purge takes it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await refreshStaleItems({ limit: 1 });
    expect(await genresOf(data!.id)).toEqual([]);
  });

  // ---- user_genre_pins -----------------------------------------------------------

  test("a user pins, reads and removes their own genres", async () => {
    const add = await owner.client.from("user_genre_pins").insert([
      { media_type: "show", genre: "Comedy" },
      { media_type: "movie", genre: "Horror" },
    ]);
    expect(add.error).toBeNull();
    expect((await getPins(owner.client, owner.id)).map((p) => [p.mediaType, p.genre])).toEqual([
      ["show", "Comedy"],
      ["movie", "Horror"],
    ]);

    const removed = await owner.client.from("user_genre_pins").delete().eq("media_type", "show").eq("genre", "Comedy").select();
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    expect((await getPins(owner.client, owner.id)).map((p) => p.genre)).toEqual(["Horror"]);
  });

  test("pins are private: a second user and anon see none, even with a public library", async () => {
    expect((await owner.client.from("user_genre_pins").insert({ media_type: "movie", genre: "Horror" })).error).toBeNull();

    const seenByOther = await other.client.from("user_genre_pins").select("*").eq("user_id", owner.id);
    expect(seenByOther.error).toBeNull();
    expect(seenByOther.data).toEqual([]);
    expect(await getPins(other.client, owner.id)).toEqual([]);

    const seenByAnon = await anonClient().from("user_genre_pins").select("*").eq("user_id", owner.id);
    expect(seenByAnon.data ?? []).toEqual([]);
  });

  test("nobody writes another user's pins, and anon writes none", async () => {
    const forOwner = await other.client.from("user_genre_pins").insert({ user_id: owner.id, media_type: "movie", genre: "Horror" });
    expect(forOwner.error?.code).toBe("42501");

    expect((await owner.client.from("user_genre_pins").insert({ media_type: "movie", genre: "Comedy" })).error).toBeNull();
    const deleted = await other.client.from("user_genre_pins").delete().eq("user_id", owner.id).select();
    expect(deleted.data ?? []).toEqual([]);
    expect(await getPins(owner.client, owner.id)).toHaveLength(1);

    const anon = await anonClient().from("user_genre_pins").insert({ user_id: owner.id, media_type: "movie", genre: "Drama" });
    expect(anon.error).not.toBeNull();
  });

  test("a pin is one genre of a provider type, 1 to 60 characters, once", async () => {
    const pin = (media_type: "movie" | "other", genre: string) => owner.client.from("user_genre_pins").insert({ media_type, genre });
    expect((await pin("movie", "")).error?.code).toBe("23514");
    expect((await pin("movie", "x".repeat(61))).error?.code).toBe("23514");
    expect((await pin("other", "Horror")).error?.code).toBe("23514");
    expect((await pin("movie", "x".repeat(60))).error).toBeNull();
    expect((await pin("movie", "Horror")).error).toBeNull();
    expect((await pin("movie", "Horror")).error?.code).toBe("23505");
  });

  // ---- The library's genres --------------------------------------------------------

  test("the library's genres are the user's own, one per item; a show counts once however many seasons", async () => {
    const film = await catalogueItem({ media_type: "movie", genres: ["Horror"], title: "Invented Damp Cellar" });
    const show = await catalogueItem({ media_type: "show", genres: ["Comedy"], title: "Invented Flat Share" });
    const { data: seasons, error } = await adminClient()
      .from("seasons")
      .insert([1, 2, 3].map((n) => ({ show_id: show, season_number: n })))
      .select("id");
    expect(error).toBeNull();
    const othersFilm = await catalogueItem({ media_type: "movie", genres: ["Western"], title: "Invented Dust Road" });

    expect((await owner.client.from("library_entries").insert({ item_id: film, item_media_type: "movie", status: "finished" })).error).toBeNull();
    expect(
      (await owner.client.from("library_entries").insert([
        { season_id: seasons![0].id, status: "dropped" },
        { season_id: seasons![1].id, status: "backlog" },
        { season_id: seasons![2].id, status: "backlog" },
      ])).error,
    ).toBeNull();
    // Another user's public entry is readable by the owner's client, but never theirs.
    expect((await other.client.from("library_entries").insert({ item_id: othersFilm, item_media_type: "movie" })).error).toBeNull();

    const entries = await getGenreEntries(owner.client, owner.id);
    expect(entries.sort((a, b) => a.mediaType.localeCompare(b.mediaType))).toEqual([
      { mediaType: "movie", genres: ["Horror"], status: "finished" },
      // Not every season is Dropped, so the show still counts.
      { mediaType: "show", genres: ["Comedy"], status: "backlog" },
    ]);
  });

  test("a show whose every season is Dropped counts as Dropped", async () => {
    const show = await catalogueItem({ media_type: "show", genres: ["Crime"], title: "Invented Night Desk" });
    const { data: seasons } = await adminClient()
      .from("seasons")
      .insert([1, 2].map((n) => ({ show_id: show, season_number: n })))
      .select("id");
    expect(
      (await owner.client.from("library_entries").insert(seasons!.map((s) => ({ season_id: s.id, status: "dropped" as const })))).error,
    ).toBeNull();
    expect(await getGenreEntries(owner.client, owner.id)).toEqual([{ mediaType: "show", genres: ["Crime"], status: "dropped" }]);
  });
});
