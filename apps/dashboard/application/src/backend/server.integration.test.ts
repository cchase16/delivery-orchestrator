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
      "status: resolved\n",
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
    const markdown =
      "# Integration run plan\n\n## PH-01 Foundation\n\n- TASK-01 Implement the menu.\n\n## Verification\n\nRun the focused tests.\n\n## Exit criteria\n\nThe menu is available.\n";
    const runPlanDraft = await request(port, "/api/run-plans/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requirementId: requirementArtifact.id,
        markdown,
        sidecar: {
          planning: {
            dependencies: [],
            affected_modules: ["web"],
            forbidden_paths: ["delivery/**"],
            database_concerns: [],
            conflicts: [],
            product_baseline: baseline,
          },
          phases: [
            {
              phase_id: "PH-01",
              title: "Foundation",
              status: "not_started",
              tasks: [
                {
                  task_id: "TASK-01",
                  title: "Implement the menu",
                  status: "not_started",
                  allowed_paths: ["addons/**"],
                  validation: ["Run the focused tests."],
                },
              ],
            },
          ],
        },
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
    const packageDraft = await request(port, "/api/work-packages/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        members: [{ runPlanId: plan.id, sequence: 1 }],
        rationale: "Single-plan integration package",
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
          actionType: "implementation_task_started",
          payload: expect.objectContaining({
            promptMode: "goal",
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
            taskIds: ["TASK-01"],
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
