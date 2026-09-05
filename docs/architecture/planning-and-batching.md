# Planning and Batching

## Planning levels

| Level | Purpose |
|---|---|
| Requirement | One approved business need with stable acceptance criteria. |
| System plan | Overall architecture, sequencing, dependencies, and release strategy. |
| Work package | One or more requirement revisions selected for implementation together. |
| Run plan | Approved technical execution plan for one work package. |
| Task | Smallest dispatchable agent, human, or deterministic unit. |
| Release | Exact tested set of product revisions and completed work packages. |

## Grouping rules

Batch size is not fixed. The planning agent recommends work packages using dependency order, overlapping product paths, shared Odoo models and migrations, required joint acceptance tests, database lineage, integration risk, and available execution capacity.

Independent work packages may run in parallel in isolated branches and worktrees. Coupled requirements share one work package when they must be designed, migrated, or accepted together.

## Authority

The planning agent proposes grouping and ordering. Human approval establishes the plan. The deterministic orchestrator dispatches only approved and dependency-ready work packages.
