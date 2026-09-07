import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { DashboardConfig } from "./config.js";

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

export class SchemaRegistry {
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(private readonly config: DashboardConfig) {
    addFormats(this.ajv);
  }

  async load(): Promise<void> {
    const files = [
      "requirements/requirement.schema.json",
      "acceptance-traceability/acceptance-traceability.schema.json",
      "run-plans/run-plan.schema.json",
      "work-packages/work-package.schema.json",
      "work-packages/sequence-proposal.schema.json",
      "model-profiles/model-profile.schema.json",
      "executions/execution-progress.schema.json",
      "evidence/validation-evidence.schema.json",
      "evidence/result-disposition.schema.json",
      "system-plans/system-plan.schema.json",
      "approvals/approval.schema.json",
      "commands/command.schema.json",
      "workflow/workflow-event.schema.json",
      "workflow/run-state.schema.json",
    ];
    for (const relative of files) {
      const schema = JSON.parse(
        await fs.readFile(
          path.join(this.config.schemaDirectory, relative),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const id = String(schema.$id ?? relative);
      this.validators.set(id, this.ajv.compile(schema));
    }
  }

  validate(schemaId: string, value: unknown): ValidationResult {
    const validator = this.validators.get(schemaId);
    if (!validator)
      return {
        valid: false,
        errors: [
          { path: "", message: `Schema is not registered: ${schemaId}` },
        ],
      };
    const valid = validator(value);
    return {
      valid: Boolean(valid),
      errors: valid ? [] : this.formatErrors(validator.errors ?? []),
    };
  }

  private formatErrors(
    errors: ErrorObject[],
  ): Array<{ path: string; message: string }> {
    return errors.map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "validation failed",
    }));
  }
}
