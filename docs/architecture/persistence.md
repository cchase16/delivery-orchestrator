# Persistence

## Durable Git-backed records

Requirements, decisions, system plans, work packages, run plans, commands, approvals, workflow events, accepted evidence manifests, and releases are durable business records in a customer delivery repository.

## Local file-backed runtime state

Leases, heartbeats, process identifiers, log offsets, temporary task packets, caches, and reconstructible projections belong in an ignored `.factory-local/` directory. A local SQLite file may provide atomic storage without introducing a server database.

## Recovery

The orchestrator reconstructs durable state from immutable inputs and ordered workflow events, then reconciles local process state. Missing local state must not erase an approval, completed product commit, accepted checkpoint, or release record.

Only one orchestrator may own a run at a time. Multi-machine operation requires an ownership mechanism stronger than a machine-local lock.
