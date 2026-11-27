import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RootError from "./error";

test("the error page explains and offers Reload, which retries the page", () => {
  const retry = vi.fn();
  render(<RootError error={new Error("boom")} retry={retry} />);
  expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeDefined();
  expect(screen.getByText("That change didn't save. Reload the page and try again.")).toBeDefined();
  expect(screen.queryByText("boom")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(retry).toHaveBeenCalledOnce();
});
