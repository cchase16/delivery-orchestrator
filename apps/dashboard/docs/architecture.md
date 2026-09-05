# Dashboard Architecture

The dashboard is a thin local client of the orchestration core.

## Responsibilities

1. Discover systems through delivery-repository configuration.
2. Display repository, requirement, run, approval, environment, and release state.
3. Collect human intent through constrained actions.
4. Submit commands to the orchestration core.
5. Display command acceptance, rejection, progress, and evidence.
6. Reconstruct its display after restart from durable repository state and local runtime state.

## Non-responsibilities

- Deciding whether a workflow transition is legal.
- Writing product implementation code.
- Acting as the only copy of approvals or completion evidence.
- Storing credentials in repository files.
- Selecting undocumented fallback models.
- Allowing two orchestrators to own the same run.

## Data boundary

Durable inputs and decisions are stored in Git repositories. High-frequency runtime state is stored in a local, ignored file-backed store. Large artifacts remain in artifact storage and are referenced by immutable identifiers and hashes.
