# Repository Write Boundaries

## Principle

Every task receives the minimum repository and path permissions required for declared outputs. The orchestration core validates each resulting diff before accepting it.

| Actor or component | Platform repositories | Customer delivery repository | Product repository | Local runtime store |
|---|---|---|---|---|
| Dashboard | Read | Submit commands and approvals through the core | Read | Read projections |
| Orchestration core | Read pinned revisions | Write runs, events, checkpoints, and accepted references | Create branches/worktrees only | Read/write |
| Requirement producer | Read applicable contracts | Assigned intake paths only | None | Own runtime only |
| Portfolio planning agent | Read instructions/contracts | Assigned system-plan and work-package branch | Product feasibility read only | Assigned output only |
| Development factory agent | Read pinned factory | Read approved inputs | Assigned worktree and allowlisted paths | Assigned output/logs |
| Validator | Read policies/contracts | Report results for acceptance | Read or declared test-output paths | Validation artifacts |
| Human approver | Read | Submit immutable decision | Read diffs/evidence | None directly |

Platform repositories are immutable during a customer delivery run. Changes to a factory or orchestrator require their own reviewed development workflow.
