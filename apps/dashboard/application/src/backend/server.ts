import crypto from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import {
  DeliveryRepository,
  type PreparedExecutionPhase,
} from "./repository.js";
import { RuntimeState } from "./state.js";
import type {
  ActiveRun,
  ExecutionProgress,
  PromptProfile,
  QualityGate,
  ReasoningEffort,
} from "../shared/types.js";
import {
  CodexAppServerAdapter,
  FakeExecutionAdapter,
  PromptBuilder,
  resolveEffectiveProfile,
  supportedPromptModels,
  supportedReasoningEfforts,
} from "./prompting.js";
import type { CodexTaskSnapshot } from "./prompting.js";
import { reviewProductDiff } from "./diff.js";
import { SchemaRegistry } from "./validation.js";

const config = loadConfig();
const state = new RuntimeState(config.runtimeDirectory);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const schemaRegistry = new SchemaRegistry(config);
await schemaRegistry.load();
const repository = new DeliveryRepository(config, state, schemaRegistry);
const promptBuilder = new PromptBuilder(config, repository);
repository.startWatcher(() => app.log.debug("Delivery repository changed"));
const adapters = {
  codex_app_server: new CodexAppServerAdapter(),
  fake: new FakeExecutionAdapter(),
};
const startingPromptTaskTypes = new Set<PromptProfile["taskType"]>();

function assertAdapterSupportsProfile(
  capability: Awaited<
    ReturnType<(typeof adapters)[keyof typeof adapters]["probe"]>
  >,
  model: string,
  reasoningEffort: ReasoningEffort,
): void {
  if (
    capability.models &&
    !(capability.models as readonly string[]).includes(model)
  )
    throw new Error(
      `${model} is not available from the active Codex App Server. ${capability.detail}`,
    );
  const efforts = capability.modelReasoningEfforts?.[model];
  if (efforts?.length && !efforts.includes(reasoningEffort))
    throw new Error(
      `${model} does not support ${reasoningEffort} reasoning in the active Codex App Server. Supported: ${efforts.join(", ")}.`,
    );
}

