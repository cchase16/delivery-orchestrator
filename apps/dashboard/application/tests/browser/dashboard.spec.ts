import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("operator can move through the planning views", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Run Plans", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run Plans" })).toBeVisible();
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Work Packages", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Suggest sequence", exact: true })
    .click();
  await expect(page.getByText("Sequence suggestion ready")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Prompt profiles" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("completed run-plan generation is recovered after navigation", async ({
  page,
}) => {
  const requirement = {
    id: "REQ-BROWSER-RECOVER",
    title: "Browser recovery requirement",
    kind: "requirement",
    path: "requirements/browser-recovery.md",
    extension: ".md",
    revision: 1,
    digest: "browser-recovery-digest",
    status: "approved",
    updatedAt: "2026-09-11T12:00:00.000Z",
  };
  const output =
    "```markdown\n# Browser recovered implementation plan\n\nComplete plan content.\n```";
  let savedBody: Record<string, unknown> | undefined;
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-09-11T12:00:00.000Z",
        system: {
          id: "browser-test",
          name: "Browser test",
          branch: "main",
          deliveryPath: "delivery",
          lockStatus: "resolved",
        },
        health: [],
        artifacts: [requirement],
        approvals: [],
        activeRun: null,
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
        blockers: [],
      }),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: ["gpt-5.6-sol"],
        reasoningEfforts: ["medium"],
        adapters: [],
      }),
    }),
  );
  await page.route("**/api/prompt-tasks", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tasks: [
          {
            taskId: "THREAD-BROWSER-RECOVER",
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
            templateVersion: "run-plan-generation.v3",
            redactionApplied: false,
          },
        ],
      }),
    }),
  );
  await page.route(
    "**/api/prompt-tasks/THREAD-BROWSER-RECOVER",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "completed", output, events: [] }),
      }),
  );
  await page.route("**/api/artifacts/REQ-BROWSER-RECOVER", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        artifact: requirement,
        content: "# Browser recovery requirement",
        contentType: "text/markdown",
        previewable: true,
      }),
    }),
  );
  await page.route("**/api/run-plans/drafts", async (route) => {
    savedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "RP-BROWSER-RECOVER",
        path: "run-plans/RP-BROWSER-RECOVER.md",
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("button", { name: "Design documents", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Completed run-plan generation" }),
  ).toBeVisible();
  await expect(page.getByLabel("Run-plan Markdown")).toHaveValue(
    /# Browser recovered implementation plan/,
  );
  await page.screenshot({
    path: path.join(os.tmpdir(), "dashboard-run-plan-recovery-fixed.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Validate and save draft" }).click();
  await expect
    .poll(() => savedBody)
    .toEqual({
      requirementId: requirement.id,
      markdown:
        "# Browser recovered implementation plan\n\nComplete plan content.",
    });
});

test("operator answers a blocking questionnaire and resumes execution", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let questionnaireOpen = true;
  let runStatus = "blocked";
  let answerRequest: Record<string, unknown> | undefined;
  let controlRequest: Record<string, unknown> | undefined;
  const questionnaire = {
    schema_version: 1,
    questionnaire_id: "QNR-BROWSER-001",
    run_id: "RUN-BROWSER-001",
    work_package_id: "WP-BROWSER-001",
    run_plan_id: "RP-BROWSER-001",
    run_plan_revision: 1,
    phase_id: "PH-02",
    task_id: "TASK-02-01",
    status: "awaiting_input",
    revision: 1,
    created_at: "2026-09-11T13:00:00.000Z",
    updated_at: "2026-09-11T13:00:00.000Z",
    questions: [
      {
        id: "Q-001",
        status: "open",
        blocking: true,
        question: "Which Odoo version should the phase target?",
        reason: "The framework hook differs by version.",
        answer_type: "single_choice",
        options: ["Odoo 17", "Odoo 18"],
        recommended_answer: "Odoo 18",
        answer: null,
        answered_by: null,
        answered_at: null,
      },
      {
        id: "Q-002",
        status: "open",
        blocking: true,
        question: "What compatibility behavior is required?",
        reason: "The fallback behavior is not specified.",
        answer_type: "text",
        answer: null,
        answered_by: null,
        answered_at: null,
      },
    ],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        system: {
          id: "browser-test",
          name: "Browser test",
          branch: "main",
          deliveryPath: "delivery",
          lockStatus: "resolved",
        },
        health: [],
        artifacts: [],
        approvals: [],
        activeRun: {
          runId: "RUN-BROWSER-001",
          workPackageId: "WP-BROWSER-001",
          title: "Questionnaire implementation",
          startedAt: "2026-09-11T12:55:00.000Z",
          sequence: 1,
          total: 1,
          currentPhase: "PH-02 · Compatibility",
          currentTask: "Awaiting operator answers",
          progress: 35,
          status: runStatus,
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
          taskId: "TASK-BROWSER-QUESTION",
          adapter: "fake",
        },
        promptProfiles: [],
        blockers: [],
      }),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: ["gpt-5.6-luna"],
        reasoningEfforts: ["high"],
        adapters: [],
      }),
    }),
  );
  await page.route("**/api/runs/RUN-BROWSER-001/progress", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: 1,
        run_id: "RUN-BROWSER-001",
        work_package_id: "WP-BROWSER-001",
        run_plan_id: "RP-BROWSER-001",
        run_plan_revision: 1,
        status: "blocked",
        current_phase_id: "PH-02",
        current_task_id: "TASK-02-01",
        phases: [{ phase_id: "PH-02", status: "blocked" }],
        tasks: [{ task_id: "TASK-02-01", status: "blocked" }],
      }),
    }),
  );
  await page.route("**/api/runs/RUN-BROWSER-001/questions", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questionnaire: questionnaireOpen ? questionnaire : null,
      }),
    }),
  );
  await page.route(
    "**/api/runs/RUN-BROWSER-001/questions/answers",
    async (route) => {
      answerRequest = JSON.parse(route.request().postData() ?? "{}");
      questionnaire.status = "answered";
      questionnaire.revision = 2;
      questionnaire.questions.forEach((question) => {
        question.status = "answered";
        question.answer = String(
          (answerRequest?.answers as Record<string, string>)[question.id],
        );
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(questionnaire),
      });
    },
  );
  await page.route("**/api/runs/RUN-BROWSER-001/control", async (route) => {
    controlRequest = JSON.parse(route.request().postData() ?? "{}");
    runStatus = "in_progress";
    questionnaireOpen = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: runStatus }),
    });
  });
  await page.route("**/api/prompt-tasks/TASK-BROWSER-QUESTION", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-BROWSER-QUESTION",
        status: "completed",
        output: "Waiting for operator input.",
        events: [],
      }),
    }),
  );

  await page.goto("/");
  await expect(page).toHaveTitle(/Factory Dashboard/);
  await page.getByRole("button", { name: "Active Runs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Answer blocking questions" }),
  ).toBeVisible();
  const resumeButton = page.getByRole("button", {
    name: "Save answers and resume",
  });
  await expect(resumeButton).toBeDisabled();
  await page
    .getByLabel(/Which Odoo version should the phase target/)
    .selectOption("Odoo 18");
  await page
    .getByLabel(/What compatibility behavior is required/)
    .fill("Use the documented fallback on older supported databases.");
  await expect(resumeButton).toBeEnabled();
  await page.screenshot({
    path: path.join(os.tmpdir(), "dashboard-questionnaire-ready.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForTimeout(250);
  await expect(resumeButton).toBeVisible();
  await page.screenshot({
    path: path.join(os.tmpdir(), "dashboard-questionnaire-mobile.png"),
    fullPage: true,
  });
  await resumeButton.click();
  await expect
    .poll(() => answerRequest)
    .toEqual({
      questionnaireId: "QNR-BROWSER-001",
      answers: {
        "Q-001": "Odoo 18",
        "Q-002": "Use the documented fallback on older supported databases.",
      },
    });
  await expect.poll(() => controlRequest).toEqual({ action: "resume" });
  await expect(
    page.getByRole("heading", { name: "Answer blocking questions" }),
  ).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("Settings exposes the confirmed repository reset action", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reset repository", exact: true }),
  ).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Reset all approval decisions");
    await dialog.dismiss();
  });
  await page
    .getByRole("button", { name: "Reset repository", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reset repository", exact: true }),
  ).toBeVisible();
});

