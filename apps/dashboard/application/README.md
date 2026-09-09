# Application Layer

The runnable dashboard application lives here.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. Add `?demo=1` to review the seeded workflow state without changing the delivery repository. The backend reads `DELIVERY_REPOSITORY`, `PRODUCT_REPOSITORY`, `DASHBOARD_RUNTIME`, `PORT`, and `LOG_LEVEL` when supplied. `npm run build` creates the production bundle and `npm run start` serves it from the backend.

On Windows, the dashboard discovers installed Codex desktop runtimes and uses the newest available executable for App Server tasks. Set `CODEX_EXECUTABLE` to an absolute executable path to override discovery. The dashboard validates configured models against `model/list` before dispatch and streams the current phase's model output, commands, file changes, warnings, and errors on Active Runs.

See [dashboard-operations.md](../docs/dashboard-operations.md) for upgrade,
backup/recovery, troubleshooting, and uninstall guidance. Use the
[dashboard-release-checklist.md](../docs/dashboard-release-checklist.md) for
the context-menu pilot and local releases. See
[dashboard-security-review.md](../docs/dashboard-security-review.md) for the
reviewed local security boundary and remaining pilot risks.
