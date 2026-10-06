# Data Ingestion Platform

Users upload CSV/TSV/TXT or Excel files against **file definitions**. The Node API and React UI use a Python + Polars validation service, Azure Blob Storage, and Azure Service Bus. Local dependencies run in Docker Compose: SQL Server, Azurite, and the Azure Service Bus emulator.

## Local development

Prerequisites: Docker Desktop with its engine running, Python 3.12 with `uv`, and Node.js 24 with npm. Docker needs at least 2 GB of memory and 5 GB of free disk for the Service Bus emulator and its SQL Server dependency.

1. Run `npm ci` in `Back-End` and `Front-End`; run `uv sync` in `Validation-Service`.
2. Copy `Back-End/.env.example` to `Back-End/.env`. Configure the local SQL connection, `JWT_SECRET`, `MSSQL_SA_PASSWORD`, the Service Bus emulator connection string, Azurite connection string, and `RULES_SERVICE_DEV_KEY` there. The template intentionally contains empty secret placeholders. Copy `Validation-Service/.env.example` only when running the Python service outside `start.ps1`; the root script loads the shared backend `.env` into the local process environment.
3. Review and accept the SQL Server and Service Bus emulator license terms before setting `ACCEPT_EULA=Y` in `Back-End/.env`. Keep connection strings, keys, passwords, and `.env` files local. The emulator's connection string format and host options are documented in Microsoft's [Service Bus emulator guide](https://learn.microsoft.com/azure/service-bus-messaging/test-locally-with-service-bus-emulator).
4. Copy `Front-End/.env.example` to `Front-End/.env.development` if needed. Set `VITE_DEV_BYPASS_AUTH=true` only for a local demo.
5. From the repository root, run `.\start.ps1`. It starts the Compose services, waits for them to become healthy, applies the local database scripts and seeds the development mock accounts, then launches the APIs and UI. Verify `http://localhost:3000/health`, `http://localhost:8000/healthz`, and `http://localhost:5173`.

The ordered schema scripts are in `Back-End/database/`. `start.ps1` applies them to the local Docker SQL Server. To apply them manually, use `Back-End/database/apply.ps1 -Authentication Local -Database <name> -Password <local-sa-password> -CreateDatabase`. The `Entra` mode uses the Go `sqlcmd` utility and `ActiveDirectoryDefault` credentials; provision the database and grant the deployment identity schema permissions first.

The current schema is a clean-slate contract. `apply.ps1` fails fast on incompatible legacy `FileDefinitions`, `Rules`, or `FileDefinitionVersions` tables instead of silently discarding their data. Back up and migrate any non-disposable database before applying it.

Local runs keep using the `.env`-based emulator settings and shared development key; they do not require Azure identity, Entra app registrations, or provisioned cloud resources. Azure managed-identity and Entra rules-service settings are injected by the Container Apps deployment.

## Validation

Every upload is streamed from Blob Storage to the Python service, parsed (including all Excel sheets), and checked in one pass:

- **File definition columns** (always): required columns must exist, required values must not be empty, and non-empty values must match the column type (`string`, `integer`, `decimal`, `datetime`, `boolean`).
- **Rules** (optional, per definition) are stored and exchanged as versioned `RuleConfig` JSON. The editor's common built-in checks use a simple declarative syntax:

| Rule type | Expression example | Checks |
|---|---|---|
| Schema Validation | `CustomerId, Email` | Columns exist in the header |
| Required Values | `CustomerId, Email` | Values are not empty |
| Type Check | `UnitPrice: decimal` | Values match the type |
| Enum Check | `Status: Active, Inactive` | Values are in the list |
| Range Check | `StockQuantity: 0..10000` | Numeric values are within the inclusive range (either bound may be omitted) |
| Natural Language | Plain-language request | A validated `naturalLanguage` RuleConfig containing restricted SQL, declared columns, examples and provenance |

Rule failures with severity `Warning` do not fail the upload. Up to 100 sample issues are stored per rule, along with the total count.

Only admins can create, edit, enable/disable or delete rules. Standard users can view the rules for the file definitions they have access to.

### Create a rule from plain language

Admins can click **New Rule**, choose **Natural language** under **Evaluation Strategy**, and describe a single check in the drawer. The backend sends the request and the selected definition's draft column names, types and sheet names to the configured Microsoft Foundry project, and the model decides:

- **Mapped**: when a built-in RuleConfig type enforces the request exactly, with no loss or change of meaning, that type is used (for example "Amount must be between 0 and 100" becomes a `range` rule). The Python service checks it against the draft schema.
- **Natural Language**: when no built-in type expresses the request without loss (for example suffixes, patterns, conditions, cross-column comparisons, uniqueness, or checks relating rows or totals across sheets), the rule stores the **original request**, an explanation, restricted SQL, declared columns and 2–20 passing/failing examples. Before saving, the Python service validates the SQL and executes the examples with the same rule path used for uploads. The model cannot provide code or bypass `sqlguard`.
- **Rejected**: ambiguous requests, requests that need external data, or ones that refer to unknown columns or sheets return an explanation, and nothing is saved.

The model returns a built-in `RuleConfig` whenever it can express the request exactly; otherwise it may propose a `naturalLanguage` RuleConfig with a restricted SQL expression and examples. The Python service validates every proposal against the definition and runs the examples through the same Polars rule path used for uploads. SQL is accepted only after `sqlguard` validation; model output is never executed as generated TypeScript or JavaScript. When a proposal fails checks, the model gets one chance to correct it using the reported problem; after that, the request is refused with the reason.

Every created rule is saved to the **draft**, so it only applies to uploads after you review it and publish a definition version. A Natural Language rule's SQL logic, declared columns and table scope are preserved when editing; its name, description, severity and order can be changed. To change its logic, regenerate it from the original request. Review the stored explanation, expression and examples before publishing, especially how empty values are treated. Model output is checked against its examples, which reduces but does not prove semantic equivalence to your request.

**Activity and errors.** While a review runs, the drawer shows a live **Activity** log (streamed from the backend as newline-delimited JSON): reading the draft schema, each call to the model, when Foundry accepts the request, when the model is reasoning or writing, a reminder every 5 seconds while it is silent, each Python validation/example check, retries, and the saved rule. The submit button counts the elapsed seconds, and **Stop** cancels the review; the backend then stops the model call and does not save a rule. When a review fails, the drawer shows the reason, such as Foundry access/deployment errors, rate limiting, model refusal, invalid RuleConfig/SQL, or a closed connection. The Foundry response ID is included when available; logs contain operational metadata rather than rule text or file data. Transient model failures are retried, up to three model calls per review.

**How rules run.** Built-in RuleConfig types compile to Polars expressions. Natural Language SQL is parsed and restricted by the Python `sqlguard`; it can read only the declared columns and approved SQL functions, and it cannot access external tables, the network or the file system. SQL-backed rules and their examples are validated before saving and are included in the published version snapshot, so uploads keep using the rule configuration they were pinned to.

Set `AZURE_FOUNDRY_RESOURCE`, `AZURE_FOUNDRY_PROJECT`, and `AZURE_FOUNDRY_MODEL` in `Back-End/.env` (defaults: `aif-zlyway6g7icoy-0`, `citadel-governance-project`, `gpt-5.3-codex`). The named model **deployment** must be available in that project. The backend uses `DefaultAzureCredential`: use a signed-in Azure developer identity locally or a managed identity in Azure, with permission to invoke the project model (for example, Azure AI User on the Foundry project/resource). A `403 ... agents/write` error means that the identity lacks that permission, or that `DefaultAzureCredential` picked a sign-in from another tenant. Locally, it tries the Azure CLI before the Azure Developer CLI; to use another sign-in without changing code, set `AZURE_TOKEN_CREDENTIALS` (for example, `AzureDeveloperCliCredential`) before starting the backend. No model key is sent to the browser or stored in the app. Each review usually makes one billable inference call and at most three (typically 5–25 s in total) and sends the entered request and draft schema names to Foundry; do not enter sensitive values in rule text. In production, assess regional availability and data-handling policies for the deployment, monitor latency/errors and model usage, and keep the rule-publishing approval step.

## Tables and workbook sheets

A definition has one of two layouts (Admin → File Definitions → **Layout**):

- **One table** (the default, and every definition created before this option existed): the columns apply to a CSV file and to **every** sheet of an Excel workbook.
- **One table per workbook sheet**: each table has a **sheet name** (up to 31 characters, without `[ ] : * ? / \`) and its own columns. An uploaded workbook's sheets are matched to tables by name, ignoring case and surrounding spaces:
  - Each table is checked as its own **Sheet "Name" columns** check. A missing sheet fails that check.
  - Sheets without a table are ignored and not validated.
  - CSV (and TSV/TXT) files have no sheets, so they are rejected when uploaded.
  - Every ordinary rule names the **sheet table** it applies to (Rules → Sheet Table), and only checks that sheet's rows. A Natural Language rule that explicitly relates sheets can instead declare columns separately for each named sheet. Publishing is refused when a target sheet does not exist or a declared column is not in its sheet.

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

Rules are stored as versioned JSON configurations in `Rules.Config`; indexed listing fields are persisted computed columns. Database schema changes are applied in the fixed order by `Back-End/database/apply.ps1`.

## Delivery

Delivery is optional. A file definition may set a **delivery folder** (Admin → File Definitions). With the default `DELIVERY_PROVIDER=local`, validated files are copied under `DELIVERY_ROOT_PATH` (default `Back-End/deliveries`). Definitions without a delivery folder finish as `VALIDATED`.

In Azure, `DELIVERY_PROVIDER=azure` stores each output in the private `deliveries` Blob container (configurable with `AZURE_STORAGE_DELIVERIES_CONTAINER`). The definition's folder is a relative Blob name prefix; the final name is deterministic for the upload and sanitized source filename, so a replay replaces the same output. The API managed identity has Blob Data Contributor access scoped to this container. On Upload Details, an authorized user can download a completed output; the API checks access to the upload before streaming it and does not expose a public URL or SAS token. Explicitly deleting an upload also deletes its delivery output. Delivery outputs have no age-based expiry; the storage account's existing seven-day Blob soft-delete setting provides recovery after deletion.

Local development continues to use filesystem copies. Outputs created by older deployments are not migrated automatically; only outputs recorded and delivered after enabling the Azure provider use the durable Blob destination.

## Storage

Uploads and issues reports are stored in Azure Blob Storage; locally, Azurite provides the compatible emulator. The Node API streams uploads to `uploads/{uploadId}/{safeName}` and computes SHA-256 while streaming. Definition templates may still use the configured local template store or a Blob container. Azure Blob Storage in production requires an account and managed identity (or another approved credential) and may incur charges; no Azure provisioning is required for the local setup.

## Authentication

- **Password login** issues an app JWT.
- **Microsoft Entra ID SSO** (optional) uses the authorization code flow with PKCE. The backend redeems the code and verifies the ID token signature, audience, issuer, tenant, and nonce. Configure `MS_SSO_ENABLED`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_REDIRECT_URI` (register it on a *Web* platform app registration).
- The mock login is development-only and depends on the seeded demo user IDs. Disable both bypass flags outside local development.
- Socket.IO connections use the same access token, and clients only receive events for uploads they can access.

## Testing

- **Unit tests:** run `npm test` in `Back-End` and `Front-End`.
- **Database functional tests** (`Back-End/tests/*.integration.test.ts`) run against a disposable SQL Server database. They are skipped unless `TEST_DB_CONNECTION_STRING` is set. Create the database (for example `FileValidationPlatform_Test`), apply every script in `Back-End/database` including `seed_local_users.sql`, and run, for example: `$env:TEST_DB_CONNECTION_STRING='Server=(localdb)\MSSQLLocalDB;Database=FileValidationPlatform_Test;Integrated Security=true'; npm test`. Never point this at a database containing real data; the tests create and delete records.
- **UI tests** (Playwright, `Front-End/e2e`) drive the running app. Start it with `.\start.ps1` using the seeded mock-login demo (both bypass flags enabled), then run `npm run test:e2e` in `Front-End`. They use the installed Microsoft Edge by default; set `E2E_BROWSER_CHANNEL=chromium` after `npx playwright install chromium` to use Playwright's browser. They create and then delete their own definition and uploads.
- **Sample files** ([samples/](samples/README.md)) cover every upload and definition scenario: delimiters, encodings, one-table and per-sheet definitions (with used and ignored sheets), every rule type and severity, example-file proposals, rejected and corrupt files, and very large files. `samples/definitions/sample_definitions.sql` creates the matching definitions. The Python golden suite compares upload fixtures with captured WP0 Node baselines; run it with `uv run pytest tests/golden/test_node_baseline.py -q` in `Validation-Service`. With the local stack running, `npm run test:e2e:samples` in `Front-End` sends every sample through the UI/API and checks outcomes, counts, reports, and delivery. Files over 10 MB are git-ignored; regenerate them with `python samples\tools\generate_samples.py`.

## Azure deployment

The Bicep and `azd` deployment runbook, Entra prerequisites, cost drivers, validation checklist, and teardown cautions are in [docs/deployment.md](docs/deployment.md). Infrastructure has been validated with Bicep compilation and `azd provision --preview`; no Azure resources are created until an owner explicitly approves provisioning.

## Production notes

Use real authentication, Azure Service Bus for validation/delivery messages, and Azure Blob Storage (preferably with managed identity via `AZURE_STORAGE_ACCOUNT_URL`). The Python worker consumes validation requests and publishes versioned validation events; the Node API consumes those events and schedules delivery retries through Service Bus. Queue depths and dead-letter counts are shown when the Service Bus admin API supports them; the local emulator reports these metrics as unavailable. Set `METRICS_TOKEN` to expose `/metrics`. Do not commit `.env` files, uploaded files, or customer data.