test("sidebar approval badge matches the pending approval count", async ({
  page,
}) => {
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as {
      approvals: Array<Record<string, unknown>>;
    };
    snapshot.approvals = [
      {
        ...(snapshot.approvals[0] ?? {
          id: "APR-ONE",
          type: "requirement",
          title: "Requirement approval",
          artifactId: "REQ-ONE",
          source: "requirements/one.md",
          requestedBy: "Operator",
          requestedAt: new Date().toISOString(),
          priority: "medium",
        }),
        status: "pending",
      },
    ];
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Approvals", exact: true })
      .locator(".nav-count"),
  ).toHaveText("1");
});

test("operator can reach every primary view and filter artifacts", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  const views = [
    ["Requirements", "Requirements"],
    ["Planning", "Planning"],
    ["Run Plans", "Run Plans"],
    ["Work Packages", "Work Packages"],
    ["Approvals", "Approval Inbox"],
    ["Active Runs", "Active Runs"],
    ["Validation", "Validation & Release"],
    ["History", "History"],
    ["Settings", "Prompt profiles"],
  ] as const;
  for (const [navigation, heading] of views) {
    const navButton =
      navigation === "Approvals"
        ? page.getByRole("button", { name: /^Approvals/ })
        : page.getByRole("button", { name: navigation, exact: true });
    await navButton.click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page.getByLabel("Filter artifacts by status").selectOption("approved");
  await expect(
    page.getByRole("button", { name: /Context menu customization/ }),
  ).toBeVisible();
});

test("real repository state exposes governed blockers", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Delivery lock")).toBeVisible();
  await expect(page.getByText("System plan")).toBeVisible();
  await page.getByRole("button", { name: "Validation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Validation & Release" }),
  ).toBeVisible();
});

test("mobile navigation opens, navigates, and closes", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto("/?demo=1");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(
    page.getByRole("button", { name: "Close navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Prompt profiles" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
});

test("review screens expose keyboard focus and accessible status names", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  const overview = page.getByRole("button", { name: "Overview", exact: true });
  await overview.focus();
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute("aria-current", "page");
  expect(
    await overview.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe("none");
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
  await expect(
    page.getByRole("img", { name: /^Status:/ }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Filter artifacts by status")).toBeVisible();
});

test("run-plan review compares revisions and submits the exact approval", async ({
  page,
}) => {
  const decisions: Array<Record<string, unknown>> = [];
  await page.route(
    "**/api/artifacts/RP-ODOO-CONTEXT-MENU/compare/RP-ODOO-MAIN-TABLE",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ changed: true, diff: "- old\n+ revised" }),
      }),
  );
  await page.route("**/api/decisions", async (route) => {
    decisions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actionId: "ACT-BROWSER-REVIEW" }),
    });
  });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Run Plans", exact: true }).click();
  await page
    .getByRole("button", { name: /Context menu implementation run plan/ })
    .click();
  await page
    .getByLabel("Compare with revision")
    .selectOption("RP-ODOO-MAIN-TABLE");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Changes found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Go to main table run plan/ }).click();
  await page.getByRole("button", { name: "Approve exact revision" }).click();
  await expect(page.getByText("Approval recorded")).toBeVisible();
  expect(decisions).toEqual([
    expect.objectContaining({
      artifactId: "RP-ODOO-MAIN-TABLE",
      kind: "run_plan",
      decision: "approved",
      revision: 1,
      digest: "4d7fa102f9c1",
    }),
  ]);
});

