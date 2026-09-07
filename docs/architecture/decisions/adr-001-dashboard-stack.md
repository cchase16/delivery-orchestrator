# ADR-001: Local dashboard application stack

**Status:** Accepted  
**Date:** 2026-09-06

## Decision

Build the first dashboard as a TypeScript React application bundled with Vite and served by a small Node.js/Fastify backend. Use Node's built-in SQLite support for reconstructible `.factory-local/` state, the installed Git CLI for read-only repository inspection, and Codex App Server over its default stdio JSONL protocol for the adapter boundary.

The backend binds to `127.0.0.1`. The browser communicates only with the backend over same-origin HTTP. Durable workflow records remain in the customer delivery repository; local SQLite stores leases, profiles, process metadata, actions, and other reconstructible runtime state.

## Rationale

- The local-first workflow does not require a desktop wrapper or a separately deployed database for the first release.
- TypeScript gives one shared type layer across API and UI while keeping the orchestration boundary explicit.
- Fastify, Vite, AJV, YAML, React Markdown, and Playwright cover the required behavior with a small dependency set.
- A child-process App Server adapter preserves local Codex authentication without putting an API key in the dashboard.
- HTTP commands plus server-sent events can be added without coupling workflow logic to React.

## Consequences

The initial application is a single local process pair and is not a multi-user service. Production App Server integration, worktree lifecycle, and deterministic validation runners remain behind interfaces so they can be tested with a fake adapter before live use.
