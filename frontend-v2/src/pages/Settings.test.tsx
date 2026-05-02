import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

const mocks = vi.hoisted(() => ({
  submitPat: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../api/queries", () => ({
  useAccount: () => ({
    data: {
      email: "person@example.edu",
      canvas_base_url: "canvas.saved.edu",
      has_pat: true,
    },
    isLoading: false,
  }),
  useLogout: () => ({
    mutateAsync: mocks.logout,
  }),
  useSubmitPat: () => ({
    mutateAsync: mocks.submitPat,
    isPending: false,
  }),
}));

describe("Settings", () => {
  beforeEach(() => {
    mocks.submitPat.mockReset();
    mocks.submitPat.mockResolvedValue({ ok: true });
    mocks.logout.mockReset();
    mocks.logout.mockResolvedValue(undefined);
  });

  it("prefills and submits the Canvas domain with the replacement PAT", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/canvas url or domain/i)).toHaveValue(
      "canvas.saved.edu",
    );

    fireEvent.change(screen.getByLabelText(/canvas url or domain/i), {
      target: { value: "canvas.changed.edu" },
    });
    fireEvent.change(screen.getByLabelText(/canvas token/i), {
      target: { value: "7289~new-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update token/i }));

    await waitFor(() => {
      expect(mocks.submitPat).toHaveBeenCalledWith({
        pat: "7289~new-token",
        canvas_base_url: "canvas.changed.edu",
      });
    });
  });
});
