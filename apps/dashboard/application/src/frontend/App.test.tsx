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
    fireEvent.click(screen.getByRole("button", { name: "Design documents" }));
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

  it("recovers completed run-plan output for the selected requirement", async () => {
    const requirement = {
      id: "REQ-RECOVER",
      title: "Recoverable design",
      kind: "requirement" as const,
      path: "requirements/recover.md",
      extension: ".md",
      revision: 1,
      digest: "abc123",
      status: "approved" as const,
      updatedAt: "2026-09-11T12:00:00.000Z",
    };
    const snapshot: Snapshot = {
      ...liveSnapshot,
      artifacts: [requirement],
      promptProfiles: [
        {
          taskType: "run_plan_generation",
          label: "Run-plan generation",
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          promptMode: "standard",
          adapter: "codex_app_server",
        },
      ],
    };
    const output =
      "```markdown\n# Recovered implementation plan\n\nFull output.\n```";
    let savedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      let body: unknown = {};
      if (url === "/api/snapshot") body = snapshot;
      else if (url === "/api/capabilities")
        body = {
          models: ["gpt-5.6-sol"],
          reasoningEfforts: ["medium"],
          adapters: [],
        };
      else if (url === "/api/prompt-tasks")
        body = {
          tasks: [
            {
              taskId: "THREAD-RECOVER",
              taskType: "run_plan_generation",
              status: "completed",
              output,
              events: [],
              adapter: "codex_app_server",
              model: "gpt-5.6-sol",
              reasoningEffort: "medium",
              startedAt: "2026-09-11T12:01:00.000Z",
              inputArtifactIds: [requirement.id],
              promptMode: "standard",
              templateVersion: "run-plan-generation.v4",
              redactionApplied: false,
            },
          ],
        };
      else if (url === "/api/prompt-tasks/THREAD-RECOVER")
        body = { status: "completed", output, events: [] };
      else if (url === "/api/artifacts/REQ-RECOVER")
        body = {
          artifact: requirement,
          content: "# Recoverable design",
          contentType: "text/markdown",
          previewable: true,
        };
      else if (url === "/api/run-plans/drafts") {
        savedBody = JSON.parse(String(init?.body));
        body = { id: "RP-RECOVER", path: "run-plans/RP-RECOVER.md" };
      }
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Design documents" }));

    expect(
      await screen.findByRole("heading", {
        name: "Completed run-plan generation",
      }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Run-plan Markdown") as HTMLTextAreaElement).value,
    ).toContain("# Recovered implementation plan");
    fireEvent.click(
      screen.getByRole("button", { name: "Validate and save draft" }),
    );
    await waitFor(() =>
      expect(savedBody).toEqual({
        requirementId: requirement.id,
        markdown: "# Recovered implementation plan\n\nFull output.",
      }),
    );
  });
});
