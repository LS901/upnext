import { expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubmitButton } from "./submit-button";

test("while its form's action saves, the button is marked disabled, keeps focus and ignores clicks", async () => {
  let finish!: () => void;
  const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  render(
    <form action={action}>
      <SubmitButton>Move up</SubmitButton>
    </form>,
  );
  const button = screen.getByRole("button", { name: "Move up" }) as HTMLButtonElement;
  expect(button.type).toBe("submit");
  expect(button.getAttribute("aria-disabled")).toBe("false");

  button.focus();
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
  // Not the disabled attribute: a disabled button drops its focus.
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(action).toHaveBeenCalledOnce();

  await act(async () => finish());
  await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
});

test("a button its caller disables keeps focus and sends nothing", () => {
  const action = vi.fn();
  render(
    <form action={action}>
      <SubmitButton disabled>Move to top</SubmitButton>
    </form>,
  );
  const button = screen.getByRole("button", { name: "Move to top" }) as HTMLButtonElement;
  expect(button.getAttribute("aria-disabled")).toBe("true");
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});
