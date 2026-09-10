import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { classifyValidationOutcome, DeliveryRepository } from "./repository.js";
import { RuntimeState } from "./state.js";
import type { DashboardConfig } from "./config.js";
import { reviewProductDiff } from "./diff.js";
import { SchemaRegistry } from "./validation.js";

const temporaryDirectories: string[] = [];
const states: RuntimeState[] = [];
const run = promisify(execFile);

function canonicalRunPlanMarkdown(
  options: {
    title?: string;
    phaseId?: string;
    phaseTitle?: string;
    taskId?: string;
    taskTitle?: string;
    baseline?: string;
    dependencies?: string[];
    forbiddenPaths?: string[];
  } = {},
): string {
  const title = options.title ?? "Context menu implementation";
  const phaseId = options.phaseId ?? "PH-01";
  const phaseTitle = options.phaseTitle ?? "Foundation";
  const taskId = options.taskId ?? "TASK-01-01";
  const taskTitle = options.taskTitle ?? "Add the menu service";
  const nested = (values: string[], code = false) =>
    (values.length ? values : ["None"])
      .map(
        (value) => `  - ${code && value !== "None" ? `\`${value}\`` : value}`,
      )
      .join("\n");
  return [
    `# ${title}`,
    "",
    "## Document status",
    "",
    "**Plan status:** `DRAFT`",
    "",
    "**Execution status:** `NOT STARTED`",
    "",
    `**Product baseline:** \`${options.baseline ?? "a".repeat(40)}\``,
    "",
    "## Architecture",
    "",
    "### Repository and delivery constraints",
    "",
    "- **Run-plan dependencies:**",
    nested(options.dependencies ?? []),
    "- **Affected modules:**",
    nested(["web"]),
    "- **Forbidden paths:**",
    nested(options.forbiddenPaths ?? ["delivery/**"], true),
    "- **Database concerns:**",
    nested(["No migration expected."]),
    "- **Known conflicts:**",
    nested([]),
    "",
    "## Phased implementation plan",
    "",
    `## ${phaseId} ${phaseTitle}`,
    "",
    "**Status:** `NOT STARTED`",
    "",
    "**Depends on:** None",
    "",
    "**Objective:** Deliver the context-menu foundation.",
    "",
    "### Development tasks",
    "",
    `- [ ] **${taskId} ${taskTitle}**`,
    "  - **Action:** Implement the menu service.",
    "  - **Deliverable:** Tested service code.",
    "  - **Allowed paths:**",
    "    - `addons/**`",
    "  - **Verification:**",
    "    - Run the focused module tests.",
    "",
    "### Tests and verification",
    "",
    "- Run the focused module tests.",
    "",
    "### Exit criteria",
    "",
    "- The menu is available from the target view.",
    "",
    "## Acceptance criteria traceability",
    "",
    "| Requirement criterion | Planned implementation | Verification | Phase and tasks |",
    "| --- | --- | --- | --- |",
    `| Context menu | Menu service | Focused tests | ${phaseId} ${taskId} |`,
    "",
    "## Risks and responses",
    "",
    "| Risk or assumption | Impact | Response or validation task | Owner | Status |",
    "| --- | --- | --- | --- | --- |",
    `| Odoo API compatibility | Rework | Validate in ${taskId} | Unassigned | Open |`,
    "",
    "## Completion rule",
    "",
    "Complete only after all tasks, tests, and acceptance criteria pass.",
  ].join("\n");
}