type PromptTaskSummary = CodexTaskSnapshot & {
  taskType: PromptProfile["taskType"];
  adapter: keyof typeof adapters;
  model: string;
  reasoningEffort: string;
  startedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function listPromptTasks(): Promise<PromptTaskSummary[]> {
  const summaries: PromptTaskSummary[] = [];
  const seen = new Set<string>();
  for (const action of state.listActions(100)) {
    if (
      action.actionType !== "prompt_task_started" ||
      !isRecord(action.payload)
    )
      continue;
    const actual = isRecord(action.payload.actual)
      ? action.payload.actual
      : undefined;
    const requested = isRecord(action.payload.requested)
      ? action.payload.requested
      : undefined;
    const taskId = typeof actual?.taskId === "string" ? actual.taskId : "";
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    const adapterId =
      requested?.adapter === "fake" ? "fake" : "codex_app_server";
    const task = await adapters[adapterId].read?.(taskId);
    if (!task) continue;
    summaries.push({
      ...task,
      taskType: String(
        action.payload.taskType ?? "run_plan_generation",
      ) as PromptProfile["taskType"],
      adapter: adapterId,
      model: String(actual?.model ?? requested?.model ?? "unknown"),
      reasoningEffort: String(
        actual?.reasoningEffort ?? requested?.reasoningEffort ?? "unknown",
      ),
      startedAt: action.createdAt,
    });
    if (summaries.length >= 25) break;
  }
  return summaries;
}

async function reconcileRuntimeTask(): Promise<void> {
  const run = state.getActiveRun();
  if (!run?.taskId) return;
  const adapterId = run.adapter ?? "codex_app_server";
  const adapter = adapters[adapterId as keyof typeof adapters];
  let task: { status: string } | undefined;
  try {
    task = await adapter?.read?.(run.taskId);
  } catch {
    task = undefined;
  }
  if (!adapter || !task || task.status.toLowerCase() === "unknown") {
    repository.updateRun(run.runId, {
      status: "blocked",
      lastHeartbeatAt: new Date().toISOString(),
      currentTask:
        "Dashboard restarted; Codex task could not be reconnected. Review the run and retry or replan.",
    });
    state.recordAction(
      "runtime_reconciliation",
      {
        runId: run.runId,
        taskId: run.taskId,
        outcome: "reconnect_required",
      },
      `runtime-reconciliation:${run.runId}:${run.taskId}`,
    );
  }
}

function readOnlyDeliveryRoots(): string[] {
  return [
    "requirements",
    "run-plans",
    "work-packages",
    "system-plans",
    "control",
    "evidence",
    "releases",
  ].map((directory) => path.join(config.deliveryRepository, directory));
}

async function readOnlyRepositoryRoots(): Promise<string[]> {
  const roots = [
    config.productRepository,
    config.orchestratorRepository,
    ...readOnlyDeliveryRoots(),
  ];
  try {
    const snapshot = await repository.snapshot();
    for (const configuredPath of Object.values(
      snapshot.system.repositories ?? {},
    ).filter((value): value is string => typeof value === "string")) {
      const resolved = path.resolve(config.deliveryRepository, configuredPath);
      if (!roots.includes(resolved)) roots.push(resolved);
    }
  } catch {
    /* Repository context is optional for the fallback packet. */
  }
  return roots;
}

function implementationWritableRoots(
  worktreePath: string,
  progressFilePath: string,
): string[] {
  return [
    worktreePath,
    path.join(config.productRepository, ".git"),
    path.dirname(progressFilePath),
  ];
}

async function dispatchNextImplementationTask(
  run: ActiveRun,
  runPlanId: string,
): Promise<{
  taskId: string;
  adapter: string;
  phaseLabel: string;
  taskLabel: string;
}> {
  const execution = await repository.prepareExecutionProgress({
    runId: run.runId,
    workPackageId: run.workPackageId,
    runPlanId,
  });
  return dispatchImplementationPhase(run, runPlanId, execution);
}

async function dispatchImplementationPhase(
  run: ActiveRun,
  runPlanId: string,
  execution: PreparedExecutionPhase,
  existingTaskId?: string,
): Promise<{
  taskId: string;
  adapter: string;
  phaseLabel: string;
  taskLabel: string;
}> {
  const profile = state
    .getPromptProfiles()
    .find((candidate) => candidate.taskType === "run_plan_execution");
  if (!profile)
    throw new Error("Run-plan execution profile is not configured.");
  if (!run.worktreePath || !run.baseCommit || !run.branch)
    throw new Error("Run did not receive an isolated product worktree.");
  const packet = await promptBuilder.preview(
    "run_plan_execution",
    [runPlanId],
    {
      ...profile,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
    },
    {
      runId: run.runId,
      workPackageId: run.workPackageId,
      planPath: execution.planPath,
      progressFilePath: execution.progressFilePath,
      firstPhaseId: execution.firstPhaseId,
      firstPhaseTitle: execution.firstPhaseTitle,
      firstTaskId: execution.firstTaskId,
      firstTaskTitle: execution.firstTaskTitle,
      phaseOrdinal: execution.phaseOrdinal,
      phaseCount: execution.phaseCount,
    },
  );
  packet.executionContext = {
    cwd: run.worktreePath,
    writableRoots: implementationWritableRoots(
      run.worktreePath,
      execution.progressFilePath,
    ),
    readOnlyRoots: await readOnlyRepositoryRoots(),
  };
  const adapterId = run.adapter ?? profile.adapter ?? "codex_app_server";
  const adapter = adapters[adapterId as keyof typeof adapters];
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);
  const capability = await adapter.probe();
  if (!capability.available) throw new Error(capability.detail);
  assertAdapterSupportsProfile(
    capability,
    packet.model,
    packet.reasoningEffort,
  );
  const existingTask = existingTaskId
    ? await adapter.read?.(existingTaskId)
    : undefined;
  const canContinue =
    existingTaskId &&
    existingTask &&
    existingTask.status.toLowerCase() !== "unknown";
  const task = canContinue
    ? await adapter.continueTask(existingTaskId, packet)
    : await adapter.start(packet);
  await repository.saveExecutionProgress({
    run_id: execution.progress.run_id,
    work_package_id: execution.progress.work_package_id,
    run_plan_id: execution.progress.run_plan_id,
    run_plan_revision: execution.progress.run_plan_revision,
    status: execution.progress.status,
    current_phase_id: execution.progress.current_phase_id,
    current_task_id: execution.progress.current_task_id,
    phases: execution.progress.phases,
    tasks: execution.progress.tasks,
  });
  state.recordAction(
    "implementation_phase_started",
    {
      runId: run.runId,
      taskId: task.taskId,
      runPlanId,
      phaseId: execution.firstPhaseId,
      phaseOrdinal: execution.phaseOrdinal,
      phaseCount: execution.phaseCount,
      continuedTask: Boolean(canContinue),
      promptMode: packet.promptMode,
      executionContext: packet.executionContext,
      requested: {
        model: packet.model,
        reasoningEffort: packet.reasoningEffort,
        adapter: adapterId,
      },
      actual: task,
    },
    `implementation-phase:${run.runId}:${runPlanId}:${execution.firstPhaseId}`,
  );
  return {
    taskId: task.taskId,
    adapter: adapterId,
    phaseLabel: `${execution.firstPhaseId} · ${execution.firstPhaseTitle}`,
    taskLabel: `${execution.firstTaskId} · ${execution.firstTaskTitle}`,
  };
}

async function continueNextImplementationPhase(
  run: ActiveRun,
  runPlanId: string,
): Promise<{
  taskId: string;
  adapter: string;
  phaseLabel: string;
  taskLabel: string;
} | null> {
  const execution = await repository.prepareNextExecutionPhase(run.runId);
  if (!execution) return null;
  return dispatchImplementationPhase(run, runPlanId, execution, run.taskId);
}

async function retryCurrentImplementationPhase(
  run: ActiveRun,
  runPlanId: string,
): Promise<{
  taskId: string;
  adapter: string;
  phaseLabel: string;
  taskLabel: string;
}> {
  const execution = await repository.prepareCurrentExecutionPhase(run.runId);
  return dispatchImplementationPhase(run, runPlanId, execution, run.taskId);
}

async function packageRunPlanId(
  run: ActiveRun,
  zeroBasedIndex: number,
): Promise<string | undefined> {
  const packageDocument = await repository.readArtifact(run.workPackageId);
  const members = JSON.parse(packageDocument?.content ?? "").members as
    Array<{ run_plan_id?: string }> | undefined;
  return members?.[zeroBasedIndex]?.run_plan_id;
}

