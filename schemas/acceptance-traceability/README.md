# Acceptance-Traceability Schema

`acceptance-traceability.schema.json` defines the immutable execution-time
record that links every requirement acceptance criterion to implementation task
identifiers and passing validation check names. The dashboard writes the record
under the configured evidence directory only after the requirement, run plan,
and referenced evidence manifests have been verified against their exact
revision and SHA-256 bindings.
