# Dashboard Security Boundary Review

**Review date:** 2026-09-06  
**Scope:** local dashboard MVP implementation and its repository/task boundaries

## Reviewed controls

| Area | Evidence | Result |
| --- | --- | --- |
| Delivery artifact path traversal | Artifact reads resolve the lexical path and the real filesystem target beneath the configured delivery root; symlink escapes are rejected. | Pass |
| Product diff path traversal | Diff entries are normalized and classified relative to the isolated product worktree. | Pass |
| Unsafe document rendering | Markdown is rendered through `rehype-sanitize`; YAML, JSON, and binary artifacts are treated as data or safe downloads. | Pass |
| Command injection | Git, npm, and Codex calls use `execFile`/`spawn` with fixed executable names and argument arrays. No arbitrary shell command endpoint is exposed. | Pass |
| Writable boundary | Implementation task packets set the isolated product worktree as the only writable root and expose delivery/orchestrator roots as read-only context. | Pass |
| Secret leakage | Prompt context and artifact content pass through bounded sensitive-value redaction; protected evidence is referenced by digest rather than copied wholesale. | Pass with residual risk |
| Local-origin exposure | Fastify binds to `127.0.0.1`; the browser uses same-origin API calls and no cross-origin API is configured. | Pass for local MVP |
| Durable writes | Delivery mutations use temporary-file replacement and an ephemeral repository write lock; interrupted replacements remove their temporary file. | Pass |
| Agent self-approval | Approval records hard-code a human local operator actor, and generated prompts explicitly forbid self-approval. | Pass |

## Residual risks and required pilot checks

- Localhost access is trusted for the MVP; a shared-host deployment needs authentication, authorization, CSRF defenses, and transport protection before exposure beyond the local machine.
- Redaction is pattern-based. The pilot must review representative customer content for secrets and sensitive business data that do not match the current patterns.
- The Codex App Server process is a local dependency. Disconnection, crash, stale lease, abrupt restart, and large-output behavior still require representative stress testing.
- Odoo-specific validation is exposed only through named quality gates. Clean-install, production-snapshot-upgrade, and targeted-validation operations run only when an approved product `factory.yaml` runner is configured; runners use a fixed executable allowlist and no shell, and they are never accepted as arbitrary UI commands. Unconfigured gates remain skipped and produce partial evidence.
- Implementation tasks receive the isolated worktree plus only the linked product `.git` metadata directory needed to create the task branch commit; product source, delivery records, and factory inputs remain outside the writable boundary.

## Review conclusion

The dashboard MVP has a deliberate local-only security boundary and does not authorize a governed implementation run until repository preflight passes. This review does not constitute final human acceptance or a production security assessment.
