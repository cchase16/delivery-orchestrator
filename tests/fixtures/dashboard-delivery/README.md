# Dashboard delivery fixture

This fixture is intentionally non-customer data for repository-inspector and
workflow tests. It covers the repository layout, resolved and unresolved lock
states, pending and rejected artifacts, malformed sidecars, and stale approval
bindings. Tests may copy the fixture to a temporary directory before mutating
it; the checked-in fixture itself is never a test output directory.

Scenarios represented by the fixture files:

- `requirements/REQ-FIXTURE-APPROVED.md` — approved by an exact digest binding.
- `requirements/REQ-FIXTURE-REJECTED.md` — rejected with a durable reason.
- `requirements/REQ-FIXTURE-STALE.md` — approval binding intentionally does not
  match the current digest.
- `requirements/REQ-FIXTURE-SUPERSEDED.json` — superseded canonical revision.
- `run-plans/RP-FIXTURE-VALID.md` and its sidecar — valid indexed plan.
- `run-plans/RP-FIXTURE-MALFORMED.sidecar.json` — invalid sidecar.
- `work-packages/WP-FIXTURE-BROKEN.json` — schema-valid package with a broken
  run-plan reference.
- `system-plans/` — absent system-plan artifact, exercising the preflight
  blocker while the directory remains part of the configured layout.
