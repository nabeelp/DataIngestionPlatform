# Implementation plan: Python + Polars data quality engine

_Plan date: 2026-10-02. Audience: a coding agent (and reviewers) implementing the changes recommended in [data-quality-review.md](./data-quality-review.md), [rule-execution-performance.md](./rule-execution-performance.md) and [greenfield-data-quality-engine.md](./greenfield-data-quality-engine.md)._

## 1. Goal

Replace the Node.js validation engine with a **Python + Polars validation service** behind **Azure Service Bus**, and implement the review's Phase 1–3 improvements:

- **Phase 1:** correctness fixes.
- **Phase 2:** JSON rule settings, new rule types and column settings.
- **Phase 3:** assurance for custom rules.

The Node.js API and React UI stay, but are adapted. The full solution becomes deployable to Azure with `azd`.

**Success means:**

- Every check in the review's findings A1–A10 behaves as specified in §6.
- The performance budgets in §9 are met.
- The equivalence suite in WP8 passes.
- The old Node engine, BullMQ, Redis and QuickJS are removed.
- `.\start.ps1` runs the whole stack locally.
- `azd up` deploys it to Azure.

## 2. Decisions (agreed with the product owner)

| # | Decision |
|---|---|
| D1 | **New Python + Polars worker**; the Node API and React UI are kept. |
| D2 | **Azure Service Bus** for all messaging, with the **Service Bus emulator** for local development. BullMQ and Redis are **removed**, including for delivery and retries. The API uses an in-memory cache. |
| D3 | The worker **writes results directly to SQL Server** and **publishes progress and completion events** to a Service Bus topic. Node consumes those events to push WebSocket updates and start delivery. |
| D4 | Natural Language rules generate **SQL** (a row predicate or a query), checked against an **allow-list** and run by Polars. **The TypeScript/QuickJS runtime is removed.** |
| D5 | The Python package provides both the **Service Bus worker** and an **internal FastAPI service**. Node calls the service during rule authoring and publishing (compile and validate rules, run examples, dry run, analyse example files). |
| D6 | Scope is the review's **Phases 1–3**. **No** per-rule tolerances or partial delivery: an upload still passes or fails as a whole. |
| D7 | **Hard cutover**: the Node engine is deleted once the Python worker passes the equivalence suite (WP8). |
| D8 | **Clean slate**: existing rules, published versions and uploads are **not** migrated. Database scripts may be rewritten. |
| D9 | Uploads always land in **Azure Blob Storage** (Azurite locally); the worker reads from there. SharePoint and desktop remain **delivery targets only**. The `TempLocalPath` shortcut is removed. |
| D10 | **Azure deployment of the full solution** with azd and Bicep: API, frontend, Python service and worker, Azure SQL, Service Bus, Storage, Key Vault, ACR, monitoring and managed identities. |

### Defaults chosen by the planner

These were confirmed by the product owner (see §12).

- **A1. Python and tooling:** Python **3.12**, `uv`, `ruff`, `mypy --strict` (on `src/`) and `pytest`. Package name `dq_engine`, in the folder `Validation-Service/`, next to `Back-End/` and `Front-End/`.
- **A2. SQL driver:** **mssql-python** with Microsoft Entra auth. Fall back to `pyodbc` + ODBC Driver 18 if a required feature is missing.
- **A3. Single source of truth for contracts:** JSON Schema files in `contracts/` at the repository root. Python Pydantic models are checked against them in tests; TypeScript types are generated from them with `json-schema-to-typescript`.
- **A4. Socket.IO** stays. The API runs **one replica** in Azure for this phase, and the in-memory cache assumes it. Scaling out later needs Azure Web PubSub for Socket.IO (see §12).
- **A5. Internal service authentication:**
  - Azure: the Python service has **internal ingress only**, and Container Apps authentication accepts tokens only from the API's managed identity.
  - Local: a development key from `.env`, never committed.
- **A6. Lookup values are snapshotted into the published version**, so re-validating an upload is deterministic even after a lookup list changes.
- **A7. The worker writes a canonical Parquet copy** of each sheet or file (retained for 30 days) for dry runs and re-validation, plus a **full issues report** (CSV) for each upload.
- **A8. Frontend hosting:** Azure Static Web Apps (Standard). **Database schema** is applied by an azd `postprovision` hook using `sqlcmd` with Entra auth.

## 3. Target architecture

```
                         ┌──────────────── Azure Container Apps environment ────────────────┐
Browser ─► SWA (React) ─►│ api (Node/Express, Socket.IO, 1 replica)                           │
                         │   │  ├─ uploads ─► Blob "uploads"                                   │
                         │   │  ├─ sends ─► SB queue "validation-requests"                     │
                         │   │  ├─ consumes ◄─ SB topic "validation-events" / sub "api"        │
                         │   │  ├─ sends/consumes ─► SB queue "delivery-requests"              │
                         │   │  └─ HTTP (Entra) ─► rules-service (internal ingress)            │
                         │ rules-service (Python FastAPI: compile, validate, test, dry run,    │
                         │                analyse example)                                     │
                         │ validation-worker (Container Apps job, KEDA on "validation-requests")│
                         │   reads Blob ─► sniff ─► parse (Polars / fastexcel) ─► Parquet       │
                         │   ─► compiled rule plan ─► SQL results + issues report ─► events     │
                         └─────────────────────────────────────────────────────────────────────┘
      Azure SQL (Entra-only)   Service Bus (Standard)   Storage   Key Vault   ACR   Log Analytics + App Insights
```