async function advanceAcceptedRun(run: ActiveRun): Promise<ActiveRun> {
  if (run.acceptedSequence !== run.sequence)
    throw new Error(
      "Resume blocked: the current run-plan result has not been accepted.",
    );
  const progressGate = await repository.executionProgressGate(run.runId);
  if (!progressGate.ready)
    throw new Error(`Resume blocked: ${progressGate.reasons.join(" ")}`);
  const nextPlanId = await packageRunPlanId(run, run.sequence);
  if (!nextPlanId)
    return repository.updateRun(run.runId, {
      status: "complete",
      progress: 100,
      currentTask: "Validation accepted; work package complete",
    });
  const nextTask = await dispatchNextImplementationTask(run, nextPlanId);
  return repository.updateRun(run.runId, {
    status: "in_progress",
    sequence: run.sequence + 1,
    progress: Math.round((run.sequence / run.total) * 100),
    currentPhase: nextTask.phaseLabel,
    currentTask: `${nextTask.taskLabel} · Codex task ${nextTask.taskId}`,
    taskId: nextTask.taskId,
    adapter: nextTask.adapter,
  });
}

app.get("/api/health", async () => ({
  ok: true,
  service: "factory-dashboard",
  generatedAt: new Date().toISOString(),
}));
app.get("/api/snapshot", async () => repository.snapshot());
app.post("/api/reconcile", async () => {
  await reconcileRuntimeTask();
  return repository.snapshot();
});
app.post<{ Body: { confirm?: boolean } }>(
  "/api/repository/reset",
  async (request, reply) => {
    if (request.body?.confirm !== true)
      return reply
        .code(400)
        .send({ error: "Repository reset requires explicit confirmation." });
    try {
      return await repository.resetWorkflowDecisions();
    } catch (cause) {
      return reply.code(409).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to reset repository decisions.",
      });
    }
  },
);
app.get<{
  Querystring: {
    workPackageId?: string;
    model?: string;
    reasoningEffort?: string;
    adapter?: string;
  };
}>("/api/preflight", async (request, reply) => {
  try {
    const result = await repository.preflight({
      workPackageId: request.query.workPackageId,
      model: request.query.model,
      reasoningEffort: request.query.reasoningEffort as
        ReasoningEffort | undefined,
      adapter: request.query.adapter,
    });
    const adapterId =
      request.query.adapter === "fake" ? "fake" : "codex_app_server";
    const capability = await adapters[adapterId].probe();
    const adapterCheck = result.checks.find(
      (check) => check.name === "Codex adapter",
    );
    if (adapterCheck) {
      adapterCheck.detail = capability.detail;
      if (!capability.available) adapterCheck.status = "blocked";
    }
    const profileCheck = result.checks.find(
      (check) => check.name === "Requested profile",
    );
    if (
      profileCheck &&
      request.query.model &&
      capability.models &&
      !(capability.models as readonly string[]).includes(request.query.model)
    ) {
      profileCheck.status = "blocked";
      profileCheck.detail = `${request.query.model} is not available from the active Codex App Server.`;
    } else if (
      profileCheck &&
      request.query.model &&
      request.query.reasoningEffort
    ) {
      const efforts = capability.modelReasoningEfforts?.[request.query.model];
      if (
        efforts?.length &&
        !efforts.includes(request.query.reasoningEffort as ReasoningEffort)
      ) {
        profileCheck.status = "blocked";
        profileCheck.detail = `${request.query.model} does not support ${request.query.reasoningEffort} reasoning.`;
      }
    }
    result.ready = result.checks.every((check) => check.status !== "blocked");
    result.blockers = result.checks
      .filter((check) => check.status === "blocked")
      .map((check) => `${check.name}: ${check.detail}`);
    return result;
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error ? cause.message : "Unable to run preflight.",
    });
  }
});
app.post<{
  Body: { acknowledged?: boolean; note?: string };
}>("/api/delivery-lock/resolve", async (request, reply) => {
  try {
    return await repository.resolveDeliveryLock({
      acknowledged: request.body?.acknowledged === true,
      note: request.body?.note,
    });
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to resolve the delivery lock.",
    });
  }
});
app.post<{ Body: Record<string, unknown> }>(
  "/api/commands",
  async (request, reply) => {
    try {
      const actionId = await repository.recordCommand(request.body ?? {});
      return { actionId, commandId: request.body?.command_id };
    } catch (cause) {
      return reply.code(409).send({
        error: cause instanceof Error ? cause.message : "Invalid command.",
      });
    }
  },
);
app.get("/api/schemas/health", async () => ({
  ok: true,
  detail: "Versioned dashboard schemas loaded",
}));
app.post<{
  Body: {
    runId?: string;
    baseCommit: string;
    allowedPaths?: string[];
    forbiddenPaths?: string[];
  };
}>("/api/diff/review", async (request, reply) => {
  try {
    let repositoryRoot: string | undefined;
    if (request.body?.runId) {
      const run = repository.getRun(request.body.runId);
      if (!run) throw new Error(`Run not found: ${request.body.runId}`);
      if (!run.worktreePath)
        throw new Error("The selected run has no isolated worktree.");
      repositoryRoot = run.worktreePath;
    }
    return await reviewProductDiff(
      config,
      request.body?.baseCommit ?? "",
      request.body?.allowedPaths ?? [],
      request.body?.forbiddenPaths ?? [],
      repositoryRoot,
    );
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to inspect product diff.",
    });
  }
});
app.get<{ Params: { runId: string } }>(
  "/api/runs/:runId/progress",
  async (request) => repository.readExecutionProgress(request.params.runId),
);
app.get<{ Params: { runId: string } }>(
  "/api/runs/:runId/traceability-context",
  async (request, reply) => {
    try {
      return await repository.acceptanceTraceabilityContext(
        request.params.runId,
      );
    } catch (cause) {
      return reply.code(409).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to load traceability context.",
      });
    }
  },
);
app.post<{
  Body: {
    runId: string;
    decision: "accepted" | "exception_accepted" | "rejected" | "replan";
    evidenceIds: string[];
    reason: string;
  };
}>("/api/validation/disposition", async (request, reply) => {
  try {
    const run = repository.getRun(request.body.runId);
    if (!run) throw new Error(`Run not found: ${request.body.runId}`);
    const accepted =
      request.body.decision === "accepted" ||
      request.body.decision === "exception_accepted";
    if (accepted && run.taskId) {
      const adapter =
        adapters[run.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      const task = await adapter.read?.(run.taskId);
      const taskStatus = task?.status.toLowerCase() ?? "unknown";
      if (
        taskStatus !== "unknown" &&
        !["completed", "complete", "succeeded"].includes(taskStatus)
      )
        throw new Error(
          "The current Codex task must finish before its result can be accepted.",
        );
    }
    const disposition = await repository.recordResultDisposition(request.body);
    const acceptedRun = repository.getRun(request.body.runId);
    if (accepted && acceptedRun && acceptedRun.sequence < acceptedRun.total) {
      try {
        await advanceAcceptedRun(acceptedRun);
      } catch (cause) {
        repository.updateRun(acceptedRun.runId, {
          status: "blocked",
          currentTask: `Sequence ${acceptedRun.sequence} accepted; next sequence could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    }
    return disposition;
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to record result disposition.",
    });
  }
});
app.post<{
  Params: { runId: string };
  Body: Omit<ExecutionProgress, "schema_version" | "updated_at" | "run_id">;
}>("/api/runs/:runId/progress", async (request, reply) => {
  try {
    return await repository.saveExecutionProgress({
      ...request.body,
      run_id: request.params.runId,
    });
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to save execution progress.",
    });
  }
});
app.get<{ Params: { taskId: string } }>(
  "/api/prompt-tasks/:taskId",
  async (request, reply) => {
    try {
      const adapter = request.params.taskId.startsWith("TASK-FAKE-")
        ? adapters.fake
        : adapters.codex_app_server;
      const task = await adapter.read?.(request.params.taskId);
      if (!task)
        return reply.code(404).send({ error: "Task state is unavailable." });
      return task;
    } catch (cause) {
      return reply.code(409).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to read Codex task state.",
      });
    }
  },
);
app.get("/api/prompt-tasks", async (_request, reply) => {
  try {
    return { tasks: await listPromptTasks() };
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error ? cause.message : "Unable to list prompt tasks.",
    });
  }
});
app.post<{ Params: { taskId: string } }>(
  "/api/prompt-tasks/:taskId/interrupt",
  async (request, reply) => {
    try {
      const task = (await listPromptTasks()).find(
        (candidate) => candidate.taskId === request.params.taskId,
      );
      if (!task)
        return reply.code(404).send({ error: "Prompt task was not found." });
      await adapters[task.adapter].interrupt?.(task.taskId);
      state.recordAction(
        "prompt_task_interrupted",
        { taskId: task.taskId, taskType: task.taskType },
        `prompt-task-interrupt:${task.taskId}`,
      );
      return await adapters[task.adapter].read?.(task.taskId);
    } catch (cause) {
      return reply.code(409).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to interrupt prompt task.",
      });
    }
  },
);
app.post<{
  Body: {
    runId: string;
    baseCommit: string;
    allowedPaths?: string[];
    forbiddenPaths?: string[];
    qualityGates?: QualityGate[];
    requiredQualityGates?: QualityGate[];
  };
}>("/api/validation/evidence", async (request, reply) => {
  try {
    return await repository.recordValidationEvidence({
      runId: request.body?.runId ?? "",
      baseCommit: request.body?.baseCommit ?? "",
      allowedPaths: request.body?.allowedPaths ?? [],
      forbiddenPaths: request.body?.forbiddenPaths ?? [],
      qualityGates: request.body?.qualityGates,
      requiredQualityGates: request.body?.requiredQualityGates,
    });
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to record validation evidence.",
    });
  }
});
app.post<{
  Body: {
    runId: string;
    requirementId: string;
    runPlanId: string;
    evidenceIds: string[];
    criteria: Array<{
      criterionId: string;
      statement: string;
      taskIds: string[];
      checkNames: string[];
    }>;
  };
}>("/api/validation/traceability", async (request, reply) => {
  try {
    return await repository.recordAcceptanceTraceability(request.body);
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to record acceptance traceability.",
    });
  }
});
app.get<{ Params: { artifactId: string } }>(
  "/api/artifacts/:artifactId",
  async (request, reply) => {
    const document = await repository.readArtifact(request.params.artifactId);
    if (!document)
      return reply.code(404).send({ error: "Artifact not found." });
    return document;
  },
);
app.get<{ Params: { artifactId: string } }>(
  "/api/artifacts/:artifactId/raw",
  async (request, reply) => {
    const artifact = await repository.readArtifactRaw(
      request.params.artifactId,
    );
    if (!artifact)
      return reply.code(404).send({ error: "Artifact not found." });
    return reply
      .header("content-type", artifact.contentType)
      .header(
        "content-disposition",
        `inline; filename="${(artifact.artifact.path.split("/").pop() ?? "artifact").replace(/["\r\n]/g, "_")}"`,
      )
      .send(artifact.content);
  },
);
app.get<{ Params: { evidenceId: string } }>(
  "/api/evidence/:evidenceId",
  async (request, reply) => {
    try {
      const evidence = await repository.readEvidence(request.params.evidenceId);
      if (!evidence)
        return reply.code(404).send({ error: "Evidence manifest not found." });
      return evidence;
    } catch (cause) {
      return reply.code(400).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to read evidence manifest.",
      });
    }
  },
);
app.get<{ Params: { artifactId: string; otherId: string } }>(
  "/api/artifacts/:artifactId/compare/:otherId",
  async (request, reply) => {
    try {
      return await repository.compareArtifacts(
        request.params.artifactId,
        request.params.otherId,
      );
    } catch (cause) {
      return reply.code(409).send({
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to compare artifacts.",
      });
    }
  },
);
app.post<{ Body: PromptProfile }>(
  "/api/prompt-profiles",
  async (request, reply) => {
    const profile = request.body;
    if (
      !profile?.taskType ||
      !profile.model ||
      !profile.reasoningEffort ||
      !profile.promptMode
    )
      return reply
        .code(400)
        .send({ error: "A complete prompt profile is required." });
    if (
      ![
        "work_package_sequencing",
        "run_plan_generation",
        "run_plan_execution",
      ].includes(profile.taskType)
    )
      return reply.code(400).send({ error: "Unknown prompt task type." });
    if (
      profile.adapter &&
      !["codex_app_server", "fake"].includes(profile.adapter)
    )
      return reply
        .code(400)
        .send({ error: "Adapter is not available in the active dashboard." });
    const expectedMode = "standard";
    if (profile.promptMode !== expectedMode)
      return reply.code(400).send({
        error: `${profile.taskType} requires a ${expectedMode} prompt.`,
      });
    try {
      resolveEffectiveProfile(
        profile,
        {},
        {
          models: supportedPromptModels,
          reasoningEfforts: supportedReasoningEfforts,
        },
      );
    } catch (cause) {
      return reply.code(400).send({
        error: cause instanceof Error ? cause.message : "Unsupported profile.",
      });
    }
    const adapter =
      adapters[
        (profile.adapter ?? "codex_app_server") as keyof typeof adapters
      ];
    if (!adapter)
      return reply.code(400).send({ error: "Unknown execution adapter." });
    const capability = await adapter.probe();
    if (!capability.available)
      return reply.code(409).send({ error: capability.detail });
    try {
      assertAdapterSupportsProfile(
        capability,
        profile.model,
        profile.reasoningEffort,
      );
    } catch (cause) {
      return reply.code(409).send({
        error: cause instanceof Error ? cause.message : "Unsupported profile.",
      });
    }
    return state.updateProfile(profile);
  },
);
app.get("/api/capabilities", async () => {
  const codex = await adapters.codex_app_server.probe();
  const fake = await adapters.fake.probe();
  return {
    adapters: [
      {
        id: "codex_app_server",
        status: codex.available ? "available" : "unavailable",
        detail: codex.detail,
        transport: "stdio-jsonl",
      },
      {
        id: "fake",
        status: fake.available ? "available" : "unavailable",
        detail: fake.detail,
        transport: "in-process",
      },
    ],
    models:
      codex.available && codex.models?.length
        ? supportedPromptModels.filter((model) =>
            (codex.models as readonly string[]).includes(model),
          )
        : supportedPromptModels,
    reasoningEfforts: supportedReasoningEfforts,
  };
});
app.get("/api/quality-gates", async () => ({
  required: await repository.getRequiredQualityGates(),
}));
app.post<{
  Body: {
    members: Array<{ runPlanId: string; sequence: number }>;
    rationale?: string;
    supersedesWorkPackageId?: string;
  };
}>("/api/work-packages/drafts", async (request, reply) => {
  try {
    return await repository.saveWorkPackageDraft(
      request.body?.members ?? [],
      request.body?.rationale ?? "Operator-selected order",
      request.body?.supersedesWorkPackageId,
    );
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to save work-package draft.",
    });
  }
});
app.post<{
  Body: { runPlanIds: string[]; proposal: unknown };
}>("/api/work-packages/sequence/validate", async (request, reply) => {
  try {
    return await repository.validateSequenceProposal(
      request.body?.runPlanIds ?? [],
      request.body?.proposal,
    );
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to validate sequencing output.",
    });
  }
});
app.post<{
  Body: { runPlanIds: string[] };
}>("/api/work-packages/analyze", async (request, reply) => {
  try {
    return await repository.analyzeRunPlans(request.body?.runPlanIds ?? []);
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to analyze run-plan dependencies.",
    });
  }
});
app.post<{
  Body: {
    requirementId: string;
    markdown: string;
    supersedesRunPlanId?: string;
  };
}>("/api/run-plans/drafts", async (request, reply) => {
  try {
    return await repository.saveRunPlanDraft({
      requirementId: request.body?.requirementId ?? "",
      markdown: request.body?.markdown ?? "",
      supersedesRunPlanId: request.body?.supersedesRunPlanId,
    });
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to save run-plan draft.",
    });
  }
});
app.post<{
  Body: { taskType: PromptProfile["taskType"]; artifactIds: string[] };
}>("/api/prompts/preview", async (request, reply) => {
  try {
    const profile = state
      .getPromptProfiles()
      .find((candidate) => candidate.taskType === request.body?.taskType);
    if (!profile)
      return reply.code(400).send({ error: "Unknown prompt task type." });
    return await promptBuilder.preview(
      request.body.taskType,
      request.body.artifactIds ?? [],
      profile,
    );
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error ? cause.message : "Unable to assemble prompt.",
    });
  }
});
app.post<{
  Body: {
    taskType: PromptProfile["taskType"];
    artifactIds: string[];
    adapter?: "codex_app_server" | "fake";
    model?: string;
    reasoningEffort?: ReasoningEffort;
  };
}>("/api/prompt-tasks", async (request, reply) => {
  try {
    const profile = state
      .getPromptProfiles()
      .find((candidate) => candidate.taskType === request.body?.taskType);
    if (!profile)
      return reply.code(400).send({ error: "Unknown prompt task type." });
    const model = request.body.model ?? profile.model;
    const reasoningEffort =
      request.body.reasoningEffort ?? profile.reasoningEffort;
    let effectiveProfile: PromptProfile;
    try {
      effectiveProfile = resolveEffectiveProfile(
        profile,
        { model, reasoningEffort },
        {
          models: supportedPromptModels,
          reasoningEfforts: supportedReasoningEfforts,
        },
      );
    } catch (cause) {
      return reply.code(400).send({
        error: cause instanceof Error ? cause.message : "Unsupported profile.",
      });
    }
    const packet = await promptBuilder.preview(
      request.body.taskType,
      request.body.artifactIds ?? [],
      effectiveProfile,
    );
    const adapterId =
      request.body.adapter ?? profile.adapter ?? "codex_app_server";
    if (adapterId === "manual_codex")
      return reply.code(400).send({
        error: "Manual Codex tasks are not supported by this endpoint.",
      });
    const adapter = adapters[adapterId];
    if (!adapter)
      return reply.code(400).send({ error: `Unknown adapter: ${adapterId}` });
    if (startingPromptTaskTypes.has(packet.taskType))
      return reply.code(409).send({
        error: `A ${packet.taskType.replaceAll("_", " ")} task is already starting.`,
      });
    startingPromptTaskTypes.add(packet.taskType);
    try {
      const existing = (await listPromptTasks()).find(
        (task) =>
          task.taskType === packet.taskType &&
          ["starting", "queued", "running", "inprogress"].includes(
            task.status.toLowerCase(),
          ),
      );
      if (existing)
        return reply.code(409).send({
          error: `Task ${existing.taskId} is already running. Interrupt it before starting another.`,
          task: existing,
        });
      const capability = await adapter.probe();
      if (!capability.available)
        return reply.code(409).send({ error: capability.detail });
      assertAdapterSupportsProfile(
        capability,
        packet.model,
        packet.reasoningEffort,
      );
      const result = await adapter.start(packet);
      const actionId = state.recordAction(
        "prompt_task_started",
        {
          taskType: packet.taskType,
          promptMode: packet.promptMode,
          templateVersion: packet.templateVersion,
          redactionApplied: packet.redactionApplied,
          inputArtifacts: packet.inputArtifacts,
          requested: {
            model: packet.model,
            reasoningEffort: packet.reasoningEffort,
            adapter: adapterId,
          },
          actual: {
            model: result.actualModel,
            reasoningEffort: result.actualReasoningEffort,
            taskId: result.taskId,
          },
        },
        `prompt-task:${packet.taskType}:${result.taskId}`,
      );
      return {
        actionId,
        taskId: result.taskId,
        taskType: packet.taskType,
        promptMode: packet.promptMode,
        requestedModel: packet.model,
        requestedReasoningEffort: packet.reasoningEffort,
        actualModel: result.actualModel,
        actualReasoningEffort: result.actualReasoningEffort,
        adapter: adapterId,
        templateVersion: packet.templateVersion,
        redactionApplied: packet.redactionApplied,
      };
    } finally {
      startingPromptTaskTypes.delete(packet.taskType);
    }
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error ? cause.message : "Unable to start prompt task.",
    });
  }
});
app.post<{
  Body: {
    taskType: PromptProfile["taskType"];
    artifactIds: string[];
    taskId: string;
  };
}>("/api/manual-task-packets", async (request, reply) => {
  try {
    if (
      !/^TASK-[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(
        request.body?.taskId ?? "",
      )
    )
      return reply
        .code(400)
        .send({ error: "A valid manual task identifier is required." });
    const profile = state
      .getPromptProfiles()
      .find((candidate) => candidate.taskType === request.body?.taskType);
    if (!profile)
      return reply.code(400).send({ error: "Unknown prompt task type." });
    const packet = await promptBuilder.preview(
      request.body.taskType,
      request.body.artifactIds ?? [],
      profile,
    );
    const actionId = state.recordAction(
      "manual_task_packet",
      {
        taskId: request.body.taskId,
        taskType: packet.taskType,
        promptMode: packet.promptMode,
        templateVersion: packet.templateVersion,
        inputArtifacts: packet.inputArtifacts,
        requested: {
          model: packet.model,
          reasoningEffort: packet.reasoningEffort,
        },
      },
      `manual-task:${request.body.taskId}`,
    );
    return {
      actionId,
      taskId: request.body.taskId,
      taskType: packet.taskType,
      promptMode: packet.promptMode,
      model: packet.model,
      reasoningEffort: packet.reasoningEffort,
      templateVersion: packet.templateVersion,
      prompt: packet.prompt,
    };
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to create manual task packet.",
    });
  }
});
app.post<{
  Body: {
    workPackageId: string;
    title: string;
    model: string;
    reasoningEffort: ActiveRun["reasoningEffort"];
    adapter?: "codex_app_server" | "fake";
  };
}>("/api/runs", async (request, reply) => {
  let startedRunId: string | undefined;
  try {
    const run = await repository.startRun(request.body);
    startedRunId = run.runId;
    const firstRunPlanId = await packageRunPlanId(run, 0);
    if (!firstRunPlanId)
      throw new Error("Approved work package has no executable run plan.");
    const task = await dispatchNextImplementationTask(run, firstRunPlanId);
    return repository.updateRun(run.runId, {
      status: "in_progress",
      currentPhase: task.phaseLabel,
      currentTask: `${task.taskLabel} · Codex task ${task.taskId}`,
      taskId: task.taskId,
      adapter: task.adapter,
    });
  } catch (cause) {
    if (startedRunId) {
      try {
        repository.updateRun(startedRunId, {
          status: "failed",
          currentTask: `Implementation could not start · ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      } catch {
        /* preserve the original dispatch failure */
      }
    }
    return reply.code(409).send({
      error: cause instanceof Error ? cause.message : "Unable to start run.",
    });
  }
});
app.post<{
  Params: { runId: string };
  Body: {
    action:
      | "pause"
      | "resume"
      | "cancel_turn"
      | "cancel"
      | "complete"
      | "retry"
      | "replan";
  };
}>("/api/runs/:runId/control", async (request, reply) => {
  const status =
    request.body?.action === "pause"
      ? "blocked"
      : request.body?.action === "cancel"
        ? "cancelled"
        : request.body?.action === "complete"
          ? "complete"
          : request.body?.action === "replan"
            ? "blocked"
            : "in_progress";
  try {
    const activeRun = repository.getRun(request.params.runId);
    if (!activeRun) throw new Error(`Run not found: ${request.params.runId}`);
    if (request.body?.action === "cancel_turn") {
      if (activeRun.status !== "in_progress" || !activeRun.taskId)
        throw new Error("The run has no active Codex turn to cancel.");
      const adapter =
        adapters[activeRun.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      await adapter.interrupt?.(activeRun.taskId);
      state.recordAction(
        "run_turn_cancelled",
        { runId: activeRun.runId, taskId: activeRun.taskId },
        `run-turn-cancel:${activeRun.runId}:${activeRun.taskId}`,
      );
      return repository.updateRun(activeRun.runId, {
        status: "blocked",
        currentTask:
          "Active turn cancelled by local operator · retry or cancel the run",
      });
    }
    const runState =
      activeRun.status === "ready"
        ? "ready"
        : activeRun.status === "in_progress"
          ? "running"
          : activeRun.status === "blocked"
            ? "blocked"
            : activeRun.status;
    const commandType =
      request.body?.action === "pause"
        ? "pause_run"
        : request.body?.action === "resume"
          ? "resume_run"
          : request.body?.action === "retry"
            ? "retry_task"
            : request.body?.action === "replan"
              ? "request_replan"
              : "cancel_run";
    await repository.recordCommand({
      schema_version: 1,
      command_id: `CMD-${crypto.randomUUID()}`,
      command_type: commandType,
      idempotency_key: `run-control:${request.params.runId}:${request.body?.action}:${activeRun.status}`,
      issued_at: new Date().toISOString(),
      issued_by: {
        actor_id: "local-operator",
        actor_type: "human",
        display_name: "Local operator",
        authentication_method: "localhost",
      },
      source: "dashboard",
      target: {
        system_id: "customer-odoo",
        run_id: request.params.runId,
        ...(activeRun.taskId ? { task_id: activeRun.taskId } : {}),
      },
      preconditions: {
        expected_run_revision: 0,
        expected_run_state: runState,
        required_lease_owner: "dashboard",
      },
      payload:
        commandType === "resume_run"
          ? { resolution_note: "Resumed by local operator." }
          : { reason: `${request.body?.action} requested by local operator.` },
    });
    if (activeRun.taskId && request.body?.action === "pause") {
      const adapter =
        adapters[activeRun.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      await adapter.interrupt?.(activeRun.taskId);
    }
    if (activeRun.taskId && request.body?.action === "cancel") {
      const adapter =
        adapters[activeRun.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      if (adapter.abandon) await adapter.abandon(activeRun.taskId);
      else await adapter.interrupt?.(activeRun.taskId);
    }
    if (request.body?.action === "retry") {
      const currentPlanId = await packageRunPlanId(
        activeRun,
        Math.max(0, activeRun.sequence - 1),
      );
      if (!currentPlanId) throw new Error("Run package has no retryable plan.");
      const nextTask = await retryCurrentImplementationPhase(
        activeRun,
        currentPlanId,
      );
      return repository.updateRun(activeRun.runId, {
        status: "in_progress",
        acceptedSequence: undefined,
        currentPhase: nextTask.phaseLabel,
        currentTask: `${nextTask.taskLabel} · Codex task ${nextTask.taskId}`,
        taskId: nextTask.taskId,
        adapter: nextTask.adapter,
      });
    }
    if (request.body?.action === "replan")
      return repository.updateRun(activeRun.runId, {
        status: "blocked",
        currentTask:
          "Replan requested · generate and approve a replacement run plan",
      });
    if (request.body?.action === "resume" && activeRun.status === "blocked") {
      const adapter =
        adapters[activeRun.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      const taskSnapshot = activeRun.taskId
        ? await adapter.read?.(activeRun.taskId)
        : undefined;
      const taskCompleted = ["completed", "complete", "succeeded"].includes(
        taskSnapshot?.status.toLowerCase() ?? "",
      );
      if (taskCompleted) {
        const currentPlanId = await packageRunPlanId(
          activeRun,
          Math.max(0, activeRun.sequence - 1),
        );
        if (!currentPlanId)
          throw new Error("Run package has no resumable plan.");
        let nextTask;
        try {
          nextTask = await continueNextImplementationPhase(
            activeRun,
            currentPlanId,
          );
        } catch (cause) {
          if (
            cause instanceof Error &&
            cause.message.startsWith(
              "Current phase functionality is incomplete",
            )
          )
            nextTask = await retryCurrentImplementationPhase(
              activeRun,
              currentPlanId,
            );
          else throw cause;
        }
        if (nextTask)
          return repository.updateRun(activeRun.runId, {
            status: "in_progress",
            acceptedSequence: undefined,
            currentPhase: nextTask.phaseLabel,
            currentTask: `${nextTask.taskLabel} · Codex task ${nextTask.taskId}`,
            taskId: nextTask.taskId,
            adapter: nextTask.adapter,
          });
        if (activeRun.acceptedSequence !== activeRun.sequence)
          throw new Error(
            "Resume blocked: the current run plan is complete and awaits validation acceptance.",
          );
        return await advanceAcceptedRun(activeRun);
      }
    }
    return repository.updateRun(request.params.runId, { status });
  } catch (cause) {
    return reply.code(409).send({
      error: cause instanceof Error ? cause.message : "Unable to control run.",
    });
  }
});
app.post<{
  Body: {
    artifactId: string;
    kind: string;
    decision: "approved" | "rejected";
    reason?: string;
    revision?: number;
    digest?: string;
  };
}>("/api/decisions", async (request, reply) => {
  if (
    !request.body?.artifactId ||
    !["approved", "rejected"].includes(request.body.decision)
  )
    return reply
      .code(400)
      .send({ error: "A valid artifact and decision are required." });
  if (request.body.decision === "rejected" && !request.body.reason?.trim())
    return reply.code(400).send({ error: "A rejection reason is required." });
  try {
    const actionId = await repository.recordDecision(request.body);
    return { actionId };
  } catch (cause) {
    return reply.code(409).send({
      error:
        cause instanceof Error ? cause.message : "Unable to record decision.",
    });
  }
});

let taskMonitorBusy = false;
const taskMonitor = setInterval(() => {
  if (taskMonitorBusy) return;
  taskMonitorBusy = true;
  void (async () => {
    try {
      const run = (await repository.snapshot()).activeRun;
      if (!run?.taskId) return;
      const adapter =
        adapters[run.adapter as keyof typeof adapters] ??
        adapters.codex_app_server;
      let progress: ExecutionProgress | null = null;
      try {
        progress = await repository.syncExecutionProgress(run.runId);
      } catch (cause) {
        repository.updateRun(run.runId, {
          status: "blocked",
          currentTask: `Execution progress is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        return;
      }
      const task = await adapter.read?.(run.taskId);
      const normalized = task?.status.toLowerCase() ?? "";
      const currentRun = repository.getRun(run.runId);
      if (
        currentRun?.status !== "in_progress" ||
        currentRun.taskId !== run.taskId
      )
        return;
      if (["failed", "error", "cancelled", "canceled"].includes(normalized))
        repository.updateRun(run.runId, {
          status: "failed",
          currentTask:
            task?.error || task?.output
              ? `Phase failed · ${task.error || task.output}`
              : `Codex task ${run.taskId} ${normalized}`,
        });
      else if (normalized === "blocked")
        repository.updateRun(run.runId, {
          status: "blocked",
          currentTask:
            progress?.tasks.find((item) => item.status === "blocked")?.note ??
            `Codex task ${run.taskId} is blocked`,
        });
      else if (["completed", "complete", "succeeded"].includes(normalized)) {
        const currentPlanId = await packageRunPlanId(
          currentRun,
          Math.max(0, currentRun.sequence - 1),
        );
        if (!currentPlanId) {
          repository.updateRun(run.runId, {
            status: "blocked",
            currentTask: "Run package has no current implementation plan.",
          });
          return;
        }
        try {
          const nextTask = await continueNextImplementationPhase(
            currentRun,
            currentPlanId,
          );
          const latestRun = repository.getRun(run.runId);
          if (
            latestRun?.status !== "in_progress" ||
            latestRun.taskId !== run.taskId
          )
            return;
          if (nextTask) {
            repository.updateRun(run.runId, {
              status: "in_progress",
              currentPhase: nextTask.phaseLabel,
              currentTask: `${nextTask.taskLabel} · Codex task ${nextTask.taskId}`,
              taskId: nextTask.taskId,
              adapter: nextTask.adapter,
            });
            return;
          }
          const gate = await repository.executionProgressGate(run.runId);
          repository.updateRun(run.runId, {
            status: "blocked",
            currentTask: gate.ready
              ? "Run plan complete · review diff and record validation evidence"
              : `Run plan ended before every status was green · ${gate.reasons.join(" ")}`,
          });
        } catch (cause) {
          const latestRun = repository.getRun(run.runId);
          if (
            latestRun?.status !== "in_progress" ||
            latestRun.taskId !== run.taskId
          )
            return;
          repository.updateRun(run.runId, {
            status: "blocked",
            currentTask:
              cause instanceof Error
                ? `Phase stopped: ${cause.message}`
                : "Phase stopped before its functionality was complete.",
          });
        }
      }
    } catch {
      /* transient adapter/repository failures remain visible through the next poll */
    } finally {
      taskMonitorBusy = false;
    }
  })();
}, 2500);
taskMonitor.unref();

try {
  await reconcileRuntimeTask();
} catch (cause) {
  app.log.warn(
    cause instanceof Error
      ? cause.message
      : "Runtime reconciliation could not complete.",
  );
}

app.addHook("onClose", async () => {
  clearInterval(taskMonitor);
  repository.stopWatcher();
  await adapters.codex_app_server.close?.();
  state.close();
});

const productionDist = path.resolve(process.cwd(), "dist");
try {
  await app.register(fastifyStatic, { root: productionDist, prefix: "/" });
  app.setNotFoundHandler(async (_request, reply) =>
    reply.sendFile("index.html"),
  );
} catch {
  /* Development mode uses Vite. */
}

app
  .listen({ port: config.port, host: "127.0.0.1" })
  .then(() =>
    app.log.info(`Dashboard API listening at http://127.0.0.1:${config.port}`),
  )
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
