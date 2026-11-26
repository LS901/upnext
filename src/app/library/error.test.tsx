import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LibraryError from "./error";
import { RemoveButton } from "./remove-button";

test("the error page explains and offers Reload, which retries the page", () => {
  const retry = vi.fn();
  render(<LibraryError error={new Error("boom")} retry={retry} />);
  expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeDefined();
  expect(screen.getByText("That change didn't save. Reload the page and try again.")).toBeDefined();
  expect(screen.queryByText("boom")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(retry).toHaveBeenCalledOnce();
});

test("Remove is a submit button, enabled while nothing is saving", () => {
  render(
    <form>
      <RemoveButton />
    </form>,
  );
  const button = screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement;
  expect(button.type).toBe("submit");
  expect(button.disabled).toBe(false);
});
