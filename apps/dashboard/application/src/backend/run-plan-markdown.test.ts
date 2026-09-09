import { describe, expect, it } from "vitest";
import { deriveRunPlanSidecar } from "./run-plan-markdown.js";

const validPlan = `# Context Menu Implementation Run Plan

## Document status

**Plan status:** \`DRAFT\`

**Execution status:** \`NOT STARTED\`

**Product baseline:** \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`

## Architecture

- **Run-plan dependencies:** None
- **Affected modules:**
  - web
- **Forbidden paths:**
  - \`delivery/**\`
- **Database concerns:**
  - No migration expected.
- **Known conflicts:** None

## Phased implementation plan

## PH-01 Foundation

**Status:** \`NOT STARTED\`

**Depends on:** None

**Objective:** Establish the extension foundation.

### Development tasks

- [ ] **TASK-01-01 Add the menu service**
  - **Action:** Implement the menu service.
  - **Deliverable:** Tested service code.
  - **Allowed paths:**
    - \`addons/context_menu/**\`
  - **Verification:**
    - Run the focused unit tests.
    - Install the module in a test database.

### Tests and verification

- Run the focused test suite.

### Exit criteria

- The service is available to the supported form view.

## Acceptance criteria traceability

| Requirement criterion | Planned implementation | Verification | Phase and tasks |
| --- | --- | --- | --- |
| Menu opens | Menu service | Focused tests | PH-01 TASK-01-01 |

## Risks and responses

| Risk or assumption | Impact | Response or validation task | Owner | Status |
| --- | --- | --- | --- | --- |
| API compatibility | Rework | TASK-01-01 | Unassigned | Open |

## Completion rule

Complete only after all checks pass.
`;

describe("deriveRunPlanSidecar", () => {
  it("derives the complete machine index from canonical Markdown", () => {
    expect(deriveRunPlanSidecar(validPlan)).toEqual({
      planning: {
        dependencies: [],
        affected_modules: ["web"],
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
              allowed_paths: ["addons/context_menu/**"],
              validation: [
                "Run the focused unit tests.",
                "Install the module in a test database.",
              ],
            },
          ],
        },
      ],
    });
  });

  it("rejects unresolved fields and missing task metadata", () => {
    expect(() =>
      deriveRunPlanSidecar(validPlan.replace("Foundation", "{{PHASE_TITLE}}")),
    ).toThrow("unresolved template fields");
    expect(() =>
      deriveRunPlanSidecar(
        validPlan.replace("    - `addons/context_menu/**`", "    - None"),
      ),
    ).toThrow("must include at least one allowed path");
  });

  it("preserves semicolons inside scalar task fields", () => {
    const plan = validPlan.replace(
      "Implement the menu service.",
      "Inspect the existing service; implement the menu without changing its public API.",
    );
    expect(deriveRunPlanSidecar(plan).phases[0].tasks[0]).toMatchObject({
      task_id: "TASK-01-01",
      title: "Add the menu service",
    });
  });

  it("rejects duplicate stable identifiers", () => {
    const duplicate = validPlan.replace(
      "## Acceptance criteria traceability",
      `${validPlan.slice(validPlan.indexOf("## PH-01 Foundation"), validPlan.indexOf("## Acceptance criteria traceability"))}\n## Acceptance criteria traceability`,
    );
    expect(() => deriveRunPlanSidecar(duplicate)).toThrow(
      "Duplicate run-plan phase identifier: PH-01",
    );
  });
});
