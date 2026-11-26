import { expect, test, vi } from "vitest";
import { fetchAll, fetchAllIn, IN_CHUNK, PAGE_SIZE } from "./fetch-all";

const rows = (n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i);

test("fetchAll pages until a short page comes back", async () => {
  const total = PAGE_SIZE * 2 + 5;
  const page = vi.fn(async (from: number, to: number) => ({
    data: rows(Math.max(0, Math.min(to, total - 1) - from + 1), from),
    error: null,
  }));
  expect(await fetchAll(page)).toEqual(rows(total));
  expect(page.mock.calls).toEqual([
    [0, PAGE_SIZE - 1],
    [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
  ]);
});

test("fetchAll asks once more after an exactly full page", async () => {
  const page = vi.fn(async (from: number) => ({ data: from === 0 ? rows(PAGE_SIZE) : [], error: null }));
  expect(await fetchAll(page)).toHaveLength(PAGE_SIZE);
  expect(page).toHaveBeenCalledTimes(2);
});

test("fetchAll throws the query's error", async () => {
  const error = { name: "PostgrestError", message: "URI too long" } as never;
  await expect(fetchAll(async () => ({ data: null, error }))).rejects.toBe(error);
});

test("fetchAllIn sends at most IN_CHUNK distinct ids per request", async () => {
  const ids = rows(IN_CHUNK * 2 + 1).map(String);
  const page = vi.fn(async (chunk: string[]) => ({ data: chunk, error: null }));
  expect((await fetchAllIn([...ids, ...ids], page)).sort()).toEqual([...ids].sort());
  expect(page.mock.calls.map(([chunk]) => chunk.length)).toEqual([IN_CHUNK, IN_CHUNK, 1]);
});

test("fetchAllIn makes no request for no ids", async () => {
  const page = vi.fn();
  expect(await fetchAllIn([], page)).toEqual([]);
  expect(page).not.toHaveBeenCalled();
});
