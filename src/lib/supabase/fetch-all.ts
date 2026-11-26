import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Rows per page. PostgREST returns at most `max_rows` rows a request (1000 in
 * supabase/config.jsonc, and on hosted Supabase by default) and says nothing
 * when it cuts a result short, so this must not exceed it.
 */
export const PAGE_SIZE = 1000;

/** Ids per `.in()` filter, so the request URL stays well under the server's limit. */
export const IN_CHUNK = 100;

type Page<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

/**
 * Every row of a query, fetched a page at a time until a short page comes
 * back. `page(from, to)` must apply `.range(from, to)` to a query with a
 * stable `.order()`, or rows can repeat or go missing between pages.
 */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Every row of a query filtered with `.in()` over `ids`: the ids go
 * IN_CHUNK at a time, and each chunk is paged as in fetchAll.
 */
export async function fetchAllIn<T>(
  ids: readonly string[],
  page: (chunk: string[], from: number, to: number) => Page<T>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks = Array.from({ length: Math.ceil(unique.length / IN_CHUNK) }, (_, i) =>
    unique.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK),
  );
  const parts = await Promise.all(chunks.map((chunk) => fetchAll((from, to) => page(chunk, from, to))));
  return parts.flat();
}
