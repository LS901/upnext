import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

function renderForm(q = "", exclude: string[] = []) {
  render(
    <>
      <SearchForm q={q} exclude={exclude as never} />
      {/* The Hide boxes live outside the form and join it through form="search". */}
      <input type="checkbox" name="exclude" value="game" form="search" aria-label="Games" defaultChecked={exclude.includes("game")} />
    </>,
  );
  return screen.getByLabelText("Search movies, TV and games") as HTMLInputElement;
}

/** Types one character at a time, `gap` ms apart, as a person would. */
function type(box: HTMLInputElement, text: string, gap = 100) {
  for (const char of text) {
    fireEvent.change(box, { target: { value: box.value + char } });
    act(() => vi.advanceTimersByTime(gap));
  }
}

test("searches 300 ms after typing stops, once there are 3 letters", () => {
  const box = renderForm();
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
  const box = renderForm();
  type(box, "kestrel", 80);
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=kestrel", { scroll: false });
});

test("emptying the box clears the results; one or two letters leave them", () => {
  const box = renderForm("kestrel");
  fireEvent.change(box, { target: { value: "ke" } });
  act(() => vi.advanceTimersByTime(1000));
  expect(router.replace).not.toHaveBeenCalled();

  fireEvent.change(box, { target: { value: "   " } });
  act(() => vi.advanceTimersByTime(300));
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search", { scroll: false });
});

test("Enter searches at once, even a short title, and cancels the pending search", () => {
  const box = renderForm();
  type(box, "kes", 0);
  fireEvent.change(box, { target: { value: "It" } });
  fireEvent.submit(box.form!);
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/search?q=It", { scroll: false });
  act(() => vi.advanceTimersByTime(1000));
  expect(router.replace).toHaveBeenCalledOnce();
});

test("a search already sent isn't sent again by the timer; Enter on it re-runs it", () => {
  const box = renderForm("kestrel");
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
