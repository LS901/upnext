import { render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { expect, test } from "vitest";
import { EmptyState } from "./empty-state";
import { Poster } from "./poster";
import { StatTile } from "./stat-tile";
import { StatusChip } from "./status-chip";

test("a poster with no image shows the type icon and initials, and no broken img", () => {
  const { container } = render(<Poster url={null} title="Kite Ledger" size="md" mediaType="movie" />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("KL");
});

test("a poster with an image renders it decoratively", () => {
  const { container } = render(
    <Poster url="https://image.tmdb.org/t/p/w342/x.jpg" title="Kite Ledger" size="sm" mediaType="movie" />,
  );
  // R2: img[alt=""] may not be exposed as role "presentation"; query the element directly.
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  expect(img!.getAttribute("alt")).toBe("");
});

test("a stat tile shows its number, label and detail", () => {
  render(<StatTile label="Backlog" value={15} detail="about 157 h to finish" />);
  expect(screen.getByText("15")).toBeDefined();
  expect(screen.getByText("Backlog")).toBeDefined();
  expect(screen.getByText("about 157 h to finish")).toBeDefined();
});

test("a status chip always carries its text, not just a colour", () => {
  render(<StatusChip status="in_progress" />);
  expect(screen.getByText("In progress")).toBeDefined();
});

test("an empty state links to its action", () => {
  render(
    <EmptyState icon={Search} text="Nothing here yet." action={{ href: "/search", label: "Search to add something" }} />,
  );
  expect(screen.getByRole("link", { name: "Search to add something" }).getAttribute("href")).toBe("/search");
});
