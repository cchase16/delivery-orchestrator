import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeState } from "./state.js";
import type { ActiveRun, PromptProfile } from "../shared/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("RuntimeState", () => {
  it("persists and reconstructs run controls without changing the approved plan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-state-"));
    roots.push(root);
    const first = new RuntimeState(root);
    const run: ActiveRun = {
      runId: "RUN-TEST",
      workPackageId: "WP-TEST",
      title: "Fixture",
      sequence: 1,
      total: 1,
      currentPhase: "PH-01",
      currentTask: "TASK-01",
      progress: 0,
      status: "ready",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    };
    first.startRun(run);
    expect(first.getActiveRun()?.runId).toBe("RUN-TEST");
    first.updateRun("RUN-TEST", { status: "blocked", progress: 25 });
    first.recordAction("prompt_task_started", {
      actual: { model: "gpt-5.6-luna", reasoningEffort: "high" },
    });
    first.close();
    const restarted = new RuntimeState(root);
    expect(restarted.getActiveRun()).toMatchObject({
      runId: "RUN-TEST",
      status: "blocked",
      progress: 25,
    });
    expect(restarted.listActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionType: "prompt_task_started" }),
      ]),
    );
    restarted.updateRun("RUN-TEST", { status: "complete", progress: 100 });
    expect(restarted.getActiveRun()).toBeNull();
    restarted.close();
  });

  it("allows only one live orchestrator lease and recovers after release", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-lease-"));
    roots.push(root);
    const state = new RuntimeState(root);
    expect(state.acquireLease("orchestrator", "owner-a", 60_000)).toBe(true);
    expect(state.acquireLease("orchestrator", "owner-b", 60_000)).toBe(false);
    state.releaseLease("orchestrator", "owner-a");
    expect(state.acquireLease("orchestrator", "owner-b", 60_000)).toBe(true);
    state.close();
  });

  it("keeps historical task settings when a profile changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-profile-"));
    roots.push(root);
    const state = new RuntimeState(root);
    const original: PromptProfile = {
      taskType: "run_plan_generation",
      label: "Run-plan generation",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      promptMode: "standard",
      adapter: "fake",
    };
    state.seedProfiles([original]);
    state.recordAction(
      "prompt_task_started",
      {
        requested: {
          model: original.model,
          reasoningEffort: original.reasoningEffort,
        },
      },
      "historical-profile-task",
    );
    state.updateProfile({
      ...original,
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
    expect(state.listActions()[0].payload).toMatchObject({
      requested: { model: "gpt-5.6-sol", reasoningEffort: "medium" },
    });
    expect(state.getPromptProfiles()[0]).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
    state.close();
  });

  it("migrates the execution profile away from the native goals mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-profile-"));
    roots.push(root);
    const state = new RuntimeState(root);
    const profile: PromptProfile = {
      taskType: "run_plan_execution",
      label: "Run-plan execution",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      promptMode: "standard",
      adapter: "fake",
    };
    state.seedProfiles([profile]);
    state.updateProfile({
      ...profile,
      model: "gpt-5.6-terra",
      promptMode: "goal",
    });

    state.seedProfiles([profile]);

    expect(state.getPromptProfiles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "run_plan_execution",
          model: "gpt-5.6-terra",
          promptMode: "standard",
        }),
      ]),
    );
    state.close();
  });
});
