import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SchemaRegistry } from "./validation.js";
import type { DashboardConfig } from "./config.js";

describe("SchemaRegistry", () => {
  it("loads the dashboard contracts and rejects an incomplete run plan", async () => {
    const config = {
      schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
    } as DashboardConfig;
    const registry = new SchemaRegistry(config);
    await registry.load();
    const result = registry.validate(
      "urn:odoo-development-factory:schema:run-plan:1",
      { schema_version: 1, run_plan_id: "RP-TEST", revision: 1 },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts the v1 dashboard contract examples", async () => {
    const config = {
      schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
    } as DashboardConfig;
    const registry = new SchemaRegistry(config);
    await registry.load();
    const artifact = {
      id: "REQ-TEST",
      revision: 1,
      path: "requirements/REQ-TEST.md",
      sha256: "a".repeat(64),
    };
    const cases: Array<[string, unknown]> = [
      [
        "urn:odoo-development-factory:schema:requirement:1",
        {
          schema_version: 1,
          requirement_id: "REQ-TEST",
          revision: 1,
          title: "Test",
          status: "awaiting_review",
          source: "test",
          acceptance_criteria: ["It works"],
        },
      ],
      [
        "urn:odoo-development-factory:schema:acceptance-traceability:1",
        {
          schema_version: 1,
          traceability_id: "TRC-TEST",
          run_id: "RUN-TEST",
          requirement: artifact,
          run_plan: { ...artifact, id: "RP-TEST" },
          criteria: [
            {
              criterion_id: "AC-01",
              statement: "It works",
              task_ids: ["TASK-01"],
              check_names: ["unit"],
              status: "verified",
            },
          ],
          evidence_ids: ["EVD-TEST"],
        },
      ],
      [
        "urn:odoo-development-factory:schema:run-plan:1",
        {
          schema_version: 1,
          run_plan_id: "RP-TEST",
          revision: 1,
          requirement: artifact,
          document: { ...artifact, id: "RP-TEST" },
          phases: [
            {
              phase_id: "PH-01",
              title: "Build",
              status: "not_started",
              tasks: [
                {
                  task_id: "TASK-01",
                  title: "Implement",
                  status: "not_started",
                },
              ],
            },
          ],
        },
      ],
      [
        "urn:odoo-development-factory:schema:work-package:1",
        {
          schema_version: 1,
          work_package_id: "WP-TEST",
          revision: 1,
          status: "draft",
          members: [
            {
              run_plan_id: "RP-TEST",
              revision: 1,
              path: "run-plans/RP-TEST.md",
              sha256: "b".repeat(64),
              sequence: 1,
            },
          ],
        },
      ],
      [
        "urn:odoo-development-factory:schema:model-profile:1",
        {
          schema_version: 1,
          task_type: "run_plan_generation",
          model: "gpt-5.6-sol",
          reasoning_effort: "medium",
          prompt_mode: "standard",
          adapter: "fake",
        },
      ],
      [
        "urn:odoo-development-factory:schema:execution-progress:1",
        {
          schema_version: 1,
          run_id: "RUN-TEST",
          work_package_id: "WP-TEST",
          run_plan_id: "RP-TEST",
          run_plan_revision: 1,
          status: "ready",
          tasks: [{ task_id: "TASK-01", status: "not_started" }],
          updated_at: "2026-09-06T00:00:00Z",
        },
      ],
      [
        "urn:odoo-development-factory:schema:validation-evidence:1",
        {
          schema_version: 1,
          evidence_id: "EVD-TEST",
          run_id: "RUN-TEST",
          outcome: "passed",
          checks: [{ name: "unit", status: "passed", exit_code: 0 }],
        },
      ],
    ];
    for (const [schemaId, value] of cases)
      expect(registry.validate(schemaId, value).valid, schemaId).toBe(true);
  });

  it("accepts the checked-in system-plan example", async () => {
    const config = {
      schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
    } as DashboardConfig;
    const registry = new SchemaRegistry(config);
    await registry.load();
    const example = JSON.parse(
      await fs.readFile(
        path.resolve(
          process.cwd(),
          "../../../schemas/system-plans/examples/shared-ux-foundation.example.json",
        ),
        "utf8",
      ),
    );
    expect(
      registry.validate(
        "urn:odoo-development-factory:schema:system-plan:1",
        example,
      ).valid,
    ).toBe(true);
    expect(example.naming_convention).toMatchObject({
      generic_prefix: "CW",
      system_name_format: "{prefix}_{PascalCaseName}",
      odoo_addon_technical_name_format: "{prefix_lower}_{snake_case_name}",
    });

    const invalidConvention = structuredClone(example);
    invalidConvention.naming_convention.generic_prefix = "customer";
    expect(
      registry.validate(
        "urn:odoo-development-factory:schema:system-plan:1",
        invalidConvention,
      ).valid,
    ).toBe(false);
  });

  it("accepts every checked-in valid example and rejects invalid examples", async () => {
    const config = {
      schemaDirectory: path.resolve(process.cwd(), "../../../schemas"),
    } as DashboardConfig;
    const registry = new SchemaRegistry(config);
    await registry.load();
    const examples: Array<[string, string, boolean]> = [
      [
        "requirements/examples/requirement.example.json",
        "urn:odoo-development-factory:schema:requirement:1",
        true,
      ],
      [
        "requirements/examples/invalid-requirement.example.json",
        "urn:odoo-development-factory:schema:requirement:1",
        false,
      ],
      [
        "run-plans/examples/run-plan.example.json",
        "urn:odoo-development-factory:schema:run-plan:1",
        true,
      ],
      [
        "run-plans/examples/invalid-run-plan.example.json",
        "urn:odoo-development-factory:schema:run-plan:1",
        false,
      ],
      [
        "work-packages/examples/work-package.example.json",
        "urn:odoo-development-factory:schema:work-package:1",
        true,
      ],
      [
        "work-packages/examples/invalid-work-package.example.json",
        "urn:odoo-development-factory:schema:work-package:1",
        false,
      ],
      [
        "work-packages/examples/sequence-proposal.example.json",
        "urn:odoo-development-factory:schema:sequence-proposal:1",
        true,
      ],
      [
        "work-packages/examples/invalid-sequence-proposal.example.json",
        "urn:odoo-development-factory:schema:sequence-proposal:1",
        false,
      ],
      [
        "model-profiles/examples/model-profile.example.json",
        "urn:odoo-development-factory:schema:model-profile:1",
        true,
      ],
      [
        "model-profiles/examples/invalid-model-profile.example.json",
        "urn:odoo-development-factory:schema:model-profile:1",
        false,
      ],
      [
        "executions/examples/execution-progress.example.json",
        "urn:odoo-development-factory:schema:execution-progress:1",
        true,
      ],
      [
        "executions/examples/invalid-execution-progress.example.json",
        "urn:odoo-development-factory:schema:execution-progress:1",
        false,
      ],
      [
        "evidence/examples/validation-evidence.example.json",
        "urn:odoo-development-factory:schema:validation-evidence:1",
        true,
      ],
      [
        "evidence/examples/invalid-validation-evidence.example.json",
        "urn:odoo-development-factory:schema:validation-evidence:1",
        false,
      ],
      [
        "evidence/examples/result-disposition.example.json",
        "urn:odoo-development-factory:schema:result-disposition:1",
        true,
      ],
      [
        "evidence/examples/invalid-result-disposition.example.json",
        "urn:odoo-development-factory:schema:result-disposition:1",
        false,
      ],
      [
        "approvals/examples/run-plan-approval.example.json",
        "urn:odoo-development-factory:schema:approval:1",
        true,
      ],
      [
        "commands/examples/start-run.example.json",
        "urn:odoo-development-factory:schema:command:1",
        true,
      ],
      [
        "system-plans/examples/shared-ux-foundation.example.json",
        "urn:odoo-development-factory:schema:system-plan:1",
        true,
      ],
      [
        "workflow/examples/run-state.example.json",
        "urn:odoo-development-factory:schema:run-state:1",
        true,
      ],
      [
        "workflow/examples/workflow-event.example.json",
        "urn:odoo-development-factory:schema:workflow-event:1",
        true,
      ],
    ];
    for (const [relative, schemaId, expected] of examples) {
      const value = JSON.parse(
        await fs.readFile(path.join(config.schemaDirectory, relative), "utf8"),
      );
      expect(registry.validate(schemaId, value).valid, relative).toBe(expected);
    }
  });
});