test("work-package revision preserves immutable predecessor membership", async ({
  page,
}) => {
  const savedPackages: Array<Record<string, unknown>> = [];
  await page.route("**/api/work-packages/drafts", async (route) => {
    savedPackages.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "WP-BROWSER-REVISION" }),
    });
  });
  await page.goto("/?demo=1");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create revision", exact: true })
    .click();
  await expect(
    page.getByText("Editing WP-SHARED-UX-01 as a new immutable revision"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save new revision", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Work-package revision draft saved"),
  ).toBeVisible();
  expect(savedPackages).toEqual([
    expect.objectContaining({
      supersedesWorkPackageId: "WP-SHARED-UX-01",
      members: [
        { runPlanId: "RP-ODOO-CONTEXT-MENU", sequence: 1 },
        { runPlanId: "RP-ODOO-MAIN-TABLE", sequence: 2 },
      ],
    }),
  ]);
});

test("work-package approval submits the exact membership revision", async ({
  page,
}) => {
  const decisions: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [
      {
        id: "RP-PENDING-001",
        title: "Pending package plan",
        kind: "run_plan",
        path: "run-plans/RP-PENDING-001.md",
        extension: "md",
        revision: 1,
        digest: "b".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T11:00:00.000Z",
        relatedRequirementId: "REQ-PENDING-001",
        phaseCount: 1,
        taskCount: 1,
      },
      {
        id: "WP-PENDING-001",
        title: "Pending package",
        kind: "work_package",
        path: "work-packages/WP-PENDING-001.json",
        extension: "json",
        revision: 3,
        digest: "c".repeat(64),
        status: "draft",
        updatedAt: "2026-09-06T10:00:00.000Z",
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [], reasoningEfforts: [], adapters: [] }),
    }),
  );
  await page.route("**/api/artifacts/WP-PENDING-001", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          members: [
            {
              run_plan_id: "RP-PENDING-001",
              revision: 1,
              path: "run-plans/RP-PENDING-001.md",
              sequence: 1,
            },
          ],
        }),
      }),
    }),
  );
  await page.route("**/api/decisions", async (route) => {
    decisions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actionId: "ACT-BROWSER-PACKAGE" }),
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await page.getByRole("button", { name: "Approve sequence" }).click();
  await expect(page.getByText("Approval recorded")).toBeVisible();
  expect(decisions).toEqual([
    expect.objectContaining({
      artifactId: "WP-PENDING-001",
      kind: "work_package",
      decision: "approved",
      revision: 3,
      digest: "c".repeat(64),
    }),
  ]);
});

test("work-package rejection requires a reason and binds the exact revision", async ({
  page,
}) => {
  const decisions: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [
      {
        id: "WP-REJECT-001",
        title: "Rejected package",
        kind: "work_package",
        path: "work-packages/WP-REJECT-001.json",
        extension: "json",
        revision: 2,
        digest: "d".repeat(64),
        status: "draft",
        updatedAt: "2026-09-06T10:00:00.000Z",
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [], reasoningEfforts: [], adapters: [] }),
    }),
  );
  await page.route("**/api/decisions", async (route) => {
    decisions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actionId: "ACT-BROWSER-REJECT" }),
    });
  });
  page.on("dialog", async (dialog) => dialog.accept("Sequence is incomplete."));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Rejection recorded")).toBeVisible();
  expect(decisions).toEqual([
    expect.objectContaining({
      artifactId: "WP-REJECT-001",
      kind: "work_package",
      decision: "rejected",
      reason: "Sequence is incomplete.",
      revision: 2,
      digest: "d".repeat(64),
    }),
  ]);
});

test("work-package cards link to the full approved run plan", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Work Packages", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Context menu implementation run plan").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "View plan" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Run Plans", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Context menu implementation" }),
  ).toBeVisible();
});

test("artifact decisions submit the exact reviewed revision", async ({
  page,
}) => {
  const decisions: Array<Record<string, unknown>> = [];
  await page.route("**/api/decisions", async (route) => {
    decisions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actionId: "ACT-BROWSER-001" }),
    });
  });
  await page.route("**/api/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  page.on("dialog", async (dialog) => {
    await dialog.accept("Needs another review pass");
  });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Run Plans", exact: true }).click();
  await page.getByRole("button", { name: /Go to main table run plan/ }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Rejection recorded")).toBeVisible();
  expect(decisions).toEqual([
    expect.objectContaining({
      artifactId: "RP-ODOO-MAIN-TABLE",
      kind: "run_plan",
      decision: "rejected",
      reason: "Needs another review pass",
      revision: 1,
      digest: "4d7fa102f9c1",
    }),
  ]);
});

