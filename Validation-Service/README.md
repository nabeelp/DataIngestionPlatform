# Validation Service

The Python validation service provides the shared contracts in `src/dq_engine/contracts/`, the Polars
validation engine, an internal FastAPI authoring service, and the Azure Service Bus validation worker.

## CSV structural-check spike (WP3)

Before implementing the CSV reader, the two planned structural-check approaches were measured against a
deterministic, synthetic 1,000,000-row CSV (110,576,998 bytes; 12 columns). Timings below are medians of three
runs on the local Windows development host with Python 3.12, Polars 1.44.2, and PyArrow 25.0.1. These are
comparative spike results, not the strict §9 performance-gate measurement on a 4-vCPU/8-GiB host.

| Measurement | Result |
|---|---:|
| Polars strict CSV load, structurally valid input | 0.0693 s |
| PyArrow CSV load, structurally valid input | 0.0536 s |
| Python `csv.reader` full structural scan, valid input | 1.5931 s (23.0× Polars load) |
| Polars strict read until a ragged row at physical line 500,001 | 0.0783 s; `ComputeError` has no usable physical line |
| Targeted `csv.reader` re-scan of the malformed 110.6-MB file | 1.5814 s; reports physical line 500,001 exactly |
| PyArrow read with `invalid_row_handler` on the same malformed file | 0.2559 s; callback `InvalidRow.number` is `null` |
| Quoted multiline record line-map check | Correctly reports the following ragged record at physical line 5 |

**Initial spike decision:** use Polars' strict read as the normal path. Only after a strict parse error, re-scan with Python's
`csv.reader` to identify every ragged logical record and its exact starting physical line; use the resulting
structural findings to exclude malformed records while retaining valid rows for evaluation. Do not run a
standalone Python structural scan on valid input: its measured 1.5931 s cost is 23× the Polars load and would
violate the 50% overhead allowance. PyArrow's callback is faster on malformed input but does not provide a
physical line number, so it cannot satisfy A4 by itself.

**Final WP3 decision:** validation against Polars 1.44 showed its strict CSV reader accepts short rows
by padding missing fields with nulls; the accepted record could not reliably trigger the planned error-path
rescan or be distinguished from an explicitly empty cell. The owner approved a narrow WP3 deviation: PyArrow
now performs CSV structural parsing (with its invalid-row callback), the Python `csv.reader` exact-line rescan
runs only when the callback detects malformed records, and Polars remains responsible for all rule expressions.
This preserves blank cells and catches both short and long rows. The existing spike measured PyArrow's valid
CSV load faster than Polars on this host; the full engine benchmark is measured separately below.

## WP3 engine benchmark

The deterministic 18-rule, one-million-row CSV workload completed three consecutive runs in **0.8195, 0.9814,
and 0.6455 seconds** (median **0.8195 seconds**). The largest measured peak working set was **890,183,680 bytes**.
Each run met the 1.5-second and 1.5-GiB budgets on this Windows development host. This is not the prescribed
4-vCPU/8-GiB performance-gate host measurement. Reproduce with
`uv run dq-engine bench`; the command reports runtime, peak memory, rule count and whether the CSV budget passed.
The test workload returns expected validation failures; the benchmark exit status indicates budget compliance,
not data validity.

## WP4 Natural Language SQL

The SQL guard validates the AST with `sqlglot` before row predicates become Polars expressions or query-mode SQL
is run. Its table-driven test executes every allow-listed function in Polars SQL; the deny-list covers file
readers, DDL/DML, session commands, nondeterministic functions, undeclared columns and unregistered tables.
Examples are run independently: each example populates only its named table, while all other declared tables
are empty. This makes an example deterministic and avoids implicitly combining separate example records.

The `dq-engine bench` command also measures the incremental cost of one guarded Natural Language row predicate
over the same parsed 1,000,000-row frame as the 18-rule baseline. On the local Windows development host:

| Measurement | Result |
|---|---:|
| 18-rule CSV engine time | 0.8363 s |
| Peak working set during the benchmark | 1,131,642,880 bytes |
| Baseline rule evaluation median | 471.1756 ms |
| Evaluation median with one Natural Language row rule | 509.5585 ms |
| Incremental Natural Language row-rule cost | 38.3829 ms |
| §9 incremental budget | 100 ms |

The CSV and Natural Language row-rule budgets passed. As with the WP3 figures, these measurements are from the
development host, not the prescribed 4-vCPU/8-GiB performance-gate host.

Use `uv run dq-engine validate <file> --contract <contract.json> --json` for local validation. Add
`--output-dir <directory>` to write a Zstandard Parquet file per table and a streamed issues CSV.

## Python API and worker (WP5)

Run `uv run dq-engine api` from this directory to start the internal API on `RULES_SERVICE_HOST` and
`RULES_SERVICE_PORT` (defaults: `0.0.0.0:8000`). `/healthz` is public; all `/v1` routes require the
`X-Rules-Service-Key` header matching `RULES_SERVICE_DEV_KEY`. Configure these local-only settings in
`Back-End/.env`; the root `start.ps1` loads that file for both Python processes. Never put the development
key in source control.

| Route | Purpose |
|---|---|
| `GET /v1/schemas/{name}` | Return a shared contract schema |
| `POST /v1/rules/validate` and `/v1/rules/test` | Compile a rule and run its examples |
| `POST /v1/contracts/validate` | Validate a publishable definition contract |
| `POST /v1/dry-run` | Preview checks for an upload or blob; uses matching stored Parquet tables for upload IDs when available, otherwise reads the source blob; limited to 60 seconds |
| `POST /v1/examples/analyze` | Propose tables, columns, and candidate Enum/Range rules from an example blob |

The local Azurite image is pinned to Blob API `2025-07-05` through `AZURE_STORAGE_API_VERSION`. Leave this
setting unset in Azure to use the SDK's current service API version.

The local Service Bus emulator is pinned to `1.1.2`: the current `latest` (2.0.0) image has a known
`BufferQueue-1` initialization failure that prevents queue sends. The configured duplicate-detection
window is capped at the emulator's five-minute limit.

The worker uses `SERVICEBUS_CONNECTION_STRING` with the local emulator, or `SERVICEBUS_NAMESPACE` and
managed identity in Azure. `WORKER_MODE=local` receives continuously. `WORKER_MODE=job` processes up to
`WORKER_MAX_MESSAGES` (default 1) and exits if the queue is empty. Successful SQL writes replace any prior
result rows for the same upload in the same transaction, so a redelivered request is idempotent.

Run unit tests with `uv run pytest`. The worker integration test targets the local SQL Server, Azurite, and
Service Bus emulator and creates/deletes uniquely identified test rows and blobs; enable it explicitly with
`$env:RUN_DQ_INTEGRATION_TESTS = '1'` after the local services and database schema are ready, then run
`uv run pytest tests/integration -q`. It publishes to the isolated
`validation-events-wp5-test/worker-tests` entity and drains only that test subscription.

Reproduce the comparison from `Validation-Service/` with:

```powershell
uv run python tests\bench\csv_structural_spike.py --rows 1000000 --repetitions 3
```

The spike writes only aggregate counts and timings to stdout; it does not print CSV contents or cell values.
