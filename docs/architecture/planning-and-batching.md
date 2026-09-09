# Planning and Batching

## Planning levels

| Level        | Purpose                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| Requirement  | One approved business need with stable acceptance criteria.                                |
| System plan  | Overall architecture, sequencing, dependencies, and release strategy.                      |
| Run plan     | Full phased implementation plan created from one approved requirement.                     |
| Work package | One or more exact approved run-plan revisions arranged in an explicit execution sequence.  |
| Task         | Stable development step within a run plan and the smallest unit whose progress is tracked. |
| Release      | Exact tested set of product revisions and completed work packages.                         |

## Grouping rules

Batch size is not fixed. The operator selects approved run plans for a work package. The sequencing agent then recommends their order using requirement dependencies, overlapping product paths, shared Odoo models and migrations, required joint acceptance tests, database lineage, integration risk, and available execution capacity.

The MVP executes the run plans in a work package serially in ascending sequence order. Starting a work package dispatches only its first run plan. The next plan is dispatched automatically only after the current task has ended, every indexed phase and task is complete, validation evidence has passed, and a human has accepted the result. A blocker or any non-complete status holds the package at its current sequence. Independent work packages may later run in parallel in isolated branches and worktrees. Coupled requirements may have their approved run plans grouped into one work package when they must be implemented, migrated, or accepted together.

The approved run plan is immutable. Actual phase and task status is recorded as execution progress keyed by the stable identifiers in the plan, allowing agents to report completion without changing the approved plan digest.

## Authority

The run-plan generator proposes the phased implementation plan for one requirement. A human selects the approved run plans that belong to a work package, and the sequencing agent proposes their order. Humans approve both the run plans and final package sequence. The deterministic orchestrator dispatches only approved, dependency-ready run plans through an approved work package and follows its sequence.
