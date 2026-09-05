# Workflow Schemas

- `workflow-event.schema.json` validates immutable durable events from which state is derived.
- `run-state.schema.json` validates reconstructible run and task state snapshots.

Events are authoritative. Snapshots are replaceable projections and must identify the last applied event and revision.

The `examples/` directory contains illustrative event and snapshot records.
