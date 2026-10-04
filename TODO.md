# Backlog

Known follow-up work after the review and remediation of the current solution. Items are grouped by priority.

## Next
- **Azure deployment**: after explicit owner approval, provision the `azd`/Bicep infrastructure and complete the Azure end-to-end smoke test. See [docs/deployment.md](docs/deployment.md).
- **Token storage**: move the app JWT from `localStorage` to an httpOnly, SameSite cookie (with CSRF protection) to reduce XSS exposure.

## Later
- Use Azure Web PubSub for horizontally scaled real-time updates on the admin Monitoring page.
- Add per-rule failure tolerances and optional partial delivery/quarantine of valid rows.
- Rename the `Rules.SqlQuery` column to reflect that it stores a declarative rule expression.
- An "unauthorized" page for non-admin deep links into `/admin`.
- A token revocation/blocklist for logout.
