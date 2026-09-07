# Run-Plan Schema

Canonical phased implementation plan created from one approved requirement. The full human-readable plan defines phases, concrete development tasks, dependencies, roles, allowed repositories and paths, validation gates, exit criteria, and stable phase/task identifiers. Domain factories may extend it with domain-specific fields.

A minimal machine-readable sidecar indexes the requirement binding, plan revision, phase identifiers, task identifiers, initial statuses, path boundaries, and planning metadata. The dashboard derives this sidecar deterministically from validated canonical Markdown and dashboard-owned bindings; it is not authored by the LLM. The implementation agent receives and works from the full approved plan, not only the sidecar.

The approved plan is immutable. Actual `not_started`, `in_progress`, `blocked`, and `complete` values are recorded in a separate execution-progress record keyed to the stable plan identifiers, so progress does not invalidate the run-plan approval.

The dashboard generates plans with the versioned files under `templates/run-plan/`. The Markdown template is also the intended source for a future deterministic DOCX renderer: presentation-only trackers and tables should be derived from the approved Markdown rather than maintained as a second editable plan.
