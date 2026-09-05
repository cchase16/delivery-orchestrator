# Delivery Orchestrator

Cross-factory control plane for accepting requirements from multiple sources, planning a system, grouping requirements into work packages, dispatching development and validation work, enforcing approval gates, and presenting the local dashboard.

The orchestrator coordinates work but does not contain customer-specific delivery state or deployable product code.

## Structure

- `apps/dashboard/` — local human control surface.
- `docs/architecture/` — system boundaries, lifecycles, planning, persistence, and ownership.
- `docs/operations/` — future operating and recovery procedures.
- `schemas/` — canonical cross-factory contracts.
- `agent-instructions/` — planning and normalization roles.
- `packages/` — future UI-independent orchestration components.
- `policies/` — organization, model-routing, approval, and execution policy.
- `templates/delivery-repository/` — customer delivery-repository structure.
- `tests/` — future contract and orchestration tests.

Requirements-factory intermediate formats and Odoo-specific implementation formats remain owned by their respective factory repositories.
