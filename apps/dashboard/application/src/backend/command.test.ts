import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardConfig } from "./config.js";
import { DeliveryRepository } from "./repository.js";
import { RuntimeState } from "./state.js";
import { SchemaRegistry } from "./validation.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-command-"));
  roots.push(root);
  const delivery = path.join(root, "delivery");
  const product = path.join(root, "product");
  await fs.mkdir(delivery, { recursive: true });
  await fs.mkdir(product, { recursive: true });
  await fs.writeFile(
    path.join(delivery, "system.yaml"),
    "system:\n  id: command-test\n  name: Command test\n",
  );
  await fs.writeFile(
    path.join(delivery, "delivery.lock"),
    "status: resolved\n",
  );
  const config: DashboardConfig = {
    deliveryRepository: delivery,
    productRepository: product,
    orchestratorRepository: root,
    schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
    runtimeDirectory: path.join(root, ".factory-local"),
    port: 4100,
  };
  const state = new RuntimeState(config.runtimeDirectory);
  const registry = new SchemaRegistry(config);
  await registry.load();
  return {
    config,
    state,
    registry,
    repository: new DeliveryRepository(config, state, registry),
  };
}

describe("command contract", () => {
  it("validates, authorizes, persists, and deduplicates dashboard commands", async () => {
    const { config, state, repository } = await repositoryFixture();
    const command = {
      schema_version: 1,
      command_id: "CMD-TEST-001",
      command_type: "pause_run",
      idempotency_key: "pause-run-test-001",
      issued_at: new Date().toISOString(),
      issued_by: {
        actor_id: "local-operator",
        actor_type: "human",
        display_name: "Local operator",
        authentication_method: "localhost",
      },
      source: "dashboard",
      target: { system_id: "command-test", run_id: "RUN-TEST-001" },
      preconditions: {
        expected_run_revision: 1,
        expected_run_state: "running",
      },
      payload: { reason: "operator pause" },
    };
    const first = await repository.recordCommand(command);
    const second = await repository.recordCommand(command);
    expect(second).toBe(first);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            config.deliveryRepository,
            "control",
            "commands",
            "CMD-TEST-001.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({ command_id: "CMD-TEST-001", source: "dashboard" });
    await expect(
      repository.recordCommand({
        ...command,
        command_id: "CMD-TEST-002",
        idempotency_key: "pause-run-test-002",
        issued_by: { ...command.issued_by, actor_type: "system" },
      }),
    ).rejects.toThrow("Only a human dashboard actor");
    await expect(
      repository.recordCommand({
        ...command,
        command_id: "CMD-TEST-003",
        idempotency_key: "pause-run-test-003",
        preconditions: {
          ...command.preconditions,
          expected_run_state: "completed",
        },
      }),
    ).rejects.toThrow("not legal from run state completed");
    await expect(
      repository.recordCommand({
        ...command,
        command_id: "CMD-TEST-004",
        idempotency_key: "pause-run-test-004",
        payload: { reason: "" },
      }),
    ).rejects.toThrow("Command is invalid");
    await expect(
      repository.recordCommand({
        command_id: "not-a-command",
      }),
    ).rejects.toThrow("Command is invalid");
    state.close();
  });

  it("accepts every supported legal transition and rejects illegal states", async () => {
    const { state, repository } = await repositoryFixture();
    const transitions = [
      ["pause_run", "ready", { reason: "pause" }],
      ["resume_run", "paused", { resolution_note: "resume" }],
      ["cancel_run", "requested", { reason: "cancel" }],
      ["retry_task", "failed", { reason: "retry" }],
      ["request_replan", "blocked", { reason: "replan" }],
    ] as const;
    for (const [
      index,
      [commandType, expectedRunState, payload],
    ] of transitions.entries()) {
      await expect(
        repository.recordCommand({
          schema_version: 1,
          command_id: `CMD-TRANSITION-${index + 1}`,
          command_type: commandType,
          idempotency_key: `transition-test-${index + 1}`,
          issued_at: new Date().toISOString(),
          issued_by: {
            actor_id: "local-operator",
            actor_type: "human",
            display_name: "Local operator",
            authentication_method: "localhost",
          },
          source: "dashboard",
          target: { system_id: "command-test", run_id: "RUN-TEST-001" },
          preconditions: {
            expected_run_revision: 1,
            expected_run_state: expectedRunState,
          },
          payload,
        }),
      ).resolves.toMatch(/^ACT-/);
      await expect(
        repository.recordCommand({
          schema_version: 1,
          command_id: `CMD-ILLEGAL-${index + 1}`,
          command_type: commandType,
          idempotency_key: `illegal-transition-test-${index + 1}`,
          issued_at: new Date().toISOString(),
          issued_by: {
            actor_id: "local-operator",
            actor_type: "human",
            display_name: "Local operator",
            authentication_method: "localhost",
          },
          source: "dashboard",
          target: { system_id: "command-test", run_id: "RUN-TEST-001" },
          preconditions: {
            expected_run_revision: 1,
            expected_run_state: "completed",
          },
          payload,
        }),
      ).rejects.toThrow("not legal from run state completed");
    }
    state.close();
  });
});
