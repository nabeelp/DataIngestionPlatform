# Data quality checks: review and recommendations

_Review date: 2026-10-02 (commit `fca4fd1`)._

## Status

The Python + Polars migration and Node-engine cutover are complete through WP8.
The implementation plan records the acceptance tests and intentional
differences. Azure infrastructure and deployment documentation are now
available; cloud provisioning and the Azure end-to-end smoke test remain gated
on explicit owner approval. See the [implementation plan](./implementation-plan-python-engine.md)
and [deployment runbook](./deployment.md). The findings and implementation
description below are the original review snapshot, not a description of the
current engine.

## Recommendation

Keep the current design. Each upload is pinned to a published version of its rules, the file is read once by evaluators that stream through it, and AI-generated code runs in a sandbox. That is a sound base. Change it in three steps:

1. **Fix the gaps that let bad files pass.** Some checks don't run or don't report, and the upload is then treated as passed.
2. **Store rule settings as structured JSON and add more built-in rule types.** Generated "Natural Language" rules should be the exception, not the default.
3. **Move validation off the API process** and add a vectorised engine for large files and for checks that span many rows (see [rule-execution-performance.md](./rule-execution-performance.md)).

## How it works today

```
Upload → pin to published version → one ValidationRuleDetails row per check → queue job
Worker: readRecords() streams rows → [columns check per table] + [declarative rules] + [Natural Language sandboxes]
       → result() per check → PASSED / WARNING / FAILED → if no Error-level failures, deliver the whole file
```

- **Declarative rules:** [ValidationEngine.ts](../Back-End/src/services/validation/ValidationEngine.ts) handles 5 types. Each rule is written as a text expression and stored in `SqlQuery`.
- **Custom rules:** [NaturalLanguageRule.service.ts](../Back-End/src/services/NaturalLanguageRule.service.ts) asks a Foundry model to either map the request to a declarative type or write TypeScript. The code is type-checked, then run against the model's own example rows.
- **Running custom rules:** [NaturalLanguageRuleRuntime.ts](../Back-End/src/services/validation/NaturalLanguageRuleRuntime.ts) runs the code in a QuickJS WebAssembly sandbox with time and memory limits, passing rows in batches of 500.
- **Versioning:** [DefinitionContract.ts](../Back-End/src/services/validation/DefinitionContract.ts) builds the versioned rule set, compares versions and checks a draft before it is published.

**Strengths worth keeping:**

- Every upload is validated against the version that was active when it arrived.
- The file is read once for all checks.
- Only sample issues are stored, so memory stays bounded however many rows fail.
- The sandbox has no network, file or environment access and is limited by time, memory and stack.
- The model is told to treat the request as data, not instructions.
- Nothing applies to uploads until an admin publishes.
- The engine is well unit-tested.

## Findings

Items marked ✅ were confirmed by running probe scripts against the real engine.

### A. Correctness: bad files that pass

| # | Issue | Where |
|---|---|---|
| A1 | ✅ **A workbook with no data passes even when columns are required.** If a sheet has no header row, the header step is never called, so neither the columns check nor Required Values reports anything. | [FileRecordReader.ts](../Back-End/src/services/validation/FileRecordReader.ts) (`headerIndex < 0`) |
| A2 | ✅ A CSV with only a header row passes. There is no minimum row count. | — |
| A3 | ✅ **Duplicate headers are silently merged.** With `Amount,Amount`, the last value wins and the first column is never checked. | `toRow` in [FileRecordReader.ts](../Back-End/src/services/validation/FileRecordReader.ts) |
| A4 | ✅ **Rows with too many or too few fields are accepted silently** (`relax_column_count: true`). Extra values are dropped, and missing ones turn into "required value missing" errors that hide the real cause. | [FileRecordReader.ts](../Back-End/src/services/validation/FileRecordReader.ts) |
| A5 | ✅ Impossible dates pass as `datetime`: `31/02/2024`, `2024-02-30`, `2024-02-31`. Whether `03/04/2024` is day-first or month-first is never decided. | `LOCAL_DATE_PATTERN` in [ValidationEngine.ts](../Back-End/src/services/validation/ValidationEngine.ts) |
| A6 | ✅ `1e400` passes as a decimal because it becomes Infinity. `1,234.56` and the European format `1.234,56` fail as decimals, and there is no setting for number formats. | `toNumber` |
| A7 | **Skipped checks don't fail the upload.** A check that can't be matched to the published version is marked `SKIPPED` and counted as neither passed nor failed. | [ValidationWorker.service.ts](../Back-End/src/services/ValidationWorker.service.ts) |
| A8 | Rules in single-table definitions aren't checked against the definition's columns at publish time; only sheet-table rules are. A misspelt column then fails every upload. | `assertPublishable` in [DefinitionContract.ts](../Back-End/src/services/validation/DefinitionContract.ts) |
| A9 | ✅ A failure from a whole-file check (`validateFile`) is reported against the last row read, which is misleading. | [NaturalLanguageRuleRuntime.ts](../Back-End/src/services/validation/NaturalLanguageRuleRuntime.ts) |
| A10 | The README says up to 100 sample issues are stored per rule, but only 10 are saved. | `markFailed` / `markWarning` in [ValidationRuleDetail.model.ts](../Back-End/src/models/ValidationRuleDetail.model.ts) |

