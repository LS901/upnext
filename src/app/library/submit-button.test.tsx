import { expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubmitButton } from "./submit-button";

test("a submit button is disabled while its form's action saves, so a double-click sends one change", async () => {
  let finish!: () => void;
  const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  render(
    <form action={action}>
      <SubmitButton>Move up</SubmitButton>
    </form>,
  );
  const button = screen.getByRole("button", { name: "Move up" }) as HTMLButtonElement;
  expect(button.type).toBe("submit");
  expect(button.disabled).toBe(false);

  fireEvent.click(button);
  await waitFor(() => expect(button.disabled).toBe(true));
  fireEvent.click(button);
  expect(action).toHaveBeenCalledOnce();

  await act(async () => finish());
  await waitFor(() => expect(button.disabled).toBe(false));
});

test("a button its caller disables stays disabled", () => {
  render(
    <form>
      <SubmitButton disabled>Move to top</SubmitButton>
    </form>,
  );
  expect((screen.getByRole("button", { name: "Move to top" }) as HTMLButtonElement).disabled).toBe(true);
});
