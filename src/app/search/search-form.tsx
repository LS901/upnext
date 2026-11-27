"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type ChangeEvent, type FormEvent } from "react";
import { primaryButton } from "@/app/ui";
import type { MediaType } from "@/lib/providers/types";
import { MAX_QUERY_LENGTH, parseSearch, searchHref } from "./params";

/** How long after typing stops a search starts (owner said, 2026-11-27). */
export const SEARCH_DELAY_MS = 300;

/** Typing searches on its own from this many letters; Enter searches any length. */
export const MIN_AUTO_LENGTH = 3;

const input =
  "mt-1 block w-full rounded-md border border-black/20 bg-transparent px-3 py-2 dark:border-white/20";

/** Whether the box holds a partial title: 1-2 letters, too short to search on its own. */
const partial = (text: string) => {
  const typed = text.trim();
  return typed.length > 0 && typed.length < MIN_AUTO_LENGTH;
};

/**
 * The search box. It searches as you type: SEARCH_DELAY_MS after typing stops,
 * once there are MIN_AUTO_LENGTH letters, and an empty box clears the results.
 * Enter or the Search button searches at once, at any length, and ticking a
 * Hide box (outside this form, joined by form="search") searches again at once.
 * Each search replaces the URL, so the page renders the results on the server.
 * Without JavaScript it's a plain GET form.
 *
 * `q` and `exclude` are the search on screen, from the URL. What counts as
 * "already searched" is that, or the search on its way, never a memory of what
 * this form once sent: Back, the header's Search link or an Add can change the
 * URL without it.
 */
export function SearchForm({ q, exclude }: { q: string; exclude: MediaType[] }) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = searchHref({ q, exclude });
  const onScreen = useRef({ href: shown, q });
  // The search on its way, until its transition ends.
  const inFlight = useRef<string | null>(null);
  // The last search this form sent: a new search on screen that isn't it came from elsewhere.
  const lastSent = useRef(shown);

  useEffect(() => {
    onScreen.current = { href: shown, q };
    if (shown === lastSent.current) return;
    // Back, the header link or a redirect: show that search in the form.
    lastSent.current = shown;
    cancel();
    if (box.current) box.current.value = q;
    for (const el of Array.from(form.current?.elements ?? [])) {
      if (el instanceof HTMLInputElement && el.name === "exclude") el.checked = exclude.includes(el.value as MediaType);
    }
  }, [shown, q, exclude]);

  useEffect(() => {
    if (!searching) inFlight.current = null;
  }, [searching]);

  /** The search the form describes now; with `keepQuery`, the one on screen's query. */
  function current(keepQuery = false): string {
    const data = new FormData(form.current!);
    const text = keepQuery ? onScreen.current.q : String(data.get("q") ?? "");
    return searchHref(parseSearch({ q: text, exclude: data.getAll("exclude").map(String) }));
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function send(href: string) {
    inFlight.current = href;
    lastSent.current = href;
    startSearch(() => router.replace(href, { scroll: false }));
  }

  /** Enter, the Search button or a Hide box: search now. The search on screen again re-runs it (a retry). */
  function searchNow(href: string) {
    cancel();
    if (href === inFlight.current) return;
    if (href === onScreen.current.href) startSearch(() => router.refresh());
    else send(href);
  }

  function onType(e: ChangeEvent<HTMLInputElement>) {
    cancel();
    if (partial(e.currentTarget.value)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const href = current();
      if (href !== onScreen.current.href && href !== inFlight.current) send(href);
    }, SEARCH_DELAY_MS);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    searchNow(current());
  }

  // The Hide boxes sit outside the form, so their changes don't bubble to it.
  // With a partial title in the box, they keep the search on screen's query.
  const onHide = useRef(() => {});
  useEffect(() => {
    onHide.current = () => searchNow(current(partial(box.current?.value ?? "")));
  });
  useEffect(() => {
    function onChange(e: Event) {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.name === "exclude" && el.form === form.current) onHide.current();
    }
    document.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("change", onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <form
      ref={form}
      id="search"
      action="/search"
      role="search"
      onSubmit={onSubmit}
      aria-busy={searching}
      className="flex items-end gap-3"
    >
      <label className="block flex-1">
        Search movies, TV and games
        <input
          ref={box}
          name="q"
          type="search"
          defaultValue={q}
          maxLength={MAX_QUERY_LENGTH}
          onChange={onType}
          className={input}
        />
      </label>
      <button type="submit" className={primaryButton}>
        Search
      </button>
    </form>
  );
}
