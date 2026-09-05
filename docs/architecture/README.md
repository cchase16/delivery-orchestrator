# Architecture

Architecture documentation for the cross-factory delivery control plane belongs here.

Record significant decisions as architecture decision records. The architecture must keep reusable factory behavior separate from product source code, customer requirements, runtime orchestration state, and generated evidence.

## Core contracts

- `workflow-state-machine.md` — authoritative run and task lifecycle.
- `command-contract.md` — immutable human and system intent.
- `approval-contract.md` — hash-bound human decisions.
- `repository-write-boundaries.md` — role and path ownership rules.
- `system-context.md` — factories, repositories, actors, and handoffs.
- `responsibility-boundaries.md` — reasoning versus deterministic control.
- `requirement-lifecycle.md` — canonical requirement revision states.
- `planning-and-batching.md` — system plan and work-package granularity.
- `persistence.md` — durable versus local runtime state.
