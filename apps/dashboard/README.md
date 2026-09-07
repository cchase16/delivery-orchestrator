# Factory Dashboard

Local human control surface for the Odoo Development Factory.

The dashboard inspects configured platform, factory, product, and delivery repositories; presents their derived state; and submits validated commands and approvals to the orchestration core. It will not become the authoritative store for discovery, requirements, plans, approvals, releases, or product source code.

## Boundaries

- The dashboard presents state; the repositories preserve durable state.
- The dashboard expresses human intent; the orchestration core owns state transitions.
- The dashboard does not write Odoo implementation code.
- The dashboard does not directly mutate arbitrary YAML status fields.
- Runtime caches, leases, logs, and process information remain local and untracked.
- All durable commands and approvals are attributable and bound to exact input hashes.

## Planned areas

- `docs/` — dashboard behavior and interaction contracts.
- `application/` — runnable React/Vite UI and local Fastify backend.
- `tests/` — future dashboard-level tests.

The initial end-to-end product and interaction design is documented in `docs/dashboard-design.md`. The build sequence and phase status fields are documented in `docs/dashboard-implementation-plan.md`.

## Local application

The first application implementation lives under `application/` and uses React, Vite, Node.js, Fastify, and built-in SQLite. From that directory:

```powershell
npm install
npm run dev
```

Vite serves the dashboard at `http://127.0.0.1:5173` and proxies API requests to the local backend at `http://127.0.0.1:4100`. Use `http://127.0.0.1:5173/?demo=1` to review the seeded visual workflow state; without `demo=1`, the dashboard reads the configured delivery repository.
