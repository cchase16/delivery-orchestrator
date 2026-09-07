// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Snapshot } from "../shared/types";

const liveSnapshot: Snapshot = {
  generatedAt: "2026-09-06T12:00:00.000Z",
  system: {
    id: "test-system",
    name: "Test system",
    branch: "main",
    deliveryPath: "delivery",
    lockStatus: "resolved",
  },
  health: [
    { label: "Delivery repository", status: "healthy", detail: "Connected" },
    { label: "Product repository", status: "healthy", detail: "Connected" },
    { label: "Git", status: "healthy", detail: "main · clean" },
    { label: "Codex App Server", status: "healthy", detail: "Available" },
  ],
  artifacts: [],
  approvals: [],
  activeRun: null,
  promptProfiles: [],
  blockers: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("dashboard shell", () => {
  it("renders navigation and filters demo artifacts", async () => {
    window.history.pushState({}, "", "/?demo=1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => liveSnapshot,
    } as Response);
    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Requirements" }));
    fireEvent.change(screen.getByLabelText("Filter artifacts by status"), {
      target: { value: "approved" },
    });
    expect(
      screen.getByRole("button", { name: /Context menu customization/ }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Context menu customization/ }),
    );
    expect(screen.getByText("REQ-ODOO-CONTEXT-MENU · Revision 2")).toBeTruthy();
    expect(screen.getByText(/SHA-256 f3b90b1c9d73/)).toBeTruthy();
    expect(screen.getAllByLabelText("Status: approved").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeTruthy();
  });

  it("shows an error state when the repository cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connection refused"),
    );
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Dashboard unavailable",
    );
    expect(screen.getByText("connection refused")).toBeTruthy();
  });

  it("derives the navigation approval badge from pending decisions", async () => {
    const pendingApproval = {
      id: "APR-ONE",
      type: "requirement" as const,
      title: "Requirement approval",
      artifactId: "REQ-ONE",
      source: "requirements/one.md",
      requestedBy: "Operator",
      requestedAt: "2026-09-07T12:00:00.000Z",
      priority: "medium" as const,
      status: "pending" as const,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ...liveSnapshot, approvals: [pendingApproval] }),
    } as Response);
    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    expect(
      screen.getByRole("button", { name: "Approvals" }).textContent,
    ).toContain("1");
  });

  it("preserves the last snapshot and reports partial validation data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        ({
          ...liveSnapshot,
          validationErrors: [
            {
              source: "requirements/example.json",
              schemaId: "requirement",
              path: "/title",
              message: "is required",
            },
          ],
        }) satisfies Snapshot,
    } as Response);
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText("Partial data: validation issues detected"),
      ).toBeTruthy(),
    );
  });

  it("confirms and invokes the repository reset from Settings", async () => {
    window.history.pushState({}, "", "/?demo=1");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => liveSnapshot,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ removed: {}, preserved: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => liveSnapshot,
      } as Response);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset repository" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repository/reset",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Repository decisions and gates reset"),
    ).toBeTruthy();
  });
});