The Python code is **one package with two entry points**: `dq-engine worker` (Service Bus consumer) and `dq-engine api` (FastAPI). Both use the same compiler and engine, so authoring checks and upload validation can never disagree.

## 4. Contracts (create first — WP0)

All schemas live in `contracts/`, are versioned (`"schemaVersion": 1`) and are covered by tests in both Python and TypeScript.

### 4.1 Definition contract — `contracts/definition-contract.schema.json`

```jsonc
{
  "schemaVersion": 1,
  "layout": "single" | "sheets",
  "ignoredSheets": ["Notes"],                 // case-insensitive; for "single", applies when reading workbooks
  "encoding": "auto" | "utf-8" | "utf-16" | "windows-1252" | "iso-8859-1",
  "tables": [{
    "sheet": null | "Orders",                 // null only for layout "single"
    "headerRow": null | 3,                    // 1-based; null = first non-blank row
    "allowExtraColumns": true,
    "minRows": null | 1, "maxRows": null | 1000000,
    "columns": [{
      "name": "Amount",
      "type": "string" | "integer" | "decimal" | "date" | "datetime" | "boolean",
      "mustExist": true,                      // header must be present
      "nullable": false,                      // empty values allowed?
      "format": null | "yyyy-MM-dd" | "dd/MM/yyyy" | "dd/MM/yyyy HH:mm",  // date/datetime text format(s); array allowed
      "decimalSeparator": ".", "thousandsSeparator": null | "," | "." | " ",
      "precision": null | 18, "scale": null | 2,
      "maxLength": null | 200,
      "unique": false
    }]
  }],
  "rules": [ /* RuleConfig[] — see 4.2; disabled rules are excluded from published versions */ ],
  "lookups": { "<lookupId>": { "name": "Countries", "values": ["ZA", "GB"] } }   // snapshot, filled on publish (A6)
}
```

### 4.2 Rule configuration — `contracts/rule-config.schema.json`

The fields common to every rule are `id`, `name`, `description`, `severity` (`"Error"` or `"Warning"`), `executionOrder`, `enabled` and `table` (a sheet name, or `null` in the single layout), plus `type` and `params`.

| `type` | `params` | Fails a row when… |
|---|---|---|
| `columnsPresent` | `columns[]` | (file-level) any listed header is missing |
| `required` | `columns[]` | a listed value is empty (one issue per cell) |
| `type` | `column, dataType, format?, decimalSeparator?, thousandsSeparator?` | a non-empty value does not parse as `dataType` |
| `enum` | `column, values[], caseSensitive=true, trim=true` | a non-empty value is not in `values` |
| `range` | `column, min?, max?, minInclusive=true, maxInclusive=true` | a non-empty value is not a number or is outside the bounds |
| `pattern` | `column, pattern, caseSensitive=true` | a non-empty value does not fully match. Regex is Rust `regex` syntax (linear time); check it at save |
| `length` | `column, min?, max?` | the character length of a non-empty value is outside the bounds |
| `unique` | `columns[]` (composite key) | the key is non-empty and seen before (first occurrence passes) |
| `lookup` | `column, lookupId, caseSensitive=true` | a non-empty value is not in the snapshotted lookup |
| `dateRange` | `column, min?, max?` (ISO date or `{ "relative": "P-1Y" }` from the **validation date**) | the date is outside the range |
| `conditionalRequired` | `columns[], when: { column, op: eq\|ne\|in\|empty\|notEmpty, value? \| values? }` | the condition holds and a listed column is empty |
| `compare` | `left, op: lt\|le\|eq\|ne\|ge\|gt, right, as: number\|date\|string` | both values parse and the comparison is false |
| `rowCount` | `min?, max?` | (file-level) the table's data row count is outside the bounds |
| `aggregate` | `column, fn: sum\|min\|max\|avg\|count\|countDistinct, min?, max?` | (file-level) the aggregate is outside the bounds |
| `reconcile` | `left: { table, column, fn }, right: { table, column, fn }, tolerance=0` | (file-level, can span sheets) `abs(left − right) > tolerance` |
| `naturalLanguage` | see 4.3 | the SQL fails the row, or the query returns failures |

**Semantics shared by all rule types:**

- "Empty" means `null`, or text that is empty after trimming.
- Rules other than `required` and `conditionalRequired` skip empty values.
- A rule that references a missing column produces **one configuration issue** and fails, rather than being skipped (A7).

