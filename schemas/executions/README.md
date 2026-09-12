# Execution Schema

Canonical task packet, execution request, execution result, and completion manifest envelopes. Records distinguish requested from actual adapter, model, reasoning effort, execution identity, outputs, and status.

`execution-questionnaire.schema.json` defines blocking operator questions raised by an implementation phase. The model emits a fenced `execution-questionnaire` JSON draft, but the orchestrator validates and persists the authoritative YAML document under `runs/<run-id>/questions/` in the delivery repository. Answers are finalized together, become immutable, and are injected into the prompt that resumes the same phase.
