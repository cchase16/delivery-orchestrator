import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import type {
  PromptPacket,
  PromptProfile,
  ReasoningEffort,
} from "../shared/types.js";
import type { Snapshot } from "../shared/types.js";
import type { DashboardConfig } from "./config.js";
import { DeliveryRepository } from "./repository.js";

const execFileAsync = promisify(execFile);

const templateVersions = {
  work_package_sequencing: "work-package-sequencing.v1",
  run_plan_generation: "run-plan-generation.v3",
  run_plan_execution: "run-plan-execution.v3",
} as const;

const runPlanTemplateDirectory = path.join("templates", "run-plan");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requirementName(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  return heading || fallback;
}

function applyPromptValues(
  prompt: string,
  values: Record<string, string>,
): string {
  const placeholders = [
    ...new Set(
      (prompt.match(/{{[A-Z0-9_]+}}/g) ?? []).map((value) =>
        value.slice(2, -2),
      ),
    ),
  ];
  const unknown = placeholders.filter((key) => !(key in values));
  if (unknown.length)
    throw new Error(
      `Run-plan generation prompt has unresolved placeholders: ${unknown.join(", ")}`,
    );
  let rendered = prompt;
  for (const [key, value] of Object.entries(values))
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  return rendered.trim();
}

export const supportedPromptModels = [
  "gpt-5.6-sol",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
] as const;

export const supportedReasoningEfforts: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export function codexAppServerInitializeParams() {
  return {
    clientInfo: {
      name: "factory-dashboard",
      title: "Factory Dashboard",
      version: "0.1.0",
    },
    capabilities: {},
  } as const;
}

export function resolveEffectiveProfile(
  profile: PromptProfile,
  overrides: Partial<Pick<PromptProfile, "model" | "reasoningEffort">>,
  capabilities: {
    models: readonly string[];
    reasoningEfforts: readonly ReasoningEffort[];
  },
): PromptProfile {
  const model = overrides.model ?? profile.model;
  const reasoningEffort = overrides.reasoningEffort ?? profile.reasoningEffort;
  if (!capabilities.models.includes(model))
    throw new Error(`Model is not available in the active adapter: ${model}`);
  if (!capabilities.reasoningEfforts.includes(reasoningEffort))
    throw new Error(
      `Reasoning level is not available in the active adapter: ${reasoningEffort}`,
    );
  return { ...profile, model, reasoningEffort };
}

