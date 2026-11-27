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

/**
 * The search box. It searches as you type: SEARCH_DELAY_MS after typing stops,
 * once there are MIN_AUTO_LENGTH letters, and an empty box clears the results.
 * Enter or the Search button searches at once, at any length, and ticking a
 * Hide box (outside this form, joined by form="search") searches again at once.
 * Each search replaces the URL, so the page renders the results on the server.
 * Without JavaScript it's a plain GET form.
 */
export function SearchForm({ q, exclude }: { q: string; exclude: MediaType[] }) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The search on screen, or on its way. The timer never sends it again.
  const sent = useRef(searchHref({ q, exclude }));

  function current(): string {
    const data = new FormData(form.current!);
    return searchHref(parseSearch({ q: String(data.get("q") ?? ""), exclude: data.getAll("exclude").map(String) }));
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function send(href: string) {
    sent.current = href;
    startSearch(() => router.replace(href, { scroll: false }));
  }

  /** Enter, the Search button or a Hide box: search now. The same search again re-runs it (a retry). */
  function searchNow() {
    cancel();
    const href = current();
    if (href !== sent.current) send(href);
    else if (!searching) startSearch(() => router.refresh());
  }

  function onType(e: ChangeEvent<HTMLInputElement>) {
    cancel();
    const typed = e.currentTarget.value.trim();
    if (typed.length > 0 && typed.length < MIN_AUTO_LENGTH) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const href = current();
      if (href !== sent.current) send(href);
    }, SEARCH_DELAY_MS);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    searchNow();
  }

  // The Hide boxes sit outside the form, so their changes don't bubble to it.
  const searchNowRef = useRef(searchNow);
  useEffect(() => {
    searchNowRef.current = searchNow;
  });
  useEffect(() => {
    function onHide(e: Event) {
      const box = e.target;
      if (box instanceof HTMLInputElement && box.name === "exclude" && box.form === form.current) {
        searchNowRef.current();
      }
    }
    document.addEventListener("change", onHide);
    return () => {
      document.removeEventListener("change", onHide);
      cancel();
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
        <input name="q" type="search" defaultValue={q} maxLength={MAX_QUERY_LENGTH} onChange={onType} className={input} />
      </label>
      <button type="submit" className={primaryButton}>
        Search
      </button>
    </form>
  );
}
