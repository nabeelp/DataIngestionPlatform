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
| Natural Language | `Email` (columns the code reads) | Generated TypeScript, run in a sandbox (see below). Created only from a plain-language request |

Rule failures with severity `Warning` do not fail the upload. Up to 100 sample issues are stored per rule, along with the total count.

Only admins can create, edit, enable/disable or delete rules. Standard users can view the rules for the file definitions they have access to.

### Create a rule from plain language

Admins can click **New Rule**, choose **Natural language** under **Evaluation Strategy**, and describe a single check in the drawer. The backend sends the request and the selected definition's draft column names, types and sheet names to the configured Microsoft Foundry project, and the model decides:

- **Mapped**: when one of the five declarative types above enforces the request exactly, with no loss or change of meaning, that type is used (for example "Amount must be between 0 and 100" becomes the Range Check `Amount: 0..100`). The expression is checked by the validation engine against the draft schema, and the drawer shows pseudocode derived from it.
- **Natural Language**: when no declarative type expresses the request without loss (for example suffixes, patterns, case-insensitive matching, conditions, cross-column comparisons, or uniqueness), a **Natural Language** rule is created. It stores the **original request**, the model's **pseudocode**, and the **TypeScript** that implements it, all shown on the rule and in the drawer. The code defines `validateRow(row: Row, rowNumber: number): string | null`, returning `null` for a valid row or an error message. Before the rule is saved, the code is type-checked against that contract and run in the sandbox on 3–10 example rows the model supplies (at least one passing and one failing); any compile error or mismatch is refused.
- **Rejected**: ambiguous requests, requests that need external data, or ones that refer to unknown columns or sheets return an explanation, and nothing is saved.

When a proposal fails these checks, the model gets one chance to correct it using the reported problem; after that, the request is refused with the reason. Every created rule is saved to the **draft**, so it only applies to uploads after you review it and publish a definition version. A Natural Language rule's type, columns, sheet table and code cannot be edited; its name, description, severity and order can. To change its logic, create a new rule. Review the pseudocode and code before publishing, especially how empty values are treated. Model output is checked against its own examples, which reduces but does not prove semantic equivalence to your request.

**Activity and errors.** While a review runs, the drawer shows a live **Activity** log (streamed from the backend as newline-delimited JSON): reading the draft schema, each call to the model, when Foundry accepts the request, when the model is reasoning or writing, a reminder every 5 seconds while it is silent, each check of the proposal, retries, and the saved rule. The submit button counts the elapsed seconds, and **Stop** cancels the review; the backend then stops the model call and does not save a rule. When a review fails, the drawer shows the specific reason, for example that Foundry denied access (with the role to check), the model deployment was not found, requests were rate-limited, the model reached its output limit or was stopped by the content filter, the model declined, or the connection closed; the Foundry response ID is included when there is one, and the backend log records the details. Transient model failures are retried, up to three model calls per review. The model occasionally gets stuck emitting whitespace instead of finishing its JSON (which previously ran to the 16,000-token limit and failed after a long wait, reported as "The model did not complete the rule review"); the backend now detects this in the stream, stops that response and retries.