function redactSensitiveValues(value: string): {
  text: string;
  changed: boolean;
} {
  const redacted = value
    .replace(
      /(^|\n)(\s*(?:password|token|secret|api[_-]?key)\s*[:=]\s*)[^\n]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b(?:sk|pk)[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
  return { text: redacted, changed: redacted !== value };
}

export class PromptBuilder {
  constructor(
    private readonly config: DashboardConfig,
    private readonly repository: DeliveryRepository,
  ) {}

  async preview(
    taskType: PromptProfile["taskType"],
    artifactIds: string[],
    profile: PromptProfile,
    execution?: {
      runId: string;
      workPackageId: string;
      planPath: string;
      progressFilePath: string;
      firstPhaseId: string;
      firstPhaseTitle: string;
      firstTaskId: string;
      firstTaskTitle: string;
      phaseOrdinal: number;
      phaseCount: number;
    },
  ): Promise<PromptPacket> {
    const expectedMode = "standard";
    if (profile.promptMode !== expectedMode)
      throw new Error(`${taskType} requires a ${expectedMode} prompt.`);
    if (artifactIds.length === 0)
      throw new Error("At least one input artifact is required.");
    const snapshot = await this.repository.snapshot();
    const expectedKind =
      taskType === "run_plan_generation"
        ? "requirement"
        : taskType === "work_package_sequencing"
          ? "run_plan"
          : "run_plan";
    if (taskType === "run_plan_generation" && artifactIds.length !== 1)
      throw new Error("Run-plan generation requires exactly one requirement.");
    for (const artifactId of artifactIds) {
      const current = snapshot.artifacts.find((item) => item.id === artifactId);
      if (!current) throw new Error(`Input artifact not found: ${artifactId}`);
      if (current.kind !== expectedKind)
        throw new Error(
          `${taskType} requires approved ${expectedKind} inputs: ${artifactId}`,
        );
      if (current.status !== "approved")
        throw new Error(
          `Input artifact is not currently approved: ${artifactId} (${current.status})`,
        );
    }
    if (taskType === "run_plan_generation") {
      const systemPlan = snapshot.artifacts.find(
        (artifact) => artifact.kind === "system_plan",
      );
      if (!systemPlan || ["invalid", "missing"].includes(systemPlan.status))
        throw new Error(
          "A valid system plan is required before generating an implementation run plan.",
        );
      if (!(await this.readProductBaseline()))
        throw new Error(
          "A resolvable product baseline is required before generating an implementation run plan.",
        );
    }
    const documents = await Promise.all(
      artifactIds.map((id) => this.repository.readArtifact(id)),
    );
    const missing = documents
      .map((document, index) => (document ? null : artifactIds[index]))
      .filter((id): id is string => Boolean(id));
    if (missing.length)
      throw new Error(`Input artifact not found: ${missing.join(", ")}`);
    const inputs = documents
      .filter((document): document is NonNullable<typeof document> =>
        Boolean(document),
      )
      .map(({ artifact }) => ({
        id: artifact.id,
        revision: artifact.revision,
        path: artifact.path,
        digest: artifact.digest,
      }));
    const rawSystemContext = await this.readSystemContext(snapshot);
    const systemContext = redactSensitiveValues(rawSystemContext);
    let redactionApplied = systemContext.changed;
    const artifactText = documents
      .filter(Boolean)
      .map((document) => {
        const content = redactSensitiveValues(
          document?.content ?? "[binary artifact; review locally]",
        );
        redactionApplied ||= content.changed;
        return `### ${document?.artifact.id} (revision ${document?.artifact.revision}, sha256 ${document?.artifact.digest}, ${document?.artifact.path})\n${content.text}`;
      })
      .join("\n\n");
    let runPlanTemplate = "";
    const executionAssignment =
      taskType === "run_plan_execution"
        ? [
            `Review the implementation run plan ${execution?.planPath ?? documents[0]?.artifact.path ?? artifactIds[0]}.`,
            execution
              ? `Implement only phase ${execution.phaseOrdinal} of ${execution.phaseCount}: ${execution.firstPhaseId} (${execution.firstPhaseTitle}), starting with ${execution.firstTaskId} (${execution.firstTaskTitle}).`
              : "Implement only the currently activated phase, starting with its first incomplete task.",
            "Work through every task in the assigned phase in order, including its tests, verification, and exit criteria. Do not begin a later phase.",
            execution
              ? `As each task and the assigned phase are completed, update the status in ${execution.progressFilePath}.`
              : "As each task and the assigned phase are completed, update the supplied execution-progress overlay.",
          ].join(" ")
        : undefined;
    const instruction =
      taskType === "run_plan_generation"
        ? await (async () => {
            const templateRoot = path.join(
              this.config.orchestratorRepository,
              runPlanTemplateDirectory,
            );
            let standardPrompt: string;
            try {
              [standardPrompt, runPlanTemplate] = await Promise.all([
                fs.readFile(
                  path.join(templateRoot, "run-plan-generation.prompt.md"),
                  "utf8",
                ),
                fs.readFile(
                  path.join(
                    templateRoot,
                    "implementation-run-plan.template.md",
                  ),
                  "utf8",
                ),
              ]);
            } catch (cause) {
              throw new Error(
                `Run-plan generation template is unavailable under ${templateRoot}: ${cause instanceof Error ? cause.message : String(cause)}`,
              );
            }
            const requirement = documents[0];
            const artifact = requirement?.artifact;
            return applyPromptValues(standardPrompt, {
              REQUIREMENT_NAME: requirementName(
                requirement?.content ?? "",
                artifact?.title ?? artifact?.id ?? artifactIds[0],
              ),
              REQUIREMENT_REFERENCE: artifact
                ? `${artifact.id} revision ${artifact.revision} at ${artifact.path}`
                : artifactIds[0],
            });
          })()
        : taskType === "work_package_sequencing"
          ? "Suggest an execution sequence only for the supplied approved run plans. Explain dependencies, shared Odoo modules, path overlap, database concerns, conflicts, and risk. Return exactly one JSON object with ordered_run_plan_ids and rationale. Do not rewrite any run plan."
          : [
              "Treat the approved implementation run plan as immutable. The dashboard owns the execution sequence and assigns exactly one phase per turn.",
              "Implement only the assigned phase and perform all of that phase's verification work. Do not begin any later phase.",
              "The execution-progress file is the only workflow status document you may edit; preserve its identifiers and JSON structure.",
              "When beginning a task, mark it in_progress. When it is finished and verified, mark it complete. Mark a phase complete only when every task in that phase is complete.",
              "A critical blocker is an issue that prevents the assigned phase's functionality, objective, verification, or exit criteria from being completed. For a critical blocker, mark the affected task, assigned phase, and overall execution blocked, add a concrete note, and stop.",
              "A non-critical issue does not prevent the assigned phase's functionality, objective, verification, or exit criteria. Record it in the relevant note, keep working, and do not set a blocked status solely because of it.",
              "For an intermediate phase, leave overall execution in_progress after the phase is complete. For the final phase, set overall execution complete after the phase and all plan tasks are complete. Never mark incomplete work complete.",
              "Do not begin another run plan. The dashboard will start the next sequenced plan only after this plan's execution, validation, and acceptance statuses are green.",
            ].join("\n");
    const commonHeader = [
      `Factory dashboard task: ${taskType}`,
      `Prompt mode: ${profile.promptMode}`,
      `Template: ${templateVersions[taskType]}`,
    ];
    const prompt =
      taskType === "run_plan_execution"
        ? [
            ...commonHeader,
            "",
            "System context:",
            systemContext.text,
            "",
            "Execution contract:",
            instruction,
            ...(execution
              ? [
                  "",
                  "Execution identity:",
                  `- Run: ${execution.runId}`,
                  `- Work package: ${execution.workPackageId}`,
                  `- Approved run plan: ${documents[0]?.artifact.id} revision ${documents[0]?.artifact.revision}`,
                  `- Progress file: ${execution.progressFilePath}`,
                ]
              : []),
            "",
            "Exact input artifacts:",
            artifactText,
            "",
            "Current phase assignment:",
            executionAssignment ??
              "Execute the currently assigned run-plan phase.",
            "",
            "Write boundary: product changes belong only in the isolated product worktree. Do not edit delivery artifacts, approvals, evidence, or release records. Never approve your own work.",
          ].join("\n")
        : [
            ...commonHeader,
            "",
            instruction,
            ...(runPlanTemplate
              ? [
                  "",
                  "Canonical run-plan Markdown template:",
                  "<run-plan-template>",
                  runPlanTemplate.trim(),
                  "</run-plan-template>",
                ]
              : []),
            "",
            "System context:",
            systemContext.text,
            "",
            "Exact input artifacts:",
            artifactText,
            "",
            "Write boundary: durable workflow records belong in the delivery repository; product changes belong only in the isolated product worktree; never approve your own work.",
          ].join("\n");
    return {
      taskType,
      promptMode: profile.promptMode,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      templateVersion: templateVersions[taskType],
      redactionApplied,
      inputArtifacts: inputs,
      prompt,
    };
  }

  private async readSystemContext(snapshot: Snapshot): Promise<string> {
    const sections: string[] = [];
    try {
      sections.push(
        "## Configured system.yaml\n" +
          (
            await fs.readFile(
              path.join(this.config.deliveryRepository, "system.yaml"),
              "utf8",
            )
          ).slice(0, 12000),
      );
    } catch {
      sections.push("## Configured system.yaml\n[unavailable]");
    }
    const systemPlans = snapshot.artifacts.filter(
      (artifact) => artifact.kind === "system_plan",
    );
    for (const systemPlan of systemPlans.slice(0, 3)) {
      try {
        const document = await this.repository.readArtifact(systemPlan.id);
        sections.push(
          `## System plan ${systemPlan.id} (revision ${systemPlan.revision}, sha256 ${systemPlan.digest})\n${(document?.content ?? "[unavailable]").slice(0, 12000)}`,
        );
      } catch {
        sections.push(`## System plan ${systemPlan.id}\n[unavailable]`);
      }
    }
    const baseline = await this.readProductBaseline();
    if (baseline) {
      sections.push(`## Product baseline\n${baseline || "[unavailable]"}`);
    } else {
      sections.push("## Product baseline\n[unavailable]");
    }
    const inventoryRoots = ["addons", "custom-addons", "odoo/addons", "src"];
    const inventories: string[] = [];
    for (const relativeRoot of inventoryRoots) {
      try {
        const entries = await fs.readdir(
          path.join(this.config.productRepository, relativeRoot),
          { withFileTypes: true },
        );
        const modules = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
          .slice(0, 100);
        if (modules.length)
          inventories.push(`${relativeRoot}: ${modules.join(", ")}`);
      } catch {
        /* Optional Odoo module roots are expected to be absent in some products. */
      }
    }
    if (inventories.length)
      sections.push(`## Product module inventory\n${inventories.join("\n")}`);
    const architectureFiles = [
      "docs/architecture/responsibility-boundaries.md",
      "docs/architecture/planning-and-batching.md",
      "docs/architecture/approval-contract.md",
    ];
    for (const relativeFile of architectureFiles) {
      try {
        sections.push(
          `## Development-factory contract: ${relativeFile}\n${(await fs.readFile(path.join(this.config.orchestratorRepository, relativeFile), "utf8")).slice(0, 4000)}`,
        );
      } catch {
        /* Optional architecture documents are not required for browsing. */
      }
    }
    return sections.join("\n\n");
  }

  private async readProductBaseline(): Promise<string | null> {
    try {
      const baseline = (
        await execFileAsync(
          "git",
          ["-C", this.config.productRepository, "rev-parse", "HEAD"],
          { timeout: 3000 },
        )
      ).stdout.trim();
      return /^[a-f0-9]{7,64}$/i.test(baseline) ? baseline : null;
    } catch {
      return null;
    }
  }
}

export interface ExecutionAdapter {
  readonly id: string;
  probe(): Promise<{ available: boolean; detail: string }>;
  start(packet: PromptPacket): Promise<{
    taskId: string;
    actualModel: string;
    actualReasoningEffort: PromptPacket["reasoningEffort"];
  }>;
  continueTask?(
    taskId: string,
    packet: PromptPacket,
  ): Promise<{
    taskId: string;
    actualModel: string;
    actualReasoningEffort: PromptPacket["reasoningEffort"];
  }>;
  read?(taskId: string): Promise<CodexTaskSnapshot>;
  interrupt?(taskId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface CodexTaskSnapshot {
  taskId: string;
  status: string;
  output: string;
  events: Array<Record<string, unknown>>;
}

export interface FakeExecutionBehavior {
  status?: string;
  output?: string;
  startError?: string;
}

export class FakeExecutionAdapter implements ExecutionAdapter {
  readonly id = "fake";
  private nextTaskNumber = 0;
  private readonly tasks = new Map<string, CodexTaskSnapshot>();

  constructor(private readonly behavior: FakeExecutionBehavior = {}) {}

  async probe() {
    return { available: true, detail: "Deterministic test adapter" };
  }

  async start(packet: PromptPacket) {
    if (this.behavior.startError) throw new Error(this.behavior.startError);
    const taskId = `TASK-FAKE-${++this.nextTaskNumber}`;
    this.tasks.set(taskId, {
      taskId,
      status: this.behavior.status ?? "completed",
      output: this.behavior.output ?? "fake adapter output",
      events: [
        {
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              text: this.behavior.output ?? "fake adapter output",
            },
          },
        },
      ],
    });
    return {
      taskId,
      actualModel: packet.model,
      actualReasoningEffort: packet.reasoningEffort,
    };
  }

  async continueTask(taskId: string, packet: PromptPacket) {
    if (this.behavior.startError) throw new Error(this.behavior.startError);
    if (!this.tasks.has(taskId))
      throw new Error(`Fake task is unavailable: ${taskId}`);
    this.tasks.set(taskId, {
      taskId,
      status: this.behavior.status ?? "completed",
      output: this.behavior.output ?? "fake adapter output",
      events: [
        {
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              text: this.behavior.output ?? "fake adapter output",
            },
          },
        },
      ],
    });
    return {
      taskId,
      actualModel: packet.model,
      actualReasoningEffort: packet.reasoningEffort,
    };
  }

  async read(taskId: string): Promise<CodexTaskSnapshot> {
    return (
      this.tasks.get(taskId) ?? {
        taskId,
        status: "unknown",
        output: "",
        events: [],
      }
    );
  }

  async interrupt(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) this.tasks.set(taskId, { ...task, status: "cancelled" });
  }
}

