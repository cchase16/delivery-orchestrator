import crypto from "node:crypto";
import { watch as fsWatch, type Dirent, type FSWatcher } from "node:fs";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { reviewProductDiff, type DiffReview } from "./diff.js";
import type {
  ActiveRun,
  ArtifactDocument,
  ArtifactSummary,
  ApprovalSummary,
  DispositionSummary,
  ExecutionQuestionnaire,
  ExecutionProgress,
  EvidenceSummary,
  PreflightResult,
  PromptProfile,
  RunPlanAnalysis,
  RunPlanAnalysisResult,
  QualityGate,
  Snapshot,
  WorkflowEventSummary,
} from "../shared/types.js";
import { deriveRunPlanSidecar } from "./run-plan-markdown.js";
import type { DashboardConfig } from "./config.js";
import { RuntimeState } from "./state.js";
import { resolveCodexRuntime } from "./codex-runtime.js";
import type { SchemaRegistry } from "./validation.js";
import {
  resolveFactoryLock,
  type FactoryResolutionResult,
} from "./factory-resolver.js";

const defaultProfiles: PromptProfile[] = [
  {
    taskType: "work_package_sequencing",
    label: "Work-package sequencing",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    promptMode: "standard",
    adapter: "codex_app_server",
  },
  {
    taskType: "run_plan_generation",
    label: "Run-plan generation",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    promptMode: "standard",
    adapter: "codex_app_server",
  },
  {
    taskType: "run_plan_execution",
    label: "Run-plan execution",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    promptMode: "standard",
    adapter: "codex_app_server",
  },
];

export interface PreparedExecutionPhase {
  progress: ExecutionProgress;
  progressFilePath: string;
  planPath: string;
  firstPhaseId: string;
  firstPhaseTitle: string;
  firstTaskId: string;
  firstTaskTitle: string;
  phaseOrdinal: number;
  phaseCount: number;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

function titleFromFile(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function idFromFile(kind: string, filePath: string): string {
  const slug = path
    .basename(filePath, path.extname(filePath))
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toUpperCase()
    .replace(/^-|-$/g, "");
  const withoutPrefix = slug.startsWith(`${kind}-`)
    ? slug.slice(kind.length + 1)
    : slug;
  return `${kind}-${withoutPrefix.slice(0, 100)}`;
}

async function digest(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function stableArtifactId(prefix: string, ...parts: string[]): string {
  const token = crypto
    .createHash("sha256")
    .update(parts.join("\u001f"), "utf8")
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
  return `${prefix}-${token}`;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true });
    throw cause;
  }
}

async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
): Promise<T> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle: fs.FileHandle | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000)
          await fs.rm(lockPath, { force: true });
      } catch {
        /* The competing lock may have been released between stat and remove. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle)
    throw new Error("Timed out waiting for the delivery write lock.");
  try {
    return await action();
  } finally {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  }
}

async function nextEventSequence(directory: string): Promise<number> {
  const files = await walk(directory);
  return (
    files.filter((file) => path.basename(file).startsWith("EVT-")).length + 1
  );
}

function safeRelativeDirectory(
  root: string,
  value: unknown,
  fallback: string,
): string {
  const candidate =
    typeof value === "string" && value.trim() ? value : fallback;
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (
    path.isAbsolute(candidate) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  )
    throw new Error(
      `Configured directory escapes the delivery repository: ${candidate}`,
    );
  return relative.replaceAll("\\", "/");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0,
            )
            .map((item) => item.trim()),
        ),
      ]
    : [];
}

function pathPatternsOverlap(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .replaceAll("\\", "/")
      .replace(/\/\*\*$/, "")
      .replace(/\*$/, "");
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

const artifactDirectories: Array<[string, ArtifactSummary["kind"]]> = [
  ["requirements", "requirement"],
  ["run-plans", "run_plan"],
  ["work-packages", "work_package"],
  ["system-plans", "system_plan"],
];
const execFileAsync = promisify(execFile);
const supportedQualityGates: readonly QualityGate[] = [
  "dashboard_verify",
  "product_lint",
  "product_test",
  "product_build",
  "manifest_validation",
  "lint",
  "clean_install",
  "production_snapshot_upgrade",
  "unit_tests",
  "browser_tests",
  "targeted_validation",
];
const configuredRunnerExecutables = new Set([
  "npm",
  "node",
  "python",
  "python3",
  "odoo",
  "odoo-bin",
]);
type ConfiguredQualityGateRunner = {
  executable: string;
  args: string[];
  timeoutMs: number;
};

async function validateAddonManifests(productRoot: string): Promise<void> {
  let addonPaths = ["addons"];
  try {
    const value = parse(
      await fs.readFile(path.join(productRoot, "factory.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const odoo = value.odoo as Record<string, unknown> | undefined;
    const configured = stringArray(odoo?.addon_paths);
    if (configured.length) addonPaths = configured;
  } catch {
    /* The conventional addons directory remains the safe default. */
  }
  for (const addonPath of addonPaths) {
    const root = path.resolve(productRoot, addonPath);
    const productPrefix = path.resolve(productRoot) + path.sep;
    if (!root.startsWith(productPrefix))
      throw new Error(
        `Configured Odoo add-on path escapes the product repository: ${addonPath}`,
      );
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(root, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const moduleRoot = path.join(root, entry.name);
      const hasPythonModule = await exists(
        path.join(moduleRoot, "__init__.py"),
      );
      let manifestPath: string | undefined;
      for (const name of ["__manifest__.py", "__openerp__.py"]) {
        const candidate = path.join(moduleRoot, name);
        if (await exists(candidate)) {
          manifestPath = candidate;
          break;
        }
      }
      if (hasPythonModule && !manifestPath)
        throw new Error(`Odoo module ${entry.name} has no manifest file.`);
      if (manifestPath && !(await fs.readFile(manifestPath, "utf8")).trim())
        throw new Error(
          `Odoo module ${entry.name} has an empty manifest file.`,
        );
    }
  }
}

export function classifyValidationOutcome(input: {
  diffAllowed: boolean;
  validationPassed: boolean;
  qualityStatuses: readonly string[];
}): "passed" | "failed" | "blocked" | "partial" {
  if (!input.diffAllowed) return "blocked";
  if (
    !input.validationPassed ||
    input.qualityStatuses.some((status) =>
      ["failed", "timed_out"].includes(status),
    )
  )
    return "failed";
  if (input.qualityStatuses.some((status) => status === "skipped"))
    return "partial";
  return "passed";
}

async function resolveDeliveryFile(
  deliveryRoot: string,
  relativePath: string,
): Promise<string> {
  const absolute = path.resolve(deliveryRoot, relativePath);
  const lexicalRoot = path.resolve(deliveryRoot) + path.sep;
  if (!absolute.startsWith(lexicalRoot))
    throw new Error("Artifact path escaped the delivery repository.");
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(deliveryRoot),
    fs.realpath(absolute),
  ]);
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep))
    throw new Error("Artifact path escaped the delivery repository.");
  return realFile;
}

async function artifactList(
  root: string,
  directory: string,
  kind: ArtifactSummary["kind"],
  ignoredNames: string[],
): Promise<ArtifactSummary[]> {
  const files = await walk(path.join(root, directory));
  return Promise.all(
    files
      .filter((filePath) => !ignoredNames.includes(path.basename(filePath)))
      .filter((filePath) => !filePath.endsWith(".sidecar.json"))
      .map(async (filePath) => {
        const stat = await fs.stat(filePath);
        const extension = path.extname(filePath).slice(1).toLowerCase();
        let metadata: Record<string, unknown> = {};
        if (extension === "json") {
          try {
            metadata = JSON.parse(
              await fs.readFile(filePath, "utf8"),
            ) as Record<string, unknown>;
          } catch {
            /* validation reports malformed JSON separately */
          }
        }
        if (extension !== "json") {
          try {
            const sidecar = JSON.parse(
              await fs.readFile(
                path.join(
                  path.dirname(filePath),
                  `${path.basename(filePath, path.extname(filePath))}.sidecar.json`,
                ),
                "utf8",
              ),
            ) as Record<string, unknown>;
            if (typeof sidecar.run_plan_id === "string") metadata = sidecar;
          } catch {
            /* a sidecar is optional for legacy artifacts */
          }
        }
        const metadataStatus = metadata.status;
        const metadataIdKey =
          kind === "run_plan"
            ? "run_plan_id"
            : kind === "work_package"
              ? "work_package_id"
              : kind === "system_plan"
                ? "system_plan_id"
                : "requirement_id";
        const metadataRequirement = metadata.requirement;
        const metadataPhases = metadata.phases;
        const phaseCount = Array.isArray(metadataPhases)
          ? metadataPhases.length
          : undefined;
        const taskCount = Array.isArray(metadataPhases)
          ? metadataPhases.reduce(
              (count, phase) =>
                count +
                (typeof phase === "object" &&
                phase !== null &&
                Array.isArray((phase as Record<string, unknown>).tasks)
                  ? ((phase as Record<string, unknown>).tasks as unknown[])
                      .length
                  : 0),
              0,
            )
          : undefined;
        return {
          id:
            typeof metadata[metadataIdKey] === "string"
              ? String(metadata[metadataIdKey])
              : idFromFile(
                  kind === "run_plan"
                    ? "RP"
                    : kind === "work_package"
                      ? "WP"
                      : kind === "system_plan"
                        ? "SP"
                        : "REQ",
                  filePath,
                ),
          title: titleFromFile(filePath),
          kind,
          path: path.relative(root, filePath).replaceAll("\\", "/"),
          extension,
          revision:
            typeof metadata.revision === "number" && metadata.revision > 0
              ? metadata.revision
              : 1,
          digest: await digest(filePath),
          status:
            typeof metadataStatus === "string" &&
            [
              "awaiting_review",
              "approved",
              "rejected",
              "draft",
              "missing",
              "blocked",
              "complete",
              "invalid",
              "superseded",
            ].includes(metadataStatus)
              ? (metadataStatus as ArtifactSummary["status"])
              : kind === "system_plan"
                ? "approved"
                : kind === "run_plan"
                  ? "draft"
                  : "awaiting_review",
          updatedAt: stat.mtime.toISOString(),
          relatedRequirementId:
            kind === "run_plan" &&
            typeof metadataRequirement === "object" &&
            metadataRequirement !== null &&
            typeof (metadataRequirement as Record<string, unknown>).id ===
              "string"
              ? String((metadataRequirement as Record<string, unknown>).id)
              : undefined,
          phaseCount,
          taskCount,
        } satisfies ArtifactSummary;
      }),
  );
}

export class DeliveryRepository {
  private codexProbe: {
    at: number;
    available: boolean;
    detail: string;
  } | null = null;
  private readonly leaseOwner = `dashboard-${process.pid}`;
  private readonly watchers: FSWatcher[] = [];

  constructor(
    private readonly config: DashboardConfig,
    private readonly state: RuntimeState,
    private readonly schemaRegistry?: SchemaRegistry,
  ) {
    state.seedProfiles(defaultProfiles);
  }

  private async writeDurable(filePath: string, content: string): Promise<void> {
    await withFileLock(
      path.join(this.config.runtimeDirectory, "delivery-write.lock"),
      () => atomicWrite(filePath, content),
    );
  }

  async resolveDeliveryLock(input: {
    acknowledged: boolean;
    note?: string;
  }): Promise<{
    status: "resolved";
    resolvedAt: string;
    repositoryCount: number;
    contractCount: number;
    dirtyRepositories: string[];
  }> {
    if (!input.acknowledged)
      throw new Error(
        "Manual delivery-lock resolution requires operator acknowledgement.",
      );
    if (this.state.getActiveRun())
      throw new Error(
        "The delivery lock cannot be changed during an active run.",
      );
    const note = input.note?.trim() ?? "";
    if (note.length > 1000)
      throw new Error(
        "Delivery-lock resolution notes are limited to 1000 characters.",
      );

    let systemYaml: Record<string, unknown> = {};
    try {
      systemYaml = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        "system.yaml must be readable before resolving the lock.",
      );
    }
    const configuredRepositories =
      typeof systemYaml.repositories === "object" &&
      systemYaml.repositories !== null
        ? (systemYaml.repositories as Record<string, unknown>)
        : {};
    const repositoryPaths = new Map<string, string>();
    for (const [name, value] of Object.entries(configuredRepositories)) {
      if (typeof value !== "object" || value === null) continue;
      const localPath = (value as Record<string, unknown>).local_path;
      if (typeof localPath !== "string" || !localPath.trim()) continue;
      repositoryPaths.set(name, localPath.replaceAll("\\", "/"));
    }
    if (!repositoryPaths.has("product"))
      repositoryPaths.set(
        "product",
        path
          .relative(
            this.config.deliveryRepository,
            this.config.productRepository,
          )
          .replaceAll("\\", "/"),
      );
    if (!repositoryPaths.has("delivery_orchestrator"))
      repositoryPaths.set(
        "delivery_orchestrator",
        path
          .relative(
            this.config.deliveryRepository,
            this.config.orchestratorRepository,
          )
          .replaceAll("\\", "/"),
      );
    repositoryPaths.set("delivery_repository", ".");

