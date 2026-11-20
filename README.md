# Data Ingestion Platform

Users upload CSV/TSV/TXT or Excel files against **file definitions**. The Node API and React UI use a Python + Polars validation service, Azure Blob Storage, and Azure Service Bus. Local dependencies run in Docker Compose: SQL Server, Azurite, and the Azure Service Bus emulator.

> **Proof of concept.** This solution is handed over as a PoC, not a production-ready system. Read the [PoC handover](docs/poc-handover.md) for scope, verified state, what you must supply or replace, accepted limits and the gate to close before production or real customer data.

**Documentation:** [User guide](docs/user-guide.md) · [administrator guide](docs/admin-guide.md) · [architecture decisions](docs/adr/index.md) · [Unreleased notes](docs/releases/unreleased.md) · [changelog](CHANGELOG.md) · [PoC handover](docs/poc-handover.md) · [architecture](docs/architecture.md) · [Azure deployment](docs/deployment.md) · [natural-language and cross-sheet rules](docs/natural-language-rules.md) · [contracts](contracts/README.md) · [validation service](Validation-Service/README.md) · [sample files](samples/README.md) · [backlog](TODO.md).

## Table of Contents

- [About](#about) · [Features](#features) · [Tech Stack](#tech-stack) · [Architecture](#architecture)
- [Project Structure](#project-structure) · [Getting Started](#getting-started) · [Configuration](#configuration) · [Security](#security)
- [How to Contribute](#how-to-contribute) · [What's Next](#whats-next) · [License](#license) · [Acknowledgements](#acknowledgements) · [Author](#author)
- [Local development](#local-development) · [Validation](#validation) · [Testing](#testing) · [Azure deployment](#azure-deployment)

## About

The platform helps data administrators define checks and users submit files for
asynchronous validation and optional delivery. It is an implemented PoC, not a
production service; see the [handover](docs/poc-handover.md).

## Features

| Capability | Description |
|---|---|
| Definitions | Publish versioned tables, columns and rules for authorized uploaders. |
| Validation | Inspect file-level results, warnings and issues reports. |
| Rule authoring | Review built-in and model-proposed rules before publishing. |
| Delivery | Optionally deliver validated files and allow authorized downloads. |
| Administration | Manage users and access; inspect audit, monitoring and compliance views. |

## Tech Stack

React 19 and Vite 7, Node.js 24 with Express and TypeScript, and Python 3.12
with FastAPI and Polars. SQL, Blob Storage and Service Bus provide persistence
and messaging; local development uses Docker emulators.

## Architecture

The browser calls the Node API; the API stores data and queues validation for
the Python worker. The rules service validates rule proposals. Azure uses
Container Apps, Azure SQL, Blob Storage, Service Bus and Key Vault. See the
[architecture overview](docs/architecture.md) and [decisions](docs/adr/index.md).

## Project Structure

- `Back-End/` — API, database scripts and backend tests.
- `Front-End/` — React UI and browser tests.
- `Validation-Service/` — rules API, validation worker and Python tests.
- `contracts/` — shared schemas and examples.
- `infra/`, `azure.yaml` and `scripts/` — Azure deployment and operations.
- `samples/` — sample inputs and definitions; some large files are generated.
- `docs/` — architecture, guides and operational documentation.
- `.github/` — CI, deployment workflows and automation.

Generated contracts, build outputs, dependencies, logs and local data are not
standalone documentation artifacts.

## Getting Started

On Windows, with Git, Docker Desktop, Node.js 24, Python 3.12, `uv` and
PowerShell installed:

```powershell
git clone https://github.com/nabeelp/DataIngestionPlatform.git
Set-Location DataIngestionPlatform
Push-Location Back-End; npm ci; Pop-Location
Push-Location Front-End; npm ci; Pop-Location
Push-Location Validation-Service; uv sync; Pop-Location
Copy-Item Back-End\.env.example Back-End\.env
# Configure Back-End\.env as described below, then:
.\start.ps1
```

Clone access depends on repository permissions. Do not overwrite an existing
`.env` file. Read the [local development steps](#local-development) for
required settings and emulator license acceptance before starting. The
[user guide](docs/user-guide.md) covers upload and administration flows;
the [administrator guide](docs/admin-guide.md) covers operation.

## Configuration

Local defaults and setting names are in
[`Back-End/.env.example`](Back-End/.env.example),
[`Front-End/.env.example`](Front-End/.env.example) and
[`Validation-Service/.env.example`](Validation-Service/.env.example).
Secrets must remain outside source control. See the
[administrator guide](docs/admin-guide.md#configuration) for configuration
scope and [deployment](docs/deployment.md#parameters-and-secrets) for Azure.

## Security

The API supports password login and optional Entra SSO with role and
definition-based access. Azure uses managed identities and Key Vault; local
bypass authentication is for development only. The session, retention and
networking limitations in the [handover](docs/poc-handover.md) must be assessed
before real customer data. Report suspected vulnerabilities privately to the
repository maintainer rather than including sensitive details in a public issue.

## How to Contribute

Create a branch, follow the local setup and [testing](#testing) instructions,
and submit a pull request for review. Keep documentation and shared contracts
in step with behavior; do not commit secrets, uploaded data or generated local
artifacts.

## What's Next

Planned, not shipped: authenticated Azure acceptance, recoverable queue handoff,
session revocation, data retention and operational recovery. Priorities and
other known gaps are tracked in the [backlog](TODO.md).

## License

This project is available under the [MIT License](LICENSE).

## Acknowledgements

The solution builds on React, Express, Polars and the Azure SDK and emulator
projects identified in the component manifests and deployment documentation.

## Author

Maintained in the [nabeelp/DataIngestionPlatform repository](https://github.com/nabeelp/DataIngestionPlatform).
Use its issue tracker for questions and non-sensitive bug reports.

## Local development

Prerequisites: Docker Desktop with its engine running, Python 3.12 with `uv`, and Node.js 24 with npm. Docker needs at least 2 GB of memory and 5 GB of free disk for the Service Bus emulator and its SQL Server dependency.

1. Run `npm ci` in `Back-End` and `Front-End`; run `uv sync` in `Validation-Service`. The lockfiles reference the public npm and PyPI registries; npm transparently uses your configured mirror for `registry.npmjs.org`. If a mirrored `npm install` or `npm audit fix` rewrites `resolved` URLs in a `package-lock.json`, restore the `https://registry.npmjs.org/` form before committing.
2. Copy `Back-End/.env.example` to `Back-End/.env`. Configure the local SQL connection, `JWT_SECRET`, `MSSQL_SA_PASSWORD`, the Service Bus emulator connection string, Azurite connection string, and `RULES_SERVICE_DEV_KEY` there. The template intentionally contains empty secret placeholders. Copy `Validation-Service/.env.example` only when running the Python service outside `start.ps1`; the root script loads the shared backend `.env` into the local process environment.
3. Review and accept the SQL Server and Service Bus emulator license terms before setting `ACCEPT_EULA=Y` in `Back-End/.env`. Keep connection strings, keys, passwords, and `.env` files local. The emulator's connection string format and host options are documented in Microsoft's [Service Bus emulator guide](https://learn.microsoft.com/azure/service-bus-messaging/test-locally-with-service-bus-emulator).
4. Copy `Front-End/.env.example` to `Front-End/.env.development` if needed. Set `VITE_DEV_BYPASS_AUTH=true` only for a local demo.
5. From the repository root, run `.\start.ps1`. It starts the Compose services, waits for them to become healthy, applies the local database scripts and seeds the development mock accounts, then launches the APIs and UI. Verify `http://localhost:3000/health`, `http://localhost:8000/healthz`, and `http://localhost:5173`.

The ordered schema scripts are in `Back-End/database/`. `start.ps1` applies them to the local Docker SQL Server. To apply them manually, use `Back-End/database/apply.ps1 -Authentication Local -Database <name> -Password <local-sa-password> -CreateDatabase`. The `Entra` mode uses the Go `sqlcmd` utility and `ActiveDirectoryDefault` credentials; provision the database and grant the deployment identity schema permissions first.

The current schema is a clean-slate contract. `apply.ps1` fails fast on incompatible legacy `FileDefinitions`, `Rules`, or `FileDefinitionVersions` tables instead of silently discarding their data. Back up and migrate any non-disposable database before applying it.

Local runs keep using the `.env`-based emulator settings and shared development key; they do not require Azure identity, Entra app registrations, or provisioned cloud resources. Azure managed-identity and Entra rules-service settings are injected by the Container Apps deployment.

### Service Bus emulator startup troubleshooting

`start.ps1` waits for the emulator's HTTP `/health` endpoint to return success before starting the application. An open AMQP port alone does not mean the emulator has finished creating its databases and messaging entities.

If startup times out, inspect `docker logs --tail 100 servicebus-emulator` and `docker logs --tail 100 data-ingestion-servicebus-sql` locally; redact credentials before sharing logs. Repeated SQL error 5170 ("Cannot create file ... because it already exists") can indicate orphaned emulator database files in the dedicated `servicebus-sql-data` volume. Stop only `servicebus-emulator`, verify the affected files are not registered in SQL Server's `sys.master_files`, and back up those exact files outside the SQL data directory before restarting the emulator. This recreates the emulator message store; preserve anything needed before recovery. Do not delete the application SQL or Azurite volumes, or run `docker compose down --volumes` to fix this.

## Validation

Every upload is streamed from Blob Storage to the Python service, parsed (including all Excel sheets), and checked in one pass:

- **File definition columns** (always): required columns must exist, required values must not be empty, and non-empty values must match the column type (`string`, `integer`, `decimal`, `date`, `datetime`, `boolean`).
- **Rules** (optional, per definition) add business logic on top of the column checks and are stored and exchanged as versioned `RuleConfig` JSON. There are no rule types for required columns, required values or data types: set those on the column definitions instead, and a definition that still carries such a rule is rejected. The rule types are:

| Rule type (editor label) | Checks |
|---|---|
| Allowed values (`enum`) | Values are in a fixed list |
| Numeric range (`range`) | Numeric values are within the inclusive range (either bound may be omitted) |
| Pattern (`pattern`) | Text matches a regular expression |
| Length (`length`) | Text length is within a minimum and/or maximum |
| Unique values (`unique`) | A column or combination of columns is not duplicated |
| Lookup (`lookup`) | Values exist in a reusable **lookup** list |
| Date range (`dateRange`) | Dates fall within fixed or relative bounds |
| Conditional required values (`conditionalRequired`) | Columns are populated when another column meets a condition |
| Compare columns (`compare`) | Two columns satisfy a typed comparison (less than, equal, and so on) |
| Row count (`rowCount`) | A table's row count is within a minimum and/or maximum |
| Aggregate (`aggregate`) | A sum, average, minimum, maximum, count or distinct count meets a bound |
| Reconcile tables (`reconcile`) | Aggregates from two sheets agree, optionally within a tolerance |
| Natural language (`naturalLanguage`) | A plain-language request stored with restricted SQL, declared columns, examples and provenance |

The rule list shows allowed-values and range rules as a short expression, for example `Status: Active, Inactive` or `StockQuantity: 0..10000`.

**Lookups** (sidebar → Lookups) are reusable value lists that admins create and edit and that `lookup` rules reference. All signed-in users can view them. Deleting a lookup that a definition references is not yet safe (FUN-06 in [TODO.md](TODO.md)).

Rule failures with severity `Warning` do not fail the upload. Up to 100 sample issues are stored per rule, along with the total count.

Only admins can create, edit, enable/disable or delete rules. Standard users can view the rules for the file definitions they have access to.

### Definition, rule, and upload workflow

1. An admin creates a definition in a dedicated full-page workspace and publishes version 1 only after reviewing its details, structure, and rules. The workspace is the only place rules are maintained: its **Rules** step (also reachable from the **Rules** action in the definitions list and the workspace's **Rules** tab) lists, adds, edits, reorders, disables and removes rules, and links to full-page version review. Structure and rules are one draft held in the workspace: nothing is saved until the admin selects **Review & publish**, and leaving or cancelling discards both (with a warning when there are unsaved changes). Existing and new uploads continue to use the active published version until a new version is published.
2. Definition links preserve the selected definition between **File Definitions** and **Upload File**. Uploaders can review the published version, expected sheets/columns, and the published rules (read only, under **My Files**) before choosing a file.
3. **Upload and validate** stores the file and adds it to upload history. History and result pages show the definition name and pinned version so validation outcomes remain explainable after a newer version is published.
4. A failed result prioritizes failed checks, warnings, affected rows, and sample values. **Retry stored file** reprocesses the stored upload against its recorded version; use **Upload corrected file** to submit changed data with the same definition preselected.

### Create a rule from plain language

In a definition workspace's **Rules** step, admins can click **Describe a rule** and describe a single check (**Choose a rule type** adds a built-in rule through a form instead). The backend sends the request and the workspace's current (unsaved) column names, types and sheet names through the Citadel Azure API Management gateway, and the model decides:

- **Mapped**: when a built-in RuleConfig type enforces the request exactly, with no loss or change of meaning, that type is used (for example "Amount must be between 0 and 100" becomes a `range` rule). The Python service checks it against the draft schema.
- **Natural Language**: when no built-in type expresses the request without loss (for example suffixes, patterns, conditions, cross-column comparisons, uniqueness, or checks relating rows or totals across sheets), the rule stores the **original request**, an explanation, restricted SQL, declared columns and 2–20 passing/failing examples. Before saving, the Python service validates the SQL and executes the examples with the same rule path used for uploads. The model cannot provide code or bypass `sqlguard`.
- **Rejected**: ambiguous requests, requests that need external data, or ones that refer to unknown columns or sheets return an explanation, and nothing is saved.

The model returns a built-in `RuleConfig` whenever it can express the request exactly; otherwise it may propose a `naturalLanguage` RuleConfig with a restricted SQL expression and examples. The Python service validates every proposal against the definition and runs the examples through the same Polars rule path used for uploads. SQL is accepted only after `sqlguard` validation; model output is never executed as generated TypeScript or JavaScript. When a proposal fails checks, the model gets one chance to correct it using precise feedback (the example, sheet and column involved); if only the examples were malformed, just the examples are rewritten and the validated SQL is kept. After that, the request is refused with the reason.

A reviewed rule is only a proposal until you choose **Add to definition**; it then joins the workspace's draft and is saved with the definition, and it only applies to uploads after a definition version is published. A Natural Language rule's SQL logic, declared columns and table scope are preserved when editing; its name, description and severity can be changed, and reordering is done in the list. To change its logic, regenerate it from the request and choose **Use regenerated rule**. Review the stored explanation, expression and examples before publishing, especially how empty values are treated. Model output is checked against its examples, which reduces but does not prove semantic equivalence to your request.

**Activity and errors.** While a review runs, the rule panel shows a live **Activity** log (streamed from the backend as newline-delimited JSON): reading the draft schema, each call to the model, when Citadel accepts the request, when the model is reasoning or writing, a reminder every 5 seconds while it is silent, each Python validation/example check, retries, and the proposed rule. The activity panel shows the elapsed seconds, and **Stop generation** (which replaces **Generate rule** while a review runs) cancels the review; the backend then stops the model call. When a review fails, the panel shows the reason, such as Citadel access/deployment errors, rate limiting, model refusal, invalid RuleConfig/SQL, or a closed connection. The model response ID is included when available; logs contain operational metadata rather than rule text or file data. Transient model failures are retried, up to three model calls per review.

**How rules run.** Built-in RuleConfig types compile to Polars expressions. Natural Language SQL is parsed and restricted by the Python `sqlguard`; it can read only the declared columns and approved SQL functions, and it cannot access external tables, the network or the file system. SQL-backed rules and their examples are validated before saving and are included in the published version snapshot, so uploads keep using the rule configuration they were pinned to.

**Cross-sheet rules.** In a sheet-layout definition, describe a check that names the sheets (for example "Every order's customer id must exist in the Customers sheet"). Totals across sheets map to the built-in `reconcile` type; everything else relating rows of different sheets becomes a query-mode Natural Language rule that joins the sheets and reports offending rows against their own sheet. Examples can seed rows in other sheets (`relatedRows`). See [docs/natural-language-rules.md](docs/natural-language-rules.md) for the contract, limits, review findings, the golden test corpus and the opt-in live model evaluation (`npm run eval:nl-rules`).

Set `CITADEL_SUBSCRIPTION_KEY` in your ignored `Back-End/.env`. Set `CITADEL_ENDPOINT` to your gateway's `/models` base URL (there is no default; without it, rule review reports that the setting is required); the backend posts streaming Responses API requests to `/models/responses` with the `api-key` header, without a bearer token. Set `CITADEL_SUBSCRIPTION_KEY_HEADER` to override the header name (for example, `Ocp-Apim-Subscription-Key` for gateways that require it). Set `CITADEL_MODEL` to a deployment exposed by the gateway (default `gpt-6-luna`; existing `AZURE_FOUNDRY_MODEL` remains a fallback). The old Foundry resource/project settings are no longer used, and there is no direct-model fallback. No model key is sent to the browser. In Azure, the API reads the key through a managed-identity Key Vault reference; see [deployment](docs/deployment.md). Missing keys and gateway access errors are shown explicitly. Each review usually makes one billable inference call and at most three (typically 5–25 s in total), sending the entered request and draft schema names through Citadel; do not enter sensitive values in rule text. Assess the gateway's downstream regional availability and data-handling policies, monitor latency/errors and model usage, rotate the subscription key, and keep the rule-publishing approval step.

## Tables and workbook sheets

A definition has one of two layouts (Admin → File Definitions → **Layout**):

- **One table** (the default): the columns apply to a CSV file and to **every** sheet of an Excel workbook.
- **One table per workbook sheet**: each table has a **sheet name** (up to 31 characters, without `[ ] : * ? / \`) and its own columns. An uploaded workbook's sheets are matched to tables by name, ignoring case and surrounding spaces:
  - Each table is checked as its own **Sheet "Name" columns** check. A missing sheet fails that check.
  - Sheets without a table are ignored and not validated.
  - CSV (and TSV/TXT) files have no sheets, so they are rejected when uploaded.
  - Every ordinary rule names the **sheet table** it applies to (Rules step → Sheet), and only checks that sheet's rows. A Natural Language rule that explicitly relates sheets can instead declare columns separately for each named sheet. Publishing is refused when a target sheet does not exist or a declared column is not in its sheet.
  - For a **Reconcile tables** rule, choose a sheet for each aggregate before selecting its column. Both table selectors start with **Choose a sheet ...** when creating a rule; existing rules retain their saved selections.

The layout, the sheet tables and each rule's table are part of the versioned contract, so switching layout or renaming a sheet is a draft change until published.

## Definition versions

A definition's **tables (columns) and enabled rules** form its versioned contract. Everything else (name, description, status, delivery folder and template) applies immediately and is not versioned. The APIs exchange a definition only as that `contract` (plus `RuleConfig[]` rules): admin reads and writes, version history, exports, the uploader's view and example-file proposals all use the same shapes. A column is shown as **required** when it must exist (`mustExist`) and may not be empty (`nullable: false`). Version comparisons cover every contract field, including column parsing options, table limits, encoding, ignored sheets and the lookup values a rule uses.

- Creating a definition publishes **version 1**.
- Editing a definition uses the same **Details → Tables and columns → Rules → Review** flow as clean-slate creation (saved definitions can jump between these sections). Details include name, description, status, delivery folder, and reusable-template replacement or removal. The final Review step accepts an optional change note and publishes a new version containing those details, the validation contract, and enabled rules.
- Rule changes made in the definition workspace are saved with the definition as draft changes until it is published. Admin → File Definitions labels definitions with any unpublished metadata, template, column, contract, or rule changes as **Unpublished changes**. The Versions workspace shows those changes and the complete history. Publishing supersedes the previous version; each definition has exactly one active version. Publishing is refused when nothing has changed or an enabled rule is invalid, and each publish is recorded in the audit log.
- Each upload is **pinned** to the version active when it arrives. Validation and retries use that version, even after later publishes. Upload details show it as **Definition Version**. Unpublished draft edits never apply to uploads.
- Standard users see the active version's columns and rules under **My Files**. Admins edit the draft in the definition workspace.
- Deleting a definition that uploads still reference is not yet reliable: the intended policy (archive, reject or transactional delete) is an open decision tracked as FUN-02 in [TODO.md](TODO.md).

## Creating a file definition

New definitions use a path-specific wizard:

1. **Details**: enter a name and optional description, then choose either **Start from an example file** or **Start from a clean slate**. Both choices remain the same size; selecting one highlights it. New definitions are always active.
2. **Example file** (example path only): upload a representative **CSV** or **XLSX** file (up to 10 MB). Every detected sheet and its proposed columns and rules appear together. You can correct each proposed column's type and required state before continuing. Clear a sheet's include checkbox to collapse and grey it out; select it again to restore it.
3. **Tables and columns** (step 2 for clean slate, step 3 for example files): add or remove tables and define each column's name, data type, and required state. Example-file proposals populate this same editor before review. The wizard infers a one-table layout from one table and a workbook-sheet layout from multiple tables, so there is no separate layout choice.
4. **Review** (step 3 for clean slate, step 4 for example files): review the tables, columns, and selected suggested rules, then choose **Publish version 1**.

Every creation step shows **Cancel** at the bottom left. Cancel returns to the file-definition list without saving; creation does not provide backward navigation.

File contract settings and delivery/template settings are intentionally hidden during creation. They remain available when editing an existing definition.

The example-file path reads the example the same way uploads are validated, so the proposal matches what validation will see:

- **Header row**: the first non-empty row (the first record for CSV). Title rows above the headers become the header, so the panel warns when many header cells are blank.
- **Sheets**: an XLSX workbook with **more than one populated sheet** is proposed as **one table per sheet**. Choose which sheets to include (all populated sheets are included by default) and preview each sheet's columns. A workbook with a single populated sheet, or a CSV file (which has no sheets), is proposed as one table.
- **Columns**: name, the most specific type every value matches (`integer`, `decimal`, `datetime`, `boolean`, otherwise `string`), and **required** when every analyzed row has a value. Up to 1,000 data rows per sheet are analyzed. Fill counts and sample values are shown for review.
- **Suggested rules** (new definitions only), each scoped to its sheet's table:
  - an `Enum Check` for text columns with 2–10 repeating values. It allows only the values seen in the example, so review it carefully.
  - a `Range Check` for integer and decimal columns with at least two different values. The bounds are rounded out to the next 1, 2 or 5 × 10ⁿ (for example, values from 16 to 9,827 suggest `StockQuantity: 0..10000`), and the minimum is 0 unless the example has negative values. Columns named like identifiers or codes (such as `CustomerId`, `Order No`, `ZipCode` or `SKU`) are skipped.

  The reason for each suggestion is shown next to it. Pick suggestions individually or with **Select all suggested rules**. Selected suggestions from included sheets are created with the definition and published in version 1.

After reviewing the detected structure, **Next** applies the included columns, sheet tables, and selected rules and continues to metadata. Nothing is saved until the final review is published. The example-file assistant is available only while creating a definition. The example file is staged in Blob storage only for the analysis and deleted as soon as it has been analyzed; it is never retained.

Rules are stored as versioned JSON configurations in `Rules.Config`; indexed listing fields are persisted computed columns. Database schema changes are applied in the fixed order by `Back-End/database/apply.ps1`.

## Delivery

Delivery is optional. A file definition may set a **delivery folder** (Admin → File Definitions). With the default `DELIVERY_PROVIDER=local`, validated files are copied under `DELIVERY_ROOT_PATH` (default `Back-End/deliveries`). Definitions without a delivery folder finish as `VALIDATED`.

In Azure, `DELIVERY_PROVIDER=azure` stores each output in the private `deliveries` Blob container (configurable with `AZURE_STORAGE_DELIVERIES_CONTAINER`). The definition's folder is a relative Blob name prefix; the final name is deterministic for the upload and sanitized source filename, so a replay replaces the same output. The API managed identity has Blob Data Contributor access scoped to this container. On Upload Details, an authorized user can download a completed output; the API checks access to the upload before streaming it and does not expose a public URL or SAS token. Explicitly deleting an upload also deletes its delivery output. Delivery outputs have no age-based expiry; the storage account's existing seven-day Blob soft-delete setting provides recovery after deletion.

Local development continues to use filesystem copies.

## Storage

Uploads and issues reports are stored in Azure Blob Storage; locally, Azurite provides the compatible emulator. The Node API streams uploads to `uploads/{uploadId}/{safeName}` and computes SHA-256 while streaming. Definition templates use the Blob `templates` container when a storage connection string or account URL is configured, otherwise the local folder `TEMPLATE_STORAGE_PATH`. Azure Blob Storage in production requires an account and managed identity (or another approved credential) and may incur charges; no Azure provisioning is required for the local setup.

## Authentication

- **Password login** issues an app JWT.
- **Microsoft Entra ID SSO** (optional) uses the authorization code flow with PKCE. The backend redeems the code and verifies the ID token signature, audience, issuer, tenant, and nonce. Configure `MS_SSO_ENABLED`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_REDIRECT_URI` (register it on a *Web* platform app registration).
- The mock login is development-only and depends on the seeded demo user IDs. It lives in `Back-End/src/dev/mockAuth.ts` and `Front-End/src/dev/mockAuth.ts`, and the local-only SQL (demo users, assignments, sample definitions) in `Back-End/database/local/`. Disable both bypass flags outside local development.
- Socket.IO connections use the same access token, and clients only receive events for uploads they can access.

### Roles and pages

| Role | Pages |
|---|---|
| `user` | **My Files** (the definitions an admin granted, with their published columns and rules), **Upload File**, **Upload History** and details (results, issues report, delivery download, retry), **Lookups** (read only) and a personal dashboard |
| `admin` | Everything above for all uploads, plus the **Admin Dashboard**, **User Management** (create, edit, unlock and delete users; grant definition access), **File Definitions** (the workspace, versions and **Dry run against a recent upload** in the Rules step), editable **Lookups**, **Audit Logs**, **Monitoring** (queue depth, dead-letter counts and recent throughput) and **Compliance** (a validation summary by definition for a chosen period, exportable as CSV) |

## Testing

CI (GitHub Actions) runs zero-warning lint, type checks, unit tests and builds for all three components, audits production dependencies (high and critical advisories fail the build; Dependabot proposes updates weekly), verifies the generated TypeScript contracts are current,
and compiles the Bicep templates. The suites below that need the running stack are manual acceptance gates to run before a release.

- **Unit tests:** run `npm test` in `Back-End` and `Front-End`, and `uv run pytest` in `Validation-Service`.
- **Database functional tests** (`Back-End/tests/*.integration.test.ts`) run against a disposable SQL Server database. They are skipped unless `TEST_DB_CONNECTION_STRING` is set. Create the database (for example `FileValidationPlatform_Test`), apply every script in `Back-End/database` plus `Back-End/database/local/seed_local_users.sql`, and run, for example: `$env:TEST_DB_CONNECTION_STRING='Server=(localdb)\MSSQLLocalDB;Database=FileValidationPlatform_Test;Integrated Security=true'; npm test`. Never point this at a database containing real data; the tests create and delete records.
- **UI tests** (Playwright, `Front-End/e2e`) drive the running app. Start it with `.\start.ps1` using the seeded mock-login demo (both bypass flags enabled), then run `npm run test:e2e` in `Front-End`. They use the installed Microsoft Edge by default; set `E2E_BROWSER_CHANNEL=chromium` after `npx playwright install chromium` to use Playwright's browser. They create and then delete their own definition and uploads.
- **Sample files** ([samples/](samples/README.md)) cover every upload and definition scenario: delimiters, encodings, one-table and per-sheet definitions (with used and ignored sheets), every rule type and severity, example-file proposals, rejected and corrupt files, and very large files. `samples/definitions/sample_definitions.sql` creates the matching definitions. The Python golden suite compares every upload fixture with a reviewed snapshot; run it with `uv run pytest tests/golden -q` in `Validation-Service` (`UPDATE_GOLDEN=1` regenerates the snapshot after an intended change). With the local stack running, `npm run test:e2e:samples` in `Front-End` sends every sample through the UI/API and checks outcomes, counts, reports, and delivery. Files over 10 MB are git-ignored; regenerate them with `python samples\tools\generate_samples.py`.

## Azure deployment

The Bicep and `azd` deployment runbook, Entra prerequisites, cost drivers, validation checklist, and teardown cautions are in [docs/deployment.md](docs/deployment.md). Infrastructure has been validated with Bicep compilation and `azd provision --preview`, and a reference development environment has been deployed; provisioning in a new subscription happens only after an owner explicitly approves it. See the deployment guide for the status and what has not been accepted yet.

## Production notes

This is a PoC; the items to close before production are listed in the [PoC handover](docs/poc-handover.md#close-before-production-or-real-customer-data) and the [backlog](TODO.md). Use real authentication, Azure Service Bus for validation/delivery messages, and Azure Blob Storage (preferably with managed identity via `AZURE_STORAGE_ACCOUNT_URL`). The Python worker consumes validation requests and publishes versioned validation events; the Node API consumes those events and schedules delivery retries through Service Bus. Queue depths and dead-letter counts are shown when the Service Bus admin API supports them; the local emulator reports these metrics as unavailable. Set `METRICS_TOKEN` to expose `/metrics`. Do not commit `.env` files, uploaded files, or customer data.
