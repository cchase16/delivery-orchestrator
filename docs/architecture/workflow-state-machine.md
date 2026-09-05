# Workflow State Machine

## Purpose

The factory uses one state-machine contract for requirement intake, implementation, validation, and release runs. A run declares its `kind`; the same lifecycle and control rules apply to every kind.

The orchestrator is the only component authorized to change run or task state. Commands and approvals are immutable facts. State snapshots are derived projections that may be rebuilt from ordered workflow events.

## Run kinds

- `requirement_intake` — review a submitted requirement, create sidecars and a human-readable run plan, and stop for approval.
- `implementation` — implement an approved plan in an isolated product worktree.
- `validation` — perform broader testing against a declared product revision and database lineage.
- `release` — assemble and approve an exact release candidate.

## Run lifecycle

```mermaid
stateDiagram-v2
    [*] --> requested
    requested --> preflight: start_run accepted
    preflight --> ready: preflight passed
    preflight --> blocked: recoverable preflight failure
    preflight --> failed: unrecoverable preflight failure

    ready --> running: first task started
    running --> awaiting_approval: approval gate opened
    awaiting_approval --> running: bound approval accepted
    awaiting_approval --> blocked: rejection or invalidated approval

    running --> validating: planned work completed
    validating --> completed: validations and gates passed
    validating --> blocked: validation failed
    validating --> failed: unrecoverable validation failure

    requested --> paused: pause accepted
    preflight --> paused: pause accepted
    ready --> paused: pause accepted
    running --> paused: pause accepted
    awaiting_approval --> paused: administrative pause
    validating --> paused: pause accepted
    blocked --> paused: administrative pause
    paused --> preflight: resume to saved state
    paused --> ready: resume to saved state
    paused --> running: resume to saved state
    paused --> awaiting_approval: resume to saved state
    paused --> validating: resume to saved state
    paused --> blocked: resume to saved state

    blocked --> preflight: retry preflight
    blocked --> ready: blocking condition resolved
    blocked --> running: task retry or approved replan
    blocked --> validating: validation retry
    blocked --> failed: abandon as failed

    requested --> cancelled: cancel accepted
    preflight --> cancelled: cancel accepted
    ready --> cancelled: cancel accepted
    running --> cancelled: cancel accepted
    awaiting_approval --> cancelled: cancel accepted
    validating --> cancelled: cancel accepted
    blocked --> cancelled: cancel accepted
    paused --> cancelled: cancel accepted

    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

## Run-state definitions

| State | Meaning | Work permitted |
|---|---|---|
| `requested` | An immutable run request exists but has not passed preflight. | Preflight only. |
| `preflight` | Inputs, hashes, repositories, models, policies, dependencies, and environment prerequisites are being checked. | Preflight checks only. |
| `ready` | Preflight passed and the next task may be dispatched. | An authorized start-task command. |
| `running` | At least one planned task is actively executing or eligible to execute. | Only tasks allowed by the dependency graph. |
| `awaiting_approval` | A human approval gate is open. | Read, review, and approval-record creation only. No downstream task may start. |
| `validating` | Planned work finished and required validators are running. | Declared validation tasks only. |
| `paused` | An authorized operational pause is active. | Inspection and cancellation only, until resumed. |
| `blocked` | The run cannot progress without a corrective action, retry, replan, or resolved dependency. | Corrective commands explicitly allowed by the blocker. |
| `completed` | All required tasks, validations, and approvals succeeded. | None; terminal and immutable. |
| `failed` | The run ended unsuccessfully and will not be resumed. | None; a replacement run may supersede it. |
| `cancelled` | An authorized actor intentionally terminated the run. | None; a replacement run may supersede it. |

## Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> ready: dependencies satisfied
    ready --> dispatched: start_task accepted
    dispatched --> running: executor acknowledged
    dispatched --> blocked: dispatch failed
    running --> completed: result accepted
    running --> blocked: recoverable failure
    running --> failed: unrecoverable failure
    blocked --> ready: retry accepted
    pending --> skipped: approved conditional exclusion
    ready --> cancelled: run cancelled
    dispatched --> cancelled: run cancelled
    running --> cancelled: run cancelled
    blocked --> cancelled: run cancelled
    completed --> [*]
    skipped --> [*]
    failed --> [*]
    cancelled --> [*]
```

Manual Codex work uses the same task lifecycle. `dispatched` means the task packet is ready for an operator; `running` begins when the operator records the created Codex task identifier.

## Transition rules

1. Every accepted transition increments the run revision exactly once.
2. A command must state its expected run revision and expected state. A mismatch rejects the command without side effects.
3. Repeating a command with the same idempotency key returns the original outcome.
4. Terminal runs and terminal tasks are immutable.
5. A paused run records its prior resumable state; resume returns only to that state after preconditions are rechecked.
6. A blocked run records a structured blocker and the commands allowed to resolve it.
7. An approval opens for exact input digests. Changed bound inputs invalidate the gate automatically.
8. Rejection never mutates an existing approval. It creates a new immutable record and moves the run to `blocked` with a replan or revision requirement.
9. Agents may report outcomes but cannot declare their own task result accepted or advance the workflow.
10. Heartbeats, leases, log offsets, and percentages are runtime telemetry, not workflow transitions.

## Authoritative records

The current state is derived in this order:

1. Immutable run request.
2. Ordered accepted workflow events.
3. Immutable approval records referenced by gate events.
4. Accepted task-result and validation manifests referenced by events.

`state.yaml` or a local database row may cache the derived state, but neither overrides the event history.
