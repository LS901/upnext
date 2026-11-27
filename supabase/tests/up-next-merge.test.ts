// Backlog and Up next are one queue per type (owner said, 2026-11-27): every
// Backlog entry has a place in its type's queue, always. The database owns it:
// a trigger puts a new or returning Backlog entry at the bottom of its own queue
// and clears the place when an entry leaves Backlog, and a check makes "Backlog"
// and "has a place" the same thing (Review Focus 1-3). Entries are written
// through the user's own client unless a test says otherwise.
import { execSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { setEntryStatus } from "../../src/lib/library/queries";
import { adminClient, createTestUser, deleteTestUsers, testEmail, type TestUser } from "./helpers";

vi.mock("server-only", () => ({}));

const CHECK = "library_entries_up_next_position_check";
const invented = () => String(randomInt(10_000_000, 99_999_999));

/** Runs one SQL statement as the database owner, for the DDL PostgREST can't send. */
function sql(statement: string): void {
  const dir = mkdtempSync(join(tmpdir(), "upnext-sql-"));
  const file = join(dir, "statement.sql");
  try {
    writeFileSync(file, statement);
    execSync(`npx supabase db query -f "${file}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`SQL failed: ${stdout ?? ""} ${stderr ?? ""}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("one queue per type", () => {
  let a: TestUser;
  let b: TestUser;
  const itemIds: string[] = [];
  const item: Record<string, string> = {};
  const season: Record<number, string> = {};
  const entry: Record<string, string> = {};

  const add = async (user: TestUser, key: string, row: object) => {
    const { data, error } = await user.client.from("library_entries").insert(row).select("id").single();
    if (error) throw error;
    entry[key] = data.id;
  };
  const movie = (key: string, extra: object = {}) => ({ item_id: item[key], item_media_type: "movie", ...extra });
  const positions = async (keys: string[]) => {
    const { data, error } = await adminClient()
      .from("library_entries")
      .select("id, up_next_position")
      .in("id", keys.map((k) => entry[k]));
    if (error) throw error;
    const byId = new Map(data.map((r) => [r.id, r.up_next_position]));
    return Object.fromEntries(keys.map((k) => [k, byId.get(entry[k])]));
  };
  const setStatus = async (key: string, status: "backlog" | "in_progress" | "finished" | "paused") => {
    // Only the status: the caller never sends the place.
    const { error } = await a.client.from("library_entries").update({ status }).eq("id", entry[key]);
    if (error) throw error;
  };

  beforeAll(async () => {
    const admin = adminClient();
    const movies = [1, 2, 3, 4, 5, 6].map((n) => `Invented Merge Film ${n}`);
    const { data: items, error } = await admin
      .from("items")
      .insert([
        ...movies.map((title) => ({ provider: "tmdb" as const, media_type: "movie" as const, provider_id: invented(), title })),
        { provider: "igdb", media_type: "game", provider_id: invented(), title: "Invented Merge Game" },
        { provider: "hardcover", media_type: "book", provider_id: invented(), title: "Invented Merge Book" },
        { provider: "tmdb", media_type: "show", provider_id: invented(), title: "Invented Merge Show" },
      ])
      .select("id, title");
    if (error) throw error;
    itemIds.push(...items.map((i) => i.id));
    const byTitle = new Map(items.map((i) => [i.title, i.id]));
    movies.forEach((t, n) => (item[`m${n + 1}`] = byTitle.get(t)!));
    item.game = byTitle.get("Invented Merge Game")!;
    item.book = byTitle.get("Invented Merge Book")!;
    item.show = byTitle.get("Invented Merge Show")!;

    const { data: seasons, error: seasonsError } = await admin
      .from("seasons")
      .insert([1, 2].map((n) => ({ show_id: item.show, season_number: n })))
      .select("id, season_number");
    if (seasonsError) throw seasonsError;
    for (const s of seasons) season[s.season_number] = s.id;

    a = await createTestUser("merge-a");
    b = await createTestUser("merge-b");
    // b's library is public (the default), so a's client can read b's queue.
    for (const m of ["m1", "m2", "m3", "m4", "m5"]) await add(b, `b${m}`, movie(m));
  });

  afterAll(async () => {
    await deleteTestUsers([a, b].filter(Boolean));
    if (itemIds.length) await adminClient().from("items").delete().in("id", itemIds);
  });

  test("a new Backlog entry goes to the bottom of its queue; the first in an empty queue gets 1", async () => {
    await add(a, "m1", movie("m1"));
    expect(await positions(["m1"])).toEqual({ m1: 1 });
    await add(a, "m2", movie("m2", { status: "backlog" }));
    expect(await positions(["m1", "m2"])).toEqual({ m1: 1, m2: 2 });
  });

  test("a movie, a game, a print book, an audio book and a season each go to the bottom of their own queue", async () => {
    await add(a, "game", { item_id: item.game, item_media_type: "game" });
    await add(a, "print", { item_id: item.book, item_media_type: "book", book_version: "print" });
    await add(a, "audio", { item_id: item.book, item_media_type: "book", book_version: "audio" });
    await add(a, "s1", { season_id: season[1] });
    await add(a, "m3", movie("m3"));
    // Games, Books and TV start their own queues; print and audio share Books.
    expect(await positions(["m1", "m2", "m3", "game", "print", "audio", "s1"])).toEqual({
      m1: 1,
      m2: 2,
      m3: 3,
      game: 1,
      print: 1,
      audio: 2,
      s1: 1,
    });
  });

  test("another user's queue never changes your place, and yours never changes theirs", async () => {
    // b has five movies queued, a has three: a's next is 4, not 6.
    await add(a, "m4", movie("m4"));
    expect(await positions(["m4"])).toEqual({ m4: 4 });
    expect(await positions(["bm1", "bm2", "bm3", "bm4", "bm5"])).toEqual({ bm1: 1, bm2: 2, bm3: 3, bm4: 4, bm5: 5 });
  });

  test("an entry coming back to Up next goes to the bottom; leaving clears its place without the caller sending it", async () => {
    await add(a, "m5", movie("m5", { status: "paused" }));
    expect(await positions(["m5"])).toEqual({ m5: null });
    await setStatus("m5", "backlog"); // Paused back to Up next
    expect(await positions(["m5"])).toEqual({ m5: 5 });

    await setStatus("m1", "in_progress");
    expect(await positions(["m1"])).toEqual({ m1: null });
    await setStatus("m1", "finished");
    expect(await positions(["m1"])).toEqual({ m1: null });
    await setStatus("m1", "backlog"); // Finished back to Up next: the bottom, not its old place
    expect(await positions(["m1"])).toEqual({ m1: 6 });

    // Staying in Up next keeps the place.
    await setStatus("m3", "backlog");
    expect(await positions(["m3"])).toEqual({ m3: 3 });

    // The app's own status change sends only the status too.
    await setEntryStatus(a.client, a.id, entry.m2, "dropped");
    expect(await positions(["m2"])).toEqual({ m2: null });
    await setEntryStatus(a.client, a.id, entry.m2, "backlog");
    expect(await positions(["m2"])).toEqual({ m2: 7 });
  });

  test("an Up next entry's place can't be cleared directly (23514)", async () => {
    const own = await a.client.from("library_entries").update({ up_next_position: null }).eq("id", entry.m3);
    expect(own.error?.code).toBe("23514");
    const admin = await adminClient().from("library_entries").update({ up_next_position: null }).eq("id", entry.m3);
    expect(admin.error?.code).toBe("23514");
    expect(await positions(["m3"])).toEqual({ m3: 3 });
  });

  test("an admin insert into Up next also gets the bottom place", async () => {
    const { data, error } = await adminClient()
      .from("library_entries")
      .insert({ user_id: a.id, item_id: item.m6, item_media_type: "movie", status: "backlog" })
      .select("id")
      .single();
    if (error) throw error;
    entry.m6 = data.id;
    expect(await positions(["m6"])).toEqual({ m6: 8 });
  });

  test("the backfill appends unqueued Backlog entries after the queued ones, oldest first, per queue", async () => {
    const admin = adminClient();
    const { data: created, error } = await admin.auth.admin.createUser({ email: testEmail("merge-c"), email_confirm: true });
    if (error || !created.user) throw error ?? new Error("createUser returned no user");
    const c = created.user.id;
    for (const key of ["q1", "q2", "older", "newer", "cgame"]) entry[key] = randomUUID();
    const row = (key: string, itemKey: string, type: string, position: number | null, createdAt: string) =>
      `('${entry[key]}', '${c}', '${item[itemKey]}', '${type}', 'backlog', ${position ?? "null"}, '${createdAt}')`;

    // Data from before the merge: Backlog entries with no place. Only possible
    // with the trigger off and the check lifted, all in one statement; the
    // check comes back at once, unvalidated, so it still guards every new write.
    sql(`do $$ begin
      alter table public.library_entries drop constraint ${CHECK};
      alter table public.library_entries disable trigger library_entries_queue_backlog;
      insert into public.library_entries (id, user_id, item_id, item_media_type, status, up_next_position, created_at)
      values ${[
        row("newer", "m4", "movie", null, "2026-01-03T00:00:00Z"),
        row("q2", "m2", "movie", 2, "2026-01-05T00:00:00Z"),
        row("older", "m3", "movie", null, "2026-01-02T00:00:00Z"),
        row("q1", "m1", "movie", 1, "2026-01-01T00:00:00Z"),
        row("cgame", "game", "game", null, "2026-01-04T00:00:00Z"),
      ].join(", ")};
      alter table public.library_entries enable trigger library_entries_queue_backlog;
      alter table public.library_entries add constraint ${CHECK}
        check ((status = 'backlog') = (up_next_position is not null)) not valid;
    end $$`);
    try {
      expect(await positions(["q1", "q2", "older", "newer", "cgame"])).toEqual({
        q1: 1,
        q2: 2,
        older: null,
        newer: null,
        cgame: null,
      });

      // Users can't run it; only the migration (and the service role) can.
      const refused = await a.client.rpc("backfill_up_next");
      expect(refused.error).not.toBeNull();

      const { error: backfillError } = await admin.rpc("backfill_up_next");
      if (backfillError) throw backfillError;
      expect(await positions(["q1", "q2", "older", "newer", "cgame"])).toEqual({
        q1: 1,
        q2: 2,
        older: 3,
        newer: 4,
        cgame: 1,
      });
      // Users already in one queue are untouched.
      expect(await positions(["m3", "m4", "bm5"])).toEqual({ m3: 3, m4: 4, bm5: 5 });
    } finally {
      // Gone first, so the check validates even if the backfill failed.
      await admin.auth.admin.deleteUser(c);
      sql(`alter table public.library_entries validate constraint ${CHECK}`);
    }
  }, 60_000); // each SQL statement goes through the Supabase CLI, which takes seconds
});
