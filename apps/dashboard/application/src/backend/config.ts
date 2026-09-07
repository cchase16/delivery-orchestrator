import fs from "node:fs";
import path from "node:path";

export interface DashboardConfig {
  deliveryRepository: string;
  productRepository: string;
  orchestratorRepository: string;
  schemaDirectory: string;
  runtimeDirectory: string;
  port: number;
}

function resolveConfiguredPath(
  value: string | undefined,
  fallback: string,
  label: string,
): string {
  const resolved = path.resolve(value ?? fallback);
  if (
    value &&
    (resolved === path.parse(resolved).root || resolved.includes(".."))
  ) {
    throw new Error(
      `${label} must resolve to a specific repository directory.`,
    );
  }
  return resolved;
}

export function loadConfig(): DashboardConfig {
  const cwd = process.cwd();
  const workspaceRoot = path.resolve(cwd, "../../../..");
  const orchestratorRepository = path.resolve(cwd, "../../..");
  const deliveryRepository = resolveConfiguredPath(
    process.env.DELIVERY_REPOSITORY,
    path.join(workspaceRoot, "customer-odoo-delivery"),
    "DELIVERY_REPOSITORY",
  );
  const productRepository = resolveConfiguredPath(
    process.env.PRODUCT_REPOSITORY,
    path.join(workspaceRoot, "customer-odoo"),
    "PRODUCT_REPOSITORY",
  );
  if (!fs.existsSync(deliveryRepository)) {
    throw new Error(
      `DELIVERY_REPOSITORY is not accessible: ${deliveryRepository}`,
    );
  }
  if (!fs.existsSync(productRepository)) {
    throw new Error(
      `PRODUCT_REPOSITORY is not accessible: ${productRepository}`,
    );
  }
  return {
    deliveryRepository,
    productRepository,
    orchestratorRepository,
    schemaDirectory: path.join(orchestratorRepository, "schemas"),
    runtimeDirectory: path.resolve(
      process.env.DASHBOARD_RUNTIME ??
        path.join(workspaceRoot, "customer-odoo-delivery", ".factory-local"),
    ),
    port: Number(process.env.PORT ?? 4100),
  };
}