### B. Flexibility

- **Rule settings are a fragile text format stored in `SqlQuery`.** ✅ `Name: Smith, John` becomes two allowed values, and a column name containing `:` can't be referenced at all. The format also can't be extended with options such as case sensitivity, date format or tolerance.
- **The built-in catalog is too small, so too many requests go to AI-generated code.** Missing types: pattern, length, unique (single or composite key), lookup lists (the `Lookups` table exists and is already in [TODO.md](../TODO.md)), date range or relative date, conditionally required, column-to-column comparison, row count, and aggregate or reconciliation checks.
- **Column definitions are thin.** `required` means both "the column must exist" and "values can't be empty". There is no format, precision/scale, maximum length, unique or allow-extra-columns setting.
- **Workbook layout is fixed.** The header is the first non-blank row, and a single-table definition applies to every sheet, including hidden or notes sheets. There is no header-row setting and no list of sheets to ignore.
- **Results are pass/fail for the whole file.** There is no tolerance (for example, fail only if more than 0.5% of rows fail), and valid rows can't be delivered while the invalid ones are quarantined.

### C. Custom (Natural Language) rules

- **They are only tested against examples the model wrote itself.** The examples aren't saved, so they can't be re-run when the rule is regenerated or published. There are no admin-supplied test cases and no dry run against a real file.
- ✅ **`Date.now()` and `Math.random()` are available in the sandbox**, so revalidating the same file can give a different result.
- **Checks across many rows don't scale in the sandbox.** Duplicate detection keeps its state inside the 64 MB limit, and the 20-second limit is per rule regardless of file size, so large files fail on resource limits rather than on their data.
- **Results are coarse and repeated work is expensive.** `validateRow` returns one message and can't name the column at fault, so multi-column rules show the whole row as JSON. Rows are also JSON-encoded separately for every Natural Language rule. ✅ For 300k rows, validation took 1.3 s with declarative rules only, 2.0 s with one Natural Language rule and 3.6 s with three.
- **There is no record of how a rule was produced.** Store the model deployment and version, a hash of the prompt and the Foundry response ID with each rule for audit.

### D. Performance and reliability

- ✅ **Excel files aren't streamed.** `XLSX.readFile` and `sheet_to_json` run synchronously on the API process. A 300k-row, 39 MB workbook blocked the event loop for **2.8 s** and grew the heap by **about 230 MB**. With a 100 MB upload limit and 5 concurrent jobs, the likely results are out-of-memory crashes, a frozen API and socket traffic, and BullMQ lock timeouts that make a job run twice. Natural Language sandboxes also run synchronously.
- **Files that can never validate are retried 3 times with backoff.** For example, a corrupt workbook is retried, and the upload is marked `VALIDATION_FAILED` (and the UI notified) between attempts.
- **Small overheads:** timing every check on every row adds two `hrtime` calls per row per check, and saving results makes 2 database round trips per check, one after another.
- **No content checks on upload.** The file type comes from the extension only: the content signature isn't checked, the text encoding isn't detected (UTF-8 is assumed), and there is no row or byte limit specific to Excel.
- The `xlsx@0.18` package has known security advisories (already in [TODO.md](../TODO.md)).

