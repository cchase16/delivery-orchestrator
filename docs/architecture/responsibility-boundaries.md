# Responsibility Boundaries

## Requirements producers

Requirements factories, analysts, developers, and backlog tools submit requirement candidates with provenance. They do not schedule implementation or declare requirements accepted.

## Run-plan and portfolio planning agents

The run-plan generator turns one approved requirement and relevant system context into a phased implementation plan. A human selects approved run plans for a work package; the sequencing role analyzes dependencies, conflicts, and release objectives to propose their order. Neither agentic role can approve its own output.

## Execution orchestrator

The deterministic orchestration core validates state, accepts or rejects commands, dispatches eligible tasks, enforces approvals, and records durable events. It does not invent business requirements or edit product code.

## Development factories

Domain-specific factories consume approved work packages and produce product commits, tests, validation evidence, and completion manifests. They cannot change requirement scope, approval records, or release authorization.

## Dashboard

The dashboard displays derived state and captures constrained human intent. It does not own state transitions or directly edit arbitrary status fields.
