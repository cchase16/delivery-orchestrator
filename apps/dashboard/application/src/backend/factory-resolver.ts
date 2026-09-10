import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";

const execFileAsync = promisify(execFile);
const allowedRunnerExecutables = new Set([
  "npm",
  "node",
  "python",
  "python3",
  "odoo",
  "odoo-bin",
]);

type FactoryResolverOptions = {
  productRepository: string;
  factoryRepository: string;
  writeFile: (filePath: string, content: string) => Promise<void>;
};

export type FactoryResolutionResult = {
  status: "resolved";
  resolvedAt: string;
  configurationSha256: string;
  factoryRevision: string | null;
  schemaRevision: string | null;
  qualityGateCount: number;
  lockPath: string;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
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
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(filePath)));
    else files.push(filePath);
  }
  return files;
}

async function digestDirectory(root: string): Promise<string | null> {
  const files = (await walk(root)).sort((left, right) =>
    left.localeCompare(right),
  );
  if (!files.length) return null;
  const hash = crypto.createHash("sha256");
  for (const filePath of files) {
    hash.update(path.relative(root, filePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function gitRevision(repositoryPath: string): Promise<string | null> {
  try {
    const result = await execFileAsync(
      "git",
      ["-C", repositoryPath, "rev-parse", "HEAD"],
      { timeout: 5000 },
    );
    const revision = result.stdout.trim();
    return revision || null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRunners(
  value: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [gate, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const runner = raw as Record<string, unknown>;
    const executable =
      typeof runner.executable === "string" ? runner.executable.trim() : "";
    const executableName = path.basename(executable).toLowerCase();
    const args = Array.isArray(runner.args)
      ? runner.args.filter(
          (arg): arg is string => typeof arg === "string" && arg.length <= 1000,
        )
      : [];
    if (
      !executable ||
      executableName !== executable.toLowerCase() ||
      !allowedRunnerExecutables.has(executableName) ||
      args.length > 32
    )
      continue;
    const timeout =
      typeof runner.timeout_seconds === "number" &&
      Number.isFinite(runner.timeout_seconds)
        ? Math.max(1, Math.min(600, Math.trunc(runner.timeout_seconds)))
        : 120;
    normalized[gate] = {
      executable,
      args,
      timeout_seconds: timeout,
    };
  }
  return normalized;
}

export async function resolveFactoryLock(
  options: FactoryResolverOptions,
): Promise<FactoryResolutionResult> {
  const configurationPath = path.join(
    options.productRepository,
    "factory.yaml",
  );
  const configurationText = await fs.readFile(configurationPath, "utf8");
  const configurationSha256 = crypto
    .createHash("sha256")
    .update(configurationText, "utf8")
    .digest("hex");
  const configuration = objectRecord(parse(configurationText));
  const odoo = objectRecord(configuration.odoo);
  if (typeof odoo.version !== "string" || !odoo.version.trim())
    throw new Error(
      "factory.yaml must declare odoo.version before factory.lock can be resolved.",
    );
  const qualityGates = objectRecord(configuration.quality_gates);
  const requiredGates = stringArray(qualityGates.required);
  const runners = normalizeRunners(objectRecord(qualityGates.runners));

  const factoryRevision = await gitRevision(options.factoryRepository);
  const schemaRevision = factoryRevision;
  const packageDefinitions = [
    ["policies", "policy_packages"],
    ["templates", "template_packages"],
    ["agent-instructions", "agent_instruction_packages"],
  ] as const;
  const packages: Record<string, Array<Record<string, string | null>>> = {};
  for (const [directory, key] of packageDefinitions) {
    const packageRoot = path.join(options.factoryRepository, directory);
    const packageHash = await digestDirectory(packageRoot);
    packages[key] = packageHash
      ? [
          {
            path: directory,
            revision: factoryRevision,
            sha256: packageHash,
          },
        ]
      : [];
  }

  const lock = {
    lock_version: 1,
    status: "resolved",
    source: {
      configuration: "factory.yaml",
      configuration_sha256: configurationSha256,
    },
    resolved: {
      resolved_at: new Date().toISOString(),
      resolver: "manual_local_resolver",
      factory_release: {
        repository: path
          .relative(options.productRepository, options.factoryRepository)
          .replaceAll("\\", "/"),
        revision: factoryRevision,
      },
      schema_release: {
        repository: path
          .relative(options.productRepository, options.factoryRepository)
          .replaceAll("\\", "/"),
        revision: schemaRevision,
      },
      policy_packages: packages.policy_packages,
      template_packages: packages.template_packages,
      agent_instruction_packages: packages.agent_instruction_packages,
      validation_toolchain: {
        odoo: {
          version: typeof odoo.version === "string" ? odoo.version : null,
          edition: typeof odoo.edition === "string" ? odoo.edition : null,
          addon_paths: stringArray(odoo.addon_paths),
        },
        quality_gates: {
          required: requiredGates,
          runners,
        },
      },
    },
  };
  const lockPath = path.join(options.productRepository, "factory.lock");
  await options.writeFile(
    lockPath,
    [
      "# GENERATED BY THE DELIVERY-ORCHESTRATOR FACTORY RESOLVER.",
      "# Re-run the manual resolver after changing factory inputs.",
      stringify(lock, { lineWidth: 0 }).trimEnd(),
      "",
    ].join("\n"),
  );
  return {
    status: "resolved",
    resolvedAt: lock.resolved.resolved_at,
    configurationSha256,
    factoryRevision,
    schemaRevision,
    qualityGateCount: requiredGates.length,
    lockPath,
  };
}
