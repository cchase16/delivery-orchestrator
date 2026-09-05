# Requirement Lifecycle

```mermaid
stateDiagram-v2
    [*] --> submitted
    submitted --> under_review
    under_review --> needs_decision
    needs_decision --> under_review: answer supplied
    under_review --> approved
    under_review --> rejected
    under_review --> deferred
    under_review --> revision_required
    revision_required --> under_review: new revision submitted
    deferred --> under_review: reactivated
    approved --> planned
    approved --> superseded: replacement revision approved
    planned --> in_development
    in_development --> implemented
    implemented --> released
    rejected --> [*]
    superseded --> [*]
    released --> [*]
```

Requirement state applies to an immutable revision. Modification creates a new revision and may invalidate system plans, work packages, run plans, or approvals bound to the superseded revision.

Deferral is distinct from rejection and records a review date, release, or explicit reactivation condition.
