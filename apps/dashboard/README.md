# Factory Dashboard

Local human control surface for the Odoo Development Factory.

The dashboard will inspect the factory, product, and delivery repositories; present their derived state; and submit validated commands and approvals to the orchestration core. It will not become the authoritative store for requirements, plans, approvals, releases, or product source code.

## Boundaries

- The dashboard presents state; the repositories preserve durable state.
- The dashboard expresses human intent; the orchestration core owns state transitions.
- The dashboard does not write Odoo implementation code.
- The dashboard does not directly mutate arbitrary YAML status fields.
- Runtime caches, leases, logs, and process information remain local and untracked.
- All durable commands and approvals are attributable and bound to exact input hashes.

## Planned areas

- `docs/` — dashboard behavior and interaction contracts.
- `application/` — future application composition and presentation layer.
- `tests/` — future dashboard-level tests.

No UI framework or executable application has been selected or added.