### 4.3 Natural Language rules (D4)

```jsonc
{
  "type": "naturalLanguage",
  "params": {
    "request": "Discount must not exceed half the amount",
    "explanation": "Fails a row when Discount > 0.5 × Amount; empty values pass.",  // replaces pseudocode
    "mode": "row" | "query",
    "failWhen": "TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5",   // mode "row": boolean SQL expression
    "query": null,          // mode "query": one SELECT over the registered table names (see below)
    "message": "Discount exceeds half of the amount",                                  // issue text for failing rows
    "columns": { "Orders": ["Amount", "Discount"] },                                   // every column read, by table
    "examples": [{ "table": "Orders", "values": { "Amount": "100", "Discount": "60" }, "expectedValid": false, "source": "model" | "admin" }],
    "provenance": { "model": "gpt-5.3-codex", "responseId": "resp_…", "promptSha256": "…", "createdAt": "…" }
  }
}
```

- **Row mode:** `failWhen` is compiled to a Polars expression with `pl.sql_expr`. The table is the rule's `table`, or the single table.
- **Query mode** handles checks across rows, files and sheets.
  - Run `query` in a `pl.SQLContext` in which **only** the definition's tables are registered, as `t_<n>` (with a mapping from sheet names), each with a `__row` column.
  - The query must return either rows with `__row` (and optionally `table`, `column` and `message`) for row-level failures, or a single row with a `message` column for a file-level failure.
- **Allow-list,** enforced in Python with `sqlglot`. Parse and walk the syntax tree; reject anything not on the list:
  - **Statements:** a single `SELECT` (CTEs and subqueries over registered tables are allowed in query mode only).
  - **Expressions:** column references (declared in `columns`), literals, arithmetic, comparisons, `AND/OR/NOT`, `CASE`, `IN (list)`, `BETWEEN`, `IS [NOT] NULL`, `CAST/TRY_CAST`, `LIKE`, `GROUP BY/HAVING`, `JOIN` between registered tables, and window functions (`ROW_NUMBER`, `COUNT`, `SUM`, `MIN`, `MAX`, `LAG`, `LEAD` with `OVER`).
  - **Functions:** an explicit list (for example `lower, upper, trim, length, substr, starts_with, ends_with, regexp_like, coalesce, nullif, abs, round, floor, ceil, date_part, strptime` and the aggregates). Each must be **verified to work in Polars SQL by a test**.
  - **Forbidden:** table functions such as `read_csv`, `read_parquet` and `read_json` (Polars SQL provides these), DDL/DML, `SET`, `PRAGMA`, unknown identifiers, `now()`/`current_date`/`random()`.
  - **Validation date:** offered as the literal `:validation_date`, substituted at compile time.
- **Limits:**
  - At most 4 KB of SQL and at most 20 columns.
  - At run time, each query runs under a wall-clock limit (default 30 s) by running it in a child process or thread pool with a timeout, and fails the rule if exceeded.
  - Polars' streaming engine bounds memory.

### 4.4 Messages — `contracts/messages/*.schema.json`

| Entity | Body | Settings |
|---|---|---|
| Queue `validation-requests` | `{ schemaVersion, uploadId, definitionVersionId, blob: { container, name }, fileType, requestedAt, correlationId }` | lock 5 min (renewed automatically by the worker), max delivery 3, dead-lettering on |
| Topic `validation-events`, subscription `api` | `{ schemaVersion, uploadId, type: "progress" \| "completed" \| "failed", stage: "download" \| "sniff" \| "parse" \| "rules" \| "persist", percent, summary?: { status, passed, failed, warnings, rowCount }, error? }` | duplicate detection on |
| Queue `delivery-requests` | `{ schemaVersion, uploadId, attempt }` | Node is the producer and consumer; retries use **scheduled messages** with exponential backoff; max 5 attempts, then dead-letter |

### 4.5 Results

Use the existing tables, simplified (WP2).

- **Per check:** `Status` ∈ `PASSED | WARNING | FAILED | ERROR`, where `ERROR` is a configuration or runtime error and fails the upload. Also store `IssueCount`, `Issues` (JSON, **up to 100** `{ sheet, row, column, value, message }`), `ElapsedMs` and `Sheet`.
- **Per upload:** `ReportBlobName` (full issues CSV), `ParquetPrefix`, `FileSha256`, `DetectedEncoding`, `EngineVersion` and `RowCount`.

## 5. Repository layout after the change

