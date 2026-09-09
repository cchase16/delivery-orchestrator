import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const roots: string[] = [];
const children: ChildProcess[] = [];

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(
  port: number,
  route: string,
  init?: RequestInit,
): Promise<{ response: Response; value: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, init);
  const value = (await response.json()) as any;
  return { response, value };
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const { response } = await request(port, "/api/health");
      if (response.ok) return;
    } catch {
      /* The child is still starting. */
    }
    await delay(100);
  }
  throw new Error("Dashboard API did not become healthy.");
}

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill();
        }),
    ),
  );
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("dashboard HTTP integration", () => {
  it("runs the governed workflow end to end with the fake adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-http-"));
    roots.push(root);
    const delivery = path.join(root, "delivery");
    const product = path.join(root, "product");
    const runtime = path.join(delivery, ".factory-local");
    const port = 4317;
    for (const directory of [
      "requirements",
      "run-plans",
      "system-plans",
      "work-packages",
      "control/approvals",
      "control/events",
      "control/commands",
      "evidence",
      "releases",
      "runs",
    ])
      await fs.mkdir(path.join(delivery, directory), { recursive: true });
    await fs.mkdir(product, { recursive: true });
    await fs.writeFile(
      path.join(delivery, "system.yaml"),
      [
        "schema_version: 1",
        "system:",
        "  id: integration-system",
        "  name: Integration system",
        "repositories:",
        "  product:",
        "    local_path: ../product",
        "  delivery_orchestrator:",
        "    local_path: ../delivery-orchestrator",
        "  requirements_factory:",
        "    local_path: ../requirements-factory",
        "  development_factory:",
        "    local_path: ../Odoo-development-factory",
        "requirements:",
        "  directory: requirements",
        "delivery:",
        "  system_plan_directory: system-plans",
        "  work_package_directory: work-packages",
        "  run_plan_directory: run-plans",
        "  evidence_directory: evidence",
        "  release_directory: releases",
        "  command_directory: control/commands",
        "  approval_directory: control/approvals",
        "  run_directory: runs",
      ].join("\n") + "\n",
    );
    await fs.writeFile(
      path.join(delivery, "delivery.lock"),
      "lock_version: 1\nstatus: unresolved\n",
    );
    const requirement = {
      schema_version: 1,
      requirement_id: "REQ-INTEGRATION-CONTEXT",
      revision: 1,
      title: "Integration context menu",
      status: "awaiting_review",
      source: "integration-test",
      acceptance_criteria: ["The context menu is available."],
      affected_modules: ["web"],
      allowed_paths: ["addons/**"],
      forbidden_paths: ["delivery/**"],
    };
    await fs.writeFile(
      path.join(delivery, "requirements", "context-menu.json"),
      JSON.stringify(requirement, null, 2) + "\n",
    );
    await fs.copyFile(
      path.resolve(
        process.cwd(),
        "../../../schemas/system-plans/examples/shared-ux-foundation.example.json",
      ),
      path.join(delivery, "system-plans", "system-plan.json"),
    );
    await fs.writeFile(path.join(product, "README.md"), "# Product\n");
    await run("git", ["-C", product, "init", "-q"]);
    await run("git", [
      "-C",
      product,
      "config",
      "user.email",
      "integration@example.invalid",
    ]);
    await run("git", ["-C", product, "config", "user.name", "Integration"]);
    await run("git", ["-C", product, "add", "."]);
    await run("git", ["-C", product, "commit", "-qm", "baseline"]);
    const baseline = (
      await run("git", ["-C", product, "rev-parse", "HEAD"])
    ).stdout.trim();
    const child = spawn(
      process.execPath,
      [
        path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        "src/backend/server.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DELIVERY_REPOSITORY: delivery,
          PRODUCT_REPOSITORY: product,
          DASHBOARD_RUNTIME: runtime,
          PORT: String(port),
          LOG_LEVEL: "error",
        },
        stdio: "ignore",
      },
    );
    children.push(child);
    await waitForHealth(port);
    const initial = await request(port, "/api/snapshot");
    expect(initial.value.system.lockStatus).toBe("unresolved");
    const unacknowledgedLock = await request(
      port,
      "/api/delivery-lock/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledged: false }),
      },
    );
    expect(unacknowledgedLock.response.status).toBe(409);
    const resolvedLock = await request(port, "/api/delivery-lock/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledged: true, note: "Integration pilot" }),
    });
    expect(resolvedLock.response.ok).toBe(true);
    expect(resolvedLock.value).toMatchObject({ status: "resolved" });
    expect(resolvedLock.value.contractCount).toBeGreaterThan(0);
    const resolvedSnapshot = await request(port, "/api/snapshot");
    expect(resolvedSnapshot.value.system.lockStatus).toBe("resolved");
    const requirementArtifact = initial.value.artifacts.find(
      (artifact: { kind: string }) => artifact.kind === "requirement",
    );
    expect(requirementArtifact).toBeDefined();
    const approvedRequirement = await request(port, "/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactId: requirementArtifact.id,
        kind: "requirement",
        decision: "approved",
        revision: requirementArtifact.revision,
        digest: requirementArtifact.digest,
      }),
    });
    expect(approvedRequirement.response.ok).toBe(true);
    const generatedPlanTask = await request(port, "/api/prompt-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskType: "run_plan_generation",
        artifactIds: [requirementArtifact.id],
        adapter: "fake",
      }),
    });
    expect(generatedPlanTask.response.ok).toBe(true);
    const promptTasks = await request(port, "/api/prompt-tasks");
    expect(promptTasks.value.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: generatedPlanTask.value.taskId,
          taskType: "run_plan_generation",
          status: "completed",
          adapter: "fake",
        }),
      ]),
    );
    const markdown = `# Integration run plan

## Document status

**Plan status:** \`DRAFT\`

**Execution status:** \`NOT STARTED\`

**Product baseline:** \`${baseline}\`

## Architecture

- **Run-plan dependencies:** None
- **Affected modules:** web
- **Forbidden paths:** \`delivery/**\`
- **Database concerns:** None
- **Known conflicts:** None

## Phased implementation plan

## PH-01 Foundation

**Status:** \`NOT STARTED\`

**Depends on:** None

**Objective:** Implement the menu.

### Development tasks

- [ ] **TASK-01-01 Implement the menu**
  - **Action:** Implement the approved menu behavior.
  - **Deliverable:** Tested menu code.
  - **Allowed paths:**
    - \`addons/**\`
  - **Verification:**
    - Run the focused tests.

### Tests and verification

- Run the focused tests.

### Exit criteria

- The menu is available.

## Acceptance criteria traceability

| Requirement criterion | Planned implementation | Verification | Phase and tasks |
| --- | --- | --- | --- |
| Menu available | Menu code | Focused tests | PH-01 TASK-01-01 |

## Risks and responses

| Risk or assumption | Impact | Response or validation task | Owner | Status |
| --- | --- | --- | --- | --- |
| Compatibility | Rework | Validate in TASK-01-01 | Unassigned | Open |

## Completion rule

Complete only after all checks pass.
`;
    const runPlanDraft = await request(port, "/api/run-plans/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requirementId: requirementArtifact.id,
        markdown,
      }),
    });
    expect(runPlanDraft.response.ok).toBe(true);
    const plan = runPlanDraft.value;
    const approvedPlan = await request(port, "/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactId: plan.id,
        kind: "run_plan",
        decision: "approved",
        revision: plan.revision,
        digest: plan.digest,
      }),
    });
    expect(approvedPlan.response.ok).toBe(true);
    const followUpMarkdown = markdown
      .replace("# Integration run plan", "# Integration follow-up run plan")
      .replaceAll("PH-01", "PH-02")
      .replaceAll("TASK-01-01", "TASK-02-01")
      .replace("Implement the menu.", "Harden the menu.");
    const followUpPlanDraft = await request(port, "/api/run-plans/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requirementId: requirementArtifact.id,
        markdown: followUpMarkdown,
      }),
    });
    expect(followUpPlanDraft.response.ok).toBe(true);
    const followUpPlan = followUpPlanDraft.value;
    const approvedFollowUpPlan = await request(port, "/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactId: followUpPlan.id,
        kind: "run_plan",
        decision: "approved",
        revision: followUpPlan.revision,
        digest: followUpPlan.digest,
      }),
    });
    expect(approvedFollowUpPlan.response.ok).toBe(true);
    const packageDraft = await request(port, "/api/work-packages/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        members: [
          { runPlanId: plan.id, sequence: 1 },
          { runPlanId: followUpPlan.id, sequence: 2 },
        ],
        rationale: "Two-plan integration package",
      }),
    });
    expect(packageDraft.response.ok).toBe(true);
    const packageArtifact = packageDraft.value;
    const approvedPackage = await request(port, "/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactId: packageArtifact.id,
        kind: "work_package",
        decision: "approved",
        revision: packageArtifact.revision,
        digest: packageArtifact.digest,
      }),
    });
    expect(approvedPackage.response.ok).toBe(true);
    const preflight = await request(
      port,
      `/api/preflight?workPackageId=${encodeURIComponent(packageArtifact.id)}&model=gpt-5.6-luna&reasoningEffort=high&adapter=fake`,
    );
    expect(preflight.response.ok).toBe(true);
    expect(preflight.value).toMatchObject({ ready: true, blockers: [] });
    expect(preflight.value.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Work package",
          status: "ready",
        }),
        expect.objectContaining({
          name: "Codex adapter",
          status: "ready",
        }),
      ]),
    );
    const cancelledRun = await request(port, "/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workPackageId: packageArtifact.id,
        title: "Integration context-menu run",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        adapter: "fake",
      }),
    });
    expect(cancelledRun.response.ok).toBe(true);
    expect(cancelledRun.value).toMatchObject({
      status: "in_progress",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
    });
    const cancelled = await request(
      port,
      `/api/runs/${encodeURIComponent(cancelledRun.value.runId)}/control`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      },
    );
    expect(cancelled.response.ok).toBe(true);
    expect(cancelled.value).toMatchObject({
      runId: cancelledRun.value.runId,
      status: "cancelled",
    });
    const started = await request(port, "/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workPackageId: packageArtifact.id,
        title: "Integration context-menu run after cancellation",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        adapter: "fake",
      }),
    });
    expect(started.response.ok).toBe(true);
    expect(started.value).toMatchObject({ status: "in_progress" });
    const snapshotAfterStart = await request(port, "/api/snapshot");
    expect(snapshotAfterStart.value.runtimeActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "implementation_phase_started",
          payload: expect.objectContaining({
            promptMode: "standard",
            phaseId: "PH-01",
            phaseOrdinal: 1,
            executionContext: expect.objectContaining({
              cwd: started.value.worktreePath,
              writableRoots: expect.arrayContaining([
                started.value.worktreePath,
                path.join(product, ".git"),
              ]),
              readOnlyRoots: expect.arrayContaining([
                path.join(delivery, "requirements"),
                path.join(delivery, "control"),
                path.join(root, "delivery-orchestrator"),
                path.join(root, "requirements-factory"),
              ]),
            }),
            requested: expect.objectContaining({
              model: "gpt-5.6-luna",
              reasoningEffort: "high",
            }),
          }),
        }),
      ]),
    );
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    });
    const restartedChild = spawn(
      process.execPath,
      [
        path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        "src/backend/server.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DELIVERY_REPOSITORY: delivery,
          PRODUCT_REPOSITORY: product,
          DASHBOARD_RUNTIME: runtime,
          PORT: String(port),
          LOG_LEVEL: "error",
        },
        stdio: "ignore",
      },
    );
    children.push(restartedChild);
    await waitForHealth(port);
    const reconciled = await request(port, "/api/reconcile", {
      method: "POST",
    });
    expect(reconciled.response.ok).toBe(true);
    expect(reconciled.value.activeRun).toMatchObject({
      runId: started.value.runId,
      status: "blocked",
      currentTask: expect.stringContaining("could not be reconnected"),
    });
    const evidence = await request(port, "/api/validation/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: started.value.runId,
        baseCommit: baseline,
        allowedPaths: ["addons/**"],
        forbiddenPaths: ["delivery/**"],
      }),
    });
    expect(evidence.response.ok).toBe(true);
    expect(evidence.value.outcome).toBe("passed");
    const traceability = await request(port, "/api/validation/traceability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: started.value.runId,
        requirementId: requirementArtifact.id,
        runPlanId: plan.id,
        evidenceIds: [evidence.value.evidenceId],
        criteria: [
          {
            criterionId: "AC-01",
            statement: "The context menu is available.",
            taskIds: ["TASK-01-01"],
            checkNames: ["Repository and schema validation"],
          },
        ],
      }),
    });
    expect(traceability.response.ok).toBe(true);
    expect(traceability.value).toMatchObject({
      path: expect.stringMatching(/^evidence\/traceability\/TRC-.*\.json$/),
      manifest: expect.objectContaining({
        run_id: started.value.runId,
        criteria: [expect.objectContaining({ status: "verified" })],
      }),
    });
    const prematureDisposition = await request(
      port,
      "/api/validation/disposition",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: started.value.runId,
          decision: "accepted",
          evidenceIds: [evidence.value.evidenceId],
          reason: "This must remain blocked while execution is incomplete.",
        }),
      },
    );
    expect(prematureDisposition.response.status).toBe(409);
    expect(prematureDisposition.value.error).toContain(
      "current run plan is not complete",
    );
    const completedProgress = await request(
      port,
      `/api/runs/${encodeURIComponent(started.value.runId)}/progress`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          work_package_id: packageArtifact.id,
          run_plan_id: plan.id,
          run_plan_revision: plan.revision,
          status: "complete",
          current_phase_id: "PH-01",
          current_task_id: "TASK-01-01",
          phases: [{ phase_id: "PH-01", status: "complete" }],
          tasks: [{ task_id: "TASK-01-01", status: "complete" }],
        }),
      },
    );
    expect(completedProgress.response.ok).toBe(true);
    const disposition = await request(port, "/api/validation/disposition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: started.value.runId,
        decision: "accepted",
        evidenceIds: [evidence.value.evidenceId],
        reason: "Integration validation passed.",
      }),
    });
    expect(disposition.response.ok).toBe(true);
    const advanced = await request(port, "/api/snapshot");
    expect(advanced.value.activeRun).toMatchObject({
      runId: started.value.runId,
      sequence: 2,
      total: 2,
      status: "in_progress",
    });
    expect(advanced.value.runtimeActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "implementation_phase_started",
          payload: expect.objectContaining({ runPlanId: followUpPlan.id }),
        }),
      ]),
    );
    const secondProgress = await request(
      port,
      `/api/runs/${encodeURIComponent(started.value.runId)}/progress`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          work_package_id: packageArtifact.id,
          run_plan_id: followUpPlan.id,
          run_plan_revision: followUpPlan.revision,
          status: "complete",
          current_phase_id: "PH-02",
          current_task_id: "TASK-02-01",
          phases: [{ phase_id: "PH-02", status: "complete" }],
          tasks: [{ task_id: "TASK-02-01", status: "complete" }],
        }),
      },
    );
    expect(secondProgress.response.ok).toBe(true);
    const staleEvidenceDisposition = await request(
      port,
      "/api/validation/disposition",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: started.value.runId,
          decision: "accepted",
          evidenceIds: [evidence.value.evidenceId],
          reason: "Sequence-one evidence must not validate sequence two.",
        }),
      },
    );
    expect(staleEvidenceDisposition.response.status).toBe(409);
    expect(staleEvidenceDisposition.value.error).toContain(
      "passed validation evidence manifest",
    );
    const secondEvidence = await request(port, "/api/validation/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: started.value.runId,
        baseCommit: baseline,
        allowedPaths: ["addons/**"],
        forbiddenPaths: ["delivery/**"],
      }),
    });
    expect(secondEvidence.response.ok).toBe(true);
    expect(secondEvidence.value.outcome).toBe("passed");
    const finalDisposition = await request(
      port,
      "/api/validation/disposition",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: started.value.runId,
          decision: "accepted",
          evidenceIds: [secondEvidence.value.evidenceId],
          reason: "Follow-up validation passed.",
        }),
      },
    );
    expect(finalDisposition.response.ok).toBe(true);
    const completed = await request(port, "/api/snapshot");
    expect(completed.value.activeRun).toBeNull();
    expect(completed.value.dispositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: started.value.runId,
          decision: "accepted",
        }),
      ]),
    );
    const evidenceDocument = await request(
      port,
      `/api/evidence/${encodeURIComponent(evidence.value.evidenceId)}`,
    );
    expect(evidenceDocument.response.ok).toBe(true);
    expect(evidenceDocument.value).toMatchObject({
      evidence_id: evidence.value.evidenceId,
    });
  }, 30000);
});