test("requirement approval submits the exact reviewed revision", async ({
  page,
}) => {
  const decisions: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [
      {
        id: "REQ-BROWSER-REVIEW-001",
        title: "Requirement under review",
        kind: "requirement",
        path: "requirements/REQ-BROWSER-REVIEW-001.md",
        extension: "md",
        revision: 4,
        digest: "f".repeat(64),
        status: "awaiting_review",
        updatedAt: "2026-09-06T11:00:00.000Z",
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/decisions", async (route) => {
    decisions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actionId: "ACT-BROWSER-REQUIREMENT" }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page.getByRole("button", { name: /Requirement under review/ }).click();
  await page.getByRole("button", { name: "Approve exact revision" }).click();
  await expect(page.getByText("Approval recorded")).toBeVisible();
  expect(decisions).toEqual([
    expect.objectContaining({
      artifactId: "REQ-BROWSER-REVIEW-001",
      kind: "requirement",
      decision: "approved",
      revision: 4,
      digest: "f".repeat(64),
    }),
  ]);
});

test("run-plan generation saves only the returned Markdown", async ({
  page,
}) => {
  const savedDrafts: Array<Record<string, unknown>> = [];
  const previewRequests: Array<Record<string, unknown>> = [];
  const taskRequests: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [
      {
        id: "REQ-BROWSER-001",
        title: "First approved requirement",
        kind: "requirement",
        path: "requirements/REQ-BROWSER-001.md",
        extension: "md",
        revision: 1,
        digest: "b".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T11:00:00.000Z",
      },
      {
        id: "REQ-BROWSER-002",
        title: "Selected browser requirement",
        kind: "requirement",
        path: "requirements/REQ-BROWSER-002.md",
        extension: "md",
        revision: 2,
        digest: "d".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T11:30:00.000Z",
      },
      {
        id: "SP-BROWSER-001",
        title: "Browser system plan",
        kind: "system_plan",
        path: "system-plans/SP-BROWSER-001.json",
        extension: "json",
        revision: 1,
        digest: "c".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T10:00:00.000Z",
      },
      {
        id: "RP-BROWSER-OLD",
        title: "Previous browser plan",
        kind: "run_plan",
        path: "run-plans/RP-BROWSER-OLD.md",
        extension: "md",
        revision: 1,
        digest: "e".repeat(64),
        status: "rejected",
        updatedAt: "2026-09-06T09:00:00.000Z",
        relatedRequirementId: "REQ-BROWSER-002",
        phaseCount: 1,
        taskCount: 1,
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [
      {
        taskType: "run_plan_generation",
        label: "Run-plan generation",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        promptMode: "standard",
        adapter: "fake",
      },
    ],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) => {
    const savedRunPlan = savedDrafts.length
      ? [
          {
            id: "RP-BROWSER-001",
            title: "Generated browser plan",
            kind: "run_plan",
            path: "run-plans/RP-BROWSER-001.md",
            extension: "md",
            revision: 1,
            digest: "f".repeat(64),
            status: "draft",
            updatedAt: "2026-09-06T12:30:00.000Z",
            relatedRequirementId: "REQ-BROWSER-002",
            phaseCount: 1,
            taskCount: 1,
          },
        ]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...snapshot,
        generatedAt: savedDrafts.length
          ? "2026-09-06T12:30:00.000Z"
          : snapshot.generatedAt,
        artifacts: [...snapshot.artifacts, ...savedRunPlan],
      }),
    });
  });
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: ["gpt-5.6-sol"],
        reasoningEfforts: ["medium"],
        adapters: [{ id: "fake", status: "available", detail: "test" }],
      }),
    }),
  );
  await page.route("**/api/artifacts/**", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ content: "# Browser requirement" }),
    }),
  );
  await page.route("**/api/prompts/preview", async (route) => {
    previewRequests.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        promptMode: "standard",
        reasoningEffort: "medium",
        templateVersion: "run-plan-generation.v3",
        redactionApplied: false,
        prompt: "Generate the plan.",
      }),
    });
  });
  await page.route("**/api/prompt-tasks", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [
            {
              taskId: "TASK-FAKE-HISTORIC",
              taskType: "run_plan_generation",
              status: "unknown",
              output: "",
              events: [],
              adapter: "fake",
              model: "gpt-5.6-sol",
              reasoningEffort: "medium",
              startedAt: "2026-09-06T10:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    taskRequests.push(JSON.parse(route.request().postData() ?? "{}"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-BROWSER",
        adapter: "fake",
        actualModel: "gpt-5.6-sol",
        actualReasoningEffort: "medium",
      }),
    });
  });
  let taskPolls = 0;
  await page.route("**/api/prompt-tasks/TASK-FAKE-BROWSER", async (route) => {
    taskPolls += 1;
    if (taskPolls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          taskId: "TASK-FAKE-BROWSER",
          status: "inProgress",
          output: "Inspecting the approved requirement and product baseline…",
          events: [{ method: "item/agentMessage/delta" }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-BROWSER",
        status: "completed",
        output: [
          "```markdown",
          "# Generated browser plan",
          "",
          "## Document status",
          "",
          "**Plan status:** `DRAFT`",
          "",
          "**Execution status:** `NOT STARTED`",
          "",
          `**Product baseline:** \`${"a".repeat(40)}\``,
          "",
          "## Architecture",
          "",
          "## Phased implementation plan",
          "",
          "## PH-01 Build",
          "",
          "- [ ] **TASK-01-01 Implement the browser requirement**",
          "",
          "## Acceptance criteria traceability",
          "",
          "## Risks and responses",
          "",
          "## Completion rule",
          "```",
        ].join("\n"),
        events: [],
      }),
    });
  });
  await page.route("**/api/run-plans/drafts", async (route) => {
    savedDrafts.push(JSON.parse(route.request().postData() ?? "{}"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "RP-BROWSER-001",
        path: "run-plans/RP-BROWSER-001.md",
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page
    .getByRole("button", { name: /Selected browser requirement/ })
    .click();
  await expect(page.getByText("Recent run-plan tasks")).toBeVisible();
  await expect(page.getByText("TASK-FAKE-HISTORIC")).toBeVisible();
  await page.getByRole("button", { name: "Create run plan" }).click();
  await expect(
    page.getByText("REQ-BROWSER-002", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start standard prompt" }).click();
  await expect(page.getByRole("button", { name: "Starting…" })).toBeVisible();
  await expect(page.getByText("TASK-FAKE-BROWSER")).toBeVisible();
  await expect(
    page.getByText("Inspecting the approved requirement and product baseline…"),
  ).toBeVisible();
  await expect(page.getByText("Save the reviewed model output")).toBeVisible();
  await expect(page.getByLabel("Run-plan Markdown")).toHaveValue(
    /Generated browser plan/,
  );
  await page.getByLabel("Revision request").selectOption("RP-BROWSER-OLD");
  await page.getByRole("button", { name: "Validate and save draft" }).click();
  await expect(
    page.getByRole("button", { name: "Validating and saving…" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved run-plans/RP-BROWSER-001.md"),
  ).toBeVisible();
  expect(savedDrafts).toHaveLength(1);
  expect(savedDrafts[0].markdown).toContain("Generated browser plan");
  expect(savedDrafts[0]).not.toHaveProperty("sidecar");
  expect(savedDrafts[0].requirementId).toBe("REQ-BROWSER-002");
  expect(savedDrafts[0].supersedesRunPlanId).toBe("RP-BROWSER-OLD");
  expect(previewRequests[0].artifactIds).toEqual(["REQ-BROWSER-002"]);
  expect(taskRequests[0].artifactIds).toEqual(["REQ-BROWSER-002"]);
  await expect(
    page.getByRole("button", { name: "View run plan RP-BROWSER-001" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await expect(
    page.getByText("1 approved requirement awaiting a run plan"),
  ).toBeVisible();
  const planningQueue = page.locator(".package-review");
  await expect(
    planningQueue.getByText("First approved requirement"),
  ).toBeVisible();
  await expect(
    planningQueue.getByText("Selected browser requirement"),
  ).toHaveCount(0);
});

test("work-package sequencing applies a validated model proposal", async ({
  page,
}) => {
  const savedPackages: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [
      {
        id: "RP-BROWSER-A",
        title: "Shared foundation plan",
        kind: "run_plan",
        path: "run-plans/RP-BROWSER-A.md",
        extension: "md",
        revision: 1,
        digest: "b".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T11:00:00.000Z",
        phaseCount: 1,
        taskCount: 1,
      },
      {
        id: "RP-BROWSER-B",
        title: "Dependent feature plan",
        kind: "run_plan",
        path: "run-plans/RP-BROWSER-B.md",
        extension: "md",
        revision: 1,
        digest: "c".repeat(64),
        status: "approved",
        updatedAt: "2026-09-06T10:00:00.000Z",
        phaseCount: 1,
        taskCount: 1,
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [
      {
        taskType: "work_package_sequencing",
        label: "Work-package sequencing",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        promptMode: "standard",
        adapter: "fake",
      },
    ],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: ["gpt-5.6-sol"],
        reasoningEfforts: ["medium"],
        adapters: [{ id: "fake", status: "available", detail: "test" }],
      }),
    }),
  );
  await page.route("**/api/work-packages/analyze", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plans: [],
        pathOverlaps: [],
        dependencyEdges: [],
        dependencyCycles: [],
        productBaselines: [],
      }),
    }),
  );
  await page.route("**/api/prompts/preview", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model: "gpt-5.6-sol" }),
    }),
  );
  await page.route("**/api/prompt-tasks", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-SEQUENCE",
        actualModel: "gpt-5.6-sol",
        actualReasoningEffort: "medium",
      }),
    }),
  );
  await page.route("**/api/prompt-tasks/TASK-FAKE-SEQUENCE", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-SEQUENCE",
        status: "completed",
        output: JSON.stringify({
          ordered_run_plan_ids: ["RP-BROWSER-B", "RP-BROWSER-A"],
          rationale: "The dependent feature follows the shared foundation.",
        }),
        events: [],
      }),
    }),
  );
  await page.route("**/api/work-packages/sequence/validate", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        orderedRunPlanIds: ["RP-BROWSER-B", "RP-BROWSER-A"],
        rationale: "The dependent feature follows the shared foundation.",
      }),
    }),
  );
  await page.route("**/api/work-packages/drafts", async (route) => {
    savedPackages.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "WP-BROWSER-001" }),
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  await page.getByRole("button", { name: /Dependent feature plan/ }).click();
  await page
    .getByRole("button", { name: "Suggest sequence", exact: true })
    .click();
  await expect(
    page.getByText("Validated sequence suggestion ready for review"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Work-package draft saved")).toBeVisible();
  expect(savedPackages).toEqual([
    expect.objectContaining({
      members: [
        { runPlanId: "RP-BROWSER-B", sequence: 1 },
        { runPlanId: "RP-BROWSER-A", sequence: 2 },
      ],
    }),
  ]);
});

