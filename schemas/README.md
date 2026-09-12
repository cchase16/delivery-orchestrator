# Schemas

Versioned, machine-readable cross-factory contracts belong here. Expected contracts include:

- Submission and source provenance
- Canonical requirement revisions and human dispositions
- System plans and work packages
- Commands, approvals, workflow events, and run state
- Database baselines, execution manifests, validation evidence, and releases

Schema changes must define their compatibility and migration behavior.

## Versioning and migration policy

- A published schema version is immutable; incompatible changes receive a new
  `$id` and version.
- Additive optional fields are backward-compatible. Readers use the documented
  empty default, and writers may emit the field after migration.
- Required-field, enum, binding, or digest-semantics changes require a new
  schema version, migration note, and compatibility fixture.
- Approval, run-plan, and work-package revisions are never edited in place;
  migration creates a new revision and preserves the prior digest and decision.
- The dashboard accepts only registered schema versions and reports unsupported
  versions as validation errors instead of silently coercing them.

## Defined version 1 contracts

- `commands/command.schema.json`
- `approvals/approval.schema.json`
- `system-plans/system-plan.schema.json`
- `workflow/workflow-event.schema.json`
- `workflow/run-state.schema.json`
- `requirements/requirement.schema.json`
- `run-plans/run-plan.schema.json`
- `work-packages/work-package.schema.json`
- `model-profiles/model-profile.schema.json`
- `executions/execution-progress.schema.json`
- `executions/execution-questionnaire.schema.json`
- `evidence/validation-evidence.schema.json`
- `acceptance-traceability/acceptance-traceability.schema.json`

## Scaffolded contract areas

- `submissions/`
- `requirements/`
- `requirement-decisions/`
- `work-packages/`
- `database-baselines/`
- `releases/`
- `run-plans/`
- `executions/`
- `evidence/`
- `model-profiles/`
- `acceptance-traceability/` (record every acceptance criterion's task and passing-check evidence)
