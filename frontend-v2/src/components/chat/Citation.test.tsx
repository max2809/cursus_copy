import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Citation } from "./Citation";

describe("Citation", () => {
  it("calls onClick with n on click", () => {
    const spy = vi.fn();
    render(<Citation n={3} onClick={spy} />);
    fireEvent.click(screen.getByLabelText("Source 3"));
    expect(spy).toHaveBeenCalledWith(3);
  });
});
