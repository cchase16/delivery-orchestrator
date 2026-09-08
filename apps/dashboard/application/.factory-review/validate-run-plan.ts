import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { deriveRunPlanSidecar } from "../src/backend/run-plan-markdown.ts";

const markdownPath = resolve(".factory-review/RP-ODOO-FORM-CONTEXT-MENU-CUSTOMIZATION-DESIGN.md");
const sidecarPath = resolve(".factory-review/RP-ODOO-FORM-CONTEXT-MENU-CUSTOMIZATION-DESIGN.sidecar.json");
const schemaPath = resolve("../../../schemas/run-plans/run-plan.schema.json");
const markdown = readFileSync(markdownPath, "utf8");
const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const derived = deriveRunPlanSidecar(markdown);
const ajv = new Ajv2020({ allErrors: true, strict: false });
if (!ajv.validate(schema, sidecar)) {
  throw new Error(ajv.errorsText(ajv.errors, { separator: "\n" }));
}
const indexed = { planning: sidecar.planning, phases: sidecar.phases };
if (JSON.stringify(indexed) !== JSON.stringify(derived)) {
  console.error(JSON.stringify({ derived, indexed }, null, 2));
  throw new Error("Sidecar does not match deterministic Markdown derivation");
}
const digest = createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex");
if (sidecar.document.sha256 !== digest) throw new Error("Document digest mismatch");
console.log(`VALID phases=${derived.phases.length} tasks=${derived.phases.reduce((n, phase) => n + phase.tasks.length, 0)} sha256=${digest}`);
