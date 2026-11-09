# Validation Service

Python 3.12 service with three entry points sharing one package (`src/dq_engine/`):

| Command | Purpose |
|---|---|
| `uv run dq-engine api` | Internal FastAPI rules service (rule compile/test, contract validation, dry run, example analysis) |
| `uv run dq-engine worker` | Azure Service Bus validation worker (Polars engine, writes reports, Parquet and SQL results) |
| `uv run dq-engine validate <file> --contract <contract.json> [--json] [--output-dir <dir>]` | Validate one file locally; `--output-dir` writes a Zstandard Parquet file per table and a streamed issues CSV |
| `uv run dq-engine bench` | Run the CSV, XLSX and Natural Language performance workloads |

The container image (`Dockerfile`) starts `dq-engine api` by default; the worker is the same image run as an event-triggered Container Apps job.
See [the architecture](../docs/architecture.md) for where it fits and [natural-language-rules.md](../docs/natural-language-rules.md) for SQL rules.

## Package layout

| Module | Responsibility |
|---|---|
| `contracts/` | Pydantic models for the definition, rule and message contracts. The JSON Schemas in [`../contracts`](../contracts/README.md) are the source of truth |
| `io/` | Blob access and CSV/Excel/Parquet readers (encoding sniffing, sheet and table detection) |
| `rules/` | One module per rule type, the SQL guard (`sqlguard.py`) and example execution |
| `engine.py` | Orchestrates a validation run (`validate_file`, `validate_parsed`) and re-exports the public engine names |
| `results.py` | `CheckResult`, `ReportIssue`, `ValidationOutcome` and the per-check and report issue limits |
| `rule_registry.py` | Rule-type to module registry, rule/table matching and rule context creation |
| `rule_checks.py` | Rule compilation and the row, file-level, missing-target and reconcile checks |
| `structural_checks.py` | File structure, column-definition and table row-count checks |
| `query_runner.py` | Query-mode natural-language rules: isolated SQL execution with a timeout and result mapping |
| `issue_format.py` | Issue message and value formatting, check status and error checks |
| `report_output.py` | Writes the Parquet tables and the capped `issues.csv` report |
| `api/` | FastAPI app, authentication and request validation |
| `api/validation.py` | Rule, contract and example-test payload validation (public entry points) |
| `api/schema_errors.py` | JSON Schema and Pydantic error translation into authoring messages |
| `api/contract_checks.py` | Contract structure and rule-reference checks |
| `api/rule_compile.py` | Compiles a candidate rule against sample data to surface configuration errors |
| `messaging/` | Service Bus worker (validation requests in, events out) |
| `persist/` | SQL persistence of results (one idempotent transaction per upload) |
| `analyze/` | Example-file analysis that proposes tables, columns and suggested rules |
| `telemetry.py` | Azure Monitor OpenTelemetry setup with redaction |

## Rules API

`/healthz` is public. Every `/v1` route requires authentication, and `RULES_SERVICE_AUTH_MODE` must be set explicitly (there is no default; an unset or unknown value makes every `/v1` call fail with 503). Locally use `shared-key`: the `X-Rules-Service-Key` header must match `RULES_SERVICE_DEV_KEY`, and the root `start.ps1` sets this mode when it is not already configured. In Azure `RULES_SERVICE_AUTH_MODE=entra` makes the service accept only the API managed identity, whose principal
ID (`RULES_SERVICE_API_PRINCIPAL_ID`) Container Apps Easy Auth forwards (see [deployment](../docs/deployment.md)).
Keep the development key in `Back-End/.env`, which the root `start.ps1` loads for both processes.

| Route | Purpose |
|---|---|
| `GET /v1/schemas/{name}` | Return a shared contract schema |
| `POST /v1/rules/validate`, `/v1/rules/test` | Compile a candidate rule and run its examples |
| `POST /v1/contracts/validate` | Validate a publishable definition contract (every rule and example) |
| `POST /v1/dry-run` | Preview checks for an upload or blob (uses stored Parquet for upload IDs when available; 60-second limit) |
| `POST /v1/examples/analyze` | Propose tables, columns and candidate Enum/Range rules from an example blob |

