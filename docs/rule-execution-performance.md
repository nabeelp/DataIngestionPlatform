# Rule execution performance: research and benchmarks

_Research date: 2026-10-02. Companion to [data-quality-review.md](./data-quality-review.md); this document assumes its Phase 1–3 recommendations (JSON rule settings, rule plugins, a larger built-in catalog, custom rules as the exception) are implemented._

## Recommendation

**Compile the JSON rule settings to SQL and run them in an embedded [DuckDB](https://duckdb.org) instance inside a dedicated validation worker.**

- **It is fast.** On a 1M-row, 104 MB CSV with 18 rules it is **11–14× faster than today's engine** (1.0–1.3 s versus 14.0 s).
- **It keeps the API responsive.** Queries run off the Node.js main thread (event-loop block ≤ 17 ms).
- **It handles large files.** It spills to disk under a memory limit.
- **It covers the hard rule types for free.** Regex runs on RE2, which takes linear time, so a rule's pattern can't hang the worker. Uniqueness, lookups, aggregates and checks across sheets become set operations.
- **It gives exact line numbers for structural and type errors.**
- **It is also the best target for custom rules:** a rule generated as a SQL expression costs ~23 ms per 1M rows, versus 1.8–2.5 s in QuickJS.

Keep a sandboxed TypeScript path only for logic that SQL cannot express, and move it to columnar batches.

| Concern | Choice |
|---|---|
| Declarative rules (CSV/TSV/TXT, .xlsx) | RuleConfig → SQL plugin → one DuckDB aggregate scan |
| Structural errors (field count, quoting, encoding) | DuckDB `read_csv(store_rejects = true)`: exact line, column and error type |
| Custom rules | 1. Map to a built-in type. 2. Else generate a **SQL boolean expression** (parsed and allow-listed). 3. Else TypeScript in **isolated-vm** (or QuickJS) fed with columnar batches |
| Excel | `.xlsx`: DuckDB `read_xlsx` (4.5× faster than SheetJS, low memory, non-blocking) with a timeout. `.xls`: SheetJS 0.20.x (CDN build) in a worker thread |
| Where it runs | A separate worker process or container (BullMQ sandboxed processor, or an Azure Container Apps job), never the API process |

## Method

**Environment:** AMD Ryzen 7 PRO 7840HS (8 cores/16 threads), 32 GB, Windows 11, Node.js 24.14.1.

**Package versions:**

- `@duckdb/node-api` 1.5.5-r.5 (DuckDB 1.5.5)
- `nodejs-polars` 0.26.1
- `isolated-vm` 7.0.1
- `quickjs-emscripten-core` 0.32.0
- `csv-parse` 5.6.0 (the version the backend uses)
- `udsv` 0.7.3
- `exceljs` 4.4.0
- `xlsx` 0.18.5

**Data:**

- **CSV:** 1,000,000 rows × 12 columns (103.7 MB) of orders, with errors injected deterministically into about 0.5% of rows per rule.
- **Excel:** a 300,000-row `.xlsx` (51.6 MB) with the same columns.

**Rules (18):** the proposed Phase 2 catalog.

- Required values (5 columns)
- Type checks: integer, two decimals, two strict dates
- Enum, range, two regex patterns and a length check
- Unique `Id`
- Lookup against 250 country codes
- Date comparison (`ShipDate >= OrderDate`) and a conditional required check
- Row count and a sum aggregate
- One custom rule: `Discount <= 50% of Amount`

**Correctness check:** every engine produced **identical counts and identical first-100 failing row numbers for all 18 rules**. Each engine ran in its own process (so peak RSS is clean), and each figure is the best of two runs.

**Engines compared:**

| Engine | Description |
|---|---|
| A — current | Today's design: `csv-parse` builds row objects, one evaluator per rule with per-row `hrtime` timing, and the custom rule runs in QuickJS using the production protocol (JSON row objects in batches of 500) |
| B — fused JS | The rule set compiled once into a single JS function over positional arrays: per-column parsing is shared, and there are no row objects and no per-check timing. Parser and sandbox are variable |
| C — DuckDB | Load as `all_varchar`, then one SQL scan with a `count_if(...)` and `min(row, 100) FILTER (...)` per rule; uniqueness by window, lookups by `list_contains` |
| D — Polars | `nodejs-polars` reads the CSV as strings, then the rules are evaluated as Polars expressions |

## Results

### CSV, 1M rows, 18 rules

| Engine | Time | vs current | Peak RSS | Max event-loop block |
|---|---:|---:|---:|---:|
| A — current (`csv-parse`, row objects, QuickJS rows) | 14,011 ms | 1× | 235 MB | 36 ms |
| B — fused / `csv-parse` / QuickJS columnar | 8,331 ms | 1.7× | 227 MB | 47 ms |
| B — fused / `udsv` / QuickJS columnar | 3,854 ms | 3.6× | 279 MB | 100 ms |
| B — fused / `udsv` / isolated-vm columnar | 2,145 ms | 6.5× | 307 MB | 42 ms |
| B — fused / `udsv` / unsandboxed _(baseline only)_ | 1,832 ms | 7.6× | 277 MB | 33 ms |
| **C — DuckDB, 1 thread** | 2,698 ms | 5.2× | 493 MB | 16 ms |
| **C — DuckDB, 2 threads** | 1,773 ms | 7.9× | 520 MB | 17 ms |
| **C — DuckDB, 4 threads** | **1,261 ms** | **11×** | 544 MB | **17 ms** |
| **C — DuckDB, 8 threads** | 1,026 ms | 14× | 610 MB | 17 ms |
| D — Polars, 1 thread | 1,142 ms | 12× | 546 MB | 1,142 ms (synchronous) |
| D — Polars, 4 threads | 728 ms | 19× | 542 MB | 728 ms (synchronous) |

**Where the time goes:**

- **Parsing dominates today's cost.** Parsing alone takes 3.0–3.4 s with `csv-parse` versus 0.4 s with `udsv`. Row objects, per-check timing and the QuickJS JSON protocol account for most of the remaining ~10 s.
- **DuckDB is mostly load time.** Loading into a table takes ~0.6 s at 4 threads (it scales poorly beyond that). Each rule predicate costs only 8–63 ms over 1M rows.
- **How a lookup is written matters.** For 250 values, `NOT IN (250 literals)` took 207 ms, `list_contains([...])` 59 ms, and an anti-join against a lookup table 9 ms. Compile lookup rules to a joined temporary table.
- **DuckDB spills to disk under a memory limit.** With `memory_limit = 256MB`, the run still completed in 1.5 s with a peak RSS of 374 MB.
- **Polars was the fastest raw engine**, but `nodejs-polars` is synchronous, blocking the event loop for the whole run, so it would need its own worker thread. It also has no Excel reader and lags the Python API. DuckDB at 4–8 threads is within 0.3–0.5 s of it, is asynchronous, and is a natural compile target for both rules and generated custom rules.

### Custom (Natural Language) rule only, 1M rows

| Execution | Time | Isolation |
|---|---:|---|
| QuickJS, current protocol (JSON row objects, batch 500) | 2,541 ms | WASM interpreter, no JIT |
| QuickJS, columnar JSON batch of 10k | 1,802 ms | Same |
| isolated-vm, columnar batch of 10k | 454 ms | Separate V8 isolate with JIT, memory limit and timeout |
| Unsandboxed `new Function` _(baseline only)_ | 115 ms | None. Never use for generated code |
| **DuckDB SQL expression** | **23 ms** | SQL engine with external access disabled (see hardening) |

### Excel `.xlsx`, 300k rows, read only

| Reader | Time | Peak RSS | Max event-loop block |
|---|---:|---:|---:|
| SheetJS `readFile` + `sheet_to_json` (current) | 8,448 ms | **989 MB** | **8,448 ms** |
| exceljs streaming `WorkbookReader` | 16,735 ms | 268 MB | 10,940 ms |
| **DuckDB `read_xlsx`** (`excel` extension, already installed) | **1,864 ms** | **131 MB** | **122 ms** |
| _Reference, outside Node: calamine (Rust) via Python `fastexcel`_ | _1,320 ms_ | _336 MB_ | _n/a_ |

> **Correction:** an earlier version of this table reported 8,229 ms for DuckDB. That run included downloading the `excel` extension on first use, which is one more reason to bake the extension into the image. The steady-state figure is above.

Excel is roughly 10× slower per row than CSV, because the cost is unzipping and parsing XML. DuckDB is **4.5× faster than SheetJS, with 7× less memory** and without blocking the event loop. exceljs is the slowest and still blocks the event loop.

## Recommended execution design

```
Upload ─► Blob ─► queue ─► Validation worker (separate process / container, e.g. 4 vCPU, 8 GiB)
                             │
                             ├─ 1. Load:   CSV  → read_csv(all_varchar, store_rejects)   ─┐
                             │             xlsx → read_xlsx(all_varchar, sheet=…)         ├─► staging table per sheet
                             │             xls  → SheetJS 0.20.x in a worker thread → Appender ┘
                             ├─ 2. Lock down DuckDB (no file/network access, config locked)
                             ├─ 3. One compiled scan: typed view (TRY_CAST once per column) +
                             │      count_if(pred) and min(row,100) FILTER(pred) per rule;
                             │      unique = GROUP BY/window; lookup = joined temp table;
                             │      cross-sheet = joins/aggregates between staging tables
                             ├─ 4. Custom TS rules (rare): stream the needed columns in chunks → isolated-vm
                             └─ 5. Persist counts and samples; optionally COPY failing rows (+ rule ids) to Blob
```

### Design points

- **Each rule plugin compiles to SQL.** Extend the Phase 2 plugin interface so each rule type implements `toSql(ctx) → { predicate, sampleColumns, setup? }`. `setup` creates any helper tables, such as lookup tables. Only literals from the validated JSON settings are embedded, always via escaping or bound parameters, and identifiers are quoted. Keep a JS evaluator per plugin only for the dry run and for unit-test equivalence.
- **Use one aggregate scan for all rules.** Bounded `min(row, 100) FILTER (WHERE …)` sample lists keep memory flat however many rows fail. Uniqueness and checks across sheets are separate set-based queries.
- **Use the rejects tables first.** `store_rejects` reports `CAST`, `MISSING COLUMNS`, `TOO MANY COLUMNS`, `UNQUOTED VALUE`, `INVALID ENCODING` and `LINE SIZE OVER MAXIMUM`, each with the exact physical line. This directly fixes findings A4 (ragged rows) and part of A5 (invalid dates). In a typed load, its counts matched the type rules exactly (5,053 / 5,052 / 5,033). Rejected rows are dropped from a typed table, so load as `all_varchar` and treat rejects as structural errors.
- **Row numbers need care.** `rowid` in an `all_varchar` table follows file order (verified against the JS engines), so a row's line is `rowid + 2`. That holds only when the file has no blank lines or quoted fields spanning several lines. Either report a "data row" number, or check `reject_scans` and the sniffer output and fall back to a line index for such files.
- **Generate custom rules as SQL first.** Change the Natural Language prompt so that, when no built-in type fits, the model returns a **single SQL boolean expression** over the declared columns (for example `TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5`).
  - Validate it with `json_serialize_sql('SELECT <expr> FROM t')` and allow-list the AST: column references, literals, operators and an approved function list only. Reject subqueries, table functions, `read_*`, `COPY`, `ATTACH`, `PRAGMA` and `SET`.
  - Keep the existing example-based self-check, run in DuckDB.
  - It is about **100× faster than isolated-vm** and naturally supports checks across rows and sheets through window functions and aggregates.
- **TypeScript fallback.** Use **isolated-vm**: 4× faster than QuickJS columnar and 5.6× faster than today's protocol, with a memory limit and timeout per call. Note that isolated-vm is in maintenance mode and needs `--no-node-snapshot` on Node 20+. If that is unacceptable, keep QuickJS but switch to columnar batches of 10k, which is 30% faster than today.
- **Pick worker sizing and settings for the container:**
  - `threads` = vCPU count; 4 is the sweet spot here.
  - `memory_limit` ≈ 50–60% of the replica's memory.
  - `temp_directory` on local disk, with `max_temp_directory_size`.
  - A fresh in-memory DuckDB instance per job.
  - Wall-clock timeout per job with `connection.interrupt()`.
  - BullMQ sandboxed processor (or a separate container) so lock renewal never stalls.
- **The fallback without native dependencies is engine B** (fused JS over `udsv`, rules compiled to one function). It took 1.8–2.1 s per 1M rows and used 280–310 MB, with a pure-JS install, but you would hand-build uniqueness spill, joins, aggregates and parallelism. It's only worth it if native binaries are not allowed.

### Hardening DuckDB for generated SQL

Apply these settings after the file is loaded (`read_csv`/`read_xlsx` need file access):

```sql
SET enable_external_access = false;       -- blocks read_*, COPY, ATTACH, extension install/load
SET autoinstall_known_extensions = false;
SET autoload_known_extensions = false;
SET lock_configuration = true;            -- generated SQL cannot change settings back
```

Also:

- Bake the `excel` extension into the image (`extension_directory`) and `LOAD` it before locking down, so the worker never downloads it at runtime.
- DuckDB has no statement-timeout setting, so enforce timeouts in the application with `interrupt()`. Run each job in its own process, so a hung native call (see the `read_xlsx` issue below) can be killed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native binary: platform coverage and supply chain (compromised DuckDB npm versions in Sept 2025, [CVE-2025-59037](https://nvd.nist.gov/vuln/detail/cve-2025-59037)) | Pin exact versions with a lockfile and integrity hashes. Linux x64/arm64 (glibc and musl) and Windows x64 are published. Build the container image in CI |
| `read_xlsx` hangs on truncated files ([duckdb-excel#102](https://github.com/duckdb/duckdb-excel/issues/102)); it is single-threaded and loads shared strings into memory | Timeout + `interrupt()` + per-job process. Check the zip and file signature before loading. Cap the Excel size |
| `.xls` is not supported by DuckDB | SheetJS 0.20.3 from the [SheetJS CDN](https://cdn.sheetjs.com/advisories/) (npm `xlsx` 0.18.5 has CVE-2023-30533 and CVE-2024-22363), in a worker thread, appending to DuckDB |
| Row/line numbering differences for blank lines or quoted fields spanning lines | Detect via the sniffer and rejects; report data-row numbers; cover with tests using the `samples/` files |
| Generated SQL escaping the sandbox | AST allow-list, external access disabled, configuration locked, fresh instance per job, separate process |
| Behaviour drift between the old and new engines | Port this benchmark's equivalence check into the backend tests: the current engine and the SQL plan must agree on every file in `samples/` before switching. Use a per-definition feature flag |

## Azure notes

- **Hosting:** run the validation worker as an **Azure Container Apps job**, event-driven, scaling from zero on queue depth, or as a separate Container App that consumes the BullMQ queue.
  - Consumption replicas go up to 4 vCPU / 8 GiB.
  - Use dedicated workload profiles for larger files.
  - Service Bus is the documented KEDA trigger. A KEDA scaler on BullMQ's Redis keys is unverified.
- **Cost drivers:** worker vCPU-seconds (about 1.3 s per 1M CSV rows at 4 vCPU; Excel about 10× more per row), temporary disk for spills, and Blob reads. Model calls are only made when a rule is authored, not per upload.
- **Identity and data:** the worker reads Blob through managed identity. Files never leave the worker's process memory or temporary disk.

## Sources

- DuckDB Node.js "Neo" client: <https://duckdb.org/docs/current/clients/node_neo/overview>. Async native calls (`AsyncWorker`) run on the libuv thread pool ([duckdb-node-neo](https://github.com/duckdb/duckdb-node-neo)). The legacy `duckdb` npm package gets no 1.5.x releases.
- Faulty CSV files and rejects tables: <https://duckdb.org/docs/current/data/csv/reading_faulty_csv_files>
- CSV options and encodings (UTF-8, UTF-16 and Latin-1 built in; more through the `encodings` extension): <https://duckdb.org/docs/current/data/csv/overview>
- Excel extension (`read_xlsx` since DuckDB 1.2; no `.xls`): <https://duckdb.org/docs/current/core_extensions/excel>
- Securing DuckDB: <https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview>
- Regular expressions (RE2): <https://duckdb.org/docs/current/sql/functions/regular_expressions>
- Node.js `vm` is not a security mechanism: <https://nodejs.org/api/vm.html>
- isolated-vm (maintenance mode, `--no-node-snapshot`): <https://github.com/laverdet/isolated-vm>
- SheetJS reads are not streamed: <https://docs.sheetjs.com/docs/demos/bigdata/stream>
- BullMQ sandboxed processors: <https://docs.bullmq.io/guide/workers/sandboxed-processors>
- Azure Container Apps jobs and workload profiles: <https://learn.microsoft.com/azure/container-apps/jobs>, <https://learn.microsoft.com/azure/container-apps/workload-profiles-overview>
- Prior art: Soda Core, dbt tests and cuallee (which supports DuckDB) all compile checks into SQL that returns aggregates and failing rows. Deequ computes metrics with shared aggregation scans on Spark.

## Next steps

1. Define the `RuleConfig` plugin interface with `toSql()` and a JS evaluator, and migrate the 5 existing types.
2. Build the DuckDB executor behind a per-definition feature flag, and add the equivalence test against the current engine on `samples/`.
3. Change Natural Language authoring to produce SQL expressions, with the AST allow-list. Keep TypeScript plus isolated-vm only as a fallback.
4. Move validation to a sandboxed BullMQ processor or a Container Apps job, and add per-rule timings and metrics.
