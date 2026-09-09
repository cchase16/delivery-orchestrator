import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardConfig } from "./config.js";
import {
  codexAppServerInitializeParams,
  FakeExecutionAdapter,
  PromptBuilder,
  resolveEffectiveProfile,
} from "./prompting.js";
import { DeliveryRepository } from "./repository.js";
import { RuntimeState } from "./state.js";
import type { PromptPacket, PromptProfile } from "../shared/types.js";

const roots: string[] = [];
const states: RuntimeState[] = [];
const run = promisify(execFile);

afterEach(async () => {
  for (const state of states.splice(0)) state.close();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  config: DashboardConfig;
  repository: DeliveryRepository;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-prompt-"));
  roots.push(root);
  const delivery = path.join(root, "delivery");
  const product = path.join(root, "product");
  await fs.mkdir(path.join(delivery, "requirements"), { recursive: true });
  await fs.mkdir(path.join(delivery, "system-plans"), { recursive: true });
  await fs.mkdir(path.join(delivery, "run-plans"), { recursive: true });
  await fs.mkdir(product, { recursive: true });
  const runPlanTemplateSource = path.resolve(
    process.cwd(),
    "../../../templates/run-plan",
  );
  await fs.cp(runPlanTemplateSource, path.join(root, "templates", "run-plan"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(delivery, "system.yaml"),
    "system:\n  id: test-system\nrequirements:\n  directory: requirements\n",
  );
  await fs.writeFile(
    path.join(delivery, "requirements", "REQ-CONTEXT-MENU.md"),
    "# Context menu\n\nAdd a right-click menu.\n\napi_key: sk-test-secret-value\n",
  );
  await fs.writeFile(
    path.join(delivery, "system-plans", "system-context.md"),
    "# System context marker\n\nThe installed Odoo shell owns the shared context menu.\n",
  );
  const runPlanMarkdown =
    "# Context menu implementation\n\n## PH-01 Foundation\n\n- TASK-01 Add the menu service.\n\n## Verification\n\nRun the focused module tests.\n\n## Exit criteria\n\nThe menu is available from the target view.\n";
  const sha256 = (value: string | Buffer) =>
    crypto.createHash("sha256").update(value).digest("hex");
  await fs.writeFile(
    path.join(delivery, "run-plans", "context-menu.md"),
    runPlanMarkdown,
  );
  await fs.writeFile(
    path.join(delivery, "run-plans", "context-menu.sidecar.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_plan_id: "RP-CONTEXT-MENU",
        revision: 1,
        requirement: {
          id: "REQ-CONTEXT-MENU",
          revision: 1,
          path: "requirements/REQ-CONTEXT-MENU.md",
          sha256: sha256(
            await fs.readFile(
              path.join(delivery, "requirements", "REQ-CONTEXT-MENU.md"),
            ),
          ),
        },
        document: {
          id: "RP-CONTEXT-MENU",
          revision: 1,
          path: "run-plans/context-menu.md",
          sha256: sha256(runPlanMarkdown),
        },
        phases: [
          {
            phase_id: "PH-01",
            title: "Foundation",
            status: "not_started",
            tasks: [
              {
                task_id: "TASK-01",
                title: "Add the menu service",
                status: "not_started",
                allowed_paths: ["addons/**"],
              },
            ],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(path.join(product, "README.md"), "# Product baseline\n");
  await run("git", ["-C", product, "init", "-q"]);
  await run("git", [
    "-C",
    product,
    "config",
    "user.email",
    "prompt-test@example.invalid",
  ]);
  await run("git", ["-C", product, "config", "user.name", "Prompt test"]);
  await run("git", ["-C", product, "add", "."]);
  await run("git", ["-C", product, "commit", "-qm", "baseline"]);
  const config = {
    deliveryRepository: delivery,
    productRepository: product,
    orchestratorRepository: root,
    schemaDirectory: root,
    runtimeDirectory: path.join(delivery, ".factory-local"),
    port: 4100,
  };
  const state = new RuntimeState(config.runtimeDirectory);
  states.push(state);
  const repository = new DeliveryRepository(config, state);
  return { config, repository };
}

const generationProfile: PromptProfile = {
  taskType: "run_plan_generation",
  label: "Run-plan generation",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  promptMode: "standard",
  adapter: "fake",
};

const executionProfile: PromptProfile = {
  taskType: "run_plan_execution",
  label: "Run-plan execution",
  model: "gpt-5.6-luna",
  reasoningEffort: "high",
  promptMode: "standard",
  adapter: "fake",
};

describe("PromptBuilder and execution adapters", () => {
  it("uses stable App Server capabilities for standard turns", () => {
    expect(codexAppServerInitializeParams()).toMatchObject({
      capabilities: {},
    });
    expect(codexAppServerInitializeParams().capabilities).not.toHaveProperty(
      "experimentalApi",
    );
  });

  it("resolves explicit overrides without falling back to unsupported settings", () => {
    const profile: PromptProfile = {
      ...generationProfile,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
    };
    expect(
      resolveEffectiveProfile(
        profile,
        { model: "gpt-5.6-terra", reasoningEffort: "high" },
        {
          models: ["gpt-5.6-sol", "gpt-5.6-terra"],
          reasoningEfforts: ["medium", "high"],
        },
      ),
    ).toMatchObject({ model: "gpt-5.6-terra", reasoningEffort: "high" });
    expect(() =>
      resolveEffectiveProfile(
        profile,
        { model: "gpt-5.6-luna" },
        { models: ["gpt-5.6-sol"], reasoningEfforts: ["medium"] },
      ),
    ).toThrow("Model is not available");
    expect(() =>
      resolveEffectiveProfile(
        profile,
        { reasoningEffort: "ultra" },
        { models: ["gpt-5.6-sol"], reasoningEfforts: ["medium"] },
      ),
    ).toThrow("Reasoning level is not available");
  });

  it("requires exact approval and records a standard fake task packet", async () => {
    const { config, repository } = await fixture();
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    const builder = new PromptBuilder(config, repository);
    await expect(
      builder.preview(
        "run_plan_generation",
        [requirement.id],
        generationProfile,
      ),
    ).rejects.toThrow("not currently approved");
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    const packet = await builder.preview(
      "run_plan_generation",
      [requirement.id],
      generationProfile,
    );
    expect(packet.promptMode).toBe("standard");
    expect(packet.prompt).toContain(requirement.digest);
    expect(packet.prompt).toContain("System context marker");
    expect(packet.prompt).toContain("Product baseline");
    expect(packet.prompt).toContain(
      'Create an implementation plan to build "Context menu" as described in REQ-CONTEXT-MENU revision 1',
    );
    expect(packet.prompt).toContain("Canonical run-plan Markdown template:");
    expect(packet.prompt).toContain("## Architecture");
    expect(packet.prompt).toContain("## Phased implementation plan");
    expect(packet.prompt).toContain("## Acceptance criteria traceability");
    expect(packet.prompt).toContain("Do not create JSON or a sidecar");
    expect(packet.prompt).toContain("never approve your own work");
    expect(packet.prompt).not.toContain("sk-test-secret-value");
    expect(packet.redactionApplied).toBe(true);
    const adapter = new FakeExecutionAdapter();
    const task = await adapter.start(packet);
    expect(task.actualModel).toBe("gpt-5.6-sol");
    expect(task.actualReasoningEffort).toBe("medium");
  });

  it("snapshots the prompt packet contract without storing prompt content", async () => {
    const { config, repository } = await fixture();
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    const packet = await new PromptBuilder(config, repository).preview(
      "run_plan_generation",
      [requirement.id],
      generationProfile,
    );
    expect({
      ...packet,
      prompt: "[prompt body intentionally omitted]",
    }).toMatchSnapshot();
  });

  it("assembles the full approved run plan as a phase-scoped prompt", async () => {
    const { config, repository } = await fixture();
    const snapshot = await repository.snapshot();
    const requirement = snapshot.artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    const runPlan = snapshot.artifacts.find(
      (artifact) => artifact.kind === "run_plan",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    await repository.recordDecision({
      artifactId: runPlan.id,
      kind: "run_plan",
      decision: "approved",
    });
    const packet = await new PromptBuilder(config, repository).preview(
      "run_plan_execution",
      [runPlan.id],
      executionProfile,
      {
        runId: "RUN-PROMPT-001",
        workPackageId: "WP-PROMPT-001",
        planPath: path.join(
          config.deliveryRepository,
          "run-plans",
          "context-menu.md",
        ),
        progressFilePath: path.join(
          config.runtimeDirectory,
          "progress-input",
          "RUN-PROMPT-001",
          "progress.json",
        ),
        firstPhaseId: "PH-01",
        firstPhaseTitle: "Foundation",
        firstTaskId: "TASK-01",
        firstTaskTitle: "Add the menu service",
        phaseOrdinal: 1,
        phaseCount: 3,
      },
    );
    expect(packet).toMatchObject({
      taskType: "run_plan_execution",
      promptMode: "standard",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    expect(packet.prompt).toContain("Context menu implementation");
    expect(packet.prompt).toContain(
      "Treat the approved implementation run plan as immutable",
    );
    expect(packet.prompt).toContain(
      "Implement only phase 1 of 3: PH-01 (Foundation), starting with TASK-01 (Add the menu service)",
    );
    expect(packet.prompt).toContain("progress.json");
    expect(packet.prompt.indexOf("System context:")).toBeLessThan(
      packet.prompt.indexOf("Current phase assignment:"),
    );
    expect(packet.prompt).toContain(
      "Do not begin another run plan. The dashboard will start the next sequenced plan",
    );
    expect(packet.prompt).toContain("Do not begin a later phase");
    expect(packet.prompt).toContain("A non-critical issue does not prevent");
    expect(packet.prompt).not.toContain("sk-test-secret-value");
  });

  it("covers fake adapter completion, blocked, cancellation, and startup failure", async () => {
    const packet: PromptPacket = {
      taskType: "run_plan_execution",
      promptMode: "standard",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      templateVersion: "run-plan-execution.v3",
      redactionApplied: false,
      inputArtifacts: [],
      prompt: "Execute the approved plan.",
    };
    const blocked = new FakeExecutionAdapter({
      status: "blocked",
      output: "Input is required.",
    });
    const task = await blocked.start(packet);
    await expect(blocked.read(task.taskId)).resolves.toMatchObject({
      status: "blocked",
      output: "Input is required.",
    });
    const continued = await blocked.continueTask!(task.taskId, packet);
    expect(continued.taskId).toBe(task.taskId);
    await blocked.interrupt(task.taskId);
    await expect(blocked.read(task.taskId)).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(
      new FakeExecutionAdapter({ startError: "simulated timeout" }).start(
        packet,
      ),
    ).rejects.toThrow("simulated timeout");

    const failed = new FakeExecutionAdapter({
      status: "failed",
      output: "Validation failed.",
    });
    const failedTask = await failed.start(packet);
    await expect(failed.read(failedTask.taskId)).resolves.toMatchObject({
      status: "failed",
      output: "Validation failed.",
    });

    const timedOut = new FakeExecutionAdapter({
      status: "timed_out",
      output: "Task exceeded its execution window.",
    });
    const timedOutTask = await timedOut.start(packet);
    await expect(timedOut.read(timedOutTask.taskId)).resolves.toMatchObject({
      status: "timed_out",
    });

    const largeOutput = "x".repeat(1024 * 1024);
    const largeAdapter = new FakeExecutionAdapter({
      output: largeOutput,
    });
    const largeTask = await largeAdapter.start(packet);
    await expect(largeAdapter.read(largeTask.taskId)).resolves.toMatchObject({
      status: "completed",
      output: largeOutput,
    });
  });

  it("blocks generation when system context or the product baseline is unavailable", async () => {
    const first = await fixture();
    const requirement = (await first.repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    await first.repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    await fs.rm(path.join(first.config.deliveryRepository, "system-plans"), {
      recursive: true,
      force: true,
    });
    await expect(
      new PromptBuilder(first.config, first.repository).preview(
        "run_plan_generation",
        [requirement.id],
        generationProfile,
      ),
    ).rejects.toThrow("valid system plan");

    const second = await fixture();
    const secondRequirement = (
      await second.repository.snapshot()
    ).artifacts.find((artifact) => artifact.kind === "requirement")!;
    await second.repository.recordDecision({
      artifactId: secondRequirement.id,
      kind: "requirement",
      decision: "approved",
    });
    await fs.rm(path.join(second.config.productRepository, ".git"), {
      recursive: true,
      force: true,
    });
    await expect(
      new PromptBuilder(second.config, second.repository).preview(
        "run_plan_generation",
        [secondRequirement.id],
        generationProfile,
      ),
    ).rejects.toThrow("product baseline");
  });
});
