# Application Layer

The runnable dashboard application lives here.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. Add `?demo=1` to review the seeded workflow state without changing the delivery repository. The backend reads `DELIVERY_REPOSITORY`, `PRODUCT_REPOSITORY`, `DASHBOARD_RUNTIME`, `PORT`, and `LOG_LEVEL` when supplied. `npm run build` creates the production bundle and `npm run start` serves it from the backend.

See [dashboard-operations.md](../docs/dashboard-operations.md) for upgrade,
backup/recovery, troubleshooting, and uninstall guidance. Use the
[dashboard-release-checklist.md](../docs/dashboard-release-checklist.md) for
the context-menu pilot and local releases. See
[dashboard-security-review.md](../docs/dashboard-security-review.md) for the
reviewed local security boundary and remaining pilot risks.
