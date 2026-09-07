import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { DashboardConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const MAX_DIFF_BUFFER = 32 * 1024 * 1024;

export interface DiffEntry {
  path: string;
  change: string;
  classification: "allowed" | "unexpected" | "forbidden";
}

export interface DiffReview {
  baseCommit: string;
  entries: DiffEntry[];
  automaticAcceptance: "allowed" | "blocked";
  patch: string;
}

function matchesPath(candidate: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const escaped = (value: string) =>
      value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const normalized = pattern
      .replaceAll("\\", "/")
      .split("**")
      .map((part) => part.split("*").map(escaped).join("[^/]*"))
      .join(".*");
    return new RegExp(`^${normalized}$`).test(candidate);
  });
}

function parseStatusLine(line: string): Array<{
  change: string;
  path: string;
}> {
  const fields = line.split("\t").map((field) => field.trim());
  if (fields.length >= 3 && /^[RC]\d+$/.test(fields[0]))
    return fields.slice(1).map((filePath) => ({
      change: fields[0],
      path: filePath.replaceAll("\\", "/"),
    }));
  const rename = line.match(/^R\s+(.+?)\s+->\s+(.+)$/);
  if (rename)
    return [rename[1], rename[2]].map((filePath) => ({
      change: "R",
      path: filePath.replaceAll("\\", "/"),
    }));
  const match = line.match(/^(\S+)\s+(.+)$/);
  return [
    {
      change: match?.[1] ?? "?",
      path: (match?.[2] ?? line).replaceAll("\\", "/").trim(),
    },
  ];
}

export async function reviewProductDiff(
  config: DashboardConfig,
  baseCommit: string,
  allowedPaths: string[],
  forbiddenPaths: string[],
  repositoryRoot = config.productRepository,
): Promise<DiffReview> {
  if (!/^[A-Fa-f0-9]{7,64}$/.test(baseCommit))
    throw new Error("baseCommit must be a Git revision hash.");
  const result = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "diff", "--name-status", baseCommit],
    { timeout: 10000 },
  );
  const patchResult = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "diff", "--no-ext-diff", "--no-color", baseCommit],
    { timeout: 10000, maxBuffer: MAX_DIFF_BUFFER },
  );
  const status = await execFileAsync(
    "git",
    ["-C", repositoryRoot, "status", "--short", "--untracked-files=all"],
    { timeout: 10000 },
  );
  const lines = new Set<string>();
  for (const line of `${result.stdout}\n${status.stdout}`
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean))
    lines.add(line);
  const entries = [...lines].flatMap((line) =>
    parseStatusLine(line).map(({ path: filePath, change }) => {
      const classification = matchesPath(filePath, forbiddenPaths)
        ? "forbidden"
        : matchesPath(filePath, allowedPaths)
          ? "allowed"
          : "unexpected";
      return { path: filePath, change, classification } satisfies DiffEntry;
    }),
  );
  const untrackedFiles = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).replaceAll("\\", "/"));
  const untrackedPatch = await Promise.all(
    untrackedFiles.map(async (filePath) => {
      try {
        const absolute = path.resolve(repositoryRoot, filePath);
        const root = path.resolve(repositoryRoot) + path.sep;
        if (!absolute.startsWith(root))
          throw new Error("path escaped repository");
        const content = await fs.readFile(absolute, "utf8");
        return `diff --git a/${filePath} b/${filePath}\nnew file\n--- /dev/null\n+++ b/${filePath}\n${content}`;
      } catch {
        return `diff --git a/${filePath} b/${filePath}\nnew file\n(binary or unreadable file)`;
      }
    }),
  );
  return {
    baseCommit,
    entries,
    automaticAcceptance: entries.some(
      (entry) => entry.classification !== "allowed",
    )
      ? "blocked"
      : "allowed",
    patch: [patchResult.stdout.trim(), ...untrackedPatch]
      .filter(Boolean)
      .join("\n\n"),
  };
}