test("approved work-package member shows its current approval state", async ({
  page,
}) => {
  const runPlanId = "RP-BROWSER-APPROVED";
  const workPackageId = "WP-BROWSER-APPROVED";
  const snapshot = {
    generatedAt: "2026-09-09T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [],
    artifacts: [
      {
        id: runPlanId,
        title: "Approved member plan",
        kind: "run_plan",
        path: `run-plans/${runPlanId}.md`,
        extension: "md",
        revision: 1,
        digest: "b".repeat(64),
        status: "approved",
        updatedAt: "2026-09-09T11:00:00.000Z",
        phaseCount: 1,
        taskCount: 1,
      },
      {
        id: workPackageId,
        title: "Approved package",
        kind: "work_package",
        path: `work-packages/${workPackageId}.json`,
        extension: "json",
        revision: 1,
        digest: "c".repeat(64),
        status: "approved",
        updatedAt: "2026-09-09T11:30:00.000Z",
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route(`**/api/artifacts/${workPackageId}`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          members: [
            {
              run_plan_id: runPlanId,
              revision: 1,
              path: `run-plans/${runPlanId}.md`,
              sequence: 1,
            },
          ],
        }),
      }),
    }),
  );

  await page.goto("/");
  await page
    .getByRole("button", { name: "Work Packages", exact: true })
    .click();
  const member = page.locator(".package-member", {
    hasText: "Approved member plan",
  });
  await expect(member.getByText("Approval", { exact: true })).toBeVisible();
  await expect(member.locator(".status-badge")).toHaveText("approved");
  await expect(
    member.getByText("awaiting review", { exact: true }),
  ).toHaveCount(0);
});

