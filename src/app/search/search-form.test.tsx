import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MediaType } from "@/lib/providers/types";
import { SearchForm } from "./search-form";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.useFakeTimers();
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The form as the page renders it for a URL; `show` re-renders it for another URL (a navigation). */
function renderForm(q = "", exclude: MediaType[] = []) {
  const page = (q: string, exclude: MediaType[]) => (
    <>
      <SearchForm q={q} exclude={exclude} />
      {/* The Hide boxes live outside the form and join it through form="search". */}
      <input type="checkbox" name="exclude" value="game" form="search" aria-label="Games" defaultChecked={exclude.includes("game")} />
    </>
  );
  const { rerender } = render(page(q, exclude));
  const box = screen.getByLabelText("Search movies, TV, games and books") as HTMLInputElement;
  return { box, show: (q: string, exclude: MediaType[] = []) => rerender(page(q, exclude)) };
}

/** Types one character at a time, `gap` ms apart, as a person would. */
function type(box: HTMLInputElement, text: string, gap = 100) {
  for (const char of text) {
    fireEvent.change(box, { target: { value: box.value + char } });
    act(() => vi.advanceTimersByTime(gap));
  }
}

test("searches 300 ms after typing stops, once there are 3 letters", () => {
  const { box } = renderForm();
  type(box, "ki");
  act(() => vi.advanceTimersByTime(1000));
  expect(router.replace).not.toHaveBeenCalled();

  type(box, "t", 0);
  act(() => vi.advanceTimersByTime(299));
  expect(router.replace).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kit", { scroll: false });
});

test("fast typing sends one search, for the whole word", () => {
  const { box } = renderForm();
  type(box, "kestrel", 80);
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel", { scroll: false });
});

test("emptying the box clears the results; one or two letters leave them", () => {
  const { box } = renderForm("kestrel");
  fireEvent.change(box, { target: { value: "ke" } });
  act(() => vi.advanceTimersByTime(1000));
  expect(router.replace).not.toHaveBeenCalled();

  fireEvent.change(box, { target: { value: "   " } });
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search", { scroll: false });
});

test("Enter searches at once, cancelling the search the pause would have sent", () => {
  const { box } = renderForm();
  type(box, "kes", 0);
  fireEvent.submit(box.form!);
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kes", { scroll: false });
  act(() => vi.advanceTimersByTime(1000));
  expect(router.replace).toHaveBeenCalledOnce();
});

test("Enter searches a title shorter than three letters", () => {
  const { box } = renderForm();
  fireEvent.change(box, { target: { value: "It" } });
  fireEvent.submit(box.form!);
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=It", { scroll: false });
});

test("the search on screen isn't sent again by the timer; Enter on it re-runs it", () => {
  const { box } = renderForm("kestrel");
  type(box, "s", 0);
  fireEvent.change(box, { target: { value: "kestrel" } });
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).not.toHaveBeenCalled();

  // A retry, such as after "Couldn't reach TMDB right now."
  fireEvent.submit(box.form!);
  expect(router.refresh).toHaveBeenCalledOnce();
  expect(router.replace).not.toHaveBeenCalled();
});

test("ticking a Hide box searches again at once", () => {
  renderForm("kestrel");
  fireEvent.click(screen.getByLabelText("Games"));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel&exclude=game", { scroll: false });
});

test("ticking a Hide box with one or two letters in the box keeps the search on screen", () => {
  const { box } = renderForm("kestrel");
  fireEvent.change(box, { target: { value: "ke" } });
  fireEvent.click(screen.getByLabelText("Games"));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel&exclude=game", { scroll: false });
});

test("after Back to an earlier search, the box shows it, and what's typed next is searched", () => {
  const { box, show } = renderForm("kes");
  type(box, "trel", 0);
  act(() => vi.advanceTimersByTime(300));
  show("kestrel");
  router.replace.mockClear();

  show("kes"); // Back
  expect(box.value).toBe("kes");
  type(box, "trel", 0);
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel", { scroll: false });
});

test("after the header's Search link empties the page, the same title can be searched again", () => {
  const { box, show } = renderForm("kestrel");
  show(""); // The header link: /search, no results
  expect(box.value).toBe("");
  type(box, "kestrel", 0);
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel", { scroll: false });
});

test("an older search landing while a newer one is on its way never resets the box", () => {
  // Searches stay on their way until the test lets them land.
  router.replace.mockImplementation(() => new Promise<void>(() => {}));
  const { box, show } = renderForm();
  type(box, "kest", 0);
  act(() => vi.advanceTimersByTime(300)); // sent
  type(box, "rel", 0);
  act(() => vi.advanceTimersByTime(300)); // sent too
  type(box, " m", 0); // still typing
  show("kest"); // the older search's results land first
  expect(box.value).toBe("kestrel m");
});

test("typing back to the search on screen while another is on its way searches it again", () => {
  router.replace.mockImplementation(() => new Promise<void>(() => {}));
  const { box } = renderForm("kestrel");
  type(box, "s", 0);
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenLastCalledWith("/search?q=kestrels", { scroll: false });

  fireEvent.change(box, { target: { value: "kestrel" } });
  act(() => vi.advanceTimersByTime(300));
  // Otherwise "kestrels" would land under a box that says "kestrel".
  expect(router.replace).toHaveBeenLastCalledWith("/search?q=kestrel", { scroll: false });
  expect(router.replace).toHaveBeenCalledTimes(2);
});

test("results arriving while you keep typing never overwrite the box", () => {
  const { box, show } = renderForm();
  type(box, "kestrel", 0);
  act(() => vi.advanceTimersByTime(300));
  type(box, " m", 0);
  show("kestrel"); // this form's own search comes back
  expect(box.value).toBe("kestrel m");
});
