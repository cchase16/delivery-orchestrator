import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { reviewProductDiff } from "./diff.js";
import type { DashboardConfig } from "./config.js";

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("reviewProductDiff", () => {
  it("classifies allowed, forbidden, and unexpected paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-diff-"));
    roots.push(root);
    await run("git", ["-C", root, "init", "-q"]);
    await run("git", [
      "-C",
      root,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await run("git", ["-C", root, "config", "user.name", "Factory test"]);
    await fs.writeFile(path.join(root, "README.md"), "base\n");
    await run("git", ["-C", root, "add", "README.md"]);
    await run("git", ["-C", root, "commit", "-qm", "base"]);
    const baseCommit = (
      await run("git", ["-C", root, "rev-parse", "HEAD"])
    ).stdout.trim();
    await fs.mkdir(path.join(root, "addons"));
    await fs.mkdir(path.join(root, "forbidden"));
    await fs.writeFile(path.join(root, "addons", "ok.txt"), "allowed\n");
    await fs.writeFile(path.join(root, "forbidden", "bad.txt"), "forbidden\n");
    await fs.writeFile(path.join(root, "unexpected.txt"), "unexpected\n");
    const config = { productRepository: root } as DashboardConfig;
    const review = await reviewProductDiff(
      config,
      baseCommit,
      ["addons/**"],
      ["forbidden/**"],
    );
    expect(review.entries.map((entry) => entry.classification).sort()).toEqual([
      "allowed",
      "forbidden",
      "unexpected",
    ]);
    expect(review.automaticAcceptance).toBe("blocked");
    expect(review.patch).toContain("unexpected.txt");
    expect(review.patch).toContain("forbidden/bad.txt");
  });

  it("includes deleted paths and rejects malformed base revisions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-diff-"));
    roots.push(root);
    await run("git", ["-C", root, "init", "-q"]);
    await run("git", [
      "-C",
      root,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await run("git", ["-C", root, "config", "user.name", "Factory test"]);
    await fs.mkdir(path.join(root, "addons"));
    await fs.writeFile(path.join(root, "addons", "remove.txt"), "base\n");
    await fs.writeFile(
      path.join(root, "addons", "rename-from.txt"),
      "rename\n",
    );
    await run("git", ["-C", root, "add", "."]);
    await run("git", ["-C", root, "commit", "-qm", "base"]);
    const baseCommit = (
      await run("git", ["-C", root, "rev-parse", "HEAD"])
    ).stdout.trim();
    await fs.rm(path.join(root, "addons", "remove.txt"));
    await run("git", [
      "-C",
      root,
      "mv",
      "addons/rename-from.txt",
      "addons/rename-to.txt",
    ]);
    const review = await reviewProductDiff(
      { productRepository: root } as DashboardConfig,
      baseCommit,
      ["addons/**"],
      [],
    );
    expect(review.entries).toContainEqual({
      path: "addons/remove.txt",
      change: "D",
      classification: "allowed",
    });
    expect(review.entries).toContainEqual({
      path: "addons/rename-from.txt",
      change: "R100",
      classification: "allowed",
    });
    expect(review.entries).toContainEqual({
      path: "addons/rename-to.txt",
      change: "R100",
      classification: "allowed",
    });
    expect(review.automaticAcceptance).toBe("allowed");
    await expect(
      reviewProductDiff(
        { productRepository: root } as DashboardConfig,
        "not-a-revision",
        [],
        [],
      ),
    ).rejects.toThrow("baseCommit must be a Git revision hash");
  });

  it("retains a large full patch for review instead of truncating it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-diff-"));
    roots.push(root);
    await run("git", ["-C", root, "init", "-q"]);
    await run("git", [
      "-C",
      root,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await run("git", ["-C", root, "config", "user.name", "Factory test"]);
    await fs.writeFile(path.join(root, "README.md"), "base\n");
    await run("git", ["-C", root, "add", "README.md"]);
    await run("git", ["-C", root, "commit", "-qm", "base"]);
    const baseCommit = (
      await run("git", ["-C", root, "rev-parse", "HEAD"])
    ).stdout.trim();
    await fs.writeFile(
      path.join(root, "README.md"),
      `${"x".repeat(9 * 1024 * 1024)}\n`,
    );
    const review = await reviewProductDiff(
      { productRepository: root } as DashboardConfig,
      baseCommit,
      ["README.md"],
      [],
    );
    expect(review.automaticAcceptance).toBe("allowed");
    expect(review.patch.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(review.patch).toContain("README.md");
  });
});