**How generated code runs.** During validation, the stored TypeScript is transpiled and run in a [QuickJS](https://github.com/justjake/quickjs-emscripten) WebAssembly sandbox, one per rule per upload. The code has no access to Node.js, the file system, the network, environment variables, or other rules, and receives only the columns it declared. Rows are passed in file order, so the code can keep state across rows (for example, to detect duplicates). If the code throws, returns a non-string value, or exceeds its CPU budget (`RULE_SANDBOX_TIME_LIMIT_MS`, default 20 s per rule per upload) or memory limit (`RULE_SANDBOX_MEMORY_LIMIT_MB`, default 64 MB), that rule fails with a descriptive issue; the other checks still run. The code is part of the published version snapshot, so uploads keep using the code they were pinned to.

Set `AZURE_FOUNDRY_RESOURCE`, `AZURE_FOUNDRY_PROJECT`, and `AZURE_FOUNDRY_MODEL` in `Back-End/.env` (defaults: `aif-zlyway6g7icoy-0`, `citadel-governance-project`, `gpt-5.3-codex`). The named model **deployment** must be available in that project. The backend uses `DefaultAzureCredential`: use a signed-in Azure developer identity locally or a managed identity in Azure, with permission to invoke the project model (for example, Azure AI User on the Foundry project/resource). A `403 ... agents/write` error means that the identity lacks that permission, or that `DefaultAzureCredential` picked a sign-in from another tenant. Locally, it tries the Azure CLI before the Azure Developer CLI; to use another sign-in without changing code, set `AZURE_TOKEN_CREDENTIALS` (for example, `AzureDeveloperCliCredential`) before starting the backend. No model key is sent to the browser or stored in the app. Each review usually makes one billable inference call and at most three (typically 5–25 s in total) and sends the entered request and draft schema names to Foundry; do not enter sensitive values in rule text. In production, assess regional availability and data-handling policies for the deployment, monitor latency/errors and model usage, and keep the rule-publishing approval step.

## Tables and workbook sheets

A definition has one of two layouts (Admin → File Definitions → **Layout**):

- **One table** (the default, and every definition created before this option existed): the columns apply to a CSV file and to **every** sheet of an Excel workbook.
- **One table per workbook sheet**: each table has a **sheet name** (up to 31 characters, without `[ ] : * ? / \`) and its own columns. An uploaded workbook's sheets are matched to tables by name, ignoring case and surrounding spaces:
  - Each table is checked as its own **Sheet "Name" columns** check. A missing sheet fails that check.
  - Sheets without a table are ignored and not validated.
  - CSV (and TSV/TXT) files have no sheets, so they are rejected when uploaded.
  - Every rule names the **sheet table** it applies to (Rules → Sheet Table), and only checks that sheet's rows. Publishing is refused when a rule has no table, its table does not exist, or it refers to a column that is not in that table.

The layout, the sheet tables and each rule's table are part of the versioned contract, so switching layout or renaming a sheet is a draft change until published.

## Definition versions

A definition's **tables (columns) and enabled rules** form its versioned contract. Everything else (name, description, status, delivery folder and template) applies immediately and is not versioned.

- Creating a definition publishes **version 1**.
- Later column and rule edits are saved as a **draft**. Admin → File Definitions labels such definitions **Unpublished changes**. Open **Versions** to review the added, changed and removed columns and rules, add an optional change note, and publish. Publishing supersedes the previous version; each definition has exactly one active version. Publishing is refused when nothing has changed or an enabled rule is invalid, and each publish is recorded in the audit log.
- Each upload is **pinned** to the version active when it arrives. Validation and retries use that version, even after later publishes. Upload details show it as **Definition Version**. The migration pins existing uploads to version 1; any upload still without a pin is pinned to the active version when it is next validated. Unpublished draft edits never apply to uploads.
- Standard users see the active version's columns (Definitions) and rules (Rules). Admins edit the draft.
- Deleting a definition keeps the versions that uploads reference.

## Starting a definition from an example file

In Admin → File Definitions, **Start from an example file** proposes a definition from an example **CSV** or **XLSX** file (up to 10 MB). The example is read the same way uploads are validated, so the proposal matches what validation will see:

- **Header row**: the first non-empty row (the first record for CSV). Title rows above the headers become the header, so the panel warns when many header cells are blank.
- **Sheets**: an XLSX workbook with **more than one populated sheet** is proposed as **one table per sheet**. Choose which sheets to include (all populated sheets are included by default) and preview each sheet's columns. A workbook with a single populated sheet, or a CSV file (which has no sheets), is proposed as one table.
- **Columns**: name, the most specific type every value matches (`integer`, `decimal`, `datetime`, `boolean`, otherwise `string`), and **required** when every analyzed row has a value. Up to 1,000 data rows per sheet are analyzed. Fill counts and sample values are shown for review.
- **Suggested rules** (new definitions only), each scoped to its sheet's table:
  - an `Enum Check` for text columns with 2–10 repeating values. It allows only the values seen in the example, so review it carefully.
  - a `Range Check` for integer and decimal columns with at least two different values. The bounds are rounded out to the next 1, 2 or 5 × 10ⁿ (for example, values from 16 to 9,827 suggest `StockQuantity: 0..10000`), and the minimum is 0 unless the example has negative values. Columns named like identifiers or codes (such as `CustomerId`, `Order No`, `ZipCode` or `SKU`) are skipped.

  The reason for each suggestion is shown next to it. Pick suggestions individually or with **Select all suggested rules**. Selected suggestions from included sheets are created with the definition and published in version 1.

**Use these columns** (or **Use N sheet tables**) replaces the form's layout and columns. You can then edit them, including switching layout, before saving; nothing is saved until you click **Create** or **Update**. When editing an existing definition, applied columns are saved as a draft like any other column edit. The example file is deleted as soon as it has been analyzed and is never stored.

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
- **Sample files** ([samples/](samples/README.md)) cover every upload and definition scenario: delimiters, encodings, one-table and per-sheet definitions (with used and ignored sheets), every rule type and severity, example-file proposals, rejected and corrupt files, and very large files. `samples/definitions/sample_definitions.sql` creates the matching definitions, and `samples/tools/verify_samples.ts` checks each file's expected outcome against the validation engine. Files over 10 MB are git-ignored; regenerate them with `python samples\tools\generate_samples.py`.

## Production notes

Use real authentication, Redis-backed processing, and Azure Blob storage (preferably with managed identity via `AZURE_STORAGE_ACCOUNT_URL`). Set `METRICS_TOKEN` to expose `/metrics`. Restarting the backend with Redis disabled discards pending jobs, so avoid restarting it while uploads are processing. Do not commit `.env` files, uploaded files, or customer data.