```
contracts/                      JSON Schemas (+ README) — single source of truth
Validation-Service/             NEW Python package (uv project)
  pyproject.toml, uv.lock, Dockerfile, README.md
  src/dq_engine/
    contracts/   pydantic models mirroring contracts/*.json
    io/          blob.py, sniff.py (signature, encoding, delimiter), csv_reader.py, excel_reader.py, parquet.py
    rules/       base.py (plugin interface), builtin/*.py (one module per rule type), naturallanguage.py, sqlguard.py
    engine/      compiler.py (contract → one LazyFrame plan), runner.py, results.py, rownumbers.py
    analyze/     example_analyzer.py (ported from Back-End ExampleFileAnalyzer)
    persist/     sql.py (results, upload status), reports.py (issues CSV)
    messaging/   servicebus.py (consumer, events publisher)
    api/         app.py (FastAPI), auth.py
    cli.py       dq-engine {worker|api|validate|bench}
  tests/  unit/, golden/, bench/
Back-End/  (Node) — engine, queue and Redis code removed; Service Bus, Blob and rules-service client added
Front-End/ (React) — rule editor, column settings, NL drawer, upload details updated
infra/     NEW Bicep modules + main.bicep;  azure.yaml at root
docker-compose.yml  NEW (SQL Server, Azurite, Service Bus emulator)
```

## 6. Required behaviour (from the review findings)

The agent must cover **each** item with a test.

| Review ID | Required behaviour |
|---|---|
| A1 | A table with columns that must exist reports `Required column "X" not found` when the sheet or file is **empty or has no header row**. A missing sheet table reports `Required sheet "X" not found`. |
| A2 | `minRows`/`maxRows` per table. A header-only file passes unless `minRows ≥ 1`. The default `minRows` for new tables in the UI is 1. |
| A3 | Duplicate headers (case-insensitive, after trimming) and empty headers are **structural errors** that fail the upload, with the column positions. |
| A4 | Rows with too many or too few fields are **structural errors** with the line number, expected and actual field counts. Valid rows are still evaluated. |
| A5 | Dates are strict: real calendar dates only, matched against the column `format`(s). With no format, accept ISO 8601 only. Excel date cells are accepted whatever their display format. |
| A6 | Decimals reject `Infinity`/`NaN`/overflow and honour `decimalSeparator`/`thousandsSeparator`, `precision` and `scale`. |
| A7 | There is no `SKIPPED` status. Unmatched checks, rule configuration errors and runtime failures are `ERROR` and fail the upload. |
| A8 | Publishing (`/v1/contracts/validate`) checks every rule's tables and columns against the contract for **both** layouts, compiles every rule, and runs every Natural Language rule's examples. |
| A9 | File-level failures (`rowCount`, `aggregate`, `reconcile`, query-mode file messages) have **no row number**. |
| A10 | Up to 100 issues are stored per check, plus the total count; the **full** list goes to the issues report CSV. |
| Determinism | No wall-clock, random or network access in rules. A **validation date** (UTC date of the upload) is stored with the upload and used for relative dates. Re-validating the same upload gives identical results. |
| Unrecoverable files | Corrupt, password-protected or unsupported files, or files whose content signature doesn't match the extension, fail **without retry**: the message is completed and the upload marked failed with a clear reason. Only transient errors are left for Service Bus redelivery. |
| Row numbers | **CSV:** the physical line number. Use a fast path when no field contains a newline. Otherwise compute a line map. **Excel:** the worksheet row number (1-based, including rows above the header). Test both, including blank lines, quoted fields spanning lines, and leading title rows. |

## 7. Work packages

Run them in order unless marked parallel. Each one ends with its tests passing and its documentation updated. Commit per work package with a message describing the change.

### WP0 — Baseline, contracts and golden files

1. Before changing any engine code, run the **current Node engine** over every file in `samples/` with the sample definitions (`samples/definitions/`). Save the per-check outputs (`status`, `errorCount`, the first 100 issues) as golden JSON under `Validation-Service/tests/golden/node-baseline/`. Add a small Node script in `samples/tools/` to do this.
2. Write `contracts/*.schema.json` (§4) and `contracts/README.md`. Generate TypeScript types into `Back-End/src/contracts/` and `Front-End/src/contracts/`, with an `npm run contracts:gen` script in each.
3. Write `Validation-Service/tests/golden/INTENTIONAL_DIFFERENCES.md`, listing where the new semantics deliberately differ from the baseline (from §6), each with the sample file and check affected.
4. Port the benchmark harness from the research (1M-row generator plus the 18-rule set) into `Validation-Service/tests/bench/`, expressed in the new rule format.

**Acceptance:** schemas validate the examples in §4; type generation is wired into `npm run build`; golden files are committed.

### WP1 — Local infrastructure (can run in parallel with WP0)

1. Add `docker-compose.yml` with:
   - SQL Server 2022 (Developer) with a health check.
   - Azurite.
   - The **Azure Service Bus emulator**, which needs its own SQL Server container (or the shared one) and a `servicebus-emulator/Config.json` declaring the entities in §4.4.
