import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownWithCites } from "./MarkdownWithCites";

describe("MarkdownWithCites", () => {
  it("normalizes markdown headings for chat bubbles", () => {
    render(
      <MarkdownWithCites
        content={"# Main answer\n\n## Detail title\n\n### Small title"}
        onCiteClick={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Main answer" }))
      .toHaveClass("bubble-heading", "bubble-heading-1");
    expect(screen.getByRole("heading", { level: 2, name: "Detail title" }))
      .toHaveClass("bubble-heading", "bubble-heading-2");
    expect(screen.getByRole("heading", { level: 3, name: "Small title" }))
      .toHaveClass("bubble-heading", "bubble-heading-3");
  });
});