### E. Reporting and observability

- Users only see sample issues; there is no downloadable report of every failing row. The `ValidationErrorBatches` table exists but nothing uses it.
- There are no metrics (rows per second, time per rule, issue rates) and no quality trend per definition (pass rate, null rate, row-count changes over time).

## Recommendations, in phases

### Phase 1: correctness (low effort, high value)

1. Report missing sheet tables and empty or header-less files whenever columns are required. Add an optional minimum and maximum row count per table.
2. Reject duplicate or empty headers. Add an option for rows with the wrong number of fields (`error`, `warning` or `ignore`) and report the expected and actual field counts.
3. Make date checks strict (real calendar dates) and add a `format` setting per column (for example `yyyy-MM-dd` or `dd/MM/yyyy`). Reject non-finite numbers.
4. Treat `SKIPPED` checks and rule configuration errors as failures.
5. Check rule columns against the definition at publish time for every layout.
6. Report `validateFile` failures as file-level issues with no row number.
7. Save all 100 sample issues, or correct the README.
8. Mark corrupt or unparseable files as unrecoverable (BullMQ `UnrecoverableError`) so they aren't retried.
9. In the sandbox, fix `Date.now()` to the upload time (or remove it), remove `Math.random`, and pass the validation date in explicitly.

### Phase 2: flexibility

1. **Store rule settings as versioned JSON** (`RuleConfig`) with a JSON Schema per rule type, for example `{ "column": "Status", "values": [...], "caseSensitive": false }`. Keep the text parser only to migrate existing rules. This also covers the `SqlQuery` rename already in [TODO.md](../TODO.md).
2. **Make rules plugins.** Each rule type registers `{ schema, parse, columns(), createEvaluator(), describe() }`, which removes the `switch` statements spread across the engine, the contract and the pseudocode code.
3. **Add built-in types:**
   - Pattern, using a linear-time engine such as RE2/`re2-wasm`, because unrestricted regex is a denial-of-service risk
   - Length
   - Unique, on one column or a composite key
   - Lookup, cached from `Lookups`
   - Date range, absolute or relative to the upload date
   - Conditionally required
   - Column comparison
   - Row count
   - Aggregate or reconciliation across sheets
4. **Add column settings:** separate `mustExist` from `nullable`; add `format`, `precision/scale`, `maxLength`, `unique` and `allowExtraColumns`; and add an optional `headerRow` and list of ignored sheets per table.
5. **Add tolerances and outcomes:** a `threshold` per rule (a count or a percentage) and, per definition, a choice between rejecting the whole file and delivering the valid rows with a separate rejects file.
6. Once these types exist, have the model map more requests to them and generate code only as a last resort.

### Phase 3: custom rule assurance

- Save the examples with the rule and let admins add their own. Re-run them on publish and on regeneration.
- Add a **dry run** that runs a draft rule against the definition's example file or a recent upload and shows what would fail.
- Let `validateRow` return `{ column, message }[]`.
- Scale the time limit with the number of rows.
- Show the rule's provenance (model, prompt hash, response ID) in the review UI.

### Phase 4: performance and scale

See [rule-execution-performance.md](./rule-execution-performance.md) for the research and benchmarks behind this phase.

- **Run validation in a separate worker process or container**, never on the API process.
- **Stream Excel files** instead of loading whole workbooks into memory, and set row and byte limits specific to Excel.
- Use a vectorised engine for large files and for checks that span many rows.
- Add per-check metrics (OpenTelemetry / Application Insights) and write a full issues report (CSV in Blob Storage) linked from the upload. Profile columns in the same pass (null %, distinct count, min/max) to detect shifts in the data and build quality scorecards.

## Proof of concept versus production

- **Required for production:** Phase 1, and Phase 4's move of validation to a separate worker.
- **What makes it flexible:** Phases 2 and 3.
- **Risks to test next:** time zone shifts in Excel dates, cached versus recalculated formula values, and CSV files that aren't UTF-8.