test("active run shows validated phase and task progress", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const snapshot = {
    generatedAt: "2026-09-09T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
    },
    health: [],
    artifacts: [],
    approvals: [],
    activeRun: {
      runId: "RUN-BROWSER-001",
      workPackageId: "WP-BROWSER-001",
      title: "Two-plan implementation",
      startedAt: "2026-09-09T11:55:00.000Z",
      sequence: 1,
      total: 2,
      currentPhase: "PH-01 · Foundation",
      currentTask: "TASK-01 · Build foundation",
      progress: 25,
      status: "in_progress",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      adapter: "fake",
      taskId: "TASK-FAKE-1",
    },
    promptProfiles: [],
    blockers: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/runs/RUN-BROWSER-001/progress", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: 1,
        run_id: "RUN-BROWSER-001",
        work_package_id: "WP-BROWSER-001",
        run_plan_id: "RP-BROWSER-001",
        run_plan_revision: 1,
        status: "in_progress",
        current_phase_id: "PH-01",
        current_task_id: "TASK-02",
        phases: [
          { phase_id: "PH-01", status: "in_progress", note: "Building" },
          { phase_id: "PH-02", status: "not_started" },
        ],
        tasks: [
          { task_id: "TASK-01", status: "complete" },
          { task_id: "TASK-02", status: "in_progress", note: "Testing" },
        ],
      }),
    }),
  );
  await page.route("**/api/prompt-tasks/TASK-FAKE-1", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-1",
        status: "running",
        output: "Implementing TASK-02",
        activity: [
          {
            id: "activity-1",
            kind: "command",
            title: "Running command",
            detail: "npm test",
            status: "inProgress",
          },
        ],
        events: [],
      }),
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Active Runs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Phase and task progress" }),
  ).toBeVisible();
  await expect(page.getByText("Phase prompts", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "PH-01 · Foundation" }),
  ).toBeVisible();
  await expect(
    page.getByText("Live model output", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Implementing TASK-02", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Running command", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("npm test", { exact: true })).toBeVisible();
  await expect(page.getByText("PH-01", { exact: true })).toBeVisible();
  await expect(page.getByText("Phase · in progress · Building")).toBeVisible();
  await expect(page.getByText("TASK-02", { exact: true })).toBeVisible();
  await expect(page.getByText("in progress · Testing")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("operator can cancel a turn without abandoning the run, then cancel the run", async ({
  page,
}) => {
  const controlActions: string[] = [];
  let activeRun: Record<string, unknown> | null = {
    runId: "RUN-CANCEL-CONTROLS",
    workPackageId: "WP-CANCEL-CONTROLS",
    title: "Cancellation controls",
    startedAt: "2026-09-09T12:00:00.000Z",
    sequence: 1,
    total: 1,
    currentPhase: "PH-01 · Foundation",
    currentTask: "TASK-01 · Active implementation",
    progress: 10,
    status: "in_progress",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    adapter: "fake",
    taskId: "TASK-FAKE-CANCEL",
  };
  let latestRun: Record<string, unknown> | null = null;
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-09-09T12:00:00.000Z",
        system: {
          id: "test-system",
          name: "Test system",
          branch: "main",
          deliveryPath: "delivery",
          lockStatus: "resolved",
        },
        health: [],
        artifacts: [],
        approvals: [],
        activeRun,
        latestRun,
        promptProfiles: [],
        blockers: [],
        validationErrors: [],
      }),
    }),
  );
  await page.route("**/api/runs/RUN-CANCEL-CONTROLS/progress", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: 1,
        run_id: "RUN-CANCEL-CONTROLS",
        work_package_id: "WP-CANCEL-CONTROLS",
        run_plan_id: "RP-CANCEL-CONTROLS",
        run_plan_revision: 1,
        status: activeRun?.status ?? "cancelled",
        phases: [{ phase_id: "PH-01", status: "in_progress" }],
        tasks: [{ task_id: "TASK-01", status: "in_progress" }],
      }),
    }),
  );
  await page.route("**/api/prompt-tasks/TASK-FAKE-CANCEL", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "TASK-FAKE-CANCEL",
        status: activeRun?.status === "in_progress" ? "running" : "cancelled",
        output: "Working on the active phase",
        activity: [],
        events: [],
      }),
    }),
  );
  await page.route("**/api/runs/RUN-CANCEL-CONTROLS/control", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    controlActions.push(body.action);
    if (body.action === "cancel_turn" && activeRun) {
      activeRun = {
        ...activeRun,
        status: "blocked",
        currentTask: "Active turn cancelled by local operator",
      };
    } else if (body.action === "cancel" && activeRun) {
      latestRun = { ...activeRun, status: "cancelled" };
      activeRun = null;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activeRun ?? latestRun),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Active Runs", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel active turn", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel run", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Cancel active turn", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel active turn", exact: true }),
  ).toHaveCount(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Cancel and abandon this run");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(
    page.getByText("No active Codex runs", { exact: true }),
  ).toBeVisible();
  expect(controlActions).toEqual(["cancel_turn", "cancel"]);
});

