# Work-Package Schema

Approved scheduling artifact containing one or more exact approved run-plan revisions and their explicit execution sequence. It also records grouping rationale, dependencies, product and database baselines, conflict groups, target branch, and required approval references.

Each included item binds the run-plan identifier, revision, path, and digest. Requirement and system-plan context are reached through those immutable run-plan bindings. The MVP executes included run plans serially in ascending sequence order.

The sequencing prompt uses `sequence-proposal.schema.json`; it may propose only
the order and rationale for the exact run plans already selected by the
operator.
