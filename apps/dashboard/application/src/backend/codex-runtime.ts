import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CodexRuntime {
  executable: string;
  version: string;
  source: "configured" | "desktop" | "path";
}

let cachedRuntime: { at: number; value: CodexRuntime } | null = null;

function versionParts(version: string): number[] {
  return (version.match(/\d+(?:\.\d+){1,3}/)?.[0] ?? "0")
    .split(".")
    .map((value) => Number(value));
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

async function desktopCandidates(): Promise<string[]> {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return [];
  const binDirectory = path.join(
    process.env.LOCALAPPDATA,
    "OpenAI",
    "Codex",
    "bin",
  );
  const candidates = [path.join(binDirectory, "codex.exe")];
  try {
    for (const entry of await fs.readdir(binDirectory, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        candidates.push(path.join(binDirectory, entry.name, "codex.exe"));
    }
  } catch {
    return [];
  }
  return candidates;
}

async function inspectCandidate(
  executable: string,
  source: CodexRuntime["source"],
): Promise<CodexRuntime | null> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    const version = `${stdout}\n${stderr}`.match(
      /codex(?:-cli)?\s+([^\s]+)/i,
    )?.[1];
    return {
      executable,
      version: version ?? "unknown",
      source,
    };
  } catch {
    return null;
  }
}

export async function resolveCodexRuntime(): Promise<CodexRuntime> {
  if (cachedRuntime && Date.now() - cachedRuntime.at < 30_000)
    return cachedRuntime.value;
  const configured = process.env.CODEX_EXECUTABLE?.trim();
  const candidates: Array<{
    executable: string;
    source: CodexRuntime["source"];
  }> = configured
    ? [{ executable: path.resolve(configured), source: "configured" }]
    : [
        ...(await desktopCandidates()).map((executable) => ({
          executable,
          source: "desktop" as const,
        })),
        { executable: "codex", source: "path" as const },
      ];
  const uniqueCandidates = candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (item) =>
          item.executable.toLowerCase() === candidate.executable.toLowerCase(),
      ) === index,
  );
  const inspected = (
    await Promise.all(
      uniqueCandidates.map((candidate) =>
        inspectCandidate(candidate.executable, candidate.source),
      ),
    )
  ).filter((candidate): candidate is CodexRuntime => Boolean(candidate));
  const selected = inspected.sort((left, right) => {
    const versionDifference = compareVersions(right.version, left.version);
    if (versionDifference) return versionDifference;
    return left.source === "configured"
      ? -1
      : right.source === "configured"
        ? 1
        : 0;
  })[0];
  if (!selected)
    throw new Error(
      configured
        ? `Configured Codex executable is unavailable: ${configured}`
        : "Codex executable is unavailable from PATH and the desktop installation.",
    );
  cachedRuntime = { at: Date.now(), value: selected };
  return selected;
}
