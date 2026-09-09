# Dashboard Operations

This document covers local installation and recovery for the Factory Dashboard.
The dashboard is a localhost application; it does not require an OpenAI API key
when the signed-in local Codex installation is used.

## Requirements

- Windows PowerShell.
- Node.js 22 or newer.
- Git available on `PATH`.
- A configured customer delivery repository and product repository.
- Codex CLI installed and authenticated if live App Server tasks are used.

## Install and run

From `delivery-orchestrator/apps/dashboard/application`:

```powershell
npm ci
npm run verify
npm run dev
```

Open `http://127.0.0.1:5173/`. Use `?demo=1` for a non-mutating seeded UI
review. The backend defaults to port `4100` and reads these optional variables:

```powershell
$env:DELIVERY_REPOSITORY = 'C:\path\to\customer-odoo-delivery'
$env:PRODUCT_REPOSITORY = 'C:\path\to\customer-odoo'
$env:DASHBOARD_RUNTIME = 'C:\path\to\customer-odoo-delivery\.factory-local'
$env:PORT = '4100'
$env:LOG_LEVEL = 'info'
$env:CODEX_EXECUTABLE = 'C:\path\to\codex.exe' # optional override
```

For a production bundle:

```powershell
npm ci
npm run build
npm run start
```

## Normal operation

1. Review the Overview blockers and repository health.
2. Refresh/reconcile before acting on a stale screen.
3. Approve exact requirement, run-plan, and work-package revisions.
4. Review the effective model, reasoning, adapter, and prompt mode before each
   prompt task.
5. Start implementation only after preflight is clear.
6. Review the complete diff and evidence before recording acceptance
   traceability and a result disposition.

The dashboard writes durable workflow records through its backend. Runtime
leases, task reconnect data, logs, and the SQLite state database live under
`.factory-local/` and are intentionally reconstructible and ignored by Git.

### Work-package execution

**Start implementation** creates one isolated product worktree and starts the
first approved run plan in the work package's saved sequence. Each plan is sent
to Codex one phase at a time as a standard prompt, prefixed with the configured
system plan, product baseline, module inventory, factory boundaries, and the
exact approved run-plan content. The dashboard keeps the Codex task open and
submits the next phase only after the current phase and all of its tasks report
`complete`.

The approved Markdown and sidecar remain immutable. The task updates its narrow
writable progress file at
`.factory-local/progress-input/<run-id>/progress.json`; the dashboard validates
that file against the execution-progress schema and the exact phase/task IDs in
the approved sidecar before reflecting it in the UI.

The phase prompt distinguishes critical blockers from non-critical issues.
Codex records non-critical issues in progress notes and continues. It marks the
phase blocked only when its functionality, objective, verification, or exit
criteria cannot be completed. **Retry task** resumes the first incomplete task
in that phase. If the dashboard restarted and cannot reconnect to the old App
Server session, retry starts a replacement Codex task with the same worktree
and current-phase context.

**Active Runs** refreshes the run and current App Server turn automatically. It
shows the assigned phase, streamed model response, command and file activity,
warnings, and the final App Server error when a turn fails. The most recent
failed run remains visible with retry and replan controls after it stops being
the active run.

The next run plan starts automatically only after every phase and task in the
current plan is `complete`, validation evidence bound to that package sequence
and exact plan revision passes, and the operator accepts the result. Evidence
from an earlier sequence cannot unlock a later plan.

### Manual delivery-lock resolution

The current lock resolver is an explicit operator gate. On **Validation**, use
**Resolve delivery lock** and accept the confirmation after reviewing the
repository state. The resolver replaces the scaffold with a generated snapshot
containing the configured repositories' current commits and working-tree state,
the registered contract fingerprints, and the local operator/time attestation.

Working-tree changes are recorded as warnings and do not block execution in
this version. An implementation run still starts from the captured product
`HEAD` in an isolated worktree, so uncommitted product changes are not included
automatically. Future policy can promote selected repository or path-level
changes from warnings to blockers without changing the lock format's manual
attestation boundary.

## Upgrade

Stop the running dashboard, preserve the delivery repository, then install from
the checked-in lockfile and rerun verification:

```powershell
npm ci
npm run verify
npm run test:e2e
npm run build
```

Do not hand-edit `package-lock.json`. Review schema and plan migrations before
using a newer application against an existing delivery repository.

## Backup and recovery

The durable source of truth is the delivery repository. Back up that repository
and the product repository using the organization's normal Git/backup process.
The `.factory-local/` directory contains reconnectable runtime state but is not
the authoritative workflow record. If it is lost:

1. Stop any old dashboard process.
2. Start the dashboard again with the same repository paths.
3. Use Refresh/reconcile.
4. Review any active-run blocker and reconnect or retry only after inspection.

If the SQLite file is corrupt, stop the app, move only
`<delivery>/.factory-local/dashboard.sqlite` aside, and restart. Durable
approvals, plans, commands, events, evidence, and dispositions remain in the
delivery repository.

## Troubleshooting

- **Delivery repository is not accessible:** set `DELIVERY_REPOSITORY` to an
  existing absolute directory.
- **`delivery.lock` is unresolved:** browsing remains available, but governed
  execution is blocked until an operator uses **Resolve delivery lock** on the
  Validation page and accepts the captured state.
- **System plan is missing or invalid:** add a schema-valid artifact under the
  configured `system-plans/` directory; do not bypass preflight.
- **Codex App Server unavailable:** verify `codex app-server --help` works in
  the same PowerShell session, or select the fake adapter for fixture tests. On
  Windows the dashboard selects the newest executable found under the Codex
  desktop installation and `PATH`; set `CODEX_EXECUTABLE` to force one exact
  executable. Preflight uses App Server `model/list` and blocks a model or
  reasoning level that the selected runtime does not advertise.
- **A native-goal capability, feature, or `thread_goals` database error:**
  restart the dashboard from the current build. Run-plan execution uses stable
  App Server turns and dashboard-owned phase sequencing; it does not call the
  native goals API.
- **A plan or package is stale:** refresh and create a new revision; immutable
  approvals are never overwritten.
- **An artifact is rejected:** inspect the reason and create a reviewed
  replacement revision rather than editing the rejected file in place.
- **A run is blocked:** read the structured blocker, diff, evidence, and task
  state before choosing resume, retry, replan, or cancel.
- **Evidence is partial:** inspect the skipped quality gates. Odoo clean-install,
  snapshot-upgrade, and targeted-validation gates remain partial until their
  approved deterministic runners are configured in the product `factory.yaml`;
  do not treat skipped gates as a successful pilot.

## Uninstall

Stop the dashboard and remove the application checkout using the repository's
normal Git workflow. The dashboard does not install a machine-wide service.
Keep the delivery repository and its durable records. Remove `.factory-local/`
only when intentionally discarding local runtime state; it can be reconstructed
on the next start.
