# System-Plan Schema

`system-plan.schema.json` defines version 1 of the overall architecture and delivery plan linking approved requirements to dependencies, capabilities, repositories, target releases, proposed work packages, risks, and assumptions.

`examples/shared-ux-foundation.example.json` demonstrates a reusable Odoo product plan whose complete capability set is still being discovered. Its proposed work packages are architectural planning placeholders. An executable work package is created only after the related requirement run plans are approved, and it binds those exact run-plan revisions in an explicit sequence.

## Work-package relationship and migration

The optional `run_plan_refs` field on a proposed system-plan work package
records exact run-plan identifiers, revisions, paths, SHA-256 digests, and
sequence numbers once those plans exist. It may remain an empty array while the
system plan is still architectural. The concrete `work-packages/` artifact is
authoritative for membership and sequencing approval and uses the same
reference shape in its `members` array. Older examples migrate additively by
adding `run_plan_refs: []`; no existing system-plan revision is edited in place.

## Naming convention

The optional `naming_convention` object records deterministic naming precedence and formats. An explicitly stated design-document naming convention takes precedence. Otherwise readers use the system plan's `generic_prefix`; older plans without this additive field default to `CW`. A suggested feature or technical name is not itself a convention. Existing `Customer`/`customer_` names may be recorded as legacy exceptions, but they do not establish a convention for new work.
