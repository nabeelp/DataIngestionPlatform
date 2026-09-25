# Backlog

Known follow-up work after the review and remediation of the current solution. Items are grouped by priority.

## Next
- **Azure deployment**: add `azd` + Bicep for App Service or Container Apps, Azure SQL, Blob Storage, Azure Cache for Redis, Key Vault, managed identity, and a CI pipeline.
- **Token storage**: move the app JWT from `localStorage` to an httpOnly, SameSite cookie (with CSRF protection) to reduce XSS exposure.
- **`xlsx` dependency**: the npm `xlsx@0.18.x` package has known advisories and is no longer published to npm. Move to the SheetJS CDN build or another maintained parser.
- **Lookup-based validation**: add a rule type that checks column values against a Lookup list.

## Later
- Real-time updates on the admin Monitoring page (it currently polls).
- Rename the `Rules.SqlQuery` column to reflect that it stores a declarative rule expression.
- An "unauthorized" page for non-admin deep links into `/admin`.
- A token revocation/blocklist for logout.