Single-rule validation and example testing use the definition's tables, columns, layout and lookups but ignore the other draft rules, so a candidate can
be created or regenerated while another rule needs repair. Publication validation (`/v1/contracts/validate`) still validates every rule. Failures return
`ok: false` with `errors[]` containing a `path` and an actionable `message`; diagnostics never echo raw schema errors, SQL, requests or example values.

## Worker

The worker uses `SERVICEBUS_CONNECTION_STRING` with the local emulator, or `SERVICEBUS_NAMESPACE` and managed identity in Azure.
`WORKER_MODE=local` receives continuously; `WORKER_MODE=job` processes up to `WORKER_MAX_MESSAGES` (default 1) and exits when the queue is empty.
Successful SQL writes replace any earlier result rows for the same upload in one transaction, so redelivery is idempotent.

## Parsing decisions

- CSV structure is checked with PyArrow's invalid-row callback; Polars' strict reader pads short rows with nulls, which cannot be told apart from empty cells.
  Python's `csv.reader` rescans only a file that the callback reports as malformed, to give exact physical line numbers.
- Excel is read with `fastexcel` (calamine). Decimal `precision` is total digits and `scale` limits fractional digits.

## Performance

`uv run dq-engine bench` generates its inputs outside the timed interval, runs each file workload three times in its own process and reports the median
engine time and peak working set. Last measured on a local Windows development host (not the 4 vCPU / 8 GiB reference host; re-measure there before go-live):

| Workload | Rows | Median engine time | Peak working set | Budget |
|---|---:|---:|---:|---|
| CSV, 18 rules | 1,000,000 | 1.21 s | 1.14 GB | ≤ 1.5 s, ≤ 1.5 GiB |
| XLSX, 18 rules | 300,000 | 2.52 s | 0.65 GB | ≤ 3.0 s, ≤ 1.5 GiB |
| Natural Language row rule (extra) | 1,000,000 | +17 ms | in the CSV process | ≤ 100 ms |

## Telemetry

The API and worker initialise Azure Monitor OpenTelemetry before loading FastAPI or starting work. Default service names are `data-ingestion-rules` and
`data-ingestion-worker` (`OTEL_SERVICE_NAME` overrides). Without `APPLICATIONINSIGHTS_CONNECTION_STRING` telemetry is reported as disabled and local
operation continues. `APPLICATIONINSIGHTS_SAMPLING_RATIO` (0 to 1, default 1) controls trace sampling; metrics are unaffected. Processors remove URL/query,
SQL, GenAI payload and exception-message attributes before export, and only safe worker lifecycle summaries are logged. Shutdown flushes each signal with a
5-second timeout and bounds the whole phase to 10 seconds. `LOG_LEVEL` controls log forwarding (default `INFO`).

## Local emulators

Azurite runs with `--skipApiVersionCheck` so its pinned emulator accepts the API version sent by the installed Storage SDK (local Docker only). The Service Bus
emulator is pinned to `1.1.2` because `latest` (2.0.0) has a known `BufferQueue-1` initialization failure; its duplicate-detection window is capped at the
emulator's five-minute limit.

## Tests

- `uv run ruff check src tests`, `uv run mypy src` and `uv run pytest` (unit and contract tests).
- **Sample-corpus golden suite** (`tests/golden`): validates every upload sample in `samples/manifest.json` and compares status, failing/warning checks and row
  count with the reviewed snapshot `tests/golden/expected_outcomes.json`. After an intended behaviour change run `$env:UPDATE_GOLDEN='1'; uv run pytest tests/golden -q`
  and review the diff. Large samples that are not generated locally are skipped.
- **Worker integration test** (`tests/integration`) needs the local SQL Server, Azurite and Service Bus emulator with the schema applied. Enable it with
  `$env:RUN_DQ_INTEGRATION_TESTS = '1'` and run `uv run pytest tests/integration -q`; it publishes to the isolated `validation-events-wp5-test/worker-tests`
  entity and removes its own rows and blobs.
- `uv run python scripts/score_nl_eval.py <report.json>` scores a live natural-language evaluation report against the golden corpus (see the NL guide).
