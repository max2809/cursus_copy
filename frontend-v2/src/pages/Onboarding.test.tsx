import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding";

const mocks = vi.hoisted(() => ({
  submitPat: vi.fn(),
}));

vi.mock("../api/queries", () => ({
  useSubmitPat: () => ({
    mutateAsync: mocks.submitPat,
    isPending: false,
  }),
}));

describe("Onboarding", () => {
  beforeEach(() => {
    mocks.submitPat.mockReset();
    mocks.submitPat.mockResolvedValue({ ok: true });
  });

  it("submits the Canvas domain with the PAT", async () => {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/canvas url or domain/i), {
      target: { value: "canvas.other.edu" },
    });
    fireEvent.change(screen.getByLabelText(/canvas token/i), {
      target: { value: "7289~token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /connect and sync/i }));

    await waitFor(() => {
      expect(mocks.submitPat).toHaveBeenCalledWith({
        pat: "7289~token",
        canvas_base_url: "canvas.other.edu",
      });
    });
  });
});
