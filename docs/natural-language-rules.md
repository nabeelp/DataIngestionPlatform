# Natural-language rules and cross-sheet checks

How a plain-language request becomes a validated `RuleConfig`, what was reviewed, how cross-sheet rules work, and how to
evaluate generation quality.

## Pipeline

```
Admin request ──► Back-End NaturalLanguageRule.service.ts ──► Foundry model (strict JSON schema)
                         │ passingExamples + failingExamples are combined; sheet names/aliases canonicalised;
                         │ deterministic fields normalised (see below); proposal → RuleConfig
                         ▼
              Python rules service: /v1/rules/validate → /v1/rules/test (examples)
                         │ sqlguard (AST allow-list) + the same engine path used for uploads
                         ▼
              Proposal returned to the workspace; nothing is saved until the admin adds it
```

Correction policy (at most one correction of each kind per review, so cost stays bounded):

* **Example-shape problems** (missing passing/failing case, an example using an unknown sheet or column) keep the proposed rule and
  make **one examples-only model call** (`rule_examples` schema) that receives the fixed rule and precise feedback.
* **Everything else** (invalid SQL, an example whose result does not match its verdict) triggers **one full re-proposal**, because
  either the SQL or the example could be at fault. The feedback names the failing example (`failingExamples[0]`), the sheet, the
  column and what the schema declares.
* Normalised rather than rejected: a query or `reconcile` rule's target is always `null`; related rows on a row rule are dropped;
  examples on a built-in rule are ignored; for a **query** rule, schema columns used only by examples are added to `tableColumns`
  (a query reads only what it selects). A row rule is never extended this way because declared columns decide which rows it skips.

Built-in types are preferred. SQL is only used through `naturalLanguage`: **row mode** (`failWhen`, one sheet) or
**query mode** (one `SELECT` over one or more sheets).

## Cross-sheet rules

| Need | Use |
| --- | --- |
| Aggregate of one sheet vs aggregate of another (totals, counts) | built-in `reconcile` |
| Row-level check that needs data from another sheet (foreign key, matched-row comparison, attribute of a related row) | `naturalLanguage` **query mode** |
| Whole-file condition over several sheets | `naturalLanguage` query mode returning one `message` row |

Query-mode contract:

* Sheets are addressed as `t_0`, `t_1`, … in **definition order**; declare in `params.columns` only the sheets and columns
  the query reads (a three-sheet definition may use two). Alias every table and qualify every column.