test("failed implementation remains visible with its model error", async ({
  page,
}) => {
  const failedRun = {
    runId: "RUN-BROWSER-FAILED",
    workPackageId: "WP-BROWSER-001",
    title: "Failed implementation",
    startedAt: "2026-09-09T11:55:00.000Z",
    sequence: 1,
    total: 1,
    currentPhase: "PH-01 · Foundation",
    currentTask: "Phase failed · Selected model requires a newer Codex.",
    progress: 0,
    status: "failed",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    adapter: "codex_app_server",
    taskId: "THREAD-FAILED-1",
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-09-09T12:00:00.000Z",
        system: {
          id: "test-system",
          name: "Test system",
          branch: "main",
          deliveryPath: "delivery",
          lockStatus: "resolved",
        },
        health: [],
        artifacts: [],
        approvals: [],
        activeRun: null,
        latestRun: failedRun,
        promptProfiles: [],
        blockers: [],
      }),
    }),
  );
  await page.route("**/api/runs/RUN-BROWSER-FAILED/progress", async (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );
  await page.route("**/api/prompt-tasks/THREAD-FAILED-1", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "THREAD-FAILED-1",
        status: "failed",
        output: "",
        error: "Selected model requires a newer Codex.",
        activity: [
          {
            id: "error-1",
            kind: "error",
            title: "Phase turn failed",
            detail: "Selected model requires a newer Codex.",
            status: "failed",
          },
        ],
        events: [],
      }),
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Active Runs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Failed implementation" }),
  ).toBeVisible();
  await expect(page.locator(".run-task-error")).toContainText(
    "Selected model requires a newer Codex.",
  );
  await expect(page.getByRole("button", { name: "Retry task" })).toBeVisible();
});

test("operator can manually resolve the delivery lock from Validation", async ({
  page,
}) => {
  let lockResolved = false;
  const lockRequests: Array<Record<string, unknown>> = [];
  const snapshot = () => ({
    generatedAt: "2026-09-09T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: lockResolved ? "resolved" : "unresolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      {
        label: "Git",
        status: "warning",
        detail: "main · worktree has changes",
      },
      {
        label: "Codex App Server",
        status: "healthy",
        detail: "Available",
      },
    ],
    artifacts: [
      {
        id: "SPL-BROWSER-001",
        title: "System plan",
        kind: "system_plan",
        path: "system-plans/plan.json",
        extension: "json",
        revision: 1,
        digest: "b".repeat(64),
        status: "approved",
        updatedAt: "2026-09-09T10:00:00.000Z",
      },
      {
        id: "WP-BROWSER-LOCK",
        title: "Approved package",
        kind: "work_package",
        path: "work-packages/package.json",
        extension: "json",
        revision: 1,
        digest: "c".repeat(64),
        status: "approved",
        updatedAt: "2026-09-09T11:00:00.000Z",
      },
    ],
    approvals: [],
    activeRun: null,
    promptProfiles: [
      {
        taskType: "run_plan_execution",
        label: "Run-plan execution",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        promptMode: "goal",
        adapter: "codex_app_server",
      },
    ],
    blockers: lockResolved
      ? []
      : ["delivery.lock is unresolved; governed execution is blocked."],
    validationErrors: [],
  });
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot()),
    }),
  );
  await page.route("**/api/preflight?*", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: lockResolved,
        checks: [
          {
            name: "Delivery lock",
            status: lockResolved ? "ready" : "blocked",
            detail: lockResolved ? "resolved" : "unresolved",
          },
          {
            name: "Product worktree",
            status: "warning",
            detail: "main · worktree has changes",
          },
        ],
        blockers: lockResolved ? [] : ["Delivery lock: unresolved"],
      }),
    }),
  );
  await page.route("**/api/delivery-lock/resolve", async (route) => {
    lockRequests.push(JSON.parse(route.request().postData() ?? "{}"));
    lockResolved = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "resolved",
        repositoryCount: 5,
        contractCount: 12,
        dirtyRepositories: ["product"],
      }),
    });
  });
  page.on("dialog", async (dialog) => dialog.accept());

  await page.goto("/");
  await page.getByRole("button", { name: "Validation", exact: true }).click();
  const readiness = page.locator(".validation-card", {
    hasText: "Readiness checks",
  });
  await expect(readiness.getByText("Blocked · unresolved")).toBeVisible();
  await expect(
    readiness.getByText("Warning · main · worktree has changes"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resolve delivery lock", exact: true })
    .click();
  await expect(
    page.getByText(/Delivery lock resolved with 5 repository bindings/),
  ).toBeVisible();
  await expect(readiness.getByText("Ready · resolved")).toBeVisible();
  await expect(page.getByText("Ready for human review")).toBeVisible();
  expect(lockRequests).toEqual([{ acknowledged: true }]);
});