    const repositoryBindings: Record<
      string,
      {
        path: string;
        revision: string | null;
        branch: string;
        working_tree: "clean" | "dirty" | "unavailable";
      }
    > = {};
    for (const [name, configuredPath] of [...repositoryPaths.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const repositoryPath = path.resolve(
        this.config.deliveryRepository,
        configuredPath,
      );
      const git = await this.inspectRepositoryGit(repositoryPath);
      repositoryBindings[name] = {
        path: configuredPath,
        revision: git.head || null,
        branch: git.branch,
        working_tree: git.available
          ? git.dirty
            ? "dirty"
            : "clean"
          : "unavailable",
      };
    }

    const schemaFiles = (await walk(this.config.schemaDirectory))
      .filter((file) => file.toLowerCase().endsWith(".schema.json"))
      .sort((left, right) => left.localeCompare(right));
    const contractBindings = await Promise.all(
      schemaFiles.map(async (file) => {
        let schemaId = "unknown";
        let schemaVersion: number | string | null = null;
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
            string,
            unknown
          >;
          schemaId = String(value.$id ?? "unknown");
          schemaVersion =
            typeof value.schema_version === "number" ||
            typeof value.schema_version === "string"
              ? value.schema_version
              : null;
        } catch {
          /* The fingerprint still records unreadable or malformed schemas. */
        }
        return {
          id: schemaId,
          version: schemaVersion,
          path: path
            .relative(this.config.orchestratorRepository, file)
            .replaceAll("\\", "/"),
          sha256: await digest(file),
        };
      }),
    );
    const resolvedAt = new Date().toISOString();
    const dirtyRepositories = Object.entries(repositoryBindings)
      .filter(([, binding]) => binding.working_tree === "dirty")
      .map(([name]) => name);
    const lock = {
      lock_version: 1,
      status: "resolved",
      resolution: {
        mode: "manual_operator_attestation",
        resolved_at: resolvedAt,
        resolved_by: {
          actor_id: "local-operator",
          actor_type: "human",
          display_name: "Local operator",
          authentication_method: "localhost",
        },
        note:
          note ||
          "Operator accepted the captured repository and contract state for governed execution.",
        policy: {
          repository_changes: "warning",
          detail:
            "Working-tree changes are recorded for review but do not block this manual lock version.",
        },
      },
      repositories: repositoryBindings,
      contracts: contractBindings,
    };
    await this.writeDurable(
      path.join(this.config.deliveryRepository, "delivery.lock"),
      [
        "# GENERATED BY THE DELIVERY-ORCHESTRATOR DASHBOARD.",
        "# Manual resolution records operator acceptance of the captured state.",
        stringify(lock, { lineWidth: 0 }).trimEnd(),
        "",
      ].join("\n"),
    );
    this.state.recordAction("delivery_lock_resolved", {
      resolvedAt,
      resolvedBy: "local-operator",
      repositoryCount: Object.keys(repositoryBindings).length,
      contractCount: contractBindings.length,
      dirtyRepositories,
    });
    return {
      status: "resolved",
      resolvedAt,
      repositoryCount: Object.keys(repositoryBindings).length,
      contractCount: contractBindings.length,
      dirtyRepositories,
    };
  }

  async resolveFactoryLock(): Promise<FactoryResolutionResult> {
    if (this.state.getActiveRun())
      throw new Error(
        "The factory lock cannot be changed during an active run.",
      );

    let systemYaml: Record<string, unknown>;
    try {
      systemYaml = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        "system.yaml must be readable before resolving factory.lock.",
      );
    }
    const repositories =
      typeof systemYaml.repositories === "object" &&
      systemYaml.repositories !== null
        ? (systemYaml.repositories as Record<string, unknown>)
        : {};
    const developmentFactory = repositories.development_factory;
    const configuredPath =
      typeof developmentFactory === "object" &&
      developmentFactory !== null &&
      typeof (developmentFactory as Record<string, unknown>).local_path ===
        "string"
        ? String(
            (developmentFactory as Record<string, unknown>).local_path,
          ).trim()
        : "";
    if (!configuredPath)
      throw new Error(
        "system.yaml does not define repositories.development_factory.local_path.",
      );
    const factoryRepository = path.resolve(
      this.config.deliveryRepository,
      configuredPath,
    );
    if (!(await exists(factoryRepository)))
      throw new Error(
        `The configured development factory repository does not exist: ${configuredPath}`,
      );

    const result = await resolveFactoryLock({
      productRepository: this.config.productRepository,
      factoryRepository,
      writeFile: (filePath, content) => this.writeDurable(filePath, content),
    });
    this.state.recordAction("factory_lock_resolved", {
      resolvedAt: result.resolvedAt,
      configurationSha256: result.configurationSha256,
      factoryRevision: result.factoryRevision,
      qualityGateCount: result.qualityGateCount,
    });
    return result;
  }

  startWatcher(onChange?: () => void): () => void {
    if (this.watchers.length) return () => this.stopWatcher();
    const targets = [
      this.config.deliveryRepository,
      path.join(this.config.deliveryRepository, "system.yaml"),
      path.join(this.config.deliveryRepository, "delivery.lock"),
      ...artifactDirectories.map(([directory]) =>
        path.join(this.config.deliveryRepository, directory),
      ),
      path.join(this.config.deliveryRepository, "control"),
      path.join(this.config.deliveryRepository, "evidence"),
    ];
    for (const target of targets) {
      try {
        const watcher = fsWatch(target, { recursive: true }, () => {
          this.codexProbe = null;
          onChange?.();
        });
        this.watchers.push(watcher);
      } catch {
        /* A missing optional directory is handled by the next snapshot. */
      }
    }
    return () => this.stopWatcher();
  }

  stopWatcher(): void {
    for (const watcher of this.watchers.splice(0)) watcher.close();
  }

  async snapshot(): Promise<Snapshot> {
    const deliveryExists = await exists(this.config.deliveryRepository);
    const productExists = await exists(this.config.productRepository);
    let systemYaml: Record<string, unknown> = {};
    let lockStatus = "Missing";
    try {
      systemYaml = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
    } catch {
      /* reported in health */
    }
    try {
      const lock = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "delivery.lock"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      lockStatus = String(lock.status ?? "unknown");
    } catch {
      /* reported in health */
    }

    const requirementsConfig = systemYaml.requirements as
      Record<string, unknown> | undefined;
    const deliveryConfig = systemYaml.delivery as
      Record<string, unknown> | undefined;
    const directories = {
      requirements: safeRelativeDirectory(
        this.config.deliveryRepository,
        requirementsConfig?.directory,
        "requirements",
      ),
      runPlans: safeRelativeDirectory(
        this.config.deliveryRepository,
        deliveryConfig?.run_plan_directory,
        "run-plans",
      ),
      workPackages: safeRelativeDirectory(
        this.config.deliveryRepository,
        deliveryConfig?.work_package_directory,
        "work-packages",
      ),
      systemPlans: safeRelativeDirectory(
        this.config.deliveryRepository,
        deliveryConfig?.system_plan_directory,
        "system-plans",
      ),
    };

    const [requirements, runPlans, workPackages, systemPlans, git, codex] =
      await Promise.all([
        artifactList(
          this.config.deliveryRepository,
          directories.requirements,
          "requirement",
          ["README.md", "index.yaml"],
        ),
        artifactList(
          this.config.deliveryRepository,
          directories.runPlans,
          "run_plan",
          ["README.md"],
        ),
        artifactList(
          this.config.deliveryRepository,
          directories.workPackages,
          "work_package",
          ["README.md"],
        ),
        artifactList(
          this.config.deliveryRepository,
          directories.systemPlans,
          "system_plan",
          ["README.md"],
        ),
        this.inspectGit(),
        this.inspectCodex(),
      ]);
    const baseArtifacts = [
      ...requirements,
      ...systemPlans,
      ...runPlans,
      ...workPackages,
    ];
    const validationErrors = await this.validateIndexedArtifacts(
      baseArtifacts,
      directories,
    );
    const referenceErrors = await this.validateReferences(baseArtifacts);
    const diagnostics = [...validationErrors, ...referenceErrors];
    const recordedApprovals = await this.readApprovals();
    const artifacts = baseArtifacts
      .map((artifact) => {
        const decision = recordedApprovals
          .filter((approval) => approval.artifactId === artifact.id)
          .sort((a, b) =>
            String(b.requestedAt).localeCompare(String(a.requestedAt)),
          )[0];
        if (!decision) return artifact;
        if (
          decision.bindingDigest?.toLowerCase() !==
            artifact.digest.toLowerCase() ||
          decision.revision !== artifact.revision
        )
          return { ...artifact, status: "invalid" as const };
        return {
          ...artifact,
          status:
            decision.status === "approved"
              ? ("approved" as const)
              : ("rejected" as const),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const decidedArtifactIds = new Set(
      recordedApprovals.map((approval) => approval.artifactId),
    );
    const pendingApprovals: ApprovalSummary[] = artifacts
      .filter(
        (artifact) =>
          ["requirement", "run_plan", "work_package"].includes(artifact.kind) &&
          ["awaiting_review", "draft"].includes(artifact.status) &&
          !decidedArtifactIds.has(artifact.id),
      )
      .map((artifact) => ({
        id: `PENDING-${artifact.id}`,
        type: artifact.kind as "requirement" | "run_plan" | "work_package",
        title:
          artifact.kind === "work_package"
            ? "Work package approval"
            : artifact.kind === "run_plan"
              ? "Run plan approval"
              : "Requirement approval",
        artifactId: artifact.id,
        source: artifact.path,
        requestedBy: "Local operator",
        requestedAt: artifact.updatedAt,
        priority: artifact.kind === "requirement" ? "high" : "medium",
        status: "pending",
        revision: artifact.revision,
        bindingDigest: artifact.digest,
      }));
    const approvals = [...recordedApprovals, ...pendingApprovals];
    const events = await this.readWorkflowEvents();
    const evidence = await this.readEvidenceSummaries();
    const dispositions = await this.readDispositions();
    const blockers = [
      ...(deliveryExists
        ? []
        : ["Customer delivery repository is not reachable."]),
      ...(productExists ? [] : ["Product repository is not reachable."]),
      ...(lockStatus === "resolved"
        ? []
        : [
            `delivery.lock is ${lockStatus.toLowerCase()}; governed execution is blocked.`,
          ]),
      ...(systemPlans.length
        ? []
        : ["No system plan is present in the configured delivery repository."]),
      ...(artifacts.some((artifact) => artifact.status === "invalid")
        ? [
            "One or more approval bindings no longer match the current artifact digest.",
          ]
        : []),
      ...(diagnostics.length
        ? [`${diagnostics.length} indexed artifact validation error(s).`]
        : []),
    ];
    const system = systemYaml.system as Record<string, unknown> | undefined;
    const repositories = Object.fromEntries(
      Object.entries(
        (systemYaml.repositories as Record<string, unknown> | undefined) ?? {},
      ).map(([key, value]) => [
        key,
        typeof value === "object" && value !== null
          ? String((value as Record<string, unknown>).local_path ?? "")
          : String(value),
      ]),
    );
    return {
      generatedAt: new Date().toISOString(),
      system: {
        id: String(system?.id ?? "customer-odoo"),
        name: String(system?.name ?? "Customer Odoo"),
        branch: git.branch,
        productHead: git.head,
        deliveryPath: this.config.deliveryRepository,
        lockStatus,
        repositories,
        directories,
      },
      health: [
        {
          label: "Delivery repository",
          status: deliveryExists ? "healthy" : "offline",
          detail: deliveryExists ? "Connected" : "Unavailable",
        },
        {
          label: "Product repository",
          status: productExists ? "healthy" : "offline",
          detail: productExists ? "Connected" : "Unavailable",
        },
        {
          label: "Git",
          status: git.available
            ? git.dirty
              ? "warning"
              : "healthy"
            : "offline",
          detail: git.available
            ? git.dirty
              ? `${git.branch} · worktree has changes`
              : `${git.branch} · clean`
            : "Unavailable",
        },
        {
          label: "Codex App Server",
          status: codex.available ? "healthy" : "warning",
          detail: codex.detail,
        },
      ],
      artifacts,
      approvals,
      activeRun: this.state.getActiveRun(),
      latestRun: this.state.getLatestRun(),
      promptProfiles: this.state.getPromptProfiles(),
      blockers,
      events,
      evidence,
      dispositions,
      runtimeActions: this.state.listActions(),
      validationErrors: diagnostics,
    };
  }

  private async readWorkflowEvents(): Promise<WorkflowEventSummary[]> {
    const eventsDirectory = path.join(
      this.config.deliveryRepository,
      "control",
      "events",
    );
    const files = (await walk(eventsDirectory)).filter(
      (file) => path.extname(file).toLowerCase() === ".json",
    );
    const events = await Promise.all(
      files.map(async (file): Promise<WorkflowEventSummary | null> => {
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
            string,
            unknown
          >;
          const details =
            typeof value.details === "object" && value.details !== null
              ? (value.details as Record<string, unknown>)
              : {};
          return {
            eventId: String(value.event_id ?? path.basename(file)),
            eventType: String(value.event_type ?? "unknown"),
            sequence: Number(value.sequence ?? 0),
            occurredAt: String(value.occurred_at ?? ""),
            gateId:
              typeof value.gate_id === "string" ? value.gate_id : undefined,
            approvalId:
              typeof value.caused_by_approval_id === "string"
                ? value.caused_by_approval_id
                : undefined,
            artifactId:
              typeof details.artifact_id === "string"
                ? details.artifact_id
                : undefined,
            decision:
              typeof details.decision === "string"
                ? details.decision
                : undefined,
          };
        } catch {
          return null;
        }
      }),
    );
    return events
      .filter((event): event is WorkflowEventSummary => event !== null)
      .sort((a, b) => b.sequence - a.sequence);
  }

  private async readEvidenceSummaries(): Promise<EvidenceSummary[]> {
    const directory = await this.configuredEvidenceDirectory();
    const files = (
      await walk(path.join(this.config.deliveryRepository, directory))
    ).filter((file) => path.extname(file).toLowerCase() === ".json");
    const summaries = await Promise.all(
      files.map(async (file): Promise<EvidenceSummary | null> => {
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
            string,
            unknown
          >;
          const outcome = String(value.outcome ?? "blocked");
          if (!["passed", "failed", "blocked", "partial"].includes(outcome))
            return null;
          const stat = await fs.stat(file);
          return {
            evidenceId: String(value.evidence_id ?? path.basename(file)),
            runId: String(value.run_id ?? ""),
            path: path
              .relative(this.config.deliveryRepository, file)
              .replaceAll("\\", "/"),
            outcome: outcome as EvidenceSummary["outcome"],
            updatedAt: stat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
    );
    return summaries
      .filter((summary): summary is EvidenceSummary => summary !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async readDispositions(): Promise<DispositionSummary[]> {
    const directory = path.join(
      this.config.deliveryRepository,
      "control",
      "dispositions",
    );
    const files = (await walk(directory)).filter(
      (file) => path.extname(file).toLowerCase() === ".json",
    );
    const summaries = await Promise.all(
      files.map(async (file): Promise<DispositionSummary | null> => {
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
            string,
            unknown
          >;
          const decision = String(value.decision ?? "");
          if (
            !["accepted", "exception_accepted", "rejected", "replan"].includes(
              decision,
            )
          )
            return null;
          return {
            dispositionId: String(value.disposition_id ?? path.basename(file)),
            runId: String(value.run_id ?? ""),
            decision: decision as DispositionSummary["decision"],
            reason: String(value.reason ?? ""),
            issuedAt: String(value.issued_at ?? ""),
          };
        } catch {
          return null;
        }
      }),
    );
    return summaries
      .filter((summary): summary is DispositionSummary => summary !== null)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }

  private async validateReferences(
    artifacts: ArtifactSummary[],
  ): Promise<NonNullable<Snapshot["validationErrors"]>> {
    const byId = new Map<string, ArtifactSummary[]>();
    for (const artifact of artifacts) {
      const entries = byId.get(artifact.id) ?? [];
      entries.push(artifact);
      byId.set(artifact.id, entries);
    }
    const issues: NonNullable<Snapshot["validationErrors"]> = [];
    for (const [id, entries] of byId) {
      if (entries.length > 1)
        issues.push({
          source: entries.map((entry) => entry.path).join(", "),
          schemaId: "reference",
          path: `/id/${id}`,
          message: "Duplicate artifact identifier.",
        });
    }
    for (const artifact of artifacts.filter(
      (candidate) =>
        candidate.kind === "work_package" && candidate.extension === "json",
    )) {
      try {
        const value = JSON.parse(
          await fs.readFile(
            path.join(this.config.deliveryRepository, artifact.path),
            "utf8",
          ),
        ) as Record<string, unknown>;
        const members = Array.isArray(value.members)
          ? (value.members as Array<Record<string, unknown>>)
          : [];
        for (const member of members) {
          const runPlanId = String(member.run_plan_id ?? "");
          const runPlan = artifacts.find(
            (candidate) =>
              candidate.id === runPlanId && candidate.kind === "run_plan",
          );
          if (!runPlan) {
            issues.push({
              source: artifact.path,
              schemaId: "reference",
              path: "/members",
              message: `Work package references missing run plan: ${runPlanId}`,
            });
          } else if (
            String(member.sha256 ?? "").toLowerCase() !==
              runPlan.digest.toLowerCase() ||
            Number(member.revision ?? 0) !== runPlan.revision
          ) {
            issues.push({
              source: artifact.path,
              schemaId: "reference",
              path: "/members",
              message: `Work package reference is stale: ${runPlanId}`,
            });
          }
        }
      } catch {
        // JSON and schema errors are reported by validateIndexedArtifacts.
      }
    }
    return issues;
  }

  private async validateIndexedArtifacts(
    artifacts: ArtifactSummary[],
    directories: Record<string, string>,
  ): Promise<NonNullable<Snapshot["validationErrors"]>> {
    if (!this.schemaRegistry) return [];
    const candidates = new Map<string, { schemaId: string; value: unknown }>();
    const schemaForKind: Record<ArtifactSummary["kind"], string> = {
      requirement: "urn:odoo-development-factory:schema:requirement:1",
      run_plan: "urn:odoo-development-factory:schema:run-plan:1",
      work_package: "urn:odoo-development-factory:schema:work-package:1",
      system_plan: "urn:odoo-development-factory:schema:system-plan:1",
    };
    for (const artifact of artifacts) {
      if (artifact.extension !== "json") continue;
      const absolute = path.join(this.config.deliveryRepository, artifact.path);
      try {
        candidates.set(artifact.path, {
          schemaId: schemaForKind[artifact.kind],
          value: JSON.parse(await fs.readFile(absolute, "utf8")),
        });
      } catch (cause) {
        candidates.set(artifact.path, {
          schemaId: schemaForKind[artifact.kind],
          value: {
            __parse_error:
              cause instanceof Error ? cause.message : "invalid JSON",
          },
        });
      }
    }
    for (const directory of Object.values(directories)) {
      for (const file of await walk(
        path.join(this.config.deliveryRepository, directory),
      )) {
        if (!file.endsWith(".sidecar.json")) continue;
        const relative = path
          .relative(this.config.deliveryRepository, file)
          .replaceAll("\\", "/");
        try {
          const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
            string,
            unknown
          >;
          const schemaId =
            typeof value.run_plan_id === "string"
              ? "urn:odoo-development-factory:schema:run-plan:1"
              : typeof value.requirement_id === "string"
                ? "urn:odoo-development-factory:schema:requirement:1"
                : typeof value.work_package_id === "string"
                  ? "urn:odoo-development-factory:schema:work-package:1"
                  : typeof value.evidence_id === "string"
                    ? "urn:odoo-development-factory:schema:validation-evidence:1"
                    : typeof value.task_type === "string"
                      ? "urn:odoo-development-factory:schema:model-profile:1"
                      : "";
          if (schemaId) candidates.set(relative, { schemaId, value });
        } catch (cause) {
          candidates.set(relative, {
            schemaId: "unknown",
            value: {
              __parse_error:
                cause instanceof Error ? cause.message : "invalid JSON",
            },
          });
        }
      }
    }
    const controlDirectories: Array<[string, string]> = [
      ["control/approvals", "urn:odoo-development-factory:schema:approval:1"],
      ["control/commands", "urn:odoo-development-factory:schema:command:1"],
      [
        "control/events",
        "urn:odoo-development-factory:schema:workflow-event:1",
      ],
    ];
    for (const [directory, schemaId] of controlDirectories) {
      for (const file of await walk(
        path.join(this.config.deliveryRepository, directory),
      )) {
        if (path.extname(file).toLowerCase() !== ".json") continue;
        const relative = path
          .relative(this.config.deliveryRepository, file)
          .replaceAll("\\", "/");
        try {
          candidates.set(relative, {
            schemaId,
            value: JSON.parse(await fs.readFile(file, "utf8")),
          });
        } catch (cause) {
          candidates.set(relative, {
            schemaId,
            value: {
              __parse_error:
                cause instanceof Error ? cause.message : "invalid JSON",
            },
          });
        }
      }
    }
    const issues: NonNullable<Snapshot["validationErrors"]> = [];
    for (const [source, candidate] of candidates) {
      if (candidate.schemaId === "unknown") {
        issues.push({
          source,
          schemaId: candidate.schemaId,
          path: "/",
          message: "Invalid JSON",
        });
        continue;
      }
      const result = this.schemaRegistry.validate(
        candidate.schemaId,
        candidate.value,
      );
      for (const error of result.errors)
        issues.push({ source, schemaId: candidate.schemaId, ...error });
    }
    return issues;
  }

  private async inspectRepositoryGit(repositoryPath: string): Promise<{
    available: boolean;
    dirty: boolean;
    branch: string;
    head: string;
  }> {
    try {
      const head = (
        await execFileAsync(
          "git",
          ["-C", repositoryPath, "rev-parse", "HEAD"],
          { timeout: 3000 },
        )
      ).stdout.trim();
      const branch =
        (
          await execFileAsync(
            "git",
            ["-C", repositoryPath, "rev-parse", "--abbrev-ref", "HEAD"],
            { timeout: 3000 },
          )
        ).stdout.trim() || "detached";
      const status = (
        await execFileAsync(
          "git",
          [
            "-C",
            repositoryPath,
            "status",
            "--porcelain",
            "--untracked-files=all",
          ],
          { timeout: 3000 },
        )
      ).stdout.trim();
      return { available: true, dirty: Boolean(status), branch, head };
    } catch {
      return { available: false, dirty: false, branch: "unknown", head: "" };
    }
  }

  private async inspectGit(): Promise<{
    available: boolean;
    dirty: boolean;
    branch: string;
    head: string;
  }> {
    return this.inspectRepositoryGit(this.config.productRepository);
  }

  private async inspectCodex(): Promise<{
    available: boolean;
    detail: string;
  }> {
    if (this.codexProbe && Date.now() - this.codexProbe.at < 30000)
      return this.codexProbe;
    try {
      const runtime = await resolveCodexRuntime();
      await execFileAsync(runtime.executable, ["app-server", "--help"], {
        timeout: 3000,
      });
      this.codexProbe = {
        at: Date.now(),
        available: true,
        detail: `Codex ${runtime.version} · stdio transport available · ${runtime.source}`,
      };
    } catch {
      this.codexProbe = {
        at: Date.now(),
        available: false,
        detail: "Capability check failed",
      };
    }
    return this.codexProbe;
  }

  private async readApprovals(): Promise<ApprovalSummary[]> {
    const files = await walk(
      path.join(this.config.deliveryRepository, "control", "approvals"),
    );
    const items: Array<ApprovalSummary | null> = await Promise.all(
      files
        .filter((file) => path.extname(file).toLowerCase() === ".json")
        .map(async (filePath): Promise<ApprovalSummary | null> => {
          try {
            const value = JSON.parse(
              await fs.readFile(filePath, "utf8"),
            ) as Record<string, unknown>;
            const target = value.target as Record<string, unknown> | undefined;
            const bindings = Array.isArray(value.bindings)
              ? (value.bindings as Array<Record<string, unknown>>)
              : [];
            const binding = bindings[0];
            const bindingType = String(binding?.binding_type ?? "requirement");
            const type = bindingType.includes("run_plan")
              ? "run_plan"
              : bindingType === "work_package"
                ? "work_package"
                : "requirement";
            return {
              id: String(value.approval_id ?? path.basename(filePath)),
              type,
              title: String(value.gate_id ?? "Approval"),
              artifactId: String(binding?.artifact_id ?? target?.task_id ?? ""),
              source: String(binding?.path ?? "control/approvals"),
              requestedBy: String(
                (value.issued_by as Record<string, unknown> | undefined)
                  ?.display_name ?? "Operator",
              ),
              requestedAt: String(value.issued_at ?? ""),
              priority: "medium",
              status: value.decision === "approved" ? "approved" : "rejected",
              revision: Number(binding?.revision ?? 0) || undefined,
              bindingDigest:
                String(
                  (binding?.digest as Record<string, unknown> | undefined)
                    ?.value ?? "",
                ) || undefined,
            } satisfies ApprovalSummary;
          } catch {
            return null;
          }
        }),
    );
    return items.filter((item): item is ApprovalSummary => item !== null);
  }

  async readArtifact(artifactId: string): Promise<ArtifactDocument | null> {
    const all = await Promise.all(
      artifactDirectories.map(([directory, kind]) =>
        artifactList(this.config.deliveryRepository, directory, kind, [
          "README.md",
          "index.yaml",
        ]),
      ),
    );
    const artifact = all.flat().find((item) => item.id === artifactId);
    if (!artifact) return null;
    const absolute = await resolveDeliveryFile(
      this.config.deliveryRepository,
      artifact.path,
    );
    const previewable = [
      "md",
      "markdown",
      "yaml",
      "yml",
      "json",
      "txt",
    ].includes(artifact.extension);
    const content = previewable ? await fs.readFile(absolute, "utf8") : null;
    const contentType =
      artifact.extension === "md" || artifact.extension === "markdown"
        ? "text/markdown"
        : artifact.extension === "json"
          ? "application/json"
          : artifact.extension === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "text/plain";
    return { artifact, content, contentType, previewable };
  }

  async compareArtifacts(
    leftId: string,
    rightId: string,
  ): Promise<{
    left: Pick<ArtifactSummary, "id" | "revision" | "path" | "digest">;
    right: Pick<ArtifactSummary, "id" | "revision" | "path" | "digest">;
    changed: boolean;
    diff: string;
  }> {
    const [left, right] = await Promise.all([
      this.readArtifact(leftId),
      this.readArtifact(rightId),
    ]);
    if (!left || !right)
      throw new Error("Both comparison artifacts are required.");
    if (left.artifact.kind !== right.artifact.kind)
      throw new Error("Comparison artifacts must have the same kind.");
    if (left.content === null || right.content === null)
      throw new Error("Only text artifacts can be compared.");
    const leftLines = left.content.split(/\r?\n/);
    const rightLines = right.content.split(/\r?\n/);
    const prefix: string[] = [];
    const suffix: string[] = [];
    let start = 0;
    while (
      start < leftLines.length &&
      start < rightLines.length &&
      leftLines[start] === rightLines[start]
    ) {
      prefix.push(`  ${leftLines[start]}`);
      start += 1;
    }
    let leftEnd = leftLines.length - 1;
    let rightEnd = rightLines.length - 1;
    while (
      leftEnd >= start &&
      rightEnd >= start &&
      leftLines[leftEnd] === rightLines[rightEnd]
    ) {
      suffix.unshift(`  ${leftLines[leftEnd]}`);
      leftEnd -= 1;
      rightEnd -= 1;
    }
    const diff = [
      `--- ${left.artifact.path} (rev ${left.artifact.revision})`,
      `+++ ${right.artifact.path} (rev ${right.artifact.revision})`,
      ...prefix,
      ...leftLines.slice(start, leftEnd + 1).map((line) => `- ${line}`),
      ...rightLines.slice(start, rightEnd + 1).map((line) => `+ ${line}`),
      ...suffix,
    ].join("\n");
    return {
      left: {
        id: left.artifact.id,
        revision: left.artifact.revision,
        path: left.artifact.path,
        digest: left.artifact.digest,
      },
      right: {
        id: right.artifact.id,
        revision: right.artifact.revision,
        path: right.artifact.path,
        digest: right.artifact.digest,
      },
      changed: left.content !== right.content,
      diff,
    };
  }

  async readArtifactRaw(artifactId: string): Promise<{
    artifact: ArtifactSummary;
    content: Buffer;
    contentType: string;
  } | null> {
    const document = await this.readArtifact(artifactId);
    if (!document) return null;
    const absolute = await resolveDeliveryFile(
      this.config.deliveryRepository,
      document.artifact.path,
    );
    return {
      artifact: document.artifact,
      content: await fs.readFile(absolute),
      contentType: document.contentType,
    };
  }

  async recordDecision(payload: {
    artifactId: string;
    kind: string;
    decision: "approved" | "rejected";
    reason?: string;
    idempotencyKey?: string;
    revision?: number;
    digest?: string;
  }): Promise<string> {
    const artifact = await this.readArtifact(payload.artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${payload.artifactId}`);
    if (
      payload.revision !== undefined &&
      payload.revision !== artifact.artifact.revision
    )
      throw new Error(
        "Decision target revision is stale; refresh the artifact.",
      );
    if (
      payload.digest &&
      payload.digest.toLowerCase() !== artifact.artifact.digest.toLowerCase()
    )
      throw new Error("Decision target digest is stale; refresh the artifact.");
    if (payload.decision === "rejected" && !payload.reason?.trim())
      throw new Error("A rejection reason is required.");
    if (
      artifact.artifact.kind !== payload.kind &&
      !(
        payload.kind === "system_plan" &&
        artifact.artifact.kind === "system_plan"
      )
    )
      throw new Error("Artifact kind does not match decision target.");
    const priorDecision = (await this.readApprovals())
      .filter(
        (approval) =>
          approval.artifactId === artifact.artifact.id &&
          approval.revision === artifact.artifact.revision &&
          approval.bindingDigest?.toLowerCase() ===
            artifact.artifact.digest.toLowerCase(),
      )
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
    if (priorDecision) {
      if (
        (payload.decision === "approved" &&
          priorDecision.status === "approved") ||
        (payload.decision === "rejected" && priorDecision.status === "rejected")
      ) {
        return priorDecision.id.startsWith("APR-")
          ? `ACT-${priorDecision.id.slice(4)}`
          : priorDecision.id;
      }
      throw new Error(
        "This exact artifact revision already has an immutable decision; create a new revision to change it.",
      );
    }
    const idempotencyKey =
      payload.idempotencyKey ??
      `decision:${artifact.artifact.id}:${artifact.artifact.revision}:${artifact.artifact.digest}:${payload.decision}`;
    const actionId = this.state.recordAction(
      "decision",
      payload,
      idempotencyKey,
    );
    const approvalsDir = path.join(
      this.config.deliveryRepository,
      "control",
      "approvals",
    );
    await fs.mkdir(approvalsDir, { recursive: true });
    const filePath = path.join(approvalsDir, `${actionId}.json`);
    const bindingType =
      payload.kind === "run_plan"
        ? "run_plan"
        : payload.kind === "work_package"
          ? "work_package"
          : payload.kind === "system_plan"
            ? "system_plan"
            : "requirement";
    const packageBindings =
      payload.kind === "work_package"
        ? await this.readWorkPackageBindings(artifact.artifact)
        : [];
    const record = {
      schema_version: 1,
      approval_id: `APR-${actionId.slice(4)}`,
      gate_id: `${payload.kind}_acceptance`,
      decision: payload.decision,
      issued_at: new Date().toISOString(),
      issued_by: {
        actor_id: "local-operator",
        actor_type: "human",
        display_name: "Local operator",
        role: "operator",
        authentication_method: "localhost",
      },
      target: {
        system_id: "customer-odoo",
        run_id: "RUN-DASHBOARD",
        run_revision: 0,
      },
      bindings: [
        {
          binding_type: bindingType,
          artifact_id: artifact.artifact.id,
          revision: artifact.artifact.revision,
          path: artifact.artifact.path,
          digest: { algorithm: "sha256", value: artifact.artifact.digest },
        },
        ...packageBindings,
      ],
      comments: payload.reason ?? "",
    };
    if (this.schemaRegistry) {
      const validation = this.schemaRegistry.validate(
        "urn:odoo-development-factory:schema:approval:1",
        record,
      );
      if (!validation.valid)
        throw new Error(
          `Approval record is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
        );
    }
    if (!(await exists(filePath))) {
      await this.writeDurable(filePath, JSON.stringify(record, null, 2) + "\n");
      const eventsDir = path.join(
        this.config.deliveryRepository,
        "control",
        "events",
      );
      await fs.mkdir(eventsDir, { recursive: true });
      const eventId = `EVT-${crypto.randomUUID()}`;
      const event = {
        schema_version: 1,
        event_id: eventId,
        event_type:
          payload.decision === "approved" ? "gate_satisfied" : "gate_rejected",
        run_id: "RUN-DASHBOARD",
        sequence: await nextEventSequence(eventsDir),
        run_revision: 0,
        occurred_at: record.issued_at,
        recorded_by: "local-operator",
        caused_by_approval_id: record.approval_id,
        gate_id: record.gate_id,
        details: {
          artifact_id: artifact.artifact.id,
          artifact_revision: artifact.artifact.revision,
          artifact_digest: artifact.artifact.digest,
          decision: payload.decision,
        },
      };
      if (this.schemaRegistry) {
        const eventValidation = this.schemaRegistry.validate(
          "urn:odoo-development-factory:schema:workflow-event:1",
          event,
        );
        if (!eventValidation.valid)
          throw new Error(
            `Approval workflow event is invalid: ${eventValidation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
          );
      }
      await this.writeDurable(
        path.join(eventsDir, `${eventId}.json`),
        JSON.stringify(event, null, 2) + "\n",
      );
    }
    return actionId;
  }

  async resetWorkflowDecisions(): Promise<{
    removed: Record<string, number>;
    preserved: string[];
  }> {
    const activeRun = this.state.getActiveRun();
    if (activeRun)
      throw new Error(
        `Cannot reset decisions while run ${activeRun.runId} is active. Stop or complete the run first.`,
      );

    const controlDirectories = [
      "control/approvals",
      "control/events",
      "control/dispositions",
      "control/commands",
    ];
    const removed: Record<string, number> = {};
    await withFileLock(
      path.join(this.config.runtimeDirectory, "delivery-write.lock"),
      async () => {
        for (const directory of controlDirectories) {
          const absoluteDirectory = path.join(
            this.config.deliveryRepository,
            directory,
          );
          const files = (await walk(absoluteDirectory)).filter(
            (file) => path.extname(file).toLowerCase() === ".json",
          );
          let count = 0;
          for (const file of files) {
            await fs.rm(file, { force: true });
            count += 1;
          }
          removed[directory] = count;
        }
      },
    );
    this.state.resetWorkflowDecisions();
    this.state.recordAction("repository_reset", {
      removed,
      preserved: [
        "requirements",
        "run-plans",
        "work-packages",
        "system-plans",
        "evidence",
        "releases",
      ],
    });
    return {
      removed,
      preserved: [
        "requirements",
        "run-plans",
        "work-packages",
        "system-plans",
        "evidence",
        "releases",
      ],
    };
  }

  async recordCommand(command: Record<string, unknown>): Promise<string> {
    if (!this.schemaRegistry)
      throw new Error("Schema registry is required to record commands.");
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:command:1",
      command,
    );
    if (!validation.valid)
      throw new Error(
        `Command is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
    const issuedBy = command.issued_by as Record<string, unknown>;
    if (command.source !== "dashboard" || issuedBy.actor_type !== "human")
      throw new Error("Only a human dashboard actor may issue this command.");
    const commandType = String(command.command_type);
    const expectedState = String(
      (command.preconditions as Record<string, unknown>).expected_run_state,
    );
    const legalStates: Record<string, string[]> = {
      pause_run: ["ready", "running"],
      resume_run: ["paused", "blocked"],
      cancel_run: [
        "requested",
        "preflight",
        "ready",
        "running",
        "paused",
        "blocked",
      ],
      retry_task: ["failed", "blocked"],
      request_replan: ["failed", "blocked"],
    };
    if (
      legalStates[commandType] &&
      !legalStates[commandType].includes(expectedState)
    )
      throw new Error(
        `Command ${commandType} is not legal from run state ${expectedState}.`,
      );
    const commandId = String(command.command_id);
    const commandsDirectory = path.join(
      this.config.deliveryRepository,
      "control",
      "commands",
    );
    await fs.mkdir(commandsDirectory, { recursive: true });
    const filePath = path.join(commandsDirectory, `${commandId}.json`);
    if (!(await exists(filePath)))
      await this.writeDurable(
        filePath,
        JSON.stringify(command, null, 2) + "\n",
      );
    return this.state.recordAction(
      "command",
      command,
      String(command.idempotency_key),
    );
  }

  async recordValidationEvidence(input: {
    runId: string;
    baseCommit: string;
    allowedPaths: string[];
    forbiddenPaths: string[];
    qualityGates?: QualityGate[];
    requiredQualityGates?: QualityGate[];
  }): Promise<{
    evidenceId: string;
    path: string;
    outcome: string;
    checks: Array<{ name: string; status: string; exitCode: number }>;
    diff: DiffReview;
  }> {
    const startedAt = new Date().toISOString();
    const run = this.state.getRun(input.runId);
    const worktreeRoot = run?.worktreePath ?? this.config.productRepository;
    let evidencePlan:
      { sequence: number; runPlanId: string; revision: number } | undefined;
    if (run) {
      try {
        const packageDocument = await this.readArtifact(run.workPackageId);
        const members = JSON.parse(packageDocument?.content ?? "").members as
          Array<{ run_plan_id?: string; revision?: number }> | undefined;
        const member = members?.[Math.max(0, run.sequence - 1)];
        if (member?.run_plan_id && member.revision)
          evidencePlan = {
            sequence: run.sequence,
            runPlanId: member.run_plan_id,
            revision: member.revision,
          };
      } catch {
        /* Legacy and fixture runs may not have a readable package artifact. */
      }
    }
    const diff = await reviewProductDiff(
      this.config,
      input.baseCommit,
      input.allowedPaths,
      input.forbiddenPaths,
      worktreeRoot,
    );
    const snapshot = await this.snapshot();
    const finishedAt = new Date().toISOString();
    let resultCommit: string | undefined;
    let gitVersion = "unavailable";
    try {
      resultCommit = (
        await execFileAsync("git", ["-C", worktreeRoot, "rev-parse", "HEAD"], {
          timeout: 3000,
        })
      ).stdout.trim();
      gitVersion = (
        await execFileAsync("git", ["--version"], { timeout: 3000 })
      ).stdout.trim();
    } catch {
      /* The diff result remains authoritative even when metadata is unavailable. */
    }
    const validationPassed = snapshot.validationErrors?.length === 0;
    const requestedQualityGates = [
      ...new Set(input.qualityGates ?? []),
    ] as QualityGate[];
    const declaredQualityGates = await this.readDeclaredQualityGates();
    const requiredQualityGates = [
      ...new Set([
        ...declaredQualityGates,
        ...(input.requiredQualityGates ?? []),
      ]),
    ] as QualityGate[];
    const configuredQualityGateRunners =
      await this.readConfiguredQualityGateRunners();
    const unknownQualityGate = [
      ...requestedQualityGates,
      ...requiredQualityGates,
    ].find((gate) => !supportedQualityGates.includes(gate));
    if (unknownQualityGate)
      throw new Error(`Unknown quality gate: ${unknownQualityGate}`);
    const qualityChecks: Array<Record<string, unknown>> = [];
    const dashboardRoot = path.join(
      this.config.orchestratorRepository,
      "apps",
      "dashboard",
      "application",
    );
    const gateCommand: Partial<
      Record<QualityGate, { cwd: string; args: string[] }>
    > = {
      dashboard_verify: { cwd: dashboardRoot, args: ["run", "verify"] },
      product_lint: { cwd: worktreeRoot, args: ["run", "lint"] },
      product_test: { cwd: worktreeRoot, args: ["test"] },
      product_build: { cwd: worktreeRoot, args: ["run", "build"] },
      lint: { cwd: worktreeRoot, args: ["run", "lint"] },
      unit_tests: { cwd: worktreeRoot, args: ["test"] },
      browser_tests: { cwd: worktreeRoot, args: ["run", "test:e2e"] },
    };
    const gatesToRun = [
      ...new Set([...requestedQualityGates, ...requiredQualityGates]),
    ];
    for (const gate of gatesToRun) {
      const gateStartedAt = new Date().toISOString();
      if (gate === "manifest_validation") {
        try {
          await validateAddonManifests(worktreeRoot);
          qualityChecks.push({
            name: gate,
            status: "passed",
            exit_code: 0,
            started_at: gateStartedAt,
            finished_at: new Date().toISOString(),
          });
        } catch (cause) {
          qualityChecks.push({
            name: gate,
            status: "failed",
            exit_code: 1,
            started_at: gateStartedAt,
            finished_at: new Date().toISOString(),
          });
          this.state.recordAction("quality_gate_failed", {
            runId: input.runId,
            gate,
            error:
              cause instanceof Error
                ? cause.message
                : "manifest validation failed",
          });
        }
        continue;
      }
      const command = gateCommand[gate];
      const configuredRunner = configuredQualityGateRunners[gate];
      if (!command && !configuredRunner) {
        qualityChecks.push({
          name: gate,
          status: "skipped",
          exit_code: 0,
          started_at: gateStartedAt,
          finished_at: new Date().toISOString(),
        });
        this.state.recordAction("quality_gate_skipped", {
          runId: input.runId,
          gate,
          reason: "No approved deterministic runner is configured.",
        });
        continue;
      }
      const executable = configuredRunner
        ? process.platform === "win32" && configuredRunner.executable === "npm"
          ? "npm.cmd"
          : configuredRunner.executable
        : process.platform === "win32"
          ? "npm.cmd"
          : "npm";
      try {
        await execFileAsync(
          executable,
          configuredRunner?.args ?? command!.args,
          {
            cwd: configuredRunner ? worktreeRoot : command!.cwd,
            timeout: configuredRunner?.timeoutMs ?? 120000,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        qualityChecks.push({
          name: gate,
          status: "passed",
          exit_code: 0,
          started_at: gateStartedAt,
          finished_at: new Date().toISOString(),
        });
      } catch (cause) {
        const details = cause as { code?: unknown; killed?: boolean };
        const timedOut = details.killed === true;
        qualityChecks.push({
          name: gate,
          status: timedOut ? "timed_out" : "failed",
          exit_code:
            typeof details.code === "number"
              ? details.code
              : timedOut
                ? 124
                : 1,
          started_at: gateStartedAt,
          finished_at: new Date().toISOString(),
        });
        this.state.recordAction("quality_gate_failed", {
          runId: input.runId,
          gate,
          error: cause instanceof Error ? cause.message : "quality gate failed",
        });
      }
    }
    const outcome = classifyValidationOutcome({
      diffAllowed: diff.automaticAcceptance === "allowed",
      validationPassed,
      qualityStatuses: qualityChecks.map((check) => String(check.status)),
    });
    const evidenceId = `EVD-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const logRelativePath = `.factory-local/logs/${input.runId}-validation.json`;
    const logPath = path.join(
      this.config.runtimeDirectory,
      "logs",
      `${input.runId}-validation.json`,
    );
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await this.writeDurable(
      logPath,
      JSON.stringify(
        {
          run_id: input.runId,
          worktree: worktreeRoot,
          base_commit: input.baseCommit,
          result_commit: resultCommit,
          git_version: gitVersion,
          diff,
        },
        null,
        2,
      ) + "\n",
    );
    const checks = [
      {
        name: "Repository and schema validation",
        status: validationPassed ? "passed" : "failed",
        exit_code: validationPassed ? 0 : 1,
        log_path: logRelativePath,
        started_at: startedAt,
        finished_at: finishedAt,
      },
      {
        name: "Git diff boundary review",
        status: diff.automaticAcceptance === "allowed" ? "passed" : "failed",
        exit_code: diff.automaticAcceptance === "allowed" ? 0 : 1,
        log_path: logRelativePath,
        started_at: startedAt,
        finished_at: finishedAt,
      },
      ...qualityChecks,
    ];
    const manifest = {
      schema_version: 1,
      evidence_id: evidenceId,
      run_id: input.runId,
      ...(evidencePlan
        ? {
            sequence: evidencePlan.sequence,
            run_plan_id: evidencePlan.runPlanId,
            run_plan_revision: evidencePlan.revision,
          }
        : {}),
      outcome,
      checks,
      result_commit:
        resultCommit && /^[A-Fa-f0-9]{7,64}$/.test(resultCommit)
          ? resultCommit
          : undefined,
    };
    if (this.schemaRegistry) {
      const validation = this.schemaRegistry.validate(
        "urn:odoo-development-factory:schema:validation-evidence:1",
        manifest,
      );
      if (!validation.valid)
        throw new Error(
          `Validation evidence is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
        );
    }
    const evidenceDirectory = await this.configuredEvidenceDirectory();
    const evidencePath = path.join(
      this.config.deliveryRepository,
      evidenceDirectory,
      `${evidenceId}.json`,
    );
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await this.writeDurable(
      evidencePath,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    this.state.recordAction(
      "validation_evidence",
      { ...manifest, diff },
      `validation:${input.runId}:${input.baseCommit}`,
    );
    return {
      evidenceId,
      path: path
        .relative(this.config.deliveryRepository, evidencePath)
        .replaceAll("\\", "/"),
      outcome,
      checks: checks.map((check) => ({
        name: String(check.name),
        status: String(check.status),
        exitCode: Number(check.exit_code ?? 1),
      })),
      diff,
    };
  }

  async saveExecutionProgress(
    input: Omit<ExecutionProgress, "schema_version" | "updated_at">,
  ): Promise<ExecutionProgress> {
    if (!this.schemaRegistry)
      throw new Error(
        "Schema registry is required to save execution progress.",
      );
    const snapshot = await this.snapshot();
    const plan = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === input.run_plan_id &&
        artifact.kind === "run_plan" &&
        artifact.status === "approved" &&
        artifact.revision === input.run_plan_revision,
    );
    if (!plan)
      throw new Error(
        "Execution progress must target the exact approved run-plan revision.",
      );
    const structure = await this.readExecutionPlanStructure(plan);
    const expectedPhaseIds = structure.phases.map((phase) => phase.phaseId);
    const expectedTaskIds = structure.phases.flatMap((phase) =>
      phase.tasks.map((task) => task.taskId),
    );
    const receivedTaskIds = input.tasks.map((task) => task.task_id);
    if (
      new Set(receivedTaskIds).size !== receivedTaskIds.length ||
      expectedTaskIds.length !== receivedTaskIds.length ||
      expectedTaskIds.some((taskId) => !receivedTaskIds.includes(taskId))
    )
      throw new Error(
        "Execution progress task identifiers must exactly match the approved run-plan sidecar.",
      );
    if (input.phases) {
      const receivedPhaseIds = input.phases.map((phase) => phase.phase_id);
      if (
        new Set(receivedPhaseIds).size !== receivedPhaseIds.length ||
        expectedPhaseIds.length !== receivedPhaseIds.length ||
        expectedPhaseIds.some((phaseId) => !receivedPhaseIds.includes(phaseId))
      )
        throw new Error(
          "Execution progress phase identifiers must exactly match the approved run-plan sidecar.",
        );
    }
    if (
      input.current_phase_id &&
      !expectedPhaseIds.includes(input.current_phase_id)
    )
      throw new Error(
        "The current execution phase is not in the approved run plan.",
      );
    if (
      input.current_task_id &&
      !expectedTaskIds.includes(input.current_task_id)
    )
      throw new Error(
        "The current execution task is not in the approved run plan.",
      );
    const progress: ExecutionProgress = {
      schema_version: 1,
      ...input,
      updated_at: new Date().toISOString(),
    };
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:execution-progress:1",
      progress,
    );
    if (!validation.valid)
      throw new Error(
        `Execution progress is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
    const progressDirectory = path.join(
      this.config.runtimeDirectory,
      "progress",
    );
    const progressPath = path.join(progressDirectory, `${input.run_id}.json`);
    await fs.mkdir(progressDirectory, { recursive: true });
    await this.writeDurable(
      progressPath,
      JSON.stringify(progress, null, 2) + "\n",
    );
    const progressInputPath = path.join(
      this.config.runtimeDirectory,
      "progress-input",
      input.run_id,
      "progress.json",
    );
    await fs.mkdir(path.dirname(progressInputPath), { recursive: true });
    await fs.writeFile(
      progressInputPath,
      JSON.stringify(progress, null, 2) + "\n",
      "utf8",
    );
    const run = this.state.getActiveRun();
    if (run?.runId === input.run_id) {
      const planFraction =
        input.tasks.filter((task) => task.status === "complete").length /
        Math.max(1, input.tasks.length);
      this.updateRun(input.run_id, {
        status: input.status === "cancelled" ? "cancelled" : "in_progress",
        currentPhase: input.current_phase_id ?? run.currentPhase,
        currentTask: input.current_task_id ?? run.currentTask,
        progress: Math.round(
          ((run.sequence - 1 + planFraction) / Math.max(1, run.total)) * 100,
        ),
      });
    }
    this.state.recordAction(
      "execution_progress",
      progress,
      `progress:${input.run_id}:${input.run_plan_id}:${progress.updated_at}`,
    );
    return progress;
  }

  private async readExecutionPlanStructure(plan: ArtifactSummary): Promise<{
    phases: Array<{
      phaseId: string;
      title: string;
      tasks: Array<{ taskId: string; title: string }>;
    }>;
  }> {
    const sidecarPath = await resolveDeliveryFile(
      this.config.deliveryRepository,
      path.join(
        path.dirname(plan.path),
        `${path.basename(plan.path, path.extname(plan.path))}.sidecar.json`,
      ),
    );
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error(
        "The approved run plan sidecar is unavailable or invalid.",
      );
    }
    const phases = Array.isArray(value.phases)
      ? value.phases.map((phaseValue) => {
          const phase = phaseValue as Record<string, unknown>;
          const tasks = Array.isArray(phase.tasks)
            ? phase.tasks.map((taskValue) => {
                const task = taskValue as Record<string, unknown>;
                return {
                  taskId: String(task.task_id ?? ""),
                  title: String(task.title ?? ""),
                };
              })
            : [];
          return {
            phaseId: String(phase.phase_id ?? ""),
            title: String(phase.title ?? ""),
            tasks,
          };
        })
      : [];
    if (
      !phases.length ||
      phases.some(
        (phase) =>
          !phase.phaseId ||
          !phase.title ||
          !phase.tasks.length ||
          phase.tasks.some((task) => !task.taskId || !task.title),
      )
    )
      throw new Error(
        "The approved run plan has no executable phase/task index.",
      );
    return { phases };
  }

  async prepareExecutionProgress(input: {
    runId: string;
    workPackageId: string;
    runPlanId: string;
  }): Promise<PreparedExecutionPhase> {
    const snapshot = await this.snapshot();
    const plan = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === input.runPlanId &&
        artifact.kind === "run_plan" &&
        artifact.status === "approved",
    );
    if (!plan)
      throw new Error(`Approved run plan not found: ${input.runPlanId}`);
    const structure = await this.readExecutionPlanStructure(plan);
    const firstPhase = structure.phases[0];
    const firstTask = firstPhase.tasks[0];
    const progress: ExecutionProgress = {
      schema_version: 1,
      run_id: input.runId,
      work_package_id: input.workPackageId,
      run_plan_id: plan.id,
      run_plan_revision: plan.revision,
      status: "in_progress",
      current_phase_id: firstPhase.phaseId,
      current_task_id: firstTask.taskId,
      phases: structure.phases.map((phase, index) => ({
        phase_id: phase.phaseId,
        status: index === 0 ? "in_progress" : "not_started",
      })),
      tasks: structure.phases.flatMap((phase, phaseIndex) =>
        phase.tasks.map((task, taskIndex) => ({
          task_id: task.taskId,
          status:
            phaseIndex === 0 && taskIndex === 0
              ? ("in_progress" as const)
              : ("not_started" as const),
        })),
      ),
      updated_at: new Date().toISOString(),
    };
    const progressDirectory = path.join(
      this.config.runtimeDirectory,
      "progress-input",
      input.runId,
    );
    const progressFilePath = path.join(progressDirectory, "progress.json");
    await fs.mkdir(progressDirectory, { recursive: true });
    await fs.writeFile(
      progressFilePath,
      JSON.stringify(progress, null, 2) + "\n",
      "utf8",
    );
    return {
      progress,
      progressFilePath,
      planPath: path.resolve(this.config.deliveryRepository, plan.path),
      firstPhaseId: firstPhase.phaseId,
      firstPhaseTitle: firstPhase.title,
      firstTaskId: firstTask.taskId,
      firstTaskTitle: firstTask.title,
      phaseOrdinal: 1,
      phaseCount: structure.phases.length,
    };
  }

  async prepareNextExecutionPhase(
    runId: string,
  ): Promise<PreparedExecutionPhase | null> {
    const progress = await this.syncExecutionProgress(runId);
    if (!progress) throw new Error("Execution progress is missing.");
    const snapshot = await this.snapshot();
    const plan = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === progress.run_plan_id &&
        artifact.kind === "run_plan" &&
        artifact.status === "approved" &&
        artifact.revision === progress.run_plan_revision,
    );
    if (!plan)
      throw new Error(
        "Execution progress does not target an approved run-plan revision.",
      );
    const structure = await this.readExecutionPlanStructure(plan);
    const currentPhaseIndex = structure.phases.findIndex(
      (phase) => phase.phaseId === progress.current_phase_id,
    );
    if (currentPhaseIndex < 0)
      throw new Error("Execution progress has no current run-plan phase.");
    const currentPhase = structure.phases[currentPhaseIndex];
    const currentPhaseStatus = progress.phases?.find(
      (phase) => phase.phase_id === currentPhase.phaseId,
    )?.status;
    const currentTaskIds = new Set(
      currentPhase.tasks.map((task) => task.taskId),
    );
    const incompleteTasks = progress.tasks.filter(
      (task) => currentTaskIds.has(task.task_id) && task.status !== "complete",
    );
    if (currentPhaseStatus !== "complete" || incompleteTasks.length) {
      const details = [
        currentPhaseStatus !== "complete"
          ? `${currentPhase.phaseId} status is ${currentPhaseStatus ?? "missing"}`
          : "",
        incompleteTasks.length
          ? `incomplete tasks: ${incompleteTasks.map((task) => task.task_id).join(", ")}`
          : "",
      ].filter(Boolean);
      throw new Error(
        `Current phase functionality is incomplete (${details.join("; ")}).`,
      );
    }
    const futurePhaseIds = new Set(
      structure.phases
        .slice(currentPhaseIndex + 1)
        .map((phase) => phase.phaseId),
    );
    const futureTaskIds = new Set(
      structure.phases
        .slice(currentPhaseIndex + 1)
        .flatMap((phase) => phase.tasks.map((task) => task.taskId)),
    );
    const touchedFuturePhases = (progress.phases ?? []).filter(
      (phase) =>
        futurePhaseIds.has(phase.phase_id) && phase.status !== "not_started",
    );
    const touchedFutureTasks = progress.tasks.filter(
      (task) =>
        futureTaskIds.has(task.task_id) && task.status !== "not_started",
    );
    if (touchedFuturePhases.length || touchedFutureTasks.length)
      throw new Error(
        "The completed turn changed a later phase; phase execution must remain sequential.",
      );
    const nextPhase = structure.phases[currentPhaseIndex + 1];
    if (!nextPhase) {
      if (progress.status !== "complete")
        await this.saveExecutionProgress({
          run_id: progress.run_id,
          work_package_id: progress.work_package_id,
          run_plan_id: progress.run_plan_id,
          run_plan_revision: progress.run_plan_revision,
          status: "complete",
          current_phase_id: progress.current_phase_id,
          current_task_id: progress.current_task_id,
          phases: progress.phases,
          tasks: progress.tasks,
        });
      return null;
    }
    const firstTask = nextPhase.tasks[0];
    const nextProgress = await this.saveExecutionProgress({
      run_id: progress.run_id,
      work_package_id: progress.work_package_id,
      run_plan_id: progress.run_plan_id,
      run_plan_revision: progress.run_plan_revision,
      status: "in_progress",
      current_phase_id: nextPhase.phaseId,
      current_task_id: firstTask.taskId,
      phases: (progress.phases ?? []).map((phase) =>
        phase.phase_id === nextPhase.phaseId
          ? { ...phase, status: "in_progress" as const, note: undefined }
          : phase,
      ),
      tasks: progress.tasks.map((task) =>
        task.task_id === firstTask.taskId
          ? { ...task, status: "in_progress" as const, note: undefined }
          : task,
      ),
    });
    return {
      progress: nextProgress,
      progressFilePath: path.join(
        this.config.runtimeDirectory,
        "progress-input",
        runId,
        "progress.json",
      ),
      planPath: path.resolve(this.config.deliveryRepository, plan.path),
      firstPhaseId: nextPhase.phaseId,
      firstPhaseTitle: nextPhase.title,
      firstTaskId: firstTask.taskId,
      firstTaskTitle: firstTask.title,
      phaseOrdinal: currentPhaseIndex + 2,
      phaseCount: structure.phases.length,
    };
  }

  async prepareCurrentExecutionPhase(
    runId: string,
  ): Promise<PreparedExecutionPhase> {
    const progress = await this.syncExecutionProgress(runId);
    if (!progress) throw new Error("Execution progress is missing.");
    const snapshot = await this.snapshot();
    const plan = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === progress.run_plan_id &&
        artifact.kind === "run_plan" &&
        artifact.status === "approved" &&
        artifact.revision === progress.run_plan_revision,
    );
    if (!plan)
      throw new Error(
        "Execution progress does not target an approved run-plan revision.",
      );
    const structure = await this.readExecutionPlanStructure(plan);
    const currentPhaseIndex = structure.phases.findIndex(
      (phase) => phase.phaseId === progress.current_phase_id,
    );
    if (currentPhaseIndex < 0)
      throw new Error("Execution progress has no current run-plan phase.");
    const currentPhase = structure.phases[currentPhaseIndex];
    const currentPhaseTaskIds = new Set(
      currentPhase.tasks.map((task) => task.taskId),
    );
    const firstIncompleteTask = currentPhase.tasks.find(
      (task) =>
        progress.tasks.find((item) => item.task_id === task.taskId)?.status !==
        "complete",
    );
    const currentPhaseStatus = progress.phases?.find(
      (phase) => phase.phase_id === currentPhase.phaseId,
    )?.status;
    if (!firstIncompleteTask && currentPhaseStatus === "complete")
      throw new Error(
        "The current phase is already complete; continue to the next phase or validate the run plan.",
      );
    const selectedTask = firstIncompleteTask ?? currentPhase.tasks[0];
    const resumedProgress = await this.saveExecutionProgress({
      run_id: progress.run_id,
      work_package_id: progress.work_package_id,
      run_plan_id: progress.run_plan_id,
      run_plan_revision: progress.run_plan_revision,
      status: "in_progress",
      current_phase_id: currentPhase.phaseId,
      current_task_id: selectedTask.taskId,
      phases: (progress.phases ?? []).map((phase) =>
        phase.phase_id === currentPhase.phaseId
          ? { ...phase, status: "in_progress" as const, note: undefined }
          : phase,
      ),
      tasks: progress.tasks.map((task) => {
        if (!currentPhaseTaskIds.has(task.task_id)) return task;
        if (task.status === "complete") return task;
        if (task.task_id === selectedTask.taskId)
          return { ...task, status: "in_progress" as const, note: undefined };
        return { ...task, status: "not_started" as const };
      }),
    });
    return {
      progress: resumedProgress,
      progressFilePath: path.join(
        this.config.runtimeDirectory,
        "progress-input",
        runId,
        "progress.json",
      ),
      planPath: path.resolve(this.config.deliveryRepository, plan.path),
      firstPhaseId: currentPhase.phaseId,
      firstPhaseTitle: currentPhase.title,
      firstTaskId: selectedTask.taskId,
      firstTaskTitle: selectedTask.title,
      phaseOrdinal: currentPhaseIndex + 1,
      phaseCount: structure.phases.length,
    };
  }

  async syncExecutionProgress(
    runId: string,
  ): Promise<ExecutionProgress | null> {
    const progressFilePath = path.join(
      this.config.runtimeDirectory,
      "progress-input",
      runId,
      "progress.json",
    );
    let candidate: ExecutionProgress;
    try {
      candidate = JSON.parse(
        await fs.readFile(progressFilePath, "utf8"),
      ) as ExecutionProgress;
    } catch (cause) {
      if (!(await exists(progressFilePath)))
        return this.readExecutionProgress(runId);
      throw new Error(
        `Execution progress file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (candidate.run_id !== runId)
      throw new Error(
        "Execution progress file run_id does not match this run.",
      );
    const input = { ...candidate } as Partial<ExecutionProgress>;
    delete input.schema_version;
    delete input.updated_at;
    const current = await this.readExecutionProgress(runId);
    const comparable = (value: ExecutionProgress | typeof input) => {
      const copy = { ...value } as Partial<ExecutionProgress>;
      delete copy.schema_version;
      delete copy.updated_at;
      return JSON.stringify(copy);
    };
    if (current && comparable(current) === comparable(input)) return current;
    return this.saveExecutionProgress(
      input as Omit<ExecutionProgress, "schema_version" | "updated_at">,
    );
  }

  async executionProgressGate(runId: string): Promise<{
    ready: boolean;
    reasons: string[];
  }> {
    const run = this.state.getRun(runId);
    if (!run) return { ready: false, reasons: [`Run not found: ${runId}`] };
    const progress = await this.syncExecutionProgress(runId);
    if (!progress)
      return { ready: false, reasons: ["Execution progress is missing."] };
    const reasons: string[] = [];
    if (progress.work_package_id !== run.workPackageId)
      reasons.push("Execution progress targets a different work package.");
    try {
      const packageDocument = await this.readArtifact(run.workPackageId);
      const members = JSON.parse(packageDocument?.content ?? "").members as
        Array<{ run_plan_id?: string; revision?: number }> | undefined;
      const currentMember = members?.[Math.max(0, run.sequence - 1)];
      if (
        !currentMember?.run_plan_id ||
        progress.run_plan_id !== currentMember.run_plan_id ||
        progress.run_plan_revision !== currentMember.revision
      )
        reasons.push(
          "Execution progress does not target the current sequenced run-plan revision.",
        );
    } catch {
      reasons.push("The current work-package sequence could not be read.");
    }
    if (progress.status !== "complete")
      reasons.push(`Execution status is ${progress.status}, not complete.`);
    if (!progress.phases?.length)
      reasons.push("Phase statuses are missing from execution progress.");
    else if (progress.phases.some((phase) => phase.status !== "complete"))
      reasons.push("Every phase must be complete.");
    if (progress.tasks.some((task) => task.status !== "complete"))
      reasons.push("Every task must be complete.");
    return { ready: reasons.length === 0, reasons };
  }

  async readExecutionProgress(
    runId: string,
  ): Promise<ExecutionProgress | null> {
    const progressPath = path.join(
      this.config.runtimeDirectory,
      "progress",
      `${runId}.json`,
    );
    try {
      return JSON.parse(
        await fs.readFile(progressPath, "utf8"),
      ) as ExecutionProgress;
    } catch {
      return null;
    }
  }

  private executionQuestionnaireDirectory(runId: string): string {
    if (!/^RUN-[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(runId))
      throw new Error(`Invalid run identifier: ${runId}`);
    return path.join(
      this.config.deliveryRepository,
      "runs",
      runId,
      "questions",
    );
  }

  private validateExecutionQuestionnaire(
    questionnaire: ExecutionQuestionnaire,
  ): void {
    if (!this.schemaRegistry)
      throw new Error(
        "Schema registry is required to save execution questionnaires.",
      );
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:execution-questionnaire:1",
      questionnaire,
    );
    if (!validation.valid)
      throw new Error(
        `Execution questionnaire is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
  }

  async listExecutionQuestionnaires(
    runId: string,
  ): Promise<ExecutionQuestionnaire[]> {
    const directory = this.executionQuestionnaireDirectory(runId);
    let files: string[];
    try {
      files = (await fs.readdir(directory))
        .filter((file) => /\.ya?ml$/i.test(file))
        .sort();
    } catch {
      return [];
    }
    const questionnaires = await Promise.all(
      files.map(async (file) => {
        const value = parse(
          await fs.readFile(path.join(directory, file), "utf8"),
        ) as ExecutionQuestionnaire;
        this.validateExecutionQuestionnaire(value);
        if (value.run_id !== runId)
          throw new Error(
            `Questionnaire ${value.questionnaire_id} targets a different run.`,
          );
        return value;
      }),
    );
    return [...questionnaires].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
  }

  async readCurrentExecutionQuestionnaire(
    runId: string,
  ): Promise<ExecutionQuestionnaire | null> {
    const questionnaires = await this.listExecutionQuestionnaires(runId);
    return (
      [...questionnaires]
        .reverse()
        .find((questionnaire) => questionnaire.status !== "resumed") ?? null
    );
  }

  async createExecutionQuestionnaire(input: {
    runId: string;
    phaseId: string;
    taskId: string;
    questions: Array<{
      id: string;
      blocking: true;
      question: string;
      reason: string;
      answer_type: "text" | "single_choice";
      options?: string[];
      recommended_answer?: string;
    }>;
  }): Promise<ExecutionQuestionnaire> {
    const run = this.state.getRun(input.runId);
    if (!run) throw new Error(`Run not found: ${input.runId}`);
    const progress = await this.syncExecutionProgress(input.runId);
    if (!progress) throw new Error("Execution progress is missing.");
    if (
      progress.current_phase_id !== input.phaseId ||
      progress.current_task_id !== input.taskId
    )
      throw new Error(
        "Questionnaire phase/task does not match current execution progress.",
      );
    const existing = await this.readCurrentExecutionQuestionnaire(input.runId);
    if (
      existing?.status === "awaiting_input" &&
      existing.phase_id === input.phaseId &&
      existing.task_id === input.taskId
    )
      return existing;
    const now = new Date().toISOString();
    const questionnaire: ExecutionQuestionnaire = {
      schema_version: 1,
      questionnaire_id: stableArtifactId(
        "QNR",
        input.runId,
        input.phaseId,
        input.taskId,
        JSON.stringify(input.questions),
      ),
      run_id: input.runId,
      work_package_id: progress.work_package_id,
      run_plan_id: progress.run_plan_id,
      run_plan_revision: progress.run_plan_revision,
      phase_id: input.phaseId,
      task_id: input.taskId,
      status: "awaiting_input",
      revision: 1,
      created_at: now,
      updated_at: now,
      questions: input.questions.map((question) => ({
        ...question,
        status: "open",
        answer: null,
        answered_by: null,
        answered_at: null,
      })),
    };
    this.validateExecutionQuestionnaire(questionnaire);
    const directory = this.executionQuestionnaireDirectory(input.runId);
    const filePath = path.join(
      directory,
      `${questionnaire.questionnaire_id}.yaml`,
    );
    await fs.mkdir(directory, { recursive: true });
    await this.writeDurable(filePath, stringify(questionnaire));
    this.state.recordAction(
      "execution_questionnaire_created",
      {
        runId: input.runId,
        questionnaireId: questionnaire.questionnaire_id,
        path: path
          .relative(this.config.deliveryRepository, filePath)
          .replaceAll("\\", "/"),
        phaseId: input.phaseId,
        taskId: input.taskId,
      },
      `questionnaire:${questionnaire.questionnaire_id}:1`,
    );
    return questionnaire;
  }

  async answerExecutionQuestionnaire(input: {
    runId: string;
    questionnaireId: string;
    answers: Record<string, string>;
    answeredBy?: string;
  }): Promise<ExecutionQuestionnaire> {
    const current = await this.readCurrentExecutionQuestionnaire(input.runId);
    if (!current || current.questionnaire_id !== input.questionnaireId)
      throw new Error("The current execution questionnaire was not found.");
    if (current.status !== "awaiting_input")
      throw new Error("Questionnaire answers are already final.");
    const now = new Date().toISOString();
    const questions = current.questions.map((question) => {
      const answer = input.answers[question.id]?.trim() ?? "";
      if (!answer) throw new Error(`An answer is required for ${question.id}.`);
      if (
        question.answer_type === "single_choice" &&
        !question.options?.includes(answer)
      )
        throw new Error(
          `Answer for ${question.id} must be one of its options.`,
        );
      return {
        ...question,
        status: "answered" as const,
        answer,
        answered_by: input.answeredBy?.trim() || "local-operator",
        answered_at: now,
      };
    });
    const answered: ExecutionQuestionnaire = {
      ...current,
      status: "answered",
      revision: current.revision + 1,
      updated_at: now,
      questions,
    };
    this.validateExecutionQuestionnaire(answered);
    const filePath = path.join(
      this.executionQuestionnaireDirectory(input.runId),
      `${answered.questionnaire_id}.yaml`,
    );
    await this.writeDurable(filePath, stringify(answered));
    this.state.recordAction(
      "execution_questionnaire_answered",
      {
        runId: input.runId,
        questionnaireId: answered.questionnaire_id,
        revision: answered.revision,
        questionIds: answered.questions.map((question) => question.id),
      },
      `questionnaire:${answered.questionnaire_id}:${answered.revision}`,
    );
    return answered;
  }

  async markExecutionQuestionnaireResumed(
    runId: string,
    questionnaireId: string,
  ): Promise<ExecutionQuestionnaire> {
    const current = await this.readCurrentExecutionQuestionnaire(runId);
    if (!current || current.questionnaire_id !== questionnaireId)
      throw new Error("The answered execution questionnaire was not found.");
    if (current.status !== "answered")
      throw new Error(
        "Every questionnaire answer must be final before resume.",
      );
    const now = new Date().toISOString();
    const resumed: ExecutionQuestionnaire = {
      ...current,
      status: "resumed",
      revision: current.revision + 1,
      updated_at: now,
      resumed_at: now,
    };
    this.validateExecutionQuestionnaire(resumed);
    const filePath = path.join(
      this.executionQuestionnaireDirectory(runId),
      `${resumed.questionnaire_id}.yaml`,
    );
    await this.writeDurable(filePath, stringify(resumed));
    this.state.recordAction(
      "execution_questionnaire_resumed",
      {
        runId,
        questionnaireId,
        revision: resumed.revision,
      },
      `questionnaire:${questionnaireId}:${resumed.revision}`,
    );
    return resumed;
  }

  async hasPassedValidationEvidence(
    runId: string,
    evidenceIds?: readonly string[],
    requirePassed = true,
    expectedPlan?: {
      sequence: number;
      runPlanId: string;
      runPlanRevision: number;
    },
  ): Promise<boolean> {
    const evidenceDirectory = await this.configuredEvidenceDirectory();
    const files = (
      await walk(path.join(this.config.deliveryRepository, evidenceDirectory))
    ).filter((file) => path.extname(file).toLowerCase() === ".json");
    const requestedIds = evidenceIds ? new Set(evidenceIds) : undefined;
    const matchedIds = new Set<string>();
    let passed = false;
    for (const file of files) {
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<
          string,
          unknown
        >;
        if (value.run_id !== runId) continue;
        const evidenceId = String(value.evidence_id ?? path.basename(file));
        if (requestedIds && !requestedIds.has(evidenceId)) continue;
        if (
          expectedPlan &&
          (value.sequence !== expectedPlan.sequence ||
            value.run_plan_id !== expectedPlan.runPlanId ||
            value.run_plan_revision !== expectedPlan.runPlanRevision)
        )
          continue;
        matchedIds.add(evidenceId);
        if (value.outcome === "passed") passed = true;
      } catch {
        /* malformed evidence is not a passing result */
      }
    }
    return (
      (!requirePassed || passed) &&
      (!requestedIds ||
        (matchedIds.size === requestedIds.size &&
          [...requestedIds].every((evidenceId) => matchedIds.has(evidenceId))))
    );
  }

  async readEvidence(
    evidenceId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!/^EVD-[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(evidenceId))
      throw new Error("Invalid evidence identifier.");
    const evidenceDirectory = await this.configuredEvidenceDirectory();
    try {
      const evidencePath = await resolveDeliveryFile(
        this.config.deliveryRepository,
        path.join(evidenceDirectory, `${evidenceId}.json`),
      );
      return JSON.parse(await fs.readFile(evidencePath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("escaped"))
        throw cause;
      return null;
    }
  }

  async recordAcceptanceTraceability(input: {
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
  }): Promise<{
    traceabilityId: string;
    path: string;
    manifest: Record<string, unknown>;
  }> {
    if (!this.schemaRegistry)
      throw new Error("Schema registry is required to record traceability.");
    const snapshot = await this.snapshot();
    const requirement = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === input.requirementId && artifact.kind === "requirement",
    );
    const runPlan = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === input.runPlanId && artifact.kind === "run_plan",
    );
    if (!requirement || requirement.status !== "approved")
      throw new Error(
        "Traceability requires an approved requirement revision.",
      );
    if (!runPlan || runPlan.status !== "approved")
      throw new Error("Traceability requires an approved run-plan revision.");
    if (!input.evidenceIds.length)
      throw new Error("At least one passing evidence manifest is required.");

    const requirementDocument = await this.readArtifact(requirement.id);
    let requirementValue: Record<string, unknown>;
    try {
      requirementValue = JSON.parse(
        requirementDocument?.content ?? "",
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        "Acceptance traceability requires a schema-valid structured requirement artifact.",
      );
    }
    const acceptanceCriteria = stringArray(
      requirementValue.acceptance_criteria,
    );
    if (!acceptanceCriteria.length)
      throw new Error("The requirement has no acceptance criteria to trace.");

    const sidecarPath = await resolveDeliveryFile(
      this.config.deliveryRepository,
      path.join(
        path.dirname(runPlan.path),
        `${path.basename(runPlan.path, path.extname(runPlan.path))}.sidecar.json`,
      ),
    );
    let sidecar: Record<string, unknown>;
    try {
      sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error(
        "The approved run plan sidecar is unavailable or invalid.",
      );
    }
    const requirementBinding =
      typeof sidecar.requirement === "object" && sidecar.requirement !== null
        ? (sidecar.requirement as Record<string, unknown>)
        : {};
    if (
      requirementBinding.id !== requirement.id ||
      Number(requirementBinding.revision) !== requirement.revision ||
      String(requirementBinding.sha256 ?? "").toLowerCase() !==
        requirement.digest.toLowerCase()
    )
      throw new Error(
        "The run plan is not bound to the exact requirement revision.",
      );
    const phases = Array.isArray(sidecar.phases)
      ? (sidecar.phases as Array<Record<string, unknown>>)
      : [];
    const taskIds = new Set(
      phases.flatMap((phase) =>
        Array.isArray(phase.tasks)
          ? (phase.tasks as Array<Record<string, unknown>>).map((task) =>
              String(task.task_id ?? ""),
            )
          : [],
      ),
    );
    const evidenceManifests = await Promise.all(
      input.evidenceIds.map(async (evidenceId) => {
        const evidence = await this.readEvidence(evidenceId);
        if (!evidence)
          throw new Error(`Evidence manifest not found: ${evidenceId}`);
        if (evidence.run_id !== input.runId)
          throw new Error(`Evidence ${evidenceId} belongs to a different run.`);
        if (evidence.outcome !== "passed")
          throw new Error(`Evidence ${evidenceId} is not a passed manifest.`);
        return evidence;
      }),
    );
    const passingChecks = new Set(
      evidenceManifests.flatMap((evidence) =>
        Array.isArray(evidence.checks)
          ? (evidence.checks as Array<Record<string, unknown>>)
              .filter((check) => check.status === "passed")
              .map((check) => String(check.name ?? ""))
          : [],
      ),
    );
    const tracedCriteria = acceptanceCriteria.map((statement, index) => {
      const criterionId = `AC-${String(index + 1).padStart(2, "0")}`;
      const criterion = input.criteria.find(
        (candidate) => candidate.criterionId === criterionId,
      );
      if (!criterion)
        throw new Error(`Missing traceability mapping for ${criterionId}.`);
      if (criterion.statement.trim() !== statement.trim())
        throw new Error(
          `${criterionId} does not match the requirement statement.`,
        );
      if (!criterion.taskIds.length)
        throw new Error(
          `${criterionId} must reference at least one implementation task.`,
        );
      const missingTask = criterion.taskIds.find(
        (taskId) => !taskIds.has(taskId),
      );
      if (missingTask)
        throw new Error(
          `${criterionId} references an unknown task: ${missingTask}`,
        );
      if (!criterion.checkNames.length)
        throw new Error(
          `${criterionId} must reference at least one validation check.`,
        );
      const missingCheck = criterion.checkNames.find(
        (checkName) => !passingChecks.has(checkName),
      );
      if (missingCheck)
        throw new Error(
          `${criterionId} references a check without passing evidence: ${missingCheck}`,
        );
      return {
        criterion_id: criterionId,
        statement,
        task_ids: [...new Set(criterion.taskIds)],
        check_names: [...new Set(criterion.checkNames)],
        status: "verified",
      };
    });
    if (
      new Set(input.criteria.map((criterion) => criterion.criterionId)).size !==
      input.criteria.length
    )
      throw new Error("Acceptance criterion identifiers must be unique.");
    const traceabilityId = stableArtifactId(
      "TRC",
      input.runId,
      requirement.id,
      String(requirement.revision),
      requirement.digest,
      runPlan.id,
      String(runPlan.revision),
      runPlan.digest,
      JSON.stringify(tracedCriteria),
      input.evidenceIds.join("|"),
    );
    const manifest: Record<string, unknown> = {
      schema_version: 1,
      traceability_id: traceabilityId,
      run_id: input.runId,
      requirement: {
        id: requirement.id,
        revision: requirement.revision,
        path: requirement.path,
        sha256: requirement.digest,
      },
      run_plan: {
        id: runPlan.id,
        revision: runPlan.revision,
        path: runPlan.path,
        sha256: runPlan.digest,
      },
      criteria: tracedCriteria,
      evidence_ids: [...new Set(input.evidenceIds)],
    };
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:acceptance-traceability:1",
      manifest,
    );
    if (!validation.valid)
      throw new Error(
        `Acceptance traceability is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
    const evidenceDirectory = await this.configuredEvidenceDirectory();
    const traceabilityPath = path.join(
      this.config.deliveryRepository,
      evidenceDirectory,
      "traceability",
      `${traceabilityId}.json`,
    );
    await fs.mkdir(path.dirname(traceabilityPath), { recursive: true });
    await this.writeDurable(
      traceabilityPath,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    this.state.recordAction(
      "acceptance_traceability",
      manifest,
      `traceability:${traceabilityId}`,
    );
    return {
      traceabilityId,
      path: path
        .relative(this.config.deliveryRepository, traceabilityPath)
        .replaceAll("\\", "/"),
      manifest,
    };
  }

  async acceptanceTraceabilityContext(runId: string): Promise<{
    requirement: { id: string; revision: number; path: string; sha256: string };
    runPlan: { id: string; revision: number; path: string; sha256: string };
    criteria: Array<{
      criterionId: string;
      statement: string;
      taskIds: string[];
    }>;
  }> {
    const run = this.state.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const snapshot = await this.snapshot();
    const packageArtifact = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === run.workPackageId && artifact.kind === "work_package",
    );
    if (!packageArtifact)
      throw new Error("The run work package is unavailable for traceability.");
    const packageDocument = await this.readArtifact(packageArtifact.id);
    let members: Array<{ run_plan_id?: string }> = [];
    try {
      members = JSON.parse(packageDocument?.content ?? "").members ?? [];
    } catch {
      throw new Error("The run work package is not valid JSON.");
    }
    const member = members[Math.max(0, run.sequence - 1)];
    const runPlanId = String(member?.run_plan_id ?? "");
    const runPlan = snapshot.artifacts.find(
      (artifact) => artifact.id === runPlanId && artifact.kind === "run_plan",
    );
    if (!runPlan)
      throw new Error("The active run plan is unavailable for traceability.");
    const sidecarPath = await resolveDeliveryFile(
      this.config.deliveryRepository,
      path.join(
        path.dirname(runPlan.path),
        `${path.basename(runPlan.path, path.extname(runPlan.path))}.sidecar.json`,
      ),
    );
    let sidecar: Record<string, unknown>;
    try {
      sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error("The active run plan sidecar is unavailable or invalid.");
    }
    const requirementBinding =
      typeof sidecar.requirement === "object" && sidecar.requirement !== null
        ? (sidecar.requirement as Record<string, unknown>)
        : {};
    const requirementId = String(requirementBinding.id ?? "");
    const requirement = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === requirementId && artifact.kind === "requirement",
    );
    if (!requirement)
      throw new Error(
        "The run plan requirement is unavailable for traceability.",
      );
    const requirementDocument = await this.readArtifact(requirement.id);
    let requirementValue: Record<string, unknown>;
    try {
      requirementValue = JSON.parse(
        requirementDocument?.content ?? "",
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        "Acceptance traceability requires a schema-valid structured requirement artifact.",
      );
    }
    const statements = stringArray(requirementValue.acceptance_criteria);
    const phases = Array.isArray(sidecar.phases)
      ? (sidecar.phases as Array<Record<string, unknown>>)
      : [];
    const taskIds = phases.flatMap((phase) =>
      Array.isArray(phase.tasks)
        ? (phase.tasks as Array<Record<string, unknown>>).map((task) =>
            String(task.task_id ?? ""),
          )
        : [],
    );
    return {
      requirement: {
        id: requirement.id,
        revision: requirement.revision,
        path: requirement.path,
        sha256: requirement.digest,
      },
      runPlan: {
        id: runPlan.id,
        revision: runPlan.revision,
        path: runPlan.path,
        sha256: runPlan.digest,
      },
      criteria: statements.map((statement, index) => ({
        criterionId: `AC-${String(index + 1).padStart(2, "0")}`,
        statement,
        taskIds: [...new Set(taskIds)],
      })),
    };
  }

  async recordResultDisposition(input: {
    runId: string;
    decision: "accepted" | "exception_accepted" | "rejected" | "replan";
    evidenceIds: string[];
    reason: string;
  }): Promise<DispositionSummary> {
    if (!this.schemaRegistry)
      throw new Error("Schema registry is required to record a disposition.");
    const run = this.state.getRun(input.runId);
    if (!run) throw new Error(`Run not found: ${input.runId}`);
    if (!input.reason.trim())
      throw new Error("A disposition reason is required.");
    if (!input.evidenceIds.length)
      throw new Error("At least one evidence manifest is required.");
    const evidenceIds = [...new Set(input.evidenceIds)].sort();
    const requiresPassedEvidence =
      input.decision === "accepted" || input.decision === "exception_accepted";
    let acceptedProgress: ExecutionProgress | null = null;
    if (requiresPassedEvidence) {
      const progressGate = await this.executionProgressGate(input.runId);
      if (!progressGate.ready)
        throw new Error(
          `The current run plan is not complete: ${progressGate.reasons.join(" ")}`,
        );
      acceptedProgress = await this.readExecutionProgress(input.runId);
    }
    if (
      !(await this.hasPassedValidationEvidence(
        input.runId,
        evidenceIds,
        requiresPassedEvidence,
        requiresPassedEvidence && acceptedProgress
          ? {
              sequence: run.sequence,
              runPlanId: acceptedProgress.run_plan_id,
              runPlanRevision: acceptedProgress.run_plan_revision,
            }
          : undefined,
      ))
    )
      throw new Error(
        requiresPassedEvidence
          ? "The disposition must reference existing evidence for this run, including a passed validation evidence manifest."
          : "The disposition must reference existing evidence for this run.",
      );
    const issuedAt = new Date().toISOString();
    const dispositionId = stableArtifactId(
      "DSP",
      input.runId,
      input.decision,
      ...evidenceIds,
      input.reason.trim(),
    );
    const record = {
      schema_version: 1,
      disposition_id: dispositionId,
      run_id: input.runId,
      decision: input.decision,
      issued_at: issuedAt,
      issued_by: {
        actor_id: "local-operator",
        actor_type: "human",
        display_name: "Local operator",
      },
      evidence_ids: evidenceIds,
      reason: input.reason.trim(),
    };
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:result-disposition:1",
      record,
    );
    if (!validation.valid)
      throw new Error(
        `Result disposition is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
    const directory = path.join(
      this.config.deliveryRepository,
      "control",
      "dispositions",
    );
    await fs.mkdir(directory, { recursive: true });
    await this.writeDurable(
      path.join(directory, `${dispositionId}.json`),
      JSON.stringify(record, null, 2) + "\n",
    );
    this.state.recordAction(
      "result_disposition",
      record,
      `disposition:${input.runId}:${input.decision}:${evidenceIds.join("|")}:${input.reason.trim()}`,
    );
    const eventsDirectory = path.join(
      this.config.deliveryRepository,
      "control",
      "events",
    );
    await fs.mkdir(eventsDirectory, { recursive: true });
    const eventId = stableArtifactId("EVT", "validation", dispositionId);
    const event = {
      schema_version: 1,
      event_id: eventId,
      event_type: "validation_recorded",
      run_id: input.runId,
      sequence: await nextEventSequence(eventsDirectory),
      run_revision: 0,
      occurred_at: issuedAt,
      recorded_by: "local-operator",
      details: {
        disposition_id: dispositionId,
        decision: input.decision,
        evidence_ids: record.evidence_ids,
      },
    };
    const eventValidation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:workflow-event:1",
      event,
    );
    if (!eventValidation.valid)
      throw new Error("Result disposition workflow event is invalid.");
    const eventPath = path.join(eventsDirectory, `${event.event_id}.json`);
    if (!(await exists(eventPath)))
      await this.writeDurable(eventPath, JSON.stringify(event, null, 2) + "\n");
    if (
      input.decision === "accepted" ||
      input.decision === "exception_accepted"
    ) {
      if (run.sequence < run.total)
        this.updateRun(input.runId, {
          status: "blocked",
          acceptedSequence: run.sequence,
          progress: Math.round((run.sequence / run.total) * 100),
          currentTask: `Sequence ${run.sequence} accepted; starting sequence ${run.sequence + 1}`,
        });
      else
        this.updateRun(input.runId, {
          status: "complete",
          acceptedSequence: run.sequence,
          progress: 100,
          currentTask: "Result accepted; ready for release review",
        });
    } else if (input.decision === "rejected")
      this.updateRun(input.runId, {
        status: "failed",
        currentTask: "Result rejected; retry or replan required",
      });
    else
      this.updateRun(input.runId, {
        status: "blocked",
        currentTask: "Replan requested; replacement run plan required",
      });
    return {
      dispositionId,
      runId: input.runId,
      decision: input.decision,
      reason: input.reason.trim(),
      issuedAt,
    };
  }

  async saveWorkPackageDraft(
    members: Array<{ runPlanId: string; sequence: number }>,
    rationale: string,
    supersedesWorkPackageId?: string,
  ): Promise<ArtifactSummary> {
    if (members.length < 1)
      throw new Error("Select at least one approved run plan.");
    const memberIds = new Set<string>();
    const sequences = new Set<number>();
    for (const member of members) {
      if (!Number.isInteger(member.sequence) || member.sequence < 1)
        throw new Error(
          "Work-package sequence numbers must be positive integers.",
        );
      if (memberIds.has(member.runPlanId))
        throw new Error(`Duplicate work-package member: ${member.runPlanId}`);
      if (sequences.has(member.sequence))
        throw new Error(`Duplicate work-package sequence: ${member.sequence}`);
      memberIds.add(member.runPlanId);
      sequences.add(member.sequence);
    }
    const orderedSequences = [...sequences].sort((a, b) => a - b);
    if (orderedSequences.some((sequence, index) => sequence !== index + 1))
      throw new Error(
        "Work-package sequence numbers must be contiguous from 1.",
      );
    const plans = (await this.snapshot()).artifacts.filter(
      (item) => item.kind === "run_plan",
    );
    const selected = members.map((member) => {
      const plan = plans.find((candidate) => candidate.id === member.runPlanId);
      if (!plan || plan.status !== "approved")
        throw new Error(
          `Only exact approved run plans may be packaged: ${member.runPlanId}`,
        );
      return {
        run_plan_id: plan.id,
        revision: plan.revision,
        path: plan.path,
        sha256: plan.digest,
        sequence: member.sequence,
      };
    });
    const predecessor = supersedesWorkPackageId
      ? (await this.snapshot()).artifacts.find(
          (artifact) =>
            artifact.id === supersedesWorkPackageId &&
            artifact.kind === "work_package",
        )
      : undefined;
    if (supersedesWorkPackageId && !predecessor)
      throw new Error(
        `Work-package predecessor was not found: ${supersedesWorkPackageId}`,
      );
    const revision = (predecessor?.revision ?? 0) + 1;
    const id = stableArtifactId(
      "WP",
      "work-package",
      supersedesWorkPackageId ?? "new",
      ...selected.map(
        (member) =>
          `${member.run_plan_id}:${member.revision}:${member.sha256}:${member.sequence}`,
      ),
      rationale,
    );
    const body = {
      schema_version: 1,
      work_package_id: id,
      revision,
      status: "draft",
      sequence_rationale: rationale,
      members: selected,
      ...(predecessor ? { supersedes_revision: predecessor.revision } : {}),
    };
    let workPackageDirectory = "work-packages";
    try {
      const systemYaml = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      workPackageDirectory = safeRelativeDirectory(
        this.config.deliveryRepository,
        (systemYaml.delivery as Record<string, unknown> | undefined)
          ?.work_package_directory,
        workPackageDirectory,
      );
    } catch {
      /* use the conventional directory when configuration is unavailable */
    }
    const filePath = path.join(
      this.config.deliveryRepository,
      workPackageDirectory,
      `${id}.json`,
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await this.writeDurable(filePath, JSON.stringify(body, null, 2) + "\n");
    this.state.recordAction(
      "work_package_draft",
      { id, members: selected },
      `work-package:${selected.map((member) => `${member.run_plan_id}:${member.revision}:${member.sha256}:${member.sequence}`).join("|")}`,
    );
    const stat = await fs.stat(filePath);
    return {
      id: idFromFile("WP", filePath),
      title: id,
      kind: "work_package",
      path: path
        .relative(this.config.deliveryRepository, filePath)
        .replaceAll("\\", "/"),
      extension: "json",
      revision,
      digest: await digest(filePath),
      status: "draft",
      updatedAt: stat.mtime.toISOString(),
    };
  }

  async validateSequenceProposal(
    runPlanIds: string[],
    proposal: unknown,
  ): Promise<{ orderedRunPlanIds: string[]; rationale: string }> {
    const value =
      typeof proposal === "string"
        ? (JSON.parse(proposal) as Record<string, unknown>)
        : (proposal as Record<string, unknown>);
    if (this.schemaRegistry) {
      const validation = this.schemaRegistry.validate(
        "urn:odoo-development-factory:schema:sequence-proposal:1",
        value,
      );
      if (!validation.valid)
        throw new Error(
          `Sequencing output is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
        );
    }
    const ordered = Array.isArray(value?.ordered_run_plan_ids)
      ? value.ordered_run_plan_ids.map(String)
      : [];
    const expected = [...new Set(runPlanIds)];
    if (
      ordered.length !== expected.length ||
      new Set(ordered).size !== ordered.length ||
      ordered.some((id) => !expected.includes(id))
    )
      throw new Error(
        "Sequencing output must contain each selected run plan exactly once.",
      );
    const snapshot = await this.snapshot();
    const invalid = ordered.find(
      (id) =>
        !snapshot.artifacts.some(
          (artifact) =>
            artifact.id === id &&
            artifact.kind === "run_plan" &&
            artifact.status === "approved",
        ),
    );
    if (invalid)
      throw new Error(
        `Sequencing output references a non-approved plan: ${invalid}`,
      );
    const analysis = await this.analyzeRunPlans(ordered);
    if (analysis.dependencyCycles.length > 0)
      throw new Error(
        `Sequencing output contains cyclic dependencies: ${analysis.dependencyCycles[0].join(" -> ")}`,
      );
    const orderByPlan = new Map(ordered.map((id, index) => [id, index]));
    const unresolvedDependency = analysis.plans.find((plan) =>
      plan.dependencies.some(
        (dependency) => /^RP-/.test(dependency) && !orderByPlan.has(dependency),
      ),
    );
    if (unresolvedDependency)
      throw new Error(
        `Sequencing output leaves a dependency outside the selected plans: ${unresolvedDependency.runPlanId}`,
      );
    const inverted = analysis.dependencyEdges.find(
      (edge) =>
        (orderByPlan.get(edge.from) ?? -1) >= (orderByPlan.get(edge.to) ?? -1),
    );
    if (inverted)
      throw new Error(
        `Sequencing output violates dependency order: ${inverted.from} must precede ${inverted.to}`,
      );
    if (analysis.productBaselines.length > 1)
      throw new Error(
        "Sequencing output contains run plans with inconsistent product baselines.",
      );
    return {
      orderedRunPlanIds: ordered,
      rationale:
        typeof value?.rationale === "string" && value.rationale.trim()
          ? value.rationale.trim()
          : "Model-supplied sequence; operator review required.",
    };
  }

  async analyzeRunPlans(runPlanIds: string[]): Promise<RunPlanAnalysisResult> {
    const snapshot = await this.snapshot();
    const uniqueIds = [...new Set(runPlanIds)];
    const selected = uniqueIds.map((id) => {
      const artifact = snapshot.artifacts.find(
        (candidate) =>
          candidate.id === id &&
          candidate.kind === "run_plan" &&
          candidate.status === "approved",
      );
      if (!artifact)
        throw new Error(`Only approved run plans may be analyzed: ${id}`);
      return artifact;
    });
    const plans: RunPlanAnalysis[] = await Promise.all(
      selected.map(async (artifact) => {
        let value: Record<string, unknown> = {};
        try {
          const absolute = path.join(
            this.config.deliveryRepository,
            artifact.path,
          );
          const sidecarPath =
            artifact.extension === "json"
              ? absolute
              : path.join(
                  path.dirname(absolute),
                  `${path.basename(absolute, path.extname(absolute))}.sidecar.json`,
                );
          value = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as Record<
            string,
            unknown
          >;
        } catch {
          /* Legacy plans may not have a sidecar; the analysis remains partial. */
        }
        const requirement =
          typeof value.requirement === "object" && value.requirement !== null
            ? (value.requirement as Record<string, unknown>)
            : {};
        const requirementId =
          typeof requirement.id === "string" ? requirement.id : undefined;
        const requirementRevision =
          typeof requirement.revision === "number"
            ? requirement.revision
            : undefined;
        const requirementDigest =
          typeof requirement.sha256 === "string"
            ? requirement.sha256
            : undefined;
        const phases = Array.isArray(value.phases)
          ? (value.phases as Array<Record<string, unknown>>)
          : [];
        const allowedPaths = [
          ...new Set(
            phases.flatMap((phase) =>
              Array.isArray(phase.tasks)
                ? (phase.tasks as Array<Record<string, unknown>>).flatMap(
                    (task) => stringArray(task.allowed_paths),
                  )
                : [],
            ),
          ),
        ];
        const validationText = phases
          .flatMap((phase) =>
            Array.isArray(phase.tasks)
              ? (phase.tasks as Array<Record<string, unknown>>).flatMap(
                  (task) => stringArray(task.validation),
                )
              : [],
          )
          .join(" ");
        const planning =
          typeof value.planning === "object" && value.planning !== null
            ? (value.planning as Record<string, unknown>)
            : {};
        return {
          runPlanId: artifact.id,
          requirementId,
          requirementRevision,
          requirementDigest,
          affectedModules: stringArray(planning.affected_modules),
          allowedPaths,
          forbiddenPaths: stringArray(planning.forbidden_paths),
          dependencies: stringArray(planning.dependencies),
          databaseConcerns: [
            ...stringArray(planning.database_concerns),
            ...(/\b(?:database|migration|upgrade|schema)\b/i.test(
              validationText,
            )
              ? ["Validation guidance references database/schema work."]
              : []),
          ],
          conflicts: stringArray(planning.conflicts),
          productBaseline:
            typeof planning.product_baseline === "string"
              ? planning.product_baseline
              : undefined,
        } satisfies RunPlanAnalysis;
      }),
    );
    const pathOverlaps: RunPlanAnalysisResult["pathOverlaps"] = [];
    const dependencyEdges: RunPlanAnalysisResult["dependencyEdges"] = [];
    for (let index = 0; index < plans.length; index += 1) {
      for (const dependency of plans[index].dependencies) {
        if (plans.some((plan) => plan.runPlanId === dependency))
          dependencyEdges.push({
            from: dependency,
            to: plans[index].runPlanId,
            reason: "Declared run-plan dependency",
          });
      }
      for (let other = index + 1; other < plans.length; other += 1) {
        const paths = plans[index].allowedPaths.filter((left) =>
          plans[other].allowedPaths.some((right) =>
            pathPatternsOverlap(left, right),
          ),
        );
        if (paths.length)
          pathOverlaps.push({
            left: plans[index].runPlanId,
            right: plans[other].runPlanId,
            paths: [...new Set(paths)],
          });
        const sharedModules = plans[index].affectedModules.filter((module) =>
          plans[other].affectedModules.includes(module),
        );
        if (sharedModules.length)
          plans[index].conflicts.push(
            `Shared Odoo module(s) with ${plans[other].runPlanId}: ${sharedModules.join(", ")}`,
          );
      }
    }
    const adjacency = new Map<string, string[]>();
    for (const edge of dependencyEdges)
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    const dependencyCycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];
    const visit = (node: string): void => {
      if (visiting.has(node)) {
        const start = stack.indexOf(node);
        if (start >= 0) dependencyCycles.push([...stack.slice(start), node]);
        return;
      }
      if (visited.has(node)) return;
      visiting.add(node);
      stack.push(node);
      for (const next of adjacency.get(node) ?? []) visit(next);
      stack.pop();
      visiting.delete(node);
      visited.add(node);
    };
    for (const plan of plans) visit(plan.runPlanId);
    return {
      plans,
      pathOverlaps,
      dependencyEdges,
      dependencyCycles,
      productBaselines: [
        ...new Set(
          plans
            .map((plan) => plan.productBaseline)
            .filter((value): value is string => Boolean(value)),
        ),
      ],
    };
  }

  private async readWorkPackageBindings(
    artifact: ArtifactSummary,
  ): Promise<Array<Record<string, unknown>>> {
    const document = await this.readArtifact(artifact.id);
    if (!document?.content) return [];
    try {
      const value = JSON.parse(document.content) as Record<string, unknown>;
      const members = Array.isArray(value.members)
        ? (value.members as Array<Record<string, unknown>>)
        : [];
      return members.map((member) => ({
        binding_type: "run_plan",
        artifact_id: String(member.run_plan_id ?? ""),
        revision: Number(member.revision ?? 0),
        path: String(member.path ?? ""),
        digest: { algorithm: "sha256", value: String(member.sha256 ?? "") },
      }));
    } catch {
      throw new Error("Work-package artifact is not valid JSON.");
    }
  }

  async saveRunPlanDraft(input: {
    requirementId: string;
    markdown: string;
    supersedesRunPlanId?: string;
  }): Promise<ArtifactSummary> {
    const derivedSidecar = deriveRunPlanSidecar(input.markdown);
    const snapshot = await this.snapshot();
    const requirement = snapshot.artifacts.find(
      (artifact) =>
        artifact.id === input.requirementId &&
        artifact.kind === "requirement" &&
        artifact.status === "approved",
    );
    if (!requirement)
      throw new Error(
        `Run plans require one exact approved requirement: ${input.requirementId}`,
      );
    if (!this.schemaRegistry)
      throw new Error("Schema registry is required to save a run-plan draft.");
    const predecessor = input.supersedesRunPlanId
      ? snapshot.artifacts.find(
          (artifact) =>
            artifact.id === input.supersedesRunPlanId &&
            artifact.kind === "run_plan",
        )
      : undefined;
    if (input.supersedesRunPlanId && !predecessor)
      throw new Error(
        `Run-plan predecessor was not found: ${input.supersedesRunPlanId}`,
      );
    const documentDigest = crypto
      .createHash("sha256")
      .update(input.markdown, "utf8")
      .digest("hex");
    const revision = (predecessor?.revision ?? 0) + 1;
    const id = stableArtifactId(
      "RP",
      "run-plan",
      requirement.id,
      String(requirement.revision),
      documentDigest,
      predecessor?.id ?? "new",
    );
    const runPlanDirectory = await this.configuredDirectory(
      "run_plan_directory",
      "run-plans",
    );
    const documentPath = path.join(
      this.config.deliveryRepository,
      runPlanDirectory,
      `${id}.md`,
    );
    const sidecarPath = path.join(
      this.config.deliveryRepository,
      runPlanDirectory,
      `${id}.sidecar.json`,
    );
    const relativeDocumentPath = path
      .relative(this.config.deliveryRepository, documentPath)
      .replaceAll("\\", "/");
    const sidecar = {
      ...derivedSidecar,
      schema_version: 1,
      run_plan_id: id,
      revision,
      status: "draft",
      ...(predecessor ? { supersedes_revision: predecessor.revision } : {}),
      requirement: {
        id: requirement.id,
        revision: requirement.revision,
        path: requirement.path,
        sha256: requirement.digest,
      },
      document: {
        id,
        revision,
        path: relativeDocumentPath,
        sha256: documentDigest,
      },
    };
    const validation = this.schemaRegistry.validate(
      "urn:odoo-development-factory:schema:run-plan:1",
      sidecar,
    );
    if (!validation.valid)
      throw new Error(
        `Run-plan sidecar is invalid: ${validation.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
      );
    await fs.mkdir(path.dirname(documentPath), { recursive: true });
    try {
      await this.writeDurable(documentPath, input.markdown);
      await this.writeDurable(
        sidecarPath,
        JSON.stringify(sidecar, null, 2) + "\n",
      );
    } catch (cause) {
      await fs.rm(documentPath, { force: true }).catch(() => undefined);
      await fs.rm(sidecarPath, { force: true }).catch(() => undefined);
      throw cause;
    }
    this.state.recordAction(
      "run_plan_draft",
      {
        id,
        requirementId: requirement.id,
        requirementDigest: requirement.digest,
      },
      `run-plan:${requirement.id}:${requirement.digest}:${documentDigest}`,
    );
    const stat = await fs.stat(documentPath);
    return {
      id,
      title: titleFromFile(documentPath),
      kind: "run_plan",
      path: relativeDocumentPath,
      extension: "md",
      revision,
      digest: documentDigest,
      status: "draft",
      updatedAt: stat.mtime.toISOString(),
    };
  }

  async resetRunPlanBaseline(runPlanId: string): Promise<ArtifactSummary> {
    const snapshot = await this.snapshot();
    const runPlan = snapshot.artifacts.find(
      (artifact) => artifact.id === runPlanId && artifact.kind === "run_plan",
    );
    if (!runPlan) throw new Error(`Run plan not found: ${runPlanId}`);
    if (!runPlan.relatedRequirementId)
      throw new Error("Run plan is not linked to an approved requirement.");
    const document = await this.readArtifact(runPlan.id);
    if (!document?.content)
      throw new Error("Run-plan Markdown is unavailable.");
    const git = await this.inspectGit();
    if (!git.available || !git.head)
      throw new Error("Unable to resolve the current product baseline commit.");
    const baselinePattern =
      /^(\*\*Product baseline:\*\*\s*`)[A-Fa-f0-9]{7,64}(`\s*)$/im;
    if (!baselinePattern.test(document.content))
      throw new Error("Run-plan Markdown does not contain a product baseline.");
    const markdown = document.content.replace(
      baselinePattern,
      `$1${git.head}$2`,
    );
    if (markdown === document.content)
      throw new Error("Run plan already uses the current product baseline.");
    return this.saveRunPlanDraft({
      requirementId: runPlan.relatedRequirementId,
      markdown,
      supersedesRunPlanId: runPlan.id,
    });
  }

  private async configuredDirectory(
    key: "run_plan_directory" | "work_package_directory",
    fallback: string,
  ): Promise<string> {
    try {
      const value = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      return safeRelativeDirectory(
        this.config.deliveryRepository,
        (value.delivery as Record<string, unknown> | undefined)?.[key],
        fallback,
      );
    } catch {
      return fallback;
    }
  }

  private async configuredEvidenceDirectory(): Promise<string> {
    try {
      const value = parse(
        await fs.readFile(
          path.join(this.config.deliveryRepository, "system.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      return safeRelativeDirectory(
        this.config.deliveryRepository,
        (value.delivery as Record<string, unknown> | undefined)
          ?.evidence_directory,
        "evidence",
      );
    } catch {
      return "evidence";
    }
  }

  private async readDeclaredQualityGates(): Promise<QualityGate[]> {
    try {
      const value = parse(
        await fs.readFile(
          path.join(this.config.productRepository, "factory.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const qualityGates = value.quality_gates as Record<string, unknown>;
      return stringArray(qualityGates?.required).filter(
        (gate): gate is QualityGate =>
          supportedQualityGates.includes(gate as QualityGate),
      );
    } catch {
      return [];
    }
  }

  private async readConfiguredQualityGateRunners(): Promise<
    Partial<Record<QualityGate, ConfiguredQualityGateRunner>>
  > {
    try {
      const value = parse(
        await fs.readFile(
          path.join(this.config.productRepository, "factory.yaml"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const qualityGates = value.quality_gates as Record<string, unknown>;
      const runners = qualityGates?.runners as Record<string, unknown>;
      if (!runners || typeof runners !== "object") return {};
      const configured: Partial<
        Record<QualityGate, ConfiguredQualityGateRunner>
      > = {};
      for (const [gate, raw] of Object.entries(runners)) {
        if (!supportedQualityGates.includes(gate as QualityGate)) continue;
        if (!raw || typeof raw !== "object") continue;
        const runner = raw as Record<string, unknown>;
        const executable =
          typeof runner.executable === "string" ? runner.executable.trim() : "";
        const args = Array.isArray(runner.args)
          ? runner.args.filter(
              (arg): arg is string =>
                typeof arg === "string" && arg.length <= 1000,
            )
          : [];
        const normalizedExecutable = path.basename(executable).toLowerCase();
        if (
          !executable ||
          normalizedExecutable !== executable.toLowerCase() ||
          !configuredRunnerExecutables.has(normalizedExecutable) ||
          args.length > 32
        )
          continue;
        const configuredTimeout =
          typeof runner.timeout_seconds === "number" &&
          Number.isFinite(runner.timeout_seconds)
            ? runner.timeout_seconds
            : 120;
        const timeoutSeconds = Math.max(
          1,
          Math.min(600, Math.trunc(configuredTimeout)),
        );
        configured[gate as QualityGate] = {
          executable,
          args,
          timeoutMs: timeoutSeconds * 1000,
        };
      }
      return configured;
    } catch {
      return {};
    }
  }

  async getRequiredQualityGates(): Promise<QualityGate[]> {
    return this.readDeclaredQualityGates();
  }

  async preflight(input?: {
    workPackageId?: string;
    model?: string;
    reasoningEffort?: ActiveRun["reasoningEffort"];
    adapter?: string;
  }): Promise<PreflightResult> {
    const snapshot = await this.snapshot();
    let packageAnalysis: RunPlanAnalysisResult | null = null;
    let selectedPackageValid = !input?.workPackageId;
    let selectedPackageDetail = input?.workPackageId
      ? "Not found"
      : "No work package selected";
    if (input?.workPackageId) {
      const selectedPackage = snapshot.artifacts.find(
        (artifact) =>
          artifact.id === input.workPackageId &&
          artifact.kind === "work_package",
      );
      if (selectedPackage?.status === "approved") {
        selectedPackageValid = true;
        selectedPackageDetail = "Approved exact package";
        const packageDocument = await this.readArtifact(selectedPackage.id);
        try {
          const value = JSON.parse(packageDocument?.content ?? "") as Record<
            string,
            unknown
          >;
          const members = Array.isArray(value.members)
            ? (value.members as Array<Record<string, unknown>>)
            : [];
          const sequences = members.map((member) =>
            Number(member.sequence ?? 0),
          );
          const sortedSequences = [...sequences].sort((a, b) => a - b);
          const invalidSequence =
            members.length === 0 ||
            new Set(sequences).size !== sequences.length ||
            sortedSequences.some((sequence, index) => sequence !== index + 1);
          const invalidMember = members.find((member) => {
            const plan = snapshot.artifacts.find(
              (artifact) =>
                artifact.id === String(member.run_plan_id ?? "") &&
                artifact.kind === "run_plan",
            );
            return (
              !plan ||
              plan.status !== "approved" ||
              plan.revision !== Number(member.revision ?? 0) ||
              plan.digest.toLowerCase() !==
                String(member.sha256 ?? "").toLowerCase()
            );
          });
          if (invalidSequence) {
            selectedPackageValid = false;
            selectedPackageDetail =
              "Package sequence must be unique and contiguous from 1";
          } else if (invalidMember) {
            selectedPackageValid = false;
            selectedPackageDetail =
              "A package member is not currently approved";
          } else {
            try {
              packageAnalysis = await this.analyzeRunPlans(
                members.map((member) => String(member.run_plan_id ?? "")),
              );
              const sequenceByPlan = new Map(
                members.map((member) => [
                  String(member.run_plan_id ?? ""),
                  Number(member.sequence ?? 0),
                ]),
              );
              const dependencyInversion = packageAnalysis.dependencyEdges.find(
                (edge) =>
                  (sequenceByPlan.get(edge.from) ?? 0) >=
                  (sequenceByPlan.get(edge.to) ?? 0),
              );
              const unresolvedDependency = packageAnalysis.plans.find((plan) =>
                plan.dependencies.some(
                  (dependency) =>
                    /^RP-/.test(dependency) && !sequenceByPlan.has(dependency),
                ),
              );
              const missingRequirementApproval = packageAnalysis.plans.find(
                (plan) =>
                  !plan.requirementId ||
                  !snapshot.artifacts.some(
                    (artifact) =>
                      artifact.kind === "requirement" &&
                      artifact.id === plan.requirementId &&
                      artifact.status === "approved" &&
                      artifact.revision === plan.requirementRevision &&
                      (!plan.requirementDigest ||
                        artifact.digest.toLowerCase() ===
                          plan.requirementDigest.toLowerCase()),
                  ),
              );
              const missingBoundaries = packageAnalysis.plans.find(
                (plan) => plan.allowedPaths.length === 0,
              );
              const boundaryConflict = packageAnalysis.plans.find((plan) =>
                plan.allowedPaths.some((allowedPath) =>
                  plan.forbiddenPaths.some((forbiddenPath) =>
                    pathPatternsOverlap(allowedPath, forbiddenPath),
                  ),
                ),
              );
              const baselines = packageAnalysis.productBaselines;
              const baselineMismatch =
                snapshot.system.productHead &&
                baselines.some(
                  (baseline) =>
                    baseline.toLowerCase() !==
                    snapshot.system.productHead?.toLowerCase(),
                );
              if (unresolvedDependency) {
                selectedPackageValid = false;
                selectedPackageDetail = `Run plan ${unresolvedDependency.runPlanId} has an unselected run-plan dependency`;
              } else if (missingRequirementApproval) {
                selectedPackageValid = false;
                selectedPackageDetail = `Run plan ${missingRequirementApproval.runPlanId} is missing approval for its exact requirement revision`;
              } else if (packageAnalysis.dependencyCycles.length > 0) {
                selectedPackageValid = false;
                selectedPackageDetail = `Cyclic run-plan dependencies: ${packageAnalysis.dependencyCycles[0].join(" -> ")}`;
              } else if (dependencyInversion) {
                selectedPackageValid = false;
                selectedPackageDetail = `Dependency order is invalid: ${dependencyInversion.from} must precede ${dependencyInversion.to}`;
              } else if (missingBoundaries) {
                selectedPackageValid = false;
                selectedPackageDetail = `Run plan ${missingBoundaries.runPlanId} has no allowed path boundaries`;
              } else if (boundaryConflict) {
                selectedPackageValid = false;
                selectedPackageDetail = `Run plan ${boundaryConflict.runPlanId} has overlapping allowed and forbidden path boundaries`;
              } else if (baselines.length > 1) {
                selectedPackageValid = false;
                selectedPackageDetail =
                  "Run plans resolve to inconsistent product baselines";
              } else if (baselineMismatch) {
                selectedPackageValid = false;
                selectedPackageDetail =
                  "A run-plan product baseline does not match the current product HEAD";
              }
            } catch (cause) {
              selectedPackageValid = false;
              selectedPackageDetail =
                cause instanceof Error
                  ? cause.message
                  : "Package dependency analysis failed";
            }
          }
        } catch {
          selectedPackageValid = false;
          selectedPackageDetail = "Package content is not valid JSON";
        }
      } else if (selectedPackage) {
        selectedPackageDetail = `Package status is ${selectedPackage.status}`;
      }
    }
    const supportedModels = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"];
    const supportedEfforts = [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ];
    const executionProfile = this.state
      .getPromptProfiles()
      .find((profile) => profile.taskType === "run_plan_execution");
    const requestedAdapter =
      input?.adapter ?? executionProfile?.adapter ?? "codex_app_server";
    const adapterKnown = ["fake", "codex_app_server"].includes(
      requestedAdapter,
    );
    const codexHealth = snapshot.health.find(
      (item) => item.label === "Codex App Server",
    );
    const checks = [
      {
        name: "Delivery repository",
        status: snapshot.health[0]?.status === "healthy" ? "ready" : "blocked",
        detail: snapshot.health[0]?.detail ?? "Unavailable",
      },
      {
        name: "Product baseline",
        status: snapshot.health[1]?.status === "healthy" ? "ready" : "blocked",
        detail: snapshot.health[1]?.detail ?? "Unavailable",
      },
      {
        name: "Delivery lock",
        status: snapshot.system.lockStatus === "resolved" ? "ready" : "blocked",
        detail: snapshot.system.lockStatus,
      },
      {
        name: "System plan",
        status: snapshot.artifacts.some(
          (artifact) => artifact.kind === "system_plan",
        )
          ? "ready"
          : "blocked",
        detail: snapshot.artifacts.some(
          (artifact) => artifact.kind === "system_plan",
        )
          ? "Present"
          : "Missing",
      },
      {
        name: "Indexed artifacts",
        status: snapshot.validationErrors?.length ? "blocked" : "ready",
        detail: snapshot.validationErrors?.length
          ? `${snapshot.validationErrors.length} validation or reference error(s)`
          : "Valid",
      },
      {
        name: "Work package",
        status: selectedPackageValid
          ? input?.workPackageId
            ? "ready"
            : "warning"
          : "blocked",
        detail: selectedPackageDetail,
      },
      {
        name: "Dependencies and path rules",
        status: input?.workPackageId
          ? selectedPackageValid
            ? "ready"
            : "blocked"
          : "warning",
        detail: input?.workPackageId
          ? packageAnalysis
            ? "Dependency order, product baseline, and allowed paths are valid"
            : selectedPackageDetail
          : "No work package selected",
      },
      {
        name: "Requested profile",
        status:
          input?.model && !supportedModels.includes(input.model)
            ? "blocked"
            : input?.reasoningEffort &&
                !supportedEfforts.includes(input.reasoningEffort)
              ? "blocked"
              : input?.model
                ? "ready"
                : "warning",
        detail: input?.model
          ? `${input.model} · ${input.reasoningEffort ?? "configured reasoning"}`
          : "No execution profile selected",
      },
      {
        name: "Orchestrator ownership",
        status: snapshot.activeRun ? "blocked" : "ready",
        detail: snapshot.activeRun
          ? `Run ${snapshot.activeRun.runId} is already active`
          : "No active run",
      },
      {
        name: "Codex adapter",
        status: !adapterKnown
          ? "blocked"
          : requestedAdapter === "fake"
            ? "ready"
            : input?.workPackageId
              ? codexHealth?.status === "healthy"
                ? "ready"
                : "blocked"
              : codexHealth?.status === "healthy"
                ? "ready"
                : "warning",
        detail: !adapterKnown
          ? `Unknown execution adapter: ${requestedAdapter}`
          : requestedAdapter === "fake"
            ? "Deterministic fake adapter"
            : (codexHealth?.detail ?? "Codex App Server unavailable"),
      },
      {
        name: "Product worktree",
        status:
          snapshot.health[2]?.status === "healthy"
            ? "ready"
            : snapshot.health[2]?.status === "warning"
              ? "warning"
              : "blocked",
        detail: snapshot.health[2]?.detail ?? "Unknown",
      },
    ] satisfies PreflightResult["checks"];
    return {
      ready: checks.every((check) => check.status !== "blocked"),
      checks,
      blockers: checks
        .filter((check) => check.status === "blocked")
        .map((check) => `${check.name}: ${check.detail}`),
    };
  }

  getRun(runId: string): ActiveRun | null {
    return this.state.getRun(runId);
  }

  async removeRunWorktree(run: ActiveRun): Promise<void> {
    if (!run.worktreePath) return;
    const worktreePath = path.resolve(run.worktreePath);
    const managedRoot = path.resolve(this.config.runtimeDirectory, "worktrees");
    const relativePath = path.relative(managedRoot, worktreePath);
    if (
      !relativePath ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    )
      throw new Error("Run worktree is outside the managed runtime directory.");
    await execFileAsync(
      "git",
      [
        "-C",
        this.config.productRepository,
        "worktree",
        "remove",
        "--force",
        worktreePath,
      ],
      { timeout: 15000 },
    );
  }

  async startRun(input: {
    workPackageId: string;
    title: string;
    model: string;
    reasoningEffort: ActiveRun["reasoningEffort"];
    adapter?: string;
  }): Promise<ActiveRun> {
    const preflight = await this.preflight({
      workPackageId: input.workPackageId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      adapter: input.adapter,
    });
    if (!preflight.ready)
      throw new Error(`Preflight blocked: ${preflight.blockers.join("; ")}`);
    if (
      !this.state.acquireLease("orchestrator", this.leaseOwner, 60 * 60 * 1000)
    )
      throw new Error(
        "Preflight blocked: another orchestrator owns the run lease.",
      );
    let packageDocument: ArtifactDocument | null = null;
    let packageMemberCount = 1;
    try {
      packageDocument = await this.readArtifact(input.workPackageId);
      if (packageDocument?.content) {
        const packageValue = JSON.parse(packageDocument.content) as {
          members?: unknown[];
        };
        packageMemberCount = Math.max(1, packageValue.members?.length ?? 1);
      }
    } catch {
      this.state.releaseLease("orchestrator", this.leaseOwner);
      throw new Error("Unable to read the approved work-package members.");
    }
    const run: ActiveRun = {
      runId: `RUN-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      workPackageId: input.workPackageId,
      title: input.title,
      startedAt: new Date().toISOString(),
      sequence: 1,
      total: packageMemberCount,
      currentPhase: "Phase 0 · Preflight",
      currentTask: "Awaiting execution adapter",
      progress: 0,
      status: "ready",
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      adapter: input.adapter ?? "codex_app_server",
    };
    let worktreeCreated = false;
    try {
      const git = await this.inspectGit();
      if (!git.available || !git.head)
        throw new Error("Unable to resolve the product baseline commit.");
      const worktreePath = path.join(
        this.config.runtimeDirectory,
        "worktrees",
        run.runId,
      );
      const branch = `factory/${run.runId}`;
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await execFileAsync(
        "git",
        [
          "-C",
          this.config.productRepository,
          "worktree",
          "add",
          "-b",
          branch,
          worktreePath,
          git.head,
        ],
        { timeout: 15000 },
      );
      worktreeCreated = true;
      run.baseCommit = git.head;
      run.branch = branch;
      run.worktreePath = worktreePath;
      this.state.startRun(run);
      this.state.recordAction("start_run", run);
      return run;
    } catch (cause) {
      if (worktreeCreated) {
        try {
          await execFileAsync(
            "git",
            [
              "-C",
              this.config.productRepository,
              "worktree",
              "remove",
              "--force",
              run.worktreePath ?? "",
            ],
            { timeout: 15000 },
          );
        } catch {
          /* preserve the original start failure */
        }
      }
      this.state.releaseLease("orchestrator", this.leaseOwner);
      throw cause;
    }
  }

  updateRun(runId: string, patch: Partial<ActiveRun>): ActiveRun {
    const run = this.state.updateRun(runId, patch);
    if (!run) throw new Error(`Run not found: ${runId}`);
    this.state.recordAction("run_control", { runId, patch });
    if (["complete", "cancelled", "failed"].includes(run.status))
      this.state.releaseLease("orchestrator", this.leaseOwner);
    return run;
  }
}