export class CodexAppServerAdapter implements ExecutionAdapter {
  readonly id = "codex_app_server";
  private probeResult: {
    at: number;
    available: boolean;
    detail: string;
  } | null = null;
  private readonly sessions = new Map<
    string,
    {
      child: ReturnType<typeof spawn>;
      lines: readline.Interface;
      events: Array<Record<string, unknown>>;
      turnId: string;
      turnEventOffset: number;
      send: (method: string, params: unknown, id?: number) => void;
      nextId: () => number;
    }
  >();
  private readonly completedEvents = new Map<
    string,
    {
      events: Array<Record<string, unknown>>;
      turnId: string;
      turnEventOffset: number;
    }
  >();

  private awaitResponse(
    lines: readline.Interface,
    child: ReturnType<typeof spawn>,
    id: number,
    timeoutMs = 10000,
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const listener = (line: string) => {
        try {
          const message = JSON.parse(line) as Record<string, any>;
          if (message.id !== id) return;
          clearTimeout(timer);
          lines.removeListener("line", listener);
          if (message.error)
            reject(
              new Error(
                String(
                  message.error.message ?? "Codex App Server request failed.",
                ),
              ),
            );
          else resolve(message);
        } catch {
          // Ignore diagnostic lines; JSON-RPC responses are line-delimited.
        }
      };
      const timer = setTimeout(() => {
        lines.removeListener("line", listener);
        child.kill();
        reject(
          new Error(`Codex App Server response timed out for request ${id}.`),
        );
      }, timeoutMs);
      lines.on("line", listener);
      child.once("error", (error) => {
        clearTimeout(timer);
        lines.removeListener("line", listener);
        reject(error);
      });
    });
  }

  async probe() {
    if (this.probeResult && Date.now() - this.probeResult.at < 10000)
      return this.probeResult;
    try {
      await execFileAsync("codex", ["app-server", "--help"], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      this.probeResult = {
        at: Date.now(),
        available: true,
        detail: "Codex App Server uses local stdio JSONL transport",
      };
    } catch (cause) {
      this.probeResult = {
        at: Date.now(),
        available: false,
        detail:
          cause instanceof Error
            ? `Codex App Server unavailable: ${cause.message}`
            : "Codex App Server unavailable",
      };
    }
    return this.probeResult;
  }

  async start(packet: PromptPacket) {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let nextId = 0;
    let activeThreadId = "";
    let activeTurnId = "";
    const events: Array<Record<string, unknown>> = [];
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.id === undefined && typeof message.method === "string") {
          events.push(message);
        }
      } catch {
        // Ignore diagnostic lines; JSON-RPC notifications are captured above.
      }
    });
    child.once("exit", () => {
      if (activeThreadId) {
        const session = this.sessions.get(activeThreadId);
        this.completedEvents.set(activeThreadId, {
          events,
          turnId: session?.turnId ?? activeTurnId,
          turnEventOffset: session?.turnEventOffset ?? 0,
        });
        this.sessions.delete(activeThreadId);
      }
      lines.close();
    });
    const send = (method: string, params: unknown, id?: number) => {
      child.stdin.write(
        `${JSON.stringify({ method, ...(id === undefined ? {} : { id }), params })}\n`,
      );
    };
    try {
      const initializeId = ++nextId;
      const initializeResponse = this.awaitResponse(lines, child, initializeId);
      send("initialize", codexAppServerInitializeParams(), initializeId);
      await initializeResponse;
      send("initialized", {});
      const threadIdRequest = ++nextId;
      const threadResponsePromise = this.awaitResponse(
        lines,
        child,
        threadIdRequest,
      );
      send(
        "thread/start",
        {
          model: packet.model,
          serviceName: "factory-dashboard",
          ...(packet.executionContext
            ? {
                cwd: packet.executionContext.cwd,
                sandboxPolicy: {
                  type: "workspaceWrite",
                  writableRoots: packet.executionContext.writableRoots,
                  networkAccess: false,
                },
              }
            : {}),
        },
        threadIdRequest,
      );
      const threadResponse = await threadResponsePromise;
      const threadId = String(threadResponse.result?.thread?.id ?? "");
      if (!threadId)
        throw new Error("Codex App Server did not return a thread id.");
      activeThreadId = threadId;
      const turnEventOffset = events.length;
      const turnRequestId = ++nextId;
      const turnResponse = this.awaitResponse(lines, child, turnRequestId);
      send(
        "turn/start",
        {
          threadId,
          input: [{ type: "text", text: packet.prompt }],
          model: packet.model,
          effort: packet.reasoningEffort,
          ...(packet.executionContext
            ? {
                cwd: packet.executionContext.cwd,
                sandboxPolicy: {
                  type: "workspaceWrite",
                  writableRoots: packet.executionContext.writableRoots,
                  networkAccess: false,
                },
              }
            : {}),
        },
        turnRequestId,
      );
      const turnResponseValue = await turnResponse;
      const turnId = String(turnResponseValue.result?.turn?.id ?? "");
      if (!turnId)
        throw new Error("Codex App Server did not return a turn id.");
      activeTurnId = turnId;
      this.sessions.set(threadId, {
        child,
        lines,
        events,
        turnId,
        turnEventOffset,
        send,
        nextId: () => ++nextId,
      });
      return {
        taskId: threadId,
        actualModel: packet.model,
        actualReasoningEffort: packet.reasoningEffort,
      };
    } catch (cause) {
      lines.close();
      child.kill();
      throw cause;
    }
  }

  async continueTask(taskId: string, packet: PromptPacket) {
    const session = this.sessions.get(taskId);
    if (!session)
      throw new Error(
        `Codex task ${taskId} is unavailable for phase continuation.`,
      );
    const current = await this.read(taskId);
    if (
      ["inprogress", "in_progress", "running"].includes(
        current.status.toLowerCase(),
      )
    )
      throw new Error(
        `Codex task ${taskId} has not finished its current phase.`,
      );
    const turnEventOffset = session.events.length;
    const turnRequestId = session.nextId();
    const turnResponse = this.awaitResponse(
      session.lines,
      session.child,
      turnRequestId,
    );
    session.send(
      "turn/start",
      {
        threadId: taskId,
        input: [{ type: "text", text: packet.prompt }],
        model: packet.model,
        effort: packet.reasoningEffort,
        ...(packet.executionContext
          ? {
              cwd: packet.executionContext.cwd,
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: packet.executionContext.writableRoots,
                networkAccess: false,
              },
            }
          : {}),
      },
      turnRequestId,
    );
    const turnResponseValue = await turnResponse;
    const turnId = String(turnResponseValue.result?.turn?.id ?? "");
    if (!turnId) throw new Error("Codex App Server did not return a turn id.");
    session.turnId = turnId;
    session.turnEventOffset = turnEventOffset;
    return {
      taskId,
      actualModel: packet.model,
      actualReasoningEffort: packet.reasoningEffort,
    };
  }

  async read(taskId: string): Promise<CodexTaskSnapshot> {
    const session = this.sessions.get(taskId);
    const completed = this.completedEvents.get(taskId);
    const events = session?.events ?? completed?.events ?? [];
    const turnId = session?.turnId ?? completed?.turnId ?? "";
    const turnEventOffset =
      session?.turnEventOffset ?? completed?.turnEventOffset ?? 0;
    const turnEvents = events.slice(turnEventOffset);
    const completedTurn = [...turnEvents].reverse().find((event) => {
      if (event.method !== "turn/completed") return false;
      if (!turnId) return true;
      const params = isRecord(event.params) ? event.params : undefined;
      const turn = isRecord(params?.turn) ? params.turn : undefined;
      return String(turn?.id ?? "") === turnId;
    });
    const turn =
      typeof completedTurn?.params === "object" &&
      completedTurn.params !== null &&
      typeof (completedTurn.params as Record<string, unknown>).turn ===
        "object" &&
      (completedTurn.params as Record<string, unknown>).turn !== null
        ? ((completedTurn.params as Record<string, unknown>).turn as Record<
            string,
            unknown
          >)
        : null;
    const completedMessages = turnEvents
      .filter((event) => event.method === "item/completed")
      .map((event) =>
        typeof event.params === "object" && event.params !== null
          ? (event.params as Record<string, unknown>).item
          : null,
      )
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .filter((item) => item.type === "agentMessage")
      .map((item) => String(item.text ?? ""));
    const deltas = turnEvents
      .filter((event) => event.method === "item/agentMessage/delta")
      .map((event) =>
        typeof event.params === "object" && event.params !== null
          ? String((event.params as Record<string, unknown>).delta ?? "")
          : "",
      )
      .join("");
    return {
      taskId,
      status: String(turn?.status ?? (session ? "inProgress" : "unknown")),
      output: completedMessages.at(-1) ?? deltas,
      events: events.slice(-500),
    };
  }

  async interrupt(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    const requestId = session.nextId();
    const response = this.awaitResponse(
      session.lines,
      session.child,
      requestId,
    );
    session.send(
      "turn/interrupt",
      { threadId: taskId, turnId: session.turnId },
      requestId,
    );
    await response;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.lines.close();
      session.child.kill();
    }
    this.sessions.clear();
    this.completedEvents.clear();
  }
}