test("validation review records evidence before accepting a result", async ({
  page,
}) => {
  const dispositions: Array<Record<string, unknown>> = [];
  const traceabilityRecords: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [],
    approvals: [],
    activeRun: {
      runId: "RUN-BROWSER-001",
      workPackageId: "WP-BROWSER-001",
      title: "Browser validation run",
      sequence: 1,
      total: 1,
      currentPhase: "Phase 1 · Implementation",
      currentTask: "Review result",
      progress: 100,
      status: "blocked",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      baseCommit: "a".repeat(40),
      worktreePath: "C:/worktree",
      branch: "factory/RUN-BROWSER-001",
      adapter: "fake",
    },
    promptProfiles: [],
    blockers: [],
    evidence: [],
    dispositions: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [], reasoningEfforts: [], adapters: [] }),
    }),
  );
  await page.route("**/api/diff/review", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            path: "addons/context_menu.py",
            change: " M",
            classification: "allowed",
          },
        ],
        automaticAcceptance: "allowed",
        patch: "diff --git a/addons/context_menu.py b/addons/context_menu.py",
      }),
    }),
  );
  await page.route("**/api/validation/evidence", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        evidenceId: "EVD-BROWSER-001",
        path: "evidence/EVD-BROWSER-001.json",
        outcome: "passed",
        checks: [
          { name: "Git diff boundary review", status: "passed", exitCode: 0 },
        ],
      }),
    }),
  );
  await page.route(
    "**/api/runs/RUN-BROWSER-001/traceability-context",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requirement: { id: "REQ-BROWSER-001", revision: 1 },
          runPlan: { id: "RP-BROWSER-001", revision: 1 },
          criteria: [
            {
              criterionId: "AC-01",
              statement: "The context menu is available.",
              taskIds: ["TASK-01"],
            },
          ],
        }),
      }),
  );
  await page.route("**/api/validation/traceability", async (route) => {
    traceabilityRecords.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ traceabilityId: "TRC-BROWSER-001" }),
    });
  });
  await page.route("**/api/validation/disposition", async (route) => {
    dispositions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dispositionId: "DSP-BROWSER-001" }),
    });
  });
  page.on("dialog", async (dialog) =>
    dialog.accept("Validated by browser test"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Validation", exact: true }).click();
  await page.getByLabel("Allowed paths, one per line").fill("addons/**");
  await page.getByRole("button", { name: "Review diff", exact: true }).click();
  await expect(page.getByText(/automatic acceptance allowed/)).toBeVisible();
  await page.getByRole("button", { name: "Record evidence manifest" }).click();
  await expect(page.getByText(/EVD-BROWSER-001 · passed/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "EVD-BROWSER-001" }),
  ).toHaveAttribute("href", "/api/evidence/EVD-BROWSER-001");
  await expect(
    page.getByRole("heading", {
      name: "Map criteria to implementation evidence",
    }),
  ).toBeVisible();
  await page.getByLabel("Traceability criteria JSON").fill(
    JSON.stringify({
      criteria: [
        {
          criterionId: "AC-01",
          statement: "The context menu is available.",
          taskIds: ["TASK-01"],
          checkNames: ["Git diff boundary review"],
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "Validate traceability" }).click();
  await expect(page.getByText("TRC-BROWSER-001 recorded")).toBeVisible();
  await page
    .getByRole("button", { name: "Accept result", exact: true })
    .click();
  await expect(page.getByText("DSP-BROWSER-001 · accepted")).toBeVisible();
  expect(dispositions).toEqual([
    expect.objectContaining({
      runId: "RUN-BROWSER-001",
      decision: "accepted",
      evidenceIds: ["EVD-BROWSER-001"],
      reason: "Validated by browser test",
    }),
  ]);
  expect(traceabilityRecords).toEqual([
    expect.objectContaining({
      runId: "RUN-BROWSER-001",
      requirementId: "REQ-BROWSER-001",
      runPlanId: "RP-BROWSER-001",
      evidenceIds: ["EVD-BROWSER-001"],
    }),
  ]);
});

test("validation review exposes blocked, exception, and replanning dispositions", async ({
  page,
}) => {
  const dispositions: Array<Record<string, unknown>> = [];
  const snapshot = {
    generatedAt: "2026-09-06T12:00:00.000Z",
    system: {
      id: "test-system",
      name: "Test system",
      branch: "main",
      deliveryPath: "delivery",
      lockStatus: "resolved",
      productHead: "a".repeat(40),
    },
    health: [
      { label: "Delivery repository", status: "healthy", detail: "Connected" },
      { label: "Product repository", status: "healthy", detail: "Connected" },
      { label: "Git", status: "healthy", detail: "main · clean" },
      { label: "Codex App Server", status: "healthy", detail: "Available" },
    ],
    artifacts: [],
    approvals: [],
    activeRun: {
      runId: "RUN-BROWSER-BLOCKED",
      workPackageId: "WP-BROWSER-BLOCKED",
      title: "Blocked validation run",
      sequence: 1,
      total: 1,
      currentPhase: "Phase 1 · Implementation",
      currentTask: "Review result",
      progress: 100,
      status: "blocked",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      baseCommit: "a".repeat(40),
      worktreePath: "C:/worktree",
      branch: "factory/RUN-BROWSER-BLOCKED",
      adapter: "fake",
    },
    promptProfiles: [],
    blockers: [],
    evidence: [],
    dispositions: [],
    validationErrors: [],
  };
  await page.route("**/api/snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    }),
  );
  await page.route("**/api/capabilities", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [], reasoningEfforts: [], adapters: [] }),
    }),
  );
  await page.route("**/api/diff/review", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            path: "delivery/control/forbidden.json",
            change: "??",
            classification: "forbidden",
          },
        ],
        automaticAcceptance: "blocked",
        patch: "new forbidden input",
      }),
    }),
  );
  await page.route("**/api/validation/evidence", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        evidenceId: "EVD-BROWSER-BLOCKED",
        path: "evidence/EVD-BROWSER-BLOCKED.json",
        outcome: "blocked",
        checks: [
          { name: "Git diff boundary review", status: "failed", exitCode: 1 },
        ],
      }),
    }),
  );
  await page.route("**/api/validation/disposition", async (route) => {
    dispositions.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dispositionId: `DSP-${dispositions.length}`,
      }),
    });
  });
  page.on("dialog", async (dialog) =>
    dialog.accept("Reviewed blocked result and recorded recovery action"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Validation", exact: true }).click();
  await page.getByRole("button", { name: "Review diff", exact: true }).click();
  await expect(page.getByText(/automatic acceptance blocked/)).toBeVisible();
  await page.getByRole("button", { name: "Record evidence manifest" }).click();
  await expect(page.getByText(/EVD-BROWSER-BLOCKED · blocked/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept result", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Accept exception", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Request replan", exact: true })
    .click();
  expect(dispositions).toEqual([
    expect.objectContaining({
      runId: "RUN-BROWSER-BLOCKED",
      decision: "exception_accepted",
      evidenceIds: ["EVD-BROWSER-BLOCKED"],
    }),
    expect.objectContaining({
      runId: "RUN-BROWSER-BLOCKED",
      decision: "replan",
      evidenceIds: ["EVD-BROWSER-BLOCKED"],
    }),
  ]);
});
