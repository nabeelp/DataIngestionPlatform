# Intentional differences from the Node baseline

This file records expected differences caused by the accepted behaviours in
`docs/implementation-plan-python-engine.md` §6. Each difference must be checked
against the captured Node JSON during WP8; any other mismatch is unexplained and
must be investigated. These entries describe target semantics, not unverified
claims about a Python run.

| Finding | Sample file | Check affected | Expected difference |
|---|---|---|---|
| A1 | `samples/04-file-handling/customers_zero_bytes.xlsx` | `File definition columns` | The Node engine passes an empty single-table workbook. The new engine reports each required header as missing. |
| A2 | `samples/01-single-table/customers/customers_header_only.csv` | Table row-count check | It continues to pass when `minRows` is unset; if the new contract explicitly sets `minRows: 1`, the check fails with zero data rows. New UI tables default to 1, but this legacy sample definition does not declare that default. |
| A3 | `samples/01-single-table/customers/customers_invalid_duplicate_headers.csv` | `File definition columns` / structural check | The Node engine merges duplicate names and reports cell validation errors. The new engine reports a structural error naming the duplicate header positions. |
| A4 | `samples/01-single-table/customers/customers_invalid_ragged_rows.csv` | Structural check and affected row checks | The Node engine reports missing required cells and ignores extra trailing fields. The new engine reports expected versus actual field counts at physical line numbers, while still evaluating valid records. |
| A5 | `samples/01-single-table/sales-orders/orders_quirk_impossible_dates_accepted.csv` | `File definition columns.OrderDate` | Dates that roll over to a later calendar date in the Node engine fail strict calendar validation in the new engine. |
| A5 | `samples/01-single-table/customers/customers_valid_mixed_date_formats.csv`; `samples/01-single-table/sales-orders/orders_valid_date_format_variants.csv` | `File definition columns` date columns | Non-ISO text dates fail when a new contract has no explicit `format`; they pass when their accepted format is declared. Native Excel date cells remain valid. |
| Unrecoverable files | `samples/04-file-handling/customers_csv_renamed_to_xlsx.xlsx` | Upload/file outcome | The Node reader accepts the CSV content despite the `.xlsx` extension. Signature checking rejects it before rule execution. |
| Unrecoverable files | `samples/04-file-handling/customers_corrupt_truncated.xlsx`; `samples/01-single-table/customers/customers_invalid_unclosed_quote.csv` | Upload/file outcome | These are marked unrecoverable and completed without retry; the Node harness records only a read error. |
| Unrecoverable files | `samples/04-file-handling/customers_random_binary.csv` | Upload/file outcome | The Node engine attempts row validation and reports missing columns. The new engine classifies the content as an unrecoverable signature/format error. |

The current upload fixtures do not exercise `Infinity`, `NaN`, numeric overflow,
`SKIPPED` result matching, file-level aggregate/reconciliation issues, or
relative-date determinism. Those required behaviours need focused tests; they
must not be introduced as unexplained differences in this baseline.

The 5,000-row sample (`samples/01-single-table/customers/customers_invalid_many_errors_5000_rows.csv`)
is not an intended difference: the new engine must store the first 100 issues
per check and preserve the full issue count, matching the baseline contract.