* Blank cells are `NULL` inside queries, for CSV and Excel alike.
* Row-level result: return `__row` (the alias's `__row`), plus optional `"table"` (exact sheet name literal), `"column"`
  and `message`. The issue is reported against that sheet and its physical row. File-level result: at most one row with
  only `message`.
* Allowed: `JOIN … ON`, `WHERE`, `GROUP BY`, `HAVING`, CTEs, subqueries, `[NOT] EXISTS`, `DISTINCT`, `ORDER BY`, `LIMIT` and
  the function allow-list in `sqlguard`. Columns produced by CTE/derived-table aliases may be referenced.

```sql
-- Every order's CustomerId must exist in Customers (t_0 = Customers, t_1 = Orders)
SELECT o.__row AS __row, 'Orders' AS "table", 'CustomerId' AS "column", 'Unknown customer.' AS message
FROM t_1 AS o LEFT JOIN t_0 AS c ON o.CustomerId = c.Id
WHERE o.CustomerId IS NOT NULL AND c.Id IS NULL
```

### Examples across sheets

An example has a primary row (`table`, `values`) and optional `relatedRows` (`[{ table, values }]`) that seed other sheets,
so a passing example can include the matching customer and a failing one the missing key. `relatedRows` is only valid for
query rules and is optional, so previously saved rules are unchanged. The editor shows and edits related rows for query rules.

### Known limits

* `t_N` aliases follow sheet order. Reordering/removing sheets after a rule was saved can re-point a query; the rule list
  flags this and the rule should be regenerated.
* All declared columns across sheets together are capped at 20, and SQL at 4 KB; query execution has a 30-second limit
  (an accidental cross join on large sheets will hit it and report an error).
* Row-mode rules (and every built-in type except `reconcile`) read exactly one sheet.

## Review findings and fixes

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Query mode demanded column declarations for **every** sheet; a rule over 2 of 3 sheets was rejected. | Only declared sheets are registered; undeclared sheets are ignored, a declared sheet missing from the file is an error. |
| 2 | Examples seeded one row in one sheet, so cross-sheet rules had no valid passing example. | Added `relatedRows` (schema, Python, TypeScript contracts, model schema, editor). |
| 3 | The model was never told the row-level query output contract (`__row`, `table`, `column`) and was told not to use `__row`; only file-level cross-sheet failures were possible. | Prompt documents both output shapes, join recipes, alias/ambiguity rules and `reconcile` vs query. |
| 4 | `EXISTS`/`NOT EXISTS` was blocked; CTE/derived-table output columns (`paid.total`) were rejected as undeclared. | Allowed in query mode only, with the same table/column/function checks; negative tests added. |
| 5 | Blanks were `''` for CSV but `NULL` for Excel, so `IS NULL` queries behaved differently per file type. | Query tables normalise blank/whitespace to `NULL`. |
| 6 | Cross-sheet row issues were reported without a sheet (row 5 of which sheet?). | Report issues carry the sheet named by the query's `table` column. |
| 7 | Editing an example in the UI re-created it without unknown fields (would have dropped `relatedRows`). | Parsing preserves related rows (unit-tested). |
| 8 | Saved query rules silently re-pointed when sheets were reordered. | `ruleProblems` flags aliases that no longer map to a declared sheet. |
| 9 | All model tests mocked the model; nothing measured generation quality. | Golden corpus + opt-in live evaluation (below). |

### Fourth live evaluation (full corpus): an outage hid most of it, and the replay found three prompt gaps

The rules service stopped partway through the run, so 15 of 26 cases ended with `The rules service could not complete validation`
(one more with a dropped model connection). Only 11 were usable (6 mapped, 5 rejected). The recorded proposals were replayed
through a current service (no new model calls) to recover the rest: all 10 cross-sheet cases and the reconcile case were accepted
and behaved correctly (cross-sheet 10/10, built-in 6/6, row SQL 1/1). The replay also exposed problems that the outage had hidden:

| Finding | Change |
| --- | --- |
| **Safety-relevant:** asked to check customers against "the Dynamics CRM", the model substituted the file's own `Customers` sheet (the first run rejected this correctly; the added cross-sheet guidance made it over-eager). | Prompt: reject any request that names an external system even if a similarly named sheet exists; never substitute a sheet for an external source. |
| A failing example had a blank value in a declared column, which a row rule can never fail (the engine skips rows with a blank declared column). | Prompt explains that failWhen never sees blanks and failing examples must not use them; blanks that must fail need a query rule. |
| Duplicate/uniqueness rules were given single-row examples, so the "failing" example could not fail. | Prompt: rules comparing rows need the other row(s) in `relatedRows`, even in a single table. |
| "Order ids must be 2–6 characters" was rejected as ambiguous (`OrderId` exists in two sheets) — a fair rejection of an ambiguous eval prompt. | Golden request now names the sheet. |
| A dropped connection was classified as non-retryable. | Unclassified connection failures are retried; authorization and 4xx errors still are not. |

The evaluation now classifies outage failures (`infrastructureError`), reports them separately (`infrastructureErrors`), and stops
after three consecutive ones, writing a report with `aborted` set, so an outage no longer spends model calls.
These prompt changes are unmeasured against the live model; re-run the full corpus after restarting the rules service.

### Third live evaluation (cross-sheet × 3, current service): targets met

| Metric | Result | Target |
| --- | --- | --- |
| Runnable | 30/30 | ≥ 90 % |
| Behaviour match on the sample data | 30/30 | 100 % |
| Correct decision/type/mode | 30/30 | — |
| First-attempt success | 29/30 | — |
| Recovered after correction | 1/1 | ≥ 60 % |
| Model calls / input / output tokens | 31 / 114k / 21.5k (was 57 / 211k / 44.6k) | — |
| Latency avg / p95 | 9.8 s / 13.5 s | — |

The one correction was a **guard false positive**, not a model error: the query joined a CTE under an alias
(`JOIN paid AS p2 … p2.total`) and `sqlguard` only resolved the CTE's own name. A CTE's output columns are now visible through
any alias given to it (an alias still cannot expose columns the CTE does not produce; tested). Still unmeasured: the single-sheet,
built-in and rejection categories since the example/feedback changes — run the full corpus (`npm run eval:nl-rules --yes`) before
treating those as regression-free.

### Second live evaluation (cross-sheet × 3): a stale rules service hid the result

The second run scored 3/30 runnable, but 34 of the rejections were `relatedRows: Extra inputs are not permitted`, `Query-mode
columns for table "X" are missing` and ``Function `exists` is not allowed`` — exactly the behaviours that had been changed. The
Python service on :8000 had been started before those changes and was never restarted. **Replaying the model's recorded first
proposals through the current service** (no new model calls) gave 27/30 accepted, and 25/27 of those behaved correctly. The
remaining failures were real and are fixed:

| Remaining failure | Fix |
| --- | --- |
| Model declared `{"Orders": [], "Payments": []}` for a `COUNT(*)`-only query; the engine rejected an empty column list. | A declared table may have no columns; its row ids are still registered. |
| Model listed the internal `__row` in `tableColumns`. | Dropped deterministically. |
| FK rule flagged blank keys; the request did not say whether blanks count. | Golden request now states that blank ids are ignored (this was an ambiguous eval case, not only a model error). |

After the fixes the same replay is 30/30 accepted on the first attempt. This is a replay of recorded outputs, **not** a new live
run — re-run the evaluation to confirm.

**Operational lessons.** (1) Restart the rules service after changing `Validation-Service`; `/healthz` now reports
`features: ["nl-cross-sheet-v1"]` and the evaluation refuses to run against a service that does not (`--skip-service-check`
overrides). (2) **Deploy the Python service before (or with) the Back-End**: an old service rejects `relatedRows` as an unknown
field, so every cross-sheet proposal fails until it is updated.

### First live evaluation (gpt-5.6-luna, 26 prompts) and the response to it

Accepted rules were always right (10/10 behaved correctly on the sample data; 5/5 unsafe requests were refused), but only
10 of 21 valid requests produced a rule and **cross-sheet SQL produced 0 of 9**. 11 of 12 correction attempts failed, and the
failed requests used ~83 % of all output tokens. The causes were proposal-shape problems, not the engine:

| Observed failure (cases) | Change |
| --- | --- |
| Example used a column not in `tableColumns` (4) | For query rules the schema columns used by examples are declared automatically; unknown columns/sheets get precise feedback (example label, column, sheet, declared schema). |
| Missing passing or failing example (3) | The model now returns `passingExamples` and `failingExamples` (the verdict is no longer a field it can get wrong); the backend requires both to be non-empty (strict structured outputs do not reliably support `minItems`). |
| Query rule had a non-null table (1) | Normalised to `null` (also `reconcile`). |
| Malformed built-in `unique` for case-insensitive uniqueness (1); pattern requests answered with SQL (2) | Prompt hints for choosing `pattern`, and for case-insensitive/cross-sheet uniqueness needing query mode. |
| Generic correction feedback; whole proposal discarded for one bad example | Feedback names the example and column; example-shape failures rewrite **only the examples** and keep the validated SQL. |
| Few worked patterns in the prompt | Added FK (`NOT EXISTS`), matched-row compare, per-key CTE total, case-insensitive uniqueness and whole-file patterns, and a `relatedRows` fragment. |
| Report could not show *why* a case failed | `onDiagnostic` records each model call (response id, input/output tokens, proposal) and each validator problem; the eval report includes it. |

The retry limit is intentionally unchanged: re-run the live evaluation and look at `recoveredAfterCorrection` before adding calls.
These changes are covered by offline tests only; **their effect on the live model is not yet measured**.

## Testing and evaluation

* **Golden corpus** — [`samples/nl-rules/golden.json`](../samples/nl-rules/golden.json): 27 prompts (built-in, row SQL, query SQL,
  10 cross-sheet, 5 rejections incl. prompt injection/external data), each with a reference proposal, violating/clean sample
  data and the expected failing rows.
  * `Validation-Service/tests/rules/test_golden_corpus.py` runs every reference rule through contract validation, example
    testing and the real engine (violating data flags exactly the expected rows; clean data passes).
  * `Back-End/tests/NaturalLanguageGolden.test.ts` runs every reference proposal through the proposal pipeline with the
    model stubbed (in the model's passing/failing output format).
  * `Back-End/tests/NaturalLanguageReliability.test.ts` covers precise feedback, examples-only regeneration, normalisation,
    prompt guidance and diagnostics.
  * `Validation-Service/tests/rules/test_cross_sheet.py` covers cross-sheet engine, example, validator and `sqlguard` behaviour.
* **Live evaluation (opt-in, billable)** — measures the real model:

  ```powershell
  cd Back-End
  npm run eval:nl-rules -- --category cross-sheet          # dry run: prints what would be called
  npm run eval:nl-rules --yes                               # full corpus, one run
  npm run eval:nl-rules -- --yes --category cross-sheet --repeat 3 --out ../temp/nl-eval.json
  cd ../Validation-Service
  uv run python scripts/score_nl_eval.py ../temp/nl-eval.json   # data-behaviour score per category
  ```

  Needs `AZURE_FOUNDRY_*`, `az login` and the rules service running. At most 3 model calls per prompt per run (two rule
  proposals and one examples-only rewrite). Reports go to `Back-End/eval-results/` (git-ignored: they contain raw model output
  and each case's `diagnostics`). Per category the summary shows decision/type match, `runnable`, `corrected` /
  `recoveredAfterCorrection`, model calls and input/output tokens; the scorer checks that each generated rule flags exactly the
  expected rows on the sample data. Suggested targets for cross-sheet: ≥ 90 % runnable, 100 % behaviour match for accepted
  rules, ≥ 60 % recovery after correction, and no regression in the 5/5 safety rejections.