2. Update `.env.example` files: remove `REDIS_*`, `STORAGE_PROVIDER` (uploads always go to Blob), `UPLOAD_TEMP_DIR` (where it's only used for validation) and `RULE_SANDBOX_*`. Add the `SERVICEBUS_*`, `AZURE_STORAGE_*` (Azurite), `RULES_SERVICE_URL` and `RULES_SERVICE_DEV_KEY` settings.
3. Update the root `start.ps1`:
   - Start the compose stack and wait for health.
   - Apply the database scripts.
   - Start the Python API and worker (`uv run dq-engine api` / `worker`), the Node API and the frontend.
   - Keep the existing process-tree cleanup.
4. Document prerequisites in the README: Docker Desktop, `uv`, Node 24.

**Acceptance:** on a clean machine, `.\start.ps1` brings everything up, and `/health` on both APIs returns 200.

### WP2 — Database schema (clean slate)

1. Rewrite `Back-End/database/*.sql` as idempotent scripts:
   - `Rules`: `Id, FileDefinitionId, Config NVARCHAR(MAX) (JSON, CHECK ISJSON), ConfigSchemaVersion, IsEnabled, CreatedBy, CreatedAt, UpdatedAt`. Name, type, severity, order and table are **persisted computed columns** from the JSON, for listing and indexing.
   - `FileDefinitionVersions.Contract`: the full snapshot from §4.1.
   - `FileDefinitions` draft: the contract settings (tables, columns, settings) as JSON.
   - `Uploads`: remove `TempLocalPath` and `ValidationJobId`. Add `BlobContainer`, `BlobName`, `FileSha256`, `DetectedEncoding`, `ValidationDate`, `EngineVersion`, `ReportBlobName` and `ParquetPrefix`.
   - `ValidationRuleDetails`: the columns from §4.5.
   - Drop `ProcessingJobs`, `WorkerInstances`, `DeadLetterJobs` and `ValidationErrorBatches`.
2. Add `Back-End/database/apply.ps1`, used by `start.ps1` and the azd hook. It applies the scripts in a fixed order using `sqlcmd`, with SQL auth locally and Entra in Azure.
3. Update the Node models to match.

**Acceptance:** the scripts apply twice without error to an empty database; Node model tests pass.

### WP3 — Python engine core

1. **Sniffing** (`io/sniff.py`):
   - Check the content signature against the extension (ZIP for xlsx/xlsm, OLE CFB for xls, text for csv/tsv/txt).
   - Detect encoding: BOM, then a UTF-8 check, then the definition's `encoding`.
   - Detect the delimiter with a header-consistency check over the first 64 KB.
   - Transcode to UTF-8 as a stream when needed.
2. **CSV reader:** read with Polars as strings (`infer_schema=False`), keeping empty strings distinct from missing values where possible.
   - **Spike first (time-box: half a day).** Decide how to detect ragged rows and get exact line numbers. Compare a Polars strict read plus a targeted re-scan on error, against `pyarrow.csv` with `invalid_row_handler`. Choose the faster one that gives **exact** line numbers, and record the result in `Validation-Service/README.md`.
   - Budget: structural checks may add at most 50% to the time Polars takes to load the file.
3. **Excel reader:** use `fastexcel` (calamine) for `.xlsx/.xlsm/.xls/.xlsb`.
   - Honour `headerRow`, `ignoredSheets` and hidden sheets (skip hidden sheets unless a table names them).
   - Keep worksheet row numbers.
   - Convert date cells to ISO strings; convert text cells to strings.
   - Reject password-protected files as unrecoverable.
4. **Rule plugin interface** (`rules/base.py`):
   - `validate_params()`.
   - `columns()`.
   - `row_failure_expr(ctx) -> pl.Expr | None` for row-level rules.
   - `file_check(ctx) -> FileResult | None` for file-level rules.
   - `describe() -> str`, the plain-English explanation shown in the UI.

   Implement every type in §4.2 as one module each. Shared parsing goes through a `ColumnCache` in `ctx` (for example a parsed `Amount` decimal), so it happens once.
5. **Compiler and runner:** build **one** `LazyFrame` per table that adds a boolean failure column per rule plus `__row`.
   - Collect counts and the first 100 failing rows per rule in one `collect()` (use the streaming engine when the file is above a size threshold).
   - Compute uniqueness with `is_first_distinct` on the key (or `struct(...)` for composite keys).
   - Compute file-level checks and reconciliation across sheets afterwards.
   - Produce a `ValidationOutcome` (per-check results, structural issues, row counts).
6. **Column checks** (`mustExist`, `nullable`, `type` + `format`, `maxLength`, `precision/scale`, `unique`, `allowExtraColumns`): run as an automatic "Table "<sheet>" columns" check per table, as today.
7. **Outputs:** Parquet per table (`zstd`), and an issues CSV streamed from the failure columns (every failing row × rule, capped at 1,000,000 lines with a note).
8. **CLI:**
   - `dq-engine validate <file> --contract contract.json [--json]` for local runs and golden tests.
   - `dq-engine bench`.

**Tests:**

- Unit tests per rule type, covering empty, edge, case-sensitivity and format cases.
- One test per §6 row.
- Golden tests against `samples/`, comparing with WP0's baseline after applying `INTENTIONAL_DIFFERENCES.md`.
- Hypothesis property tests for the type parsers.

**Acceptance:** all tests pass; the benchmarks meet §9.

### WP4 — Natural Language rules in SQL

1. `rules/sqlguard.py`: parse with `sqlglot` and enforce the allow-list in §4.3, with clear error messages (for example "function `read_csv` is not allowed").
   - Keep a table-driven test listing every allowed function and checking it **actually runs in Polars SQL**.
   - Add a deny-list test for table functions, DDL/DML, `now()`, `random()`, unknown columns and unregistered tables.
2. `rules/naturallanguage.py`:
   - Row mode compiles to an expression through `pl.sql_expr`.
   - Query mode runs a `pl.SQLContext` over the registered tables and maps its output to row-level or file-level issues.
   - Enforce the wall-clock limit.
3. An examples runner: build a small DataFrame per table from the examples, run the rule, and compare with `expectedValid`. Return the mismatches.

**Acceptance:** the allow-list rejects every deny-list case; the cross-sheet example (totals across two sheets) and the duplicate-detection example work in query mode.

### WP5 — Python service: API and worker

1. **FastAPI** (`api/app.py`), with internal authentication (A5). These endpoints replace `assertPublishable`, the example checks in `NaturalLanguageRule.service.ts` and `ExampleFileAnalyzer.ts`:

   | Endpoint | Purpose |
   |---|---|
   | `GET /healthz` | Liveness |
   | `GET /v1/schemas/{name}` | Serves the `contracts/` schemas |
   | `POST /v1/rules/validate` | `{ contract, rule }` → `{ ok, errors[], normalizedRule, explanation }` |
   | `POST /v1/rules/test` | `{ contract, rule, examples[] }` → per-example results |
   | `POST /v1/contracts/validate` | `{ contract }` → publish errors (A8) |
   | `POST /v1/dry-run` | `{ contract, uploadId? \| blob? }` → results summary + first issues. Uses the upload's Parquet when present; capped at 60 s |
   | `POST /v1/examples/analyze` | Multipart or blob reference → proposed tables and columns |

2. **Worker** (`messaging/servicebus.py`, `cli worker`), for each message:
   1. Load the upload and pinned version from SQL.
   2. Download the blob to local temp storage (streamed).
   3. Sniff, parse, write Parquet, and run the plan.
   4. Write the results to SQL in **one transaction**, then publish `completed`.
   5. Complete the message.

   Also:
   - Publish `progress` at each stage (at most once a second).
   - On an unrecoverable error: mark the upload failed, publish `failed`, and complete the message. On a transient error: abandon the message so it is redelivered.
   - Make the worker **idempotent** per `uploadId`: delete earlier results for the upload in the same transaction.
   - Container Apps job mode: process up to `N` messages (default 1), then exit.
   - Local mode: a long-running loop.
3. Observability: OpenTelemetry (Azure Monitor exporter) with spans per stage, a metric for rows per second, and per-rule `ElapsedMs`. Logs must **never** contain cell values; log only IDs and counts.

**Acceptance:**

- Integration tests run against the compose stack (emulator, Azurite, SQL): an upload message produces the expected SQL rows, events, Parquet and report blob.
- Redelivering the same message produces the same final state.

### WP6 — Node API changes

1. **Uploads:**
   - Stream to Blob (`uploads/{uploadId}/{safeName}`) with `@azure/storage-blob` (connection string for Azurite locally, managed identity in Azure).
   - Compute SHA-256 while streaming.
   - Create the upload record pinned to the active version, set `ValidationDate`, and send the `validation-requests` message.
   - Remove all `TempLocalPath` logic.
2. Add a **Service Bus module** (`@azure/service-bus`): a sender for validation and delivery requests, a receiver for the `validation-events/api` subscription that maps events to Socket.IO `emitUploadEvent` and starts delivery on `completed`, and a delivery processor with scheduled-message retries.
3. **Delete:**
   - `services/validation/*` (`ValidationEngine`, `NaturalLanguageRuleRuntime`, `FileRecordReader`, `ExampleFileAnalyzer`, `DefinitionContract` checks that moved to Python; keep only the TS types and diff helpers that are still needed).
   - `ValidationWorker.service.ts`, `Queue.service.ts`, `Cache.service.ts` (Redis; replace with a small in-memory TTL cache).
   - The packages `bullmq`, `ioredis`, `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`, `csv-parse`, and `typescript` as a runtime dependency.
   - `xlsx`, if it is no longer used. Check `TemplateStorage` first; if it still needs `xlsx`, upgrade to SheetJS 0.20.x from the SheetJS CDN.
4. **Rules API:** CRUD accepts and returns `RuleConfig` JSON, validated by `/v1/rules/validate` before saving. Publishing calls `/v1/contracts/validate` and snapshots the lookups (A6). Keep the access checks in `Rule.service.ts`.
5. **Natural Language authoring** (`NaturalLanguageRule.service.ts`):
   - Change the prompt and output schema so the model returns either a **built-in `RuleConfig`** (preferred) or a **`naturalLanguage` rule with SQL**, plus examples.
   - Run checks through `/v1/rules/validate` and `/v1/rules/test`, keeping the existing one-correction loop and progress streaming.
   - Store the provenance.
   - Keep the instruction that tells the model to treat the request as data, and say explicitly that the SQL must only use the declared columns and the allowed functions (list them in the prompt).
6. **Example analysis:** proxy to `/v1/examples/analyze`.
7. **Monitoring page API:** report Service Bus queue depths and dead-letter counts (admin client in Azure; return "unavailable" when the emulator doesn't support it), plus recent upload throughput from SQL.
8. **Issues report download:** `GET /api/uploads/:id/report` streams the report blob after the existing access check.

**Acceptance:** Jest tests updated and passing; `npm run lint`, `npm run typecheck` and `npm run build` succeed; no imports remain from deleted modules.

### WP7 — Frontend changes

1. **Rule editor** (`Rules.tsx`): a form per rule type, driven by the generated types (§4.2), with inline checks from `/v1/rules/validate`. Split it into components; the file is 60 KB today.
2. **Natural Language drawer:**
   - Show the SQL (read-only, highlighted), the explanation, the provenance and the examples table.
   - Admins can **add or edit examples** and click **Run examples**.
   - Add a **Dry run** button against a chosen recent upload or the definition's example file.
   - Remove the TypeScript and pseudocode panes.
3. **Columns editor** (`ColumnsEditor.tsx`, `FileDefinitions.tsx`): the column settings (`mustExist`, `nullable`, `format`, separators, `precision/scale`, `maxLength`, `unique`) and table settings (`headerRow`, `allowExtraColumns`, `minRows/maxRows`, `ignoredSheets`, `encoding`).
4. **Upload details** (`UploadDetails.tsx`): group checks by sheet; show structural issues first; show `ERROR` checks distinctly; add a **Download full issues report** link; show the file-level issues without a row number.
5. Update the Vitest unit tests and Playwright e2e tests (`e2e/natural-language-rule.e2e.ts`, `definition-versions.e2e.ts`, `example-definition.e2e.ts`).

**Acceptance:** `npm run lint`, `npm test`, `npm run build` and the e2e suite pass against the local stack.

### WP8 — Equivalence and cutover (D7)

1. Run the golden suite: every `samples/` file through the Python engine compared with the WP0 baseline, minus the intentional differences. **It must pass with zero unexplained differences.**
2. Run the end-to-end flow on the local stack: upload each sample through the UI and API, and check status, counts, the issues shown, the report download and delivery.
3. Delete any remaining code paths of the Node engine, and confirm with a search for `ValidationEngine`, `QuickJS`, `bullmq` and `TempLocalPath`.
4. Performance gate: §9 budgets on the benchmark files in CI (a relaxed threshold on CI runners; the strict figures are recorded in the README from a 4-vCPU run).

### WP9 — Azure deployment (D10)

> Ask the product owner before running `azd provision` or `azd up`: it creates paid resources. Never commit secrets.

1. Add `azure.yaml` and `infra/main.bicep` with modules for:
   - **Monitoring:** Log Analytics and Application Insights.
   - **ACR** (Basic).
   - **Container Apps environment** (workload profiles, Consumption).
   - **Container App `api`:** Node, external ingress, `minReplicas = maxReplicas = 1` (A4).
   - **Container App `rules-service`:** Python, **internal** ingress, Entra auth allowing only the API's identity.
   - **Container Apps job `validation-worker`:** event-driven, KEDA `azure-servicebus` scaler on `validation-requests` **authenticated with managed identity**, `parallelism` 5, `replicaTimeout` 30 min, 2 vCPU / 4 GiB by default (parameter).
   - **Static Web App:** SPA fallback; build-time `VITE_API_URL`.
   - **Azure SQL:** serverless General Purpose with auto-pause, **Entra-only authentication**.
   - **Service Bus Standard:** the §4.4 entities.
   - **Storage:** containers `uploads`, `reports`, `staging` (Parquet) and `templates`; a lifecycle policy that deletes `staging` after 30 days; shared-key access **disabled**.
   - **Key Vault:** RBAC mode, holding the JWT secret and the Entra SSO client secret, referenced as Container Apps secrets.
2. **Identities:** one user-assigned managed identity each for the API and the worker/service, with least-privilege roles:

   | Identity | Roles |
   |---|---|
   | API | Storage Blob Data Contributor on `uploads` and `reports` (read), Service Bus Data Sender and Receiver, Key Vault Secrets User, AcrPull, **Azure AI User** on the existing Foundry project (parameter: resource ID) |
   | Worker / service | Storage Blob Data Reader on `uploads`, Contributor on `reports` and `staging`, Service Bus Data Receiver (requests) and Sender (events), AcrPull |
   | Both | SQL contained users with `db_datareader`/`db_datawriter` (created by the hook) |

3. **Hooks:**
   - `postprovision`: run `Back-End/database/apply.ps1` with Entra auth, and create the contained users for the managed identities.
   - `predeploy`: build the images.
4. **CI** (GitHub Actions): lint, type-check, test and build for all three projects on each pull request. A manual `azd deploy` workflow uses OIDC federated credentials, with no stored secrets.
5. **Documentation:** in `docs/deployment.md`, cover the prerequisites, required permissions (Owner or User Access Administrator for role assignments), parameters, a cost estimate (main drivers: SQL vCore-seconds, Container Apps vCPU-seconds, Service Bus Standard base fee, Log Analytics ingestion), the checks to run after deployment, and how to tear down.

**Acceptance:**

- `azd provision` and `azd deploy` succeed in a test subscription.
- A sample upload passes end to end in Azure.
- No connection strings or keys exist except the Key Vault secrets.

### WP10 — Documentation

- Update `README.md` (architecture, local setup, rule types, Natural Language SQL rules, security notes) and `TODO.md` (remove items that are done; add Web PubSub for scaling out and per-rule tolerances or partial delivery as future work).
- Update `docs/data-quality-review.md` with a status note pointing to this plan.

## 8. Coding conventions for the agent

- **Match the existing style:** TypeScript strict, ESLint, Jest (Back-End), Vitest and Playwright (Front-End).
- **Python:** `ruff` (lint and format), `mypy --strict` on `src/`, `pytest`, Pydantic v2 models, no global mutable state, and type hints throughout.
- **Keep changes surgical** inside each work package. Don't refactor unrelated code.
- **Never log cell values, file contents, tokens or connection strings.** Treat uploaded data as customer data.
- **Generated or user-supplied SQL only ever runs through `sqlguard`.** Never build SQL by joining strings for declarative rules; build Polars expressions directly.
- **Keep the root `start.ps1` working** after every work package.
- **Ask before** provisioning Azure resources, adding a paid dependency, or making a design change that contradicts §2.

## 9. Performance budgets

Measured on 4 vCPU / 8 GiB, excluding blob download, using `tests/bench`.

| Workload | Budget |
|---|---|
| CSV, 1M rows (~104 MB), the 18-rule set | ≤ 1.5 s engine time; peak RSS ≤ 1.5 GB |
| `.xlsx`, 300k rows (~52 MB), same rules | ≤ 3.0 s; peak RSS ≤ 1.5 GB |
| Natural Language row rule over 1M rows | ≤ 100 ms extra |
| End to end (upload complete → `completed` event), 10 MB CSV, warm worker | ≤ 3 s |
| Authoring checks (`/v1/rules/validate` + `/v1/rules/test`) | ≤ 300 ms p95 |

## 10. Test strategy summary

| Layer | What to test |
|---|---|
| Python unit | Each rule type, parsers, `sqlguard` allow and deny lists, row numbers, sniffing, every row in §6 |
| Python golden | `samples/` against the Node baseline, with intentional differences documented |
| Python integration | Worker against the compose stack: SQL rows, events, blobs, idempotency, unrecoverable versus transient errors |
| Node | Rules API with a mocked rules service, the Service Bus event mapping, delivery retries, access control (keep the existing authorization tests) |
| Frontend | Rule forms, NL drawer examples and dry run, upload details; e2e on the local stack |
| Performance | `dq-engine bench` against the §9 budgets |
| Security | `sqlguard` fuzz cases; no secrets in the repository (enable secret scanning); the internal service rejects calls without a token |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Polars SQL coverage differs from what the model writes | Put the allow-list (and its tests) in the prompt; the correction loop handles failures; query mode supports CTEs and joins |
| Line-number exactness in CSV files with quoted fields spanning lines | Spike in WP3; a dedicated test file |
| Service Bus emulator limits (no management operations, fixed entities) | Entities declared in `Config.json`; the Monitoring page handles "unavailable" |
| fastexcel and calamine behaviour with odd workbooks (merged cells, formulas, very wide sheets) | Use cached formula values; tests with `samples/04-file-handling`; cap sheets and columns |
| Single API replica (Socket.IO and in-memory cache) | Documented; Web PubSub for Socket.IO in `TODO.md` |
| Hard cutover with no migration | Accepted (D7, D8); the golden suite is the gate |

## 12. Planner defaults (confirmed by the product owner on 2026-10-02)

1. Python version and tooling [3.12, uv, ruff, mypy, pytest] (A1).
2. SQL driver [mssql-python, falling back to pyodbc] (A2).
3. API scale-out [one replica now; Web PubSub for Socket.IO later] (A4).
4. Internal authentication between the API and the Python service [Container Apps Entra auth with managed identity; a development key locally] (A5).
5. How long to keep Parquet and issues reports [Parquet 30 days; reports kept with the upload] (A7).
6. Frontend hosting [Static Web Apps Standard] (A8).
7. Azure region and naming convention for `azd` [parameters; default to the subscription's preferred region].
8. Who owns the Foundry resource, and whether the API identity can be granted **Azure AI User** on it [parameter plus documented manual step].
