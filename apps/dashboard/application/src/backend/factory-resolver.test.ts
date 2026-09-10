import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolveFactoryLock } from "./factory-resolver.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("factory resolver", () => {
  it("captures local factory inputs in a resolved product lock", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-resolver-"));
    temporaryDirectories.push(root);
    const product = path.join(root, "product");
    const factory = path.join(root, "factory");
    await fs.mkdir(path.join(factory, "policies"), { recursive: true });
    await fs.mkdir(path.join(factory, "templates"), { recursive: true });
    await fs.mkdir(path.join(factory, "agent-instructions"), {
      recursive: true,
    });
    await fs.mkdir(product, { recursive: true });
    await fs.writeFile(
      path.join(product, "factory.yaml"),
      [
        "odoo:",
        "  version: 19.0",
        "  edition: community",
        "  addon_paths: [addons]",
        "quality_gates:",
        "  required: [manifest_validation, unit_tests]",
        "  runners:",
        "    unit_tests:",
        "      executable: npm",
        "      args: [test]",
        "      timeout_seconds: 60",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(factory, "policies", "default.md"),
      "policy\n",
    );
    await fs.writeFile(
      path.join(factory, "templates", "base.md"),
      "template\n",
    );
    await fs.writeFile(
      path.join(factory, "agent-instructions", "default.md"),
      "instructions\n",
    );

    const result = await resolveFactoryLock({
      productRepository: product,
      factoryRepository: factory,
      writeFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    });
    const lock = parse(
      await fs.readFile(path.join(product, "factory.lock"), "utf8"),
    ) as Record<string, any>;

    expect(result.status).toBe("resolved");
    expect(result.qualityGateCount).toBe(2);
    expect(lock.status).toBe("resolved");
    expect(lock.source.configuration_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.resolved.factory_release.repository).toBe("../factory");
    expect(lock.resolved.policy_packages[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.resolved.validation_toolchain.quality_gates.required).toEqual([
      "manifest_validation",
      "unit_tests",
    ]);
  });
});
