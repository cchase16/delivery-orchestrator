# Schemas

Versioned, machine-readable cross-factory contracts belong here. Expected contracts include:

- Submission and source provenance
- Canonical requirement revisions and human dispositions
- System plans and work packages
- Commands, approvals, workflow events, and run state
- Database baselines, execution manifests, validation evidence, and releases

Schema changes must define their compatibility and migration behavior.

## Defined version 1 contracts

- `commands/command.schema.json`
- `approvals/approval.schema.json`
- `workflow/workflow-event.schema.json`
- `workflow/run-state.schema.json`

## Scaffolded contract areas

- `submissions/`
- `requirements/`
- `requirement-decisions/`
- `system-plans/`
- `work-packages/`
- `database-baselines/`
- `releases/`
- `run-plans/`
- `executions/`
- `evidence/`
- `model-profiles/`
- `acceptance-traceability/`
