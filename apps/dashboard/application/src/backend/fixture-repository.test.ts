import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardConfig } from "./config.js";
import { DeliveryRepository } from "./repository.js";
import { RuntimeState } from "./state.js";
import { SchemaRegistry } from "./validation.js";

const run = promisify(execFile);
const roots: string[] = [];
const states: RuntimeState[] = [];

afterEach(async () => {
  for (const state of states.splice(0)) state.close();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("dashboard delivery fixture", () => {
  it("reconstructs approved, rejected, stale, and malformed states", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-fixture-"));
    roots.push(root);
    const source = path.resolve(
      process.cwd(),
      "../../../tests/fixtures/dashboard-delivery",
    );
    const delivery = path.join(root, "delivery");
    const product = path.join(root, "product");
    await fs.cp(source, delivery, { recursive: true });
    await fs.cp(path.join(source, "product"), product, { recursive: true });
    await run("git", ["-C", product, "init", "-q"]);
    await run("git", [
      "-C",
      product,
      "config",
      "user.email",
      "fixture@example.invalid",
    ]);
    await run("git", ["-C", product, "config", "user.name", "Fixture"]);
    await run("git", ["-C", product, "add", "."]);
    await run("git", ["-C", product, "commit", "-qm", "fixture baseline"]);
    const config: DashboardConfig = {
      deliveryRepository: delivery,
      productRepository: product,
      orchestratorRepository: root,
      schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
      runtimeDirectory: path.join(delivery, ".factory-local"),
      port: 4100,
    };
    const state = new RuntimeState(config.runtimeDirectory);
    states.push(state);
    const registry = new SchemaRegistry(config);
    await registry.load();
    const repository = new DeliveryRepository(config, state, registry);
    const snapshot = await repository.snapshot();
    const statuses = new Map(
      snapshot.artifacts.map((artifact) => [artifact.id, artifact.status]),
    );
    expect(
      statuses.get("REQ-FIXTURE-APPROVED"),
      JSON.stringify({
        artifacts: snapshot.artifacts,
        approvals: snapshot.approvals,
      }),
    ).toBe("approved");
    expect(statuses.get("REQ-FIXTURE-REJECTED")).toBe("rejected");
    expect(statuses.get("REQ-FIXTURE-STALE")).toBe("invalid");
    expect(statuses.get("REQ-FIXTURE-SUPERSEDED")).toBe("superseded");
    expect(statuses.has("RP-FIXTURE-VALID")).toBe(true);
    expect(
      snapshot.validationErrors?.some((error) =>
        error.source.includes("RP-FIXTURE-MALFORMED.sidecar.json"),
      ),
    ).toBe(true);
    expect(
      snapshot.validationErrors?.some((error) =>
        error.message.includes("missing run plan"),
      ),
    ).toBe(true);
    expect(snapshot.blockers).toContain(
      "No system plan is present in the configured delivery repository.",
    );
    expect(snapshot.blockers).toContain(
      "One or more approval bindings no longer match the current artifact digest.",
    );
    await expect(
      repository.saveRunPlanDraft({
        requirementId: "REQ-FIXTURE-APPROVED",
        markdown: "# Incomplete\n\n## PH-01\n\n- TASK-01\n",
        sidecar: {},
      }),
    ).rejects.toThrow("verification guidance");
    const saved = await repository.saveRunPlanDraft({
      requirementId: "REQ-FIXTURE-APPROVED",
      markdown:
        "# Generated plan\n\n## PH-01 Build\n\n- TASK-01 Implement the menu.\n\n## Verification\n\nRun tests.\n\n## Exit criteria\n\nThe menu works.\n",
      sidecar: {
        phases: [
          {
            phase_id: "PH-01",
            title: "Build",
            status: "not_started",
            tasks: [
              {
                task_id: "TASK-01",
                title: "Implement the menu",
                status: "not_started",
              },
            ],
          },
        ],
      },
    });
    expect(saved.id).toMatch(/^RP-/);
    expect((await repository.readArtifact(saved.id))?.content).toContain(
      "Generated plan",
    );
    const regenerated = await repository.saveRunPlanDraft({
      requirementId: "REQ-FIXTURE-APPROVED",
      supersedesRunPlanId: saved.id,
      markdown:
        "# Regenerated plan\n\n## PH-01 Build\n\n- TASK-01 Implement the revised menu.\n\n## Verification\n\nRun the revised tests.\n\n## Exit criteria\n\nThe revised menu works.\n",
      sidecar: {
        phases: [
          {
            phase_id: "PH-01",
            title: "Build",
            status: "not_started",
            tasks: [
              {
                task_id: "TASK-01",
                title: "Implement the revised menu",
                status: "not_started",
              },
            ],
          },
        ],
      },
    });
    expect(regenerated.id).toMatch(/^RP-[A-F0-9]{20}$/);
    expect(regenerated.id).not.toBe(saved.id);
    expect(regenerated.revision).toBe(2);
    expect(
      (await repository.snapshot()).artifacts.find(
        (artifact) => artifact.id === regenerated.id,
      ),
    ).toMatchObject({ revision: 2, status: "draft" });
    const baseCommit = (
      await run("git", ["-C", product, "rev-parse", "HEAD"])
    ).stdout.trim();
    const evidence = await repository.recordValidationEvidence({
      runId: "RUN-FIXTURE-001",
      baseCommit,
      allowedPaths: [],
      forbiddenPaths: ["delivery/**"],
    });
    expect(evidence.outcome).toBe("failed");
    expect(evidence.path).toMatch(/^evidence\/EVD-.*\.json$/);
    expect(
      JSON.parse(await fs.readFile(path.join(delivery, evidence.path), "utf8")),
    ).toMatchObject({
      evidence_id: evidence.evidenceId,
      run_id: "RUN-FIXTURE-001",
      outcome: "failed",
    });
    await expect(
      repository.readEvidence(evidence.evidenceId),
    ).resolves.toMatchObject({
      evidence_id: evidence.evidenceId,
      run_id: "RUN-FIXTURE-001",
    });
    await expect(repository.readEvidence("EVD-../outside")).rejects.toThrow(
      "Invalid evidence identifier",
    );
    const productGateEvidence = await repository.recordValidationEvidence({
      runId: "RUN-FIXTURE-001",
      baseCommit,
      allowedPaths: [],
      forbiddenPaths: ["delivery/**"],
      qualityGates: ["product_test"],
    });
    expect(productGateEvidence.checks).toContainEqual(
      expect.objectContaining({ name: "product_test", status: "failed" }),
    );
    state.startRun({
      runId: "RUN-FIXTURE-001",
      workPackageId: "WP-FIXTURE-BROKEN",
      title: "Fixture validation",
      sequence: 1,
      total: 1,
      currentPhase: "PH-01",
      currentTask: "Validation",
      progress: 0,
      status: "blocked",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    await expect(
      repository.recordResultDisposition({
        runId: "RUN-FIXTURE-001",
        decision: "rejected",
        evidenceIds: [evidence.evidenceId],
        reason: "Failed boundary validation requires rework.",
      }),
    ).resolves.toMatchObject({ decision: "rejected" });
    await expect(
      fs.access(
        path.join(
          delivery,
          ".factory-local",
          "logs",
          "RUN-FIXTURE-001-validation.json",
        ),
      ),
    ).resolves.toBeUndefined();
    await repository.recordDecision({
      artifactId: "RP-FIXTURE-VALID",
      kind: "run_plan",
      decision: "approved",
    });
    const approvedPlanDigest = (await repository.snapshot()).artifacts.find(
      (artifact) => artifact.id === "RP-FIXTURE-VALID",
    )!.digest;
    const progress = await repository.saveExecutionProgress({
      run_id: "RUN-FIXTURE-001",
      work_package_id: "WP-FIXTURE-BROKEN",
      run_plan_id: "RP-FIXTURE-VALID",
      run_plan_revision: 1,
      status: "in_progress",
      current_phase_id: "PH-01",
      current_task_id: "TASK-01",
      tasks: [
        { task_id: "TASK-01", status: "in_progress" },
        { task_id: "TASK-02", status: "not_started" },
      ],
    });
    expect(progress.status).toBe("in_progress");
    expect(
      await repository.readExecutionProgress("RUN-FIXTURE-001"),
    ).toMatchObject({ current_task_id: "TASK-01" });
    expect(
      (await repository.snapshot()).artifacts.find(
        (artifact) => artifact.id === "RP-FIXTURE-VALID",
      )!.digest,
    ).toBe(approvedPlanDigest);
    const preflight = await repository.preflight({
      workPackageId: "WP-FIXTURE-BROKEN",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    expect(preflight.ready).toBe(false);
    expect(preflight.blockers).toContain(
      "Work package: Package status is draft",
    );

    let changed = false;
    const stopWatcher = repository.startWatcher(() => {
      changed = true;
    });
    await fs.writeFile(
      path.join(delivery, "control", "watcher-test.json"),
      "{}\n",
    );
    await expect.poll(() => changed, { timeout: 3000 }).toBe(true);
    stopWatcher();

    state.close();
    states.splice(states.indexOf(state), 1);
    await fs.rm(config.runtimeDirectory, { recursive: true, force: true });
    const reconstructedState = new RuntimeState(config.runtimeDirectory);
    states.push(reconstructedState);
    const reconstructedRepository = new DeliveryRepository(
      config,
      reconstructedState,
      registry,
    );
    const reconstructedSnapshot = await reconstructedRepository.snapshot();
    expect(
      reconstructedSnapshot.artifacts.find(
        (artifact) => artifact.id === "RP-FIXTURE-VALID",
      ),
    ).toMatchObject({ status: "approved", digest: approvedPlanDigest });
    expect(
      reconstructedSnapshot.evidence?.some(
        (item) => item.evidenceId === evidence.evidenceId,
      ),
    ).toBe(true);
  }, 15000);
});