async function fixture(): Promise<DashboardConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-dashboard-"));
  temporaryDirectories.push(root);
  const delivery = path.join(root, "delivery");
  const product = path.join(root, "product");
  await fs.mkdir(path.join(delivery, "requirements"), { recursive: true });
  await fs.mkdir(path.join(delivery, "run-plans"), { recursive: true });
  await fs.mkdir(product, { recursive: true });
  await fs.writeFile(
    path.join(delivery, "system.yaml"),
    "system:\n  id: test-system\n  name: Test system\n",
  );
  await fs.writeFile(
    path.join(delivery, "delivery.lock"),
    "status: resolved\n",
  );
  await fs.writeFile(
    path.join(delivery, "requirements", "context-menu.md"),
    "# Context menu\n\nOpen the menu with the right mouse button.\n",
  );
  await fs.writeFile(
    path.join(delivery, "run-plans", "implementation-plan.md"),
    "# Implementation plan\n\n- Add the context menu.\n",
  );
  const requirementContent = await fs.readFile(
    path.join(delivery, "requirements", "context-menu.md"),
  );
  const planContent = await fs.readFile(
    path.join(delivery, "run-plans", "implementation-plan.md"),
  );
  const sha256 = (content: Buffer) =>
    crypto.createHash("sha256").update(content).digest("hex");
  await fs.writeFile(
    path.join(delivery, "run-plans", "implementation-plan.sidecar.json"),
    JSON.stringify(
      {
        schema_version: 1,
        run_plan_id: "RP-IMPLEMENTATION-PLAN",
        revision: 1,
        requirement: {
          id: "REQ-CONTEXT-MENU",
          revision: 1,
          path: "requirements/context-menu.md",
          sha256: sha256(requirementContent),
        },
        document: {
          id: "RP-IMPLEMENTATION-PLAN",
          revision: 1,
          path: "run-plans/implementation-plan.md",
          sha256: sha256(planContent),
        },
        phases: [
          {
            phase_id: "PH-01",
            title: "Implementation",
            status: "not_started",
            tasks: [
              {
                task_id: "TASK-01",
                title: "Add the context menu",
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
  return {
    deliveryRepository: delivery,
    productRepository: product,
    orchestratorRepository: root,
    schemaDirectory: root,
    runtimeDirectory: path.join(delivery, ".factory-local"),
    port: 4100,
  };
}

afterEach(async () => {
  for (const state of states.splice(0)) state.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("DeliveryRepository", () => {
  it("classifies validation outcomes without collapsing failures into blockers", () => {
    expect(
      classifyValidationOutcome({
        diffAllowed: true,
        validationPassed: true,
        qualityStatuses: ["passed"],
      }),
    ).toBe("passed");
    expect(
      classifyValidationOutcome({
        diffAllowed: false,
        validationPassed: true,
        qualityStatuses: ["passed"],
      }),
    ).toBe("blocked");
    expect(
      classifyValidationOutcome({
        diffAllowed: true,
        validationPassed: true,
        qualityStatuses: ["failed"],
      }),
    ).toBe("failed");
    expect(
      classifyValidationOutcome({
        diffAllowed: true,
        validationPassed: true,
        qualityStatuses: ["timed_out"],
      }),
    ).toBe("failed");
    expect(
      classifyValidationOutcome({
        diffAllowed: true,
        validationPassed: true,
        qualityStatuses: ["skipped"],
      }),
    ).toBe("partial");
  });

  it("reconstructs an artifact and binds a decision to its real digest", async () => {
    const config = await fixture();
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const snapshot = await repository.snapshot();
    expect(snapshot.artifacts).toHaveLength(2);
    expect(snapshot.approvals).toHaveLength(2);
    expect(
      snapshot.approvals.every((approval) => approval.status === "pending"),
    ).toBe(true);
    const artifact = snapshot.artifacts.find(
      (candidate) => candidate.kind === "requirement",
    )!;
    expect(artifact.digest).toMatch(/^[a-f0-9]{64}$/);
    const document = await repository.readArtifact(artifact.id);
    expect(document?.content).toContain("Context menu");
    const firstAction = await repository.recordDecision({
      artifactId: artifact.id,
      kind: "requirement",
      decision: "approved",
    });
    const secondAction = await repository.recordDecision({
      artifactId: artifact.id,
      kind: "requirement",
      decision: "approved",
    });
    expect(secondAction).toBe(firstAction);
    await expect(
      repository.recordDecision({
        artifactId: artifact.id,
        kind: "requirement",
        decision: "rejected",
        reason: "A second decision cannot replace an immutable approval.",
      }),
    ).rejects.toThrow("immutable decision");
    await expect(
      repository.recordDecision({
        artifactId: artifact.id,
        kind: "requirement",
        decision: "rejected",
      }),
    ).rejects.toThrow("rejection reason");
    expect(
      await fs.readdir(
        path.join(config.deliveryRepository, "control", "approvals"),
      ),
    ).toHaveLength(1);
    expect(
      await fs.readdir(
        path.join(config.deliveryRepository, "control", "events"),
      ),
    ).toHaveLength(1);
    expect((await repository.snapshot()).events).toHaveLength(1);
    const eventFile = (
      await fs.readdir(
        path.join(config.deliveryRepository, "control", "events"),
      )
    )[0];
    const event = JSON.parse(
      await fs.readFile(
        path.join(config.deliveryRepository, "control", "events", eventFile),
        "utf8",
      ),
    ) as { event_type: string; caused_by_approval_id: string };
    expect(event.event_type).toBe("gate_satisfied");
    expect(event.caused_by_approval_id).toMatch(/^APR-/);
    const approval = JSON.parse(
      await fs.readFile(
        path.join(
          config.deliveryRepository,
          "control",
          "approvals",
          (
            await fs.readdir(
              path.join(config.deliveryRepository, "control", "approvals"),
            )
          )[0],
        ),
        "utf8",
      ),
    ) as {
      issued_by: { actor_type: string };
      bindings: Array<{ path: string; digest: { value: string } }>;
    };
    expect(approval.issued_by.actor_type).toBe("human");
    expect(approval.bindings[0].path).toBe(artifact.path);
    expect(approval.bindings[0].digest.value).toBe(artifact.digest);
    let runPlan = snapshot.artifacts.find(
      (candidate) => candidate.kind === "run_plan",
    )!;
    await expect(
      repository.saveWorkPackageDraft([], "empty package"),
    ).rejects.toThrow("at least one approved run plan");
    await fs.appendFile(
      path.join(config.deliveryRepository, runPlan.path),
      "\n",
    );
    await expect(
      repository.recordDecision({
        artifactId: runPlan.id,
        kind: "run_plan",
        decision: "approved",
        revision: runPlan.revision,
        digest: runPlan.digest,
      }),
    ).rejects.toThrow("Decision target digest is stale");
    runPlan = (await repository.snapshot()).artifacts.find(
      (candidate) => candidate.kind === "run_plan",
    )!;
    await expect(
      repository.saveWorkPackageDraft(
        [
          { runPlanId: runPlan.id, sequence: 1 },
          { runPlanId: runPlan.id, sequence: 2 },
        ],
        "duplicate",
      ),
    ).rejects.toThrow("Duplicate work-package member");
    await repository.recordDecision({
      artifactId: runPlan.id,
      kind: "run_plan",
      decision: "approved",
    });
    await expect(
      repository.saveWorkPackageDraft(
        [{ runPlanId: runPlan.id, sequence: 2 }],
        "gapped sequence",
      ),
    ).rejects.toThrow("contiguous from 1");
    await expect(
      repository.validateSequenceProposal([runPlan.id], {
        ordered_run_plan_ids: [runPlan.id],
        rationale: "Single plan",
      }),
    ).resolves.toEqual({
      orderedRunPlanIds: [runPlan.id],
      rationale: "Single plan",
    });
    await expect(
      repository.validateSequenceProposal([runPlan.id], {
        ordered_run_plan_ids: [],
        rationale: "missing plan",
      }),
    ).rejects.toThrow("Sequencing output is invalid");
    const workPackage = await repository.saveWorkPackageDraft(
      [{ runPlanId: runPlan.id, sequence: 1 }],
      "One approved plan",
    );
    await repository.recordDecision({
      artifactId: workPackage.id,
      kind: "work_package",
      decision: "approved",
    });
    const approvalFiles = await fs.readdir(
      path.join(config.deliveryRepository, "control", "approvals"),
    );
    const packageApprovals = await Promise.all(
      approvalFiles.map(
        async (file) =>
          JSON.parse(
            await fs.readFile(
              path.join(
                config.deliveryRepository,
                "control",
                "approvals",
                file,
              ),
              "utf8",
            ),
          ) as { bindings: unknown[] },
      ),
    );
    const packageApproval = packageApprovals.find(
      (candidate) => candidate.bindings.length === 2,
    );
    expect(packageApproval).toBeDefined();
    expect(packageApproval!.bindings).toHaveLength(2);
    expect(workPackage.kind).toBe("work_package");
    expect(
      (await repository.snapshot()).artifacts.some(
        (candidate) => candidate.id === workPackage.id,
      ),
    ).toBe(true);
  });

  it("resets a run-plan product baseline as a new draft revision", async () => {
    const config = await fixture();
    await run("git", ["-C", config.productRepository, "init", "-q"]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.name",
      "Dashboard test",
    ]);
    await fs.writeFile(
      path.join(config.productRepository, "README.md"),
      "# Product\n",
    );
    await run("git", ["-C", config.productRepository, "add", "."]);
    await run("git", [
      "-C",
      config.productRepository,
      "commit",
      "-qm",
      "baseline",
    ]);
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    const runPlan = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({ baseline: "a".repeat(40) }),
    });
    const productHead = (
      await run("git", ["-C", config.productRepository, "rev-parse", "HEAD"])
    ).stdout.trim();

    const reset = await repository.resetRunPlanBaseline(runPlan.id);

    expect(reset).toMatchObject({
      kind: "run_plan",
      revision: runPlan.revision + 1,
      status: "draft",
    });
    const resetDocument = await repository.readArtifact(reset.id);
    expect(resetDocument?.content).toContain(
      `**Product baseline:** \`${productHead}\``,
    );
    const resetSidecar = JSON.parse(
      await fs.readFile(
        path.join(
          config.deliveryRepository,
          reset.path.replace(/\.md$/, ".sidecar.json"),
        ),
        "utf8",
      ),
    ) as { supersedes_revision?: number };
    expect(resetSidecar.supersedes_revision).toBe(runPlan.revision);
  });

  it("creates an isolated implementation worktree from the clean product baseline", async () => {
    const config = await fixture();
    await fs.mkdir(path.join(config.deliveryRepository, "system-plans"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(config.deliveryRepository, "system-plans", "system.md"),
      "# Test system plan\n",
    );
    await run("git", ["-C", config.productRepository, "init", "-q"]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.name",
      "Dashboard test",
    ]);
    await fs.writeFile(
      path.join(config.productRepository, "README.md"),
      "# Product\n",
    );
    await run("git", ["-C", config.productRepository, "add", "."]);
    await run("git", [
      "-C",
      config.productRepository,
      "commit",
      "-qm",
      "baseline",
    ]);
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
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
    const workPackage = await repository.saveWorkPackageDraft(
      [{ runPlanId: runPlan.id, sequence: 1 }],
      "single plan",
    );
    await repository.recordDecision({
      artifactId: workPackage.id,
      kind: "work_package",
      decision: "approved",
    });
    const baseline = (
      await run("git", ["-C", config.productRepository, "rev-parse", "HEAD"])
    ).stdout.trim();
    const readyPreflight = await repository.preflight({
      workPackageId: workPackage.id,
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    expect(readyPreflight).toMatchObject({ ready: true, blockers: [] });
    expect(readyPreflight.checks.map((check) => check.name)).toEqual([
      "Delivery repository",
      "Product baseline",
      "Delivery lock",
      "System plan",
      "Indexed artifacts",
      "Work package",
      "Dependencies and path rules",
      "Requested profile",
      "Orchestrator ownership",
      "Codex adapter",
      "Product worktree",
    ]);
    expect(
      readyPreflight.checks.every((check) => check.status === "ready"),
    ).toBe(true);
    const started = await repository.startRun({
      workPackageId: workPackage.id,
      title: "Context menu test",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    expect(started.baseCommit).toBe(baseline);
    expect(started.adapter).toBe("fake");
    expect(started.branch).toMatch(/^factory\/RUN-/);
    expect(started.worktreePath).toBeDefined();
    await expect(fs.access(started.worktreePath!)).resolves.toBeUndefined();
    await fs.writeFile(
      path.join(started.worktreePath!, "context-menu.txt"),
      "implemented\n",
    );
    const isolatedDiff = await reviewProductDiff(
      config,
      baseline,
      ["context-menu.txt"],
      [],
      started.worktreePath,
    );
    expect(isolatedDiff.entries).toEqual([
      { path: "context-menu.txt", change: "??", classification: "allowed" },
    ]);
    expect(isolatedDiff.patch).toContain("context-menu.txt");
    const evidence = await repository.recordValidationEvidence({
      runId: started.runId,
      baseCommit: baseline,
      allowedPaths: ["context-menu.txt"],
      forbiddenPaths: [],
    });
    expect(evidence.outcome).toBe("passed");
    const approvedPlanBeforeProgress = (
      await repository.snapshot()
    ).artifacts.find((artifact) => artifact.id === runPlan.id)!;
    await repository.saveExecutionProgress({
      run_id: started.runId,
      work_package_id: workPackage.id,
      run_plan_id: runPlan.id,
      run_plan_revision: runPlan.revision,
      status: "complete",
      current_phase_id: "PH-01",
      current_task_id: "TASK-01",
      phases: [{ phase_id: "PH-01", status: "complete" }],
      tasks: [{ task_id: "TASK-01", status: "complete" }],
    });
    const approvedPlanAfterProgress = (
      await repository.snapshot()
    ).artifacts.find((artifact) => artifact.id === runPlan.id)!;
    expect(approvedPlanAfterProgress).toMatchObject({
      id: approvedPlanBeforeProgress.id,
      revision: approvedPlanBeforeProgress.revision,
      digest: approvedPlanBeforeProgress.digest,
      status: "approved",
    });
    const failedQualityEvidence = await repository.recordValidationEvidence({
      runId: started.runId,
      baseCommit: baseline,
      allowedPaths: ["context-menu.txt"],
      forbiddenPaths: [],
      qualityGates: ["product_lint"],
    });
    expect(failedQualityEvidence.outcome).toBe("failed");
    expect(failedQualityEvidence.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "product_lint", status: "failed" }),
      ]),
    );
    const partialQualityEvidence = await repository.recordValidationEvidence({
      runId: started.runId,
      baseCommit: baseline,
      allowedPaths: ["context-menu.txt"],
      forbiddenPaths: [],
      requiredQualityGates: ["product_test"],
    });
    expect(partialQualityEvidence.outcome).toBe("failed");
    expect(partialQualityEvidence.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "product_test", status: "failed" }),
      ]),
    );
    await fs.writeFile(
      path.join(config.productRepository, "factory.yaml"),
      'quality_gates:\n  required:\n    - clean_install\n  runners:\n    clean_install:\n      executable: node\n      args: ["-e", "process.exit(0)"]\n      timeout_seconds: 10\n',
    );
    const declaredGateEvidence = await repository.recordValidationEvidence({
      runId: started.runId,
      baseCommit: baseline,
      allowedPaths: ["context-menu.txt"],
      forbiddenPaths: [],
      qualityGates: ["manifest_validation"],
    });
    expect(declaredGateEvidence.outcome).toBe("passed");
    expect(declaredGateEvidence.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "manifest_validation",
          status: "passed",
        }),
        expect.objectContaining({
          name: "clean_install",
          status: "passed",
        }),
      ]),
    );
    await fs.rm(path.join(config.productRepository, "factory.yaml"), {
      force: true,
    });
    repository.updateRun(started.runId, { total: 2 });
    await expect(
      repository.recordResultDisposition({
        runId: started.runId,
        decision: "accepted",
        evidenceIds: ["EVD-NOT-REAL"],
        reason: "An unknown evidence reference must not be accepted.",
      }),
    ).rejects.toThrow(/existing evidence/);
    await expect(
      repository.recordResultDisposition({
        runId: started.runId,
        decision: "accepted",
        evidenceIds: [evidence.evidenceId],
        reason: "Isolated worktree result accepted in test.",
      }),
    ).resolves.toMatchObject({ decision: "accepted", runId: started.runId });
    expect(repository.getRun(started.runId)).toMatchObject({
      status: "blocked",
      progress: 50,
      currentTask: expect.stringContaining("sequence 2"),
    });
    repository.updateRun(started.runId, { total: 1 });
    await expect(
      repository.recordResultDisposition({
        runId: started.runId,
        decision: "accepted",
        evidenceIds: [evidence.evidenceId],
        reason: "Final sequence accepted in test.",
      }),
    ).resolves.toMatchObject({ decision: "accepted", runId: started.runId });
    expect(repository.getRun(started.runId)?.status).toBe("complete");
    await repository.recordResultDisposition({
      runId: started.runId,
      decision: "accepted",
      evidenceIds: [evidence.evidenceId],
      reason: "Final sequence accepted in test.",
    });
    expect(
      await fs.readdir(
        path.join(config.deliveryRepository, "control", "dispositions"),
      ),
    ).toHaveLength(2);
    expect(
      (
        await run("git", [
          "-C",
          config.productRepository,
          "status",
          "--porcelain",
        ])
      ).stdout.trim(),
    ).toBe("");
  }, 15000);

  it("reports dirty-worktree, invalid-profile, and unknown-adapter preflight blockers", async () => {
    const config = await fixture();
    await run("git", ["-C", config.productRepository, "init", "-q"]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.email",
      "preflight-test@example.invalid",
    ]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.name",
      "Preflight test",
    ]);
    await fs.writeFile(
      path.join(config.productRepository, "README.md"),
      "baseline\n",
    );
    await run("git", ["-C", config.productRepository, "add", "."]);
    await run("git", [
      "-C",
      config.productRepository,
      "commit",
      "-qm",
      "baseline",
    ]);
    await fs.appendFile(
      path.join(config.productRepository, "README.md"),
      "uncommitted\n",
    );
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const preflight = await repository.preflight({
      workPackageId: "WP-NOT-REAL",
      model: "unsupported-model",
      reasoningEffort: "ultra",
      adapter: "unknown-adapter",
    });
    expect(preflight.ready).toBe(false);
    expect(preflight.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Work package"),
        expect.stringContaining("Requested profile"),
        expect.stringContaining("Codex adapter"),
      ]),
    );
    expect(
      preflight.checks.find((check) => check.name === "Product worktree"),
    ).toMatchObject({ status: "warning" });
  });

  it("resolves the delivery lock from an explicit manual acknowledgement", async () => {
    const config = await fixture();
    await fs.writeFile(
      path.join(config.deliveryRepository, "delivery.lock"),
      "lock_version: 1\nstatus: unresolved\n",
    );
    await run("git", ["-C", config.productRepository, "init", "-q"]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.email",
      "lock-test@example.invalid",
    ]);
    await run("git", [
      "-C",
      config.productRepository,
      "config",
      "user.name",
      "Lock test",
    ]);
    await fs.writeFile(
      path.join(config.productRepository, "README.md"),
      "baseline\n",
    );
    await run("git", ["-C", config.productRepository, "add", "."]);
    await run("git", [
      "-C",
      config.productRepository,
      "commit",
      "-qm",
      "baseline",
    ]);
    const productRevision = (
      await run("git", ["-C", config.productRepository, "rev-parse", "HEAD"])
    ).stdout.trim();
    await fs.appendFile(
      path.join(config.productRepository, "README.md"),
      "operator-reviewed change\n",
    );
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    const repository = new DeliveryRepository(config, state);

    await expect(
      repository.resolveDeliveryLock({ acknowledged: false }),
    ).rejects.toThrow("operator acknowledgement");
    const resolution = await repository.resolveDeliveryLock({
      acknowledged: true,
      note: "Approved for the pilot run.",
    });
    expect(resolution).toMatchObject({
      status: "resolved",
      dirtyRepositories: ["product"],
    });
    expect(resolution.contractCount).toBeGreaterThan(0);
    const lock = parse(
      await fs.readFile(
        path.join(config.deliveryRepository, "delivery.lock"),
        "utf8",
      ),
    ) as Record<string, any>;
    expect(lock).toMatchObject({
      lock_version: 1,
      status: "resolved",
      resolution: {
        mode: "manual_operator_attestation",
        note: "Approved for the pilot run.",
        policy: { repository_changes: "warning" },
      },
      repositories: {
        product: {
          revision: productRevision,
          working_tree: "dirty",
        },
      },
    });
    expect(lock.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "urn:odoo-development-factory:schema:approval:1",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    const snapshot = await repository.snapshot();
    expect(snapshot.system.lockStatus).toBe("resolved");
    expect(snapshot.blockers).not.toContain(
      "delivery.lock is unresolved; governed execution is blocked.",
    );
    const preflight = await repository.preflight({ adapter: "fake" });
    expect(
      preflight.checks.find((check) => check.name === "Product worktree"),
    ).toMatchObject({ status: "warning" });
    expect(preflight.blockers).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Product worktree")]),
    );
  });

  it("validates plan identifiers and makes identical draft saves idempotent", async () => {
    const config = await fixture();
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    const markdown = canonicalRunPlanMarkdown();
    const first = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown,
    });
    const second = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown,
    });
    expect(second.id).toBe(first.id);
    expect(
      (await repository.snapshot()).artifacts.find(
        (artifact) => artifact.id === first.id,
      )?.relatedRequirementId,
    ).toBe(requirement.id);
    expect(
      (
        await fs.readdir(path.join(config.deliveryRepository, "run-plans"))
      ).filter((file) => file.startsWith(first.id)),
    ).toHaveLength(2);
    await repository.recordDecision({
      artifactId: first.id,
      kind: "run_plan",
      decision: "approved",
    });
    const firstSidecarPath = path.join(
      config.deliveryRepository,
      first.path.replace(/\.md$/i, ".sidecar.json"),
    );
    const firstSidecar = JSON.parse(
      await fs.readFile(firstSidecarPath, "utf8"),
    );
    expect(firstSidecar).toMatchObject({
      planning: {
        affected_modules: ["web"],
        dependencies: [],
        forbidden_paths: ["delivery/**"],
        database_concerns: ["No migration expected."],
        conflicts: [],
        product_baseline: "a".repeat(40),
      },
      phases: [
        {
          phase_id: "PH-01",
          title: "Foundation",
          status: "not_started",
          tasks: [
            {
              task_id: "TASK-01-01",
              title: "Add the menu service",
              status: "not_started",
              allowed_paths: ["addons/**"],
              validation: ["Run the focused module tests."],
            },
          ],
        },
      ],
    });
    firstSidecar.planning.forbidden_paths = ["delivery/**", "addons/**"];
    await fs.writeFile(
      firstSidecarPath,
      JSON.stringify(firstSidecar, null, 2) + "\n",
    );
    const boundaryPackage = await repository.saveWorkPackageDraft(
      [{ runPlanId: first.id, sequence: 1 }],
      "Boundary conflict",
    );
    await repository.recordDecision({
      artifactId: boundaryPackage.id,
      kind: "work_package",
      decision: "approved",
    });
    const boundaryPreflight = await repository.preflight({
      workPackageId: boundaryPackage.id,
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    expect(boundaryPreflight.ready).toBe(false);
    expect(boundaryPreflight.blockers).toContainEqual(
      expect.stringContaining(
        "overlapping allowed and forbidden path boundaries",
      ),
    );
    await expect(repository.analyzeRunPlans([first.id])).resolves.toMatchObject(
      {
        plans: [
          {
            runPlanId: first.id,
            affectedModules: ["web"],
            forbiddenPaths: ["delivery/**", "addons/**"],
            databaseConcerns: ["No migration expected."],
            productBaseline: "a".repeat(40),
          },
        ],
        productBaselines: ["a".repeat(40)],
      },
    );
    const dependentPlan = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({
        title: "Context menu integration",
        phaseId: "PH-02",
        taskId: "TASK-02-01",
        dependencies: [first.id],
      }),
    });
    await repository.recordDecision({
      artifactId: dependentPlan.id,
      kind: "run_plan",
      decision: "approved",
    });
    const multiPlanPackage = await repository.saveWorkPackageDraft(
      [
        { runPlanId: first.id, sequence: 1 },
        { runPlanId: dependentPlan.id, sequence: 2 },
      ],
      "Dependency-aware multi-plan package",
    );
    await expect(
      repository.readArtifact(multiPlanPackage.id),
    ).resolves.toMatchObject({
      content: expect.stringContaining(dependentPlan.id),
    });
    const invertedPackage = await repository.saveWorkPackageDraft(
      [
        { runPlanId: dependentPlan.id, sequence: 1 },
        { runPlanId: first.id, sequence: 2 },
      ],
      "Invalid dependency order",
    );
    await repository.recordDecision({
      artifactId: invertedPackage.id,
      kind: "work_package",
      decision: "approved",
    });
    const invertedPreflight = await repository.preflight({
      workPackageId: invertedPackage.id,
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    expect(invertedPreflight.blockers).toContainEqual(
      expect.stringContaining("Dependency order is invalid"),
    );
    await expect(
      repository.analyzeRunPlans([first.id, dependentPlan.id]),
    ).resolves.toMatchObject({
      dependencyEdges: [
        {
          from: first.id,
          to: dependentPlan.id,
        },
      ],
      pathOverlaps: [
        {
          left: first.id,
          right: dependentPlan.id,
        },
      ],
    });
    await expect(
      repository.validateSequenceProposal([first.id, dependentPlan.id], {
        ordered_run_plan_ids: [dependentPlan.id, first.id],
        rationale: "Invalid dependency inversion",
      }),
    ).rejects.toThrow("violates dependency order");
    const inconsistentPlan = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({
        title: "Context menu migration",
        phaseId: "PH-03",
        taskId: "TASK-03-01",
        baseline: "b".repeat(40),
      }),
    });
    await repository.recordDecision({
      artifactId: inconsistentPlan.id,
      kind: "run_plan",
      decision: "approved",
    });
    await expect(
      repository.validateSequenceProposal([first.id, inconsistentPlan.id], {
        ordered_run_plan_ids: [first.id, inconsistentPlan.id],
        rationale: "Inconsistent baselines",
      }),
    ).rejects.toThrow("inconsistent product baselines");
    await expect(
      repository.saveRunPlanDraft({
        requirementId: requirement.id,
        markdown: markdown.replace("    - Run the focused module tests.", ""),
      }),
    ).rejects.toThrow("must include at least one verification step");

    const unboundPlan = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({
        phaseId: "PH-06",
        taskId: "TASK-06-01",
      }),
    });
    const unboundPath = path.join(
      config.deliveryRepository,
      unboundPlan.path.replace(/\.md$/i, ".sidecar.json"),
    );
    const unboundSidecar = JSON.parse(await fs.readFile(unboundPath, "utf8"));
    unboundSidecar.requirement.sha256 = "c".repeat(64);
    await fs.writeFile(
      unboundPath,
      JSON.stringify(unboundSidecar, null, 2) + "\n",
    );
    await repository.recordDecision({
      artifactId: unboundPlan.id,
      kind: "run_plan",
      decision: "approved",
    });
    const unboundPackage = await repository.saveWorkPackageDraft(
      [{ runPlanId: unboundPlan.id, sequence: 1 }],
      "Unbound requirement package",
    );
    await repository.recordDecision({
      artifactId: unboundPackage.id,
      kind: "work_package",
      decision: "approved",
    });
    const unboundPreflight = await repository.preflight({
      workPackageId: unboundPackage.id,
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    expect(unboundPreflight.blockers).toContainEqual(
      expect.stringContaining(
        "missing approval for its exact requirement revision",
      ),
    );

    const cycleA = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({
        phaseId: "PH-04",
        taskId: "TASK-04-01",
        dependencies: ["RP-CYCLE-B"],
      }),
    });
    const cycleB = await repository.saveRunPlanDraft({
      requirementId: requirement.id,
      markdown: canonicalRunPlanMarkdown({
        phaseId: "PH-05",
        taskId: "TASK-05-01",
        dependencies: [cycleA.id],
      }),
    });
    const cycleAPath = path.join(
      config.deliveryRepository,
      cycleA.path.replace(/\.md$/i, ".sidecar.json"),
    );
    const cycleASidecar = JSON.parse(await fs.readFile(cycleAPath, "utf8"));
    cycleASidecar.planning.dependencies = [cycleB.id];
    await fs.writeFile(
      cycleAPath,
      JSON.stringify(cycleASidecar, null, 2) + "\n",
    );
    await repository.recordDecision({
      artifactId: cycleA.id,
      kind: "run_plan",
      decision: "approved",
    });
    await repository.recordDecision({
      artifactId: cycleB.id,
      kind: "run_plan",
      decision: "approved",
    });
    await expect(
      repository.analyzeRunPlans([cycleA.id, cycleB.id]),
    ).resolves.toMatchObject({
      dependencyCycles: [[cycleA.id, cycleB.id, cycleA.id]],
    });
    await expect(
      repository.validateSequenceProposal([cycleA.id, cycleB.id], {
        ordered_run_plan_ids: [cycleA.id, cycleB.id],
        rationale: "Cycle must be rejected",
      }),
    ).rejects.toThrow("cyclic dependencies");
  });

  it("activates execution phases sequentially and completes the plan deterministically", async () => {
    const config = await fixture();
    const sidecarPath = path.join(
      config.deliveryRepository,
      "run-plans",
      "implementation-plan.sidecar.json",
    );
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
    sidecar.phases.push({
      phase_id: "PH-02",
      title: "Verification",
      status: "not_started",
      tasks: [
        {
          task_id: "TASK-02",
          title: "Verify the context menu",
          status: "not_started",
          allowed_paths: ["addons/**"],
        },
      ],
    });
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const snapshot = await repository.snapshot();
    const requirement = snapshot.artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    const plan = snapshot.artifacts.find(
      (artifact) => artifact.kind === "run_plan",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
    });
    await repository.recordDecision({
      artifactId: plan.id,
      kind: "run_plan",
      decision: "approved",
    });
    const first = await repository.prepareExecutionProgress({
      runId: "RUN-PHASES",
      workPackageId: "WP-PHASES",
      runPlanId: plan.id,
    });
    expect(first).toMatchObject({
      firstPhaseId: "PH-01",
      phaseOrdinal: 1,
      phaseCount: 2,
    });
    await expect(
      repository.prepareNextExecutionPhase("RUN-PHASES"),
    ).rejects.toThrow("Current phase functionality is incomplete");
    await repository.saveExecutionProgress({
      run_id: first.progress.run_id,
      work_package_id: first.progress.work_package_id,
      run_plan_id: first.progress.run_plan_id,
      run_plan_revision: first.progress.run_plan_revision,
      status: "in_progress",
      current_phase_id: "PH-01",
      current_task_id: "TASK-01",
      phases: [
        { phase_id: "PH-01", status: "complete" },
        { phase_id: "PH-02", status: "not_started" },
      ],
      tasks: [
        { task_id: "TASK-01", status: "complete" },
        { task_id: "TASK-02", status: "not_started" },
      ],
    });
    const second = await repository.prepareNextExecutionPhase("RUN-PHASES");
    expect(second).toMatchObject({
      firstPhaseId: "PH-02",
      firstTaskId: "TASK-02",
      phaseOrdinal: 2,
      phaseCount: 2,
      progress: {
        status: "in_progress",
        current_phase_id: "PH-02",
        current_task_id: "TASK-02",
      },
    });
    expect(second?.progress.phases).toContainEqual({
      phase_id: "PH-02",
      status: "in_progress",
    });
    expect(second?.progress.tasks).toContainEqual({
      task_id: "TASK-02",
      status: "in_progress",
    });
    await repository.saveExecutionProgress({
      run_id: second!.progress.run_id,
      work_package_id: second!.progress.work_package_id,
      run_plan_id: second!.progress.run_plan_id,
      run_plan_revision: second!.progress.run_plan_revision,
      status: "in_progress",
      current_phase_id: "PH-02",
      current_task_id: "TASK-02",
      phases: [
        { phase_id: "PH-01", status: "complete" },
        { phase_id: "PH-02", status: "complete" },
      ],
      tasks: [
        { task_id: "TASK-01", status: "complete" },
        { task_id: "TASK-02", status: "complete" },
      ],
    });
    await expect(
      repository.prepareNextExecutionPhase("RUN-PHASES"),
    ).resolves.toBeNull();
    await expect(
      repository.readExecutionProgress("RUN-PHASES"),
    ).resolves.toMatchObject({
      status: "complete",
      phases: [
        { phase_id: "PH-01", status: "complete" },
        { phase_id: "PH-02", status: "complete" },
      ],
    });
  });

  it("rejects artifacts whose filesystem target escapes through a symlink", async () => {
    const config = await fixture();
    const outside = path.join(
      path.dirname(config.deliveryRepository),
      "outside.md",
    );
    await fs.writeFile(outside, "outside delivery root\n");
    await fs.symlink(
      outside,
      path.join(config.deliveryRepository, "requirements", "escape.md"),
      "file",
    );
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const escape = (await repository.snapshot()).artifacts.find((artifact) =>
      artifact.path.endsWith("requirements/escape.md"),
    );
    expect(escape).toBeDefined();
    await expect(repository.readArtifact(escape!.id)).rejects.toThrow(
      "escaped the delivery repository",
    );
  });

  it("does not leave a partial approval when durable replacement is interrupted", async () => {
    const config = await fixture();
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("simulated durable-write interruption"));
    await expect(
      repository.recordDecision({
        artifactId: requirement.id,
        kind: "requirement",
        decision: "approved",
      }),
    ).rejects.toThrow("simulated durable-write interruption");
    rename.mockRestore();
    const approvalDirectory = path.join(
      config.deliveryRepository,
      "control",
      "approvals",
    );
    expect(
      (await fs.readdir(approvalDirectory)).filter((file) =>
        file.endsWith(".json"),
      ),
    ).toHaveLength(0);
    expect(
      (await fs.readdir(approvalDirectory)).filter((file) =>
        file.endsWith(".tmp"),
      ),
    ).toHaveLength(0);
  });

  it("resets workflow decisions while preserving authored artifacts", async () => {
    const config = await fixture();
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    config.schemaDirectory = path.resolve(process.cwd(), "../../../schemas");
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const requirement = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.kind === "requirement",
    )!;
    await repository.recordDecision({
      artifactId: requirement.id,
      kind: "requirement",
      decision: "approved",
      revision: requirement.revision,
      digest: requirement.digest,
    });
    for (const directory of ["control/dispositions", "control/commands"]) {
      const absoluteDirectory = path.join(config.deliveryRepository, directory);
      await fs.mkdir(absoluteDirectory, { recursive: true });
      await fs.writeFile(
        path.join(absoluteDirectory, "generated.json"),
        "{}\n",
      );
    }

    const result = await repository.resetWorkflowDecisions();
    expect(result.removed["control/approvals"]).toBe(1);
    expect(result.removed["control/events"]).toBe(1);
    expect(result.removed["control/dispositions"]).toBe(1);
    expect(result.removed["control/commands"]).toBe(1);
    await expect(
      fs.access(path.join(config.deliveryRepository, requirement.path)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          config.deliveryRepository,
          "run-plans",
          "implementation-plan.md",
        ),
      ),
    ).resolves.toBeUndefined();
    expect((await repository.snapshot()).runtimeActions).toEqual([
      expect.objectContaining({ actionType: "repository_reset" }),
    ]);
  });
});
