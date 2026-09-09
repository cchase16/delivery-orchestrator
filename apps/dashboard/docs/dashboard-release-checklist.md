# Dashboard MVP Release Checklist

Use this checklist for the context-menu pilot and every subsequent local
release. A checked item requires evidence in the review or test record.

## Contracts and repository state

- [ ] `delivery.lock` is resolved and references exact repository revisions.
- [ ] The system plan exists and validates against its active schema.
- [ ] Requirement, run-plan, and work-package sidecars validate.
- [ ] Every approval binds the reviewed identifier, revision, path, and digest.
- [ ] Durable records reconstruct after deleting local runtime state.

## Planning workflow

- [ ] The exact requirement revision is approved.
- [ ] Run-plan generation uses one standard Sol prompt and creates no goal.
- [ ] The full Markdown run plan and sidecar are reviewed and approved.
- [ ] Work-package membership and sequence are reviewed and approved.
- [ ] Model, reasoning, adapter, prompt mode, and task identity are recorded.

## Implementation and validation

- [ ] Preflight passes with no unresolved blocker.
- [ ] Execution uses an isolated product worktree and declared path boundaries.
- [ ] Luna/high execution settings are confirmed for each phase turn.
- [ ] The next phase starts only after the current phase and all of its tasks are complete.
- [ ] Non-critical issues are recorded without blocking otherwise complete phase functionality.
- [ ] Progress is recorded separately from the approved run-plan document.
- [ ] The complete diff has been reviewed, including untracked, deleted, and
      renamed paths.
- [ ] Required quality gates and evidence manifests pass.
- [ ] A human records the final result disposition with evidence references.

## Security and operability

- [ ] Path traversal and symlink escape checks pass.
- [ ] Untrusted Markdown is sanitized and secrets are redacted from prompts and
      logs.
- [ ] No arbitrary shell command is exposed through the browser.
- [ ] App Server disconnect, stale lease, restart, and retry behavior are tested.
- [ ] `npm run verify` and `npm run test:e2e` pass from a clean checkout.
- [ ] Installation, upgrade, backup/recovery, troubleshooting, and uninstall
      documentation are current.

## Human acceptance

- [ ] The context-menu pilot completes through all three approval gates.
- [ ] Remaining risks and deferred work are documented.
- [ ] A second developer can repeat the workflow from the documentation.
- [ ] The operator has accepted the release.
