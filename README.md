# Data Ingestion Platform

Users upload CSV/TSV/TXT or Excel files against **file definitions**. The backend validates every row against the definition's columns and any configured rules, then optionally delivers the file to a folder. The backend is in `Back-End` (Express, TypeScript, SQL Server, optional Redis/BullMQ, Socket.IO) and the frontend is in `Front-End` (React, Vite).

## Local development

Use Node.js and npm and a local SQL Server instance (Windows SQL Server LocalDB also works). Redis is **not required** for local development: when `REDIS_ENABLED=false`, uploads use an in-process queue and cache. Jobs are not durable across backend restarts and should not be processed by multiple backend instances. Set `REDIS_ENABLED=true` and run Redis to use BullMQ for durable multi-instance processing.

1. Run `npm ci` in `Back-End` and `Front-End` separately.
2. Create a local SQL Server database named `FileValidationPlatform` (or choose another name). On Windows, SQL Server LocalDB can use `Server=(localdb)\MSSQLLocalDB;Database=FileValidationPlatform;Integrated Security=true`, the optional `msnodesqlv8` dependency, and ODBC Driver 17 for SQL Server. Connect using a local account with schema-creation rights. Execute these scripts **against that database** in order:
   `Back-End/database/users_schema.sql`, `file_definitions_schema.sql`, `upload_system_tables.sql`, `audit_logs_schema.sql`, `lookups_schema.sql`. For the optional mock-login demo, run `seed_local_users.sql`, then `sample_file_definitions.sql` (once), and finally `seed_user_assignments.sql`. Run `file_definition_versions_schema.sql` last: it publishes version 1 of every existing definition. The scripts are idempotent; re-run them after pulling changes to apply new columns and migrations. With `sqlcmd`, pass `-I` (or keep the script's `SET QUOTED_IDENTIFIER ON`), because the versions table uses a filtered index.
3. Copy `Back-End/.env.example` to `Back-End/.env`, or update an existing `.env` to match it. Set `DB_CONNECTION_STRING` to your local SQL Server connection string and `JWT_SECRET` to a new random secret. Replace any old user-specific `UPLOAD_TEMP_DIR` or `SHAREPOINT_LOCAL_PATH` with writable local paths. Keep these files private. The backend loads `.env`, **not** `.env.development`. Set `DEV_BYPASS_AUTH=true` only for the seeded local mock-login demo; it is ignored unless `NODE_ENV=development`.
4. Copy `Front-End/.env.example` to `Front-End/.env.development`, if it is not already configured. Set `VITE_API_URL=http://localhost:3000/api/v1` (or omit it to use the Vite `/api` proxy). Set `VITE_DEV_BYPASS_AUTH=true` only with the backend flag above. The frontend must use the same backend port as the Vite proxy.
5. From the repository root, run `.\start.ps1`, or run `npm run dev` in each project directory in separate terminals. Verify `http://localhost:3000/health` and open `http://localhost:5173`. Test logging in, viewing definitions, uploading a small CSV, and observing validation status. `npm run build` is only needed for production builds.

## Validation

Every upload is read in full (streaming CSV parser; all Excel sheets) and checked in one pass:

- **File definition columns** (always): required columns must exist, required values must not be empty, and non-empty values must match the column type (`string`, `integer`, `decimal`, `datetime`, `boolean`).
- **Rules** (optional, per definition). The rule expression uses a simple declarative syntax:

| Rule type | Expression example | Checks |
|---|---|---|
| Schema Validation | `CustomerId, Email` | Columns exist in the header |
| Required Values | `CustomerId, Email` | Values are not empty |
| Type Check | `UnitPrice: decimal` | Values match the type |
| Enum Check | `Status: Active, Inactive` | Values are in the list |
| Range Check | `StockQuantity: 0..10000` | Numeric values are within the inclusive range (either bound may be omitted) |

Rule failures with severity `Warning` do not fail the upload. Up to 100 sample issues are stored per rule, along with the total count.

Only admins can create, edit, enable/disable or delete rules. Standard users can view the rules for the file definitions they have access to.

## Definition versions

A definition's **columns and enabled rules** form its versioned contract. Everything else (name, description, status, delivery folder and template) applies immediately and is not versioned.

- Creating a definition publishes **version 1**.
- Later column and rule edits are saved as a **draft**. Admin → File Definitions labels such definitions **Unpublished changes**. Open **Versions** to review the added, changed and removed columns and rules, add an optional change note, and publish. Publishing supersedes the previous version; each definition has exactly one active version. Publishing is refused when nothing has changed or an enabled rule is invalid, and each publish is recorded in the audit log.
- Each upload is **pinned** to the version active when it arrives. Validation and retries use that version, even after later publishes. Upload details show it as **Definition Version**. The migration pins existing uploads to version 1; any upload still without a pin is pinned to the active version when it is next validated. Unpublished draft edits never apply to uploads.
- Standard users see the active version's columns (Definitions) and rules (Rules). Admins edit the draft.
- Deleting a definition keeps the versions that uploads reference.

`Custom SQL` and `Regex Pattern` rules are no longer supported. `upload_system_tables.sql` disables existing rules of those types, and on older databases it also disables rules without a `SqlQuery`. Review these rules on the Rules page and recreate them with a supported type before re-enabling them.

## Delivery

Delivery is optional. A file definition may set a **delivery folder** (Admin → File Definitions), which is resolved under `DELIVERY_ROOT_PATH` (default `Back-End/deliveries`). Validated uploads are copied there and finish as `DELIVERED`. Definitions without a delivery folder finish as `VALIDATED`.

## Storage

The default `STORAGE_PROVIDER=sharepoint` is a **local filesystem emulator**, not a connection to Microsoft SharePoint. Uploads live in the configured local folder. The optional `desktop` provider uses `DESKTOP_STORAGE_PATH` or a local `desktop-uploads` folder. Definition templates are stored in `TEMPLATE_STORAGE_PATH` locally, or in the `templates` blob container when `STORAGE_PROVIDER=azure`. Azure Blob Storage requires its own connection configuration and may incur charges; no Azure provisioning is required for this local setup.

## Authentication

- **Password login** issues an app JWT.
- **Microsoft Entra ID SSO** (optional) uses the authorization code flow with PKCE. The backend redeems the code and verifies the ID token signature, audience, issuer, tenant, and nonce. Configure `MS_SSO_ENABLED`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_REDIRECT_URI` (register it on a *Web* platform app registration).
- The mock login is development-only and depends on the seeded demo user IDs. Disable both bypass flags outside local development.
- Socket.IO connections use the same access token, and clients only receive events for uploads they can access.

## Testing

- **Unit tests:** run `npm test` in `Back-End` and `Front-End`.
- **Database functional tests** (`Back-End/tests/*.integration.test.ts`) run against a disposable SQL Server database. They are skipped unless `TEST_DB_CONNECTION_STRING` is set. Create the database (for example `FileValidationPlatform_Test`), apply every script in `Back-End/database` including `seed_local_users.sql`, and run, for example: `$env:TEST_DB_CONNECTION_STRING='Server=(localdb)\MSSQLLocalDB;Database=FileValidationPlatform_Test;Integrated Security=true'; npm test`. Never point this at a database containing real data; the tests create and delete records.
- **UI tests** (Playwright, `Front-End/e2e`) drive the running app. Start it with `.\start.ps1` using the seeded mock-login demo (both bypass flags enabled), then run `npm run test:e2e` in `Front-End`. They use the installed Microsoft Edge by default; set `E2E_BROWSER_CHANNEL=chromium` after `npx playwright install chromium` to use Playwright's browser. They create and then delete their own definition and uploads.

## Production notes

Use real authentication, Redis-backed processing, and Azure Blob storage (preferably with managed identity via `AZURE_STORAGE_ACCOUNT_URL`). Set `METRICS_TOKEN` to expose `/metrics`. Restarting the backend with Redis disabled discards pending jobs, so avoid restarting it while uploads are processing. Do not commit `.env` files, uploaded files, or customer data.
