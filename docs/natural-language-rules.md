# Natural-language rules and cross-sheet checks

How a plain-language request becomes a validated `RuleConfig`, how cross-sheet rules work, the design findings behind the
current behaviour, and how to evaluate generation quality.

## Pipeline

```
Admin request ──► Back-End services/naturalLanguageRule/ ──► Citadel APIM ──► model (strict JSON schema)
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

## Design findings

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

### Evaluation results and lessons

Four live evaluations of the full corpus (26 prompts, plus cross-sheet repeats) drove the current prompt and guard design. The latest cross-sheet
run met its targets:

| Metric | Result | Target |
| --- | --- | --- |
| Runnable | 30/30 | ≥ 90 % |
| Behaviour match on the sample data | 30/30 | 100 % |
| First-attempt success | 29/30 | — |
| Recovered after correction | 1/1 | ≥ 60 % |
| Model calls / input / output tokens | 31 / 114k / 21.5k | — |
| Latency avg / p95 | 9.8 s / 13.5 s | — |

Single-sheet, built-in and rejection categories were last measured before the final example/feedback changes; run the full corpus
(`npm run eval:nl-rules --yes`) before treating them as regression-free.

Design rules that came out of those runs:

* Accepted rules were always right; the failures were proposal-shape problems. The model therefore returns `passingExamples` and
  `failingExamples` separately (the verdict is not a field it can get wrong), and the backend requires both to be non-empty.
* Correction feedback names the example, column and sheet involved. Example-only failures rewrite just the examples and keep the validated SQL.
* The prompt rejects any request that names an external system, even when a similarly named sheet exists, and never substitutes a sheet for an
  external source. Failing examples must not rely on blank values in declared columns of a row rule (the engine skips those rows); rules that
  compare rows need the other rows in `relatedRows`, even within one table.
* `sqlguard` resolves a CTE's output columns through any alias given to the CTE, but an alias cannot expose columns the CTE does not produce.
  A declared table may have no columns (its row ids are still registered), and the internal `__row` is dropped from `tableColumns`.
* Dropped connections are retried; authorization and 4xx errors are not. The evaluation classifies outages (`infrastructureError`), reports them
  separately and aborts after three in a row so an outage does not spend model calls.

**Operational lessons.** (1) Restart the rules service after changing `Validation-Service`; `/healthz` reports `features: ["nl-cross-sheet-v1"]` and the
evaluation refuses to run against a service that does not (`--skip-service-check` overrides). (2) **Deploy the Python service before (or with) the
Back-End**: an older service rejects `relatedRows` as an unknown field, so every cross-sheet proposal fails until it is updated.

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

  Needs `CITADEL_SUBSCRIPTION_KEY`, optional `CITADEL_ENDPOINT`/`CITADEL_MODEL`, and the rules service running. At most 3 model calls per prompt per run (two rule
  proposals and one examples-only rewrite). Reports go to `Back-End/eval-results/` (git-ignored: they contain raw model output
  and each case's `diagnostics`). Per category the summary shows decision/type match, `runnable`, `corrected` /
  `recoveredAfterCorrection`, model calls and input/output tokens; the scorer checks that each generated rule flags exactly the
  expected rows on the sample data. Suggested targets for cross-sheet: ≥ 90 % runnable, 100 % behaviour match for accepted
  rules, ≥ 60 % recovery after correction, and no regression in the 5/5 safety rejections.
