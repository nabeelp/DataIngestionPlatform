# Greenfield option: the fastest way to run data quality checks

_Research date: 2026-10-02. Companion to [data-quality-review.md](./data-quality-review.md) and [rule-execution-performance.md](./rule-execution-performance.md). This document answers: "If we built this from scratch, with any language and any platform, what would be fastest?"_

## Recommendation

Use a **Rust columnar engine, Polars on Apache Arrow, with calamine for Excel**, running in a separate worker that scales on a queue.

- Store rules as versioned JSON and compile them into **one query plan per definition version**.
- Generate custom rules as **SQL expressions** and turn them into engine expressions, not code.
- Write the worker in Rust for maximum control and the smallest containers, or in **Python with Polars** for development speed. The performance is almost the same either way, because the work happens inside the engine's Rust code.

## Evidence

Same machine and data as [rule-execution-performance.md](./rule-execution-performance.md): a 1M-row, 104 MB CSV with 18 rules, and a 300k-row, 52 MB `.xlsx`. All engines produced identical failure counts.

| Workload | Engine | Time | Peak memory |
|---|---|---:|---:|
| CSV, 1M rows, 18 rules | Current app (Node.js, row by row) | 14.0 s | 235 MB |
| | DuckDB from Node.js, 4 threads | 1.26 s | 544 MB |
| | Polars from Node.js (`nodejs-polars`), 4 threads | 0.73 s | 542 MB |
| | **Polars from Python** (1.44) | **0.55 s (25× faster than current)** | 400 MB |
| `.xlsx`, 300k rows, read only | SheetJS 0.18 (current) | 8.4 s | 989 MB |
| | exceljs (streaming) | 16.7 s | 268 MB |
| | openpyxl (Python, read-only mode) | 10.4 s | 67 MB |
| | DuckDB `read_xlsx` | 1.9 s | 131 MB |
| | **calamine (Rust) via `fastexcel`** 0.21 | **1.3 s** | 336 MB |
| `.xlsx`, 300k rows, read plus all 18 rules | calamine + Polars | 2.0 s | 361 MB |

## Target architecture

```
Browser ──SAS upload──► Blob (raw) ──Event Grid──► Service Bus ──KEDA──► Container Apps job (Rust/Python worker)
                                                                           │ 1. Check: file signature, encoding, delimiter, sheets
                                                                           │ 2. Parse to Arrow: CSV (multi-threaded) / xlsx+xls (calamine)
                                                                           │ 3. Write canonical Parquet to Blob (delivery, re-runs, dry runs)
                                                                           │ 4. Run the compiled rule plan (one lazy query, shared subexpressions)
                                                                           │ 5. Counts + first-N samples → database; full rejects file → Blob
API (any language) ◄── results in Azure SQL/Postgres; progress via Web PubSub ◄┘
```

## Why this design

- **Columnar engines are 10–25× faster than row-by-row loops** in any language: JavaScript, Python or .NET.
- **One compiled plan per rule set.** The JSON rules are built into engine expressions in code, so no SQL strings are pasted together from user input. Shared work happens once: for example, `Amount` is converted to a number once and reused by the type, range, sum and custom rules.
- **Custom rules are fast and contained.**
  - The model writes a SQL boolean expression. Polars' `sql_expr` (or DataFusion with sqlparser-rs) turns it into an engine expression, which is checked against an allow-list of functions and columns.
  - Regex runs on Rust's `regex` crate, which takes linear time, so a rule's pattern can't hang the worker.
  - Logic that SQL can't express runs as **WebAssembly in Wasmtime**, with fuel metering and memory caps. That runs close to native speed with a stronger sandbox than QuickJS (no JIT compiler) or isolated-vm (in maintenance mode).
- **Excel is the bottleneck.** calamine is the fastest reader measured, and it reads legacy `.xls`, which DuckDB can't.
- **Parquet is the canonical copy.** Re-validating, dry-running a draft rule or delivering downstream then reads columnar data in milliseconds instead of re-parsing the upload.
- **Uploads go straight to Blob storage, and workers scale on events.** This removes the API proxying and the three copies of each file that exist today (temp folder, storage, then a download). Each file gets an isolated worker sized for it. Keep one warm replica if interactive latency matters.

## Options not chosen

| Option | Why not |
|---|---|
| Spark (Fabric/Databricks, Deequ/DQX) | Job startup takes seconds to minutes, which dominates for files of 100 MB or less. Use it only for multi-GB batches or backfills; the same JSON rules can compile to Spark |
| Load into Azure SQL or a warehouse, then run SQL rules | Loading costs more than the checks, and it competes with the operational database |
| DuckDB as the core | Within 2× of Polars, and excellent if SQL is the rule language. The trade-offs are generating SQL text instead of building expressions in code, a slower Excel reader, and no `.xls` |
| .NET or Go row-by-row engines | Faster than Node.js, but still row-oriented; the columnar engines win |

## Trade-offs

- **Rust:** the best performance, smallest containers and fastest cold starts, but scarcer skills.
- **Python with Polars:** about 90% of the speed with much faster development; the right choice for most proofs of concept.
- **Two languages either way.** The API stays TypeScript or .NET and the worker is Rust or Python. The boundary is just the queue plus the JSON rule format.
- **Cost drivers:**
  - Worker CPU-seconds: under 1 s per 1M CSV rows; Excel about 10× more per row.
  - Blob storage for the raw file, the Parquet copy and the rejects file.
  - Service Bus operations.
  - Model calls only happen when a rule is authored, not per upload.

## Relationship to this repository

A rewrite is not needed to get most of the gain. The **JSON rule format** is the part that transfers. Implement it with DuckDB in the current Node.js stack first (see [rule-execution-performance.md](./rule-execution-performance.md)). If Excel volume or scale later justifies it, replace the worker with Python or Rust + Polars behind the same queue and rule format; the authoring UI and API would not change.
