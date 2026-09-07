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
});
