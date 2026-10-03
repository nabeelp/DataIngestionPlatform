# Intentional differences from the Node baseline

WP8 compares the Python result for every `kind: "upload"` fixture in
`samples/manifest.json` with the committed Node JSON in `node-baseline/`.
`test_node_baseline.py` permits only the fixture/check differences below and
fails if an allowed difference disappears or any other difference appears.
The Python result was run against all 109 upload fixtures; the final comparison
passed with no unexplained differences.

| Finding | Sample file | Affected result | Verified Python-vs-Node difference |
|---|---|---|---|
| A1 | `samples/04-file-handling/customers_zero_bytes.xlsx` | `File definition columns`, `Key customer columns present`, and row rules | The Node engine passes an empty workbook. Python reports all required headers missing; row rules referencing absent columns are `ERROR` under A7. |
| A1, A7 | `samples/04-file-handling/finance_zero_bytes.xlsx` | Structural, column, and row-rule checks | Python reports missing required sheets/columns and `ERROR` for row rules referencing absent columns. The Node baseline passes the empty workbook. |
| A1 | `samples/02-sheet-tables/finance/finance_invalid_missing_credit_notes_sheet.xlsx` | `Credit Notes` column and structural checks | Python reports the missing sheet structurally and each required column as missing. Node reports a single missing-sheet issue. |
| A1 | `samples/02-sheet-tables/finance/finance_invalid_similar_sheet_names_only.xlsx` | All three sheet-column checks and structural check | Python reports all declared sheets and their required columns missing. Node reports one missing-sheet issue per table. Node's `rowCount` also includes rows from the unrelated sheets; Python counts only rows from declared table sheets (225 vs. 0). |
| A1, A7 | `samples/02-sheet-tables/finance/finance_invalid_empty_payments_sheet.xlsx` | `Payments` column and row-rule checks | Python reports every required column missing and marks row rules with missing columns `ERROR`; Node reports one missing-sheet issue and leaves those rules passed. |
| A1 | `samples/02-sheet-tables/finance/finance_invalid_unrelated_workbook.xlsx` | All sheet-column checks and structural check | Python reports the three required sheets/columns missing. Node reports one missing-sheet issue per table. Node counts unrelated rows (20); Python's count is 0. |
| A1 | `samples/02-sheet-tables/hr/hr_invalid_sheet_name_without_apostrophe.xlsx` | Emergency-contact column and structural checks | Python reports the missing declared sheet and each required column; Node reports a single missing-sheet issue. Node counts rows from the other sheets (120 vs. 80). |
| A1, A7 | `samples/02-sheet-tables/hr/hr_invalid_missing_employees_and_benefits.xlsx` | Employee/benefits columns and `Employee key columns present` | Python reports missing sheets/required columns; the file-level required-column rule fails. Node does not invoke that rule for the absent sheets. Node counts rows from the remaining sheet (80 vs. 40). |
| A3 | `samples/01-single-table/customers/customers_invalid_duplicate_headers.csv` | `File definition columns` and structural check | Python emits the duplicate-header structural error with header positions. The Python schema check passes; Node merges duplicate names and reports cell-level errors. |
| A4 | `samples/01-single-table/customers/customers_invalid_ragged_rows.csv` | Structural, column, and row-count results | Python reports malformed records with physical line numbers and evaluates only valid records (row count 6). Node reports cell errors and counts all 12 records. |
| A5 | `samples/01-single-table/customers/customers_valid_mixed_date_formats.csv` | Date column and upload status | With no declared date format, Python rejects the 21 non-ISO text dates; Node accepts them. |
| A5 | `samples/01-single-table/sales-orders/orders_valid_date_format_variants.csv` | Date columns and upload status | With no declared date formats, Python rejects 56 non-ISO text dates; Node accepts them. |
| A5 | `samples/01-single-table/sales-orders/orders_quirk_impossible_dates_accepted.csv` | `OrderDate` and upload status | Python rejects 5 impossible calendar dates that Node rolls over and accepts. |
| A7 | `samples/01-single-table/customers/customers_warning_optional_columns_missing.csv` | `Phone number provided` and upload status | The optional `Phone` header is absent but referenced by a rule. Python reports `ERROR` for that missing rule column; Node reports a warning. |
| A7 | `samples/01-single-table/customers/customers_invalid_header_case_mismatch.csv` | Country, customer-status, and phone rules | Python treats rule references to case-mismatched headers as missing-column configuration errors. Node reports failed/warning rule results instead. |
| A7 | `samples/01-single-table/customers/customers_empty_file.csv` | Country, customer-status, and phone rules | Python reports `ERROR` for rule columns absent from the headerless file; Node reports failed/warning checks. |
| A3, A7 | `samples/01-single-table/customers/customers_xlsx_title_row_above_header.xlsx` | Structural and row-rule checks | Python reports the structural header issue and `ERROR` for rules whose columns are absent from the selected header. Node reports failed/warning rule results. |
| A7 | `samples/01-single-table/customers/customers_xlsx_extra_notes_sheet.xlsx` | Country, customer-status, and phone rules on the Notes sheet | The one-table definition is evaluated against every non-empty visible sheet. Python marks rules with absent Notes-sheet columns `ERROR`; Node reports failed/warning checks. |
| A7 | `samples/02-sheet-tables/finance/finance_invalid_missing_required_column.xlsx` | `Payment method allowed values` | Python marks the rule `ERROR` because its referenced column is missing; Node reports a failed rule result. |
| A7 | `samples/04-file-handling/customers_single_column_no_delimiter.txt` | Country, customer-status, and phone rules | Python reports `ERROR` for rule columns absent from the parsed single-column header; Node reports failed/warning checks. |
| Signature validation | `samples/04-file-handling/customers_csv_renamed_to_xlsx.xlsx` | File outcome | Python rejects the CSV content with an `.xlsx` extension as an unrecoverable signature mismatch; Node accepts and validates it. |
| Signature validation | `samples/04-file-handling/customers_random_binary.csv` | File outcome | Python classifies the binary content as an unrecoverable signature/format error. Node attempts validation and reports missing columns. |
| Encoding detection | `samples/04-file-handling/customers_utf16le_no_bom.csv` | Upload status and row/check counts | Python detects UTF-16LE without a BOM and validates it successfully. Node reports failed checks; its row count is 26 versus Python's 25. |
| Reader capacity | `samples/05-large/orders_xlsx_excel_max_rows.xlsx` | File outcome | Python reads and validates 1,048,575 data rows; the Node baseline records a read error. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid.xlsx` | `rowCount` | Python counts the 225 rows in declared table sheets; Node counts 241 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid.xls` | `rowCount` | Python counts 225 rows in declared table sheets; Node counts 226 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid_sheet_names_case_and_spacing.xlsx` | `rowCount` | Python counts 225 rows in declared table sheets; Node counts 230 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid_20_ignored_sheets.xlsx` | `rowCount` | Python counts 225 rows in declared table sheets; Node counts 682 rows including sheets outside the definition. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid_similar_named_ignored_sheets.xlsx` | `rowCount` | Python counts 225 rows in declared table sheets; Node counts 270 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_valid_excel_tables_and_formulas.xlsx` | `rowCount` | Python counts 225 rows in declared table sheets; Node counts 230 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_invalid_missing_credit_notes_sheet.xlsx` | `rowCount` | Python counts declared table rows (210); Node also counts 3 rows from unrelated sheets (213). |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_invalid_similar_sheet_names_only.xlsx` | `rowCount` | Python counts no declared table rows; Node counts 225 rows from similarly named but undeclared sheets. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_invalid_errors_in_every_sheet.xlsx` | `rowCount` | Python counts the 225 rows in declared table sheets; Node counts 228 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/finance/finance_invalid_unrelated_workbook.xlsx` | `rowCount` | Python counts no declared table rows; Node counts 20 rows from unrelated sheets. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/hr/hr_valid.xlsx` | `rowCount` | Python counts 120 rows in declared table sheets; Node counts 161 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/hr/hr_invalid_sheet_name_without_apostrophe.xlsx` | `rowCount` | Python counts 80 rows in declared table sheets; Node counts 120 rows across the workbook. |
| Unconfigured-sheet row count | `samples/02-sheet-tables/hr/hr_invalid_missing_employees_and_benefits.xlsx` | `rowCount` | Python counts 40 rows in the remaining declared table; Node counts 80 rows across the workbook. |
| Unconfigured-sheet row count | `samples/05-large/finance_large_used_and_ignored_sheets.xlsx` | `rowCount` | Python counts 290,000 rows in declared table sheets; Node counts 540,000 rows including extra sheets. |

The header-only sample
(`samples/01-single-table/customers/customers_header_only.csv`) is not a
difference: it passes when `minRows` is unset. A configured `minRows: 1`
continues to fail for zero data rows.

The 5,000-row sample
(`samples/01-single-table/customers/customers_invalid_many_errors_5000_rows.csv`)
is also not a difference: Python stores the first 100 issues per check and
preserves the full issue count, matching the baseline.

The upload fixtures do not exercise every §6 rule subcase, such as `Infinity`,
`NaN`, numeric overflow, `SKIPPED` matching, aggregate/reconciliation failures,
or relative-date determinism. Those remain covered by focused engine tests and
must not be added to this golden-difference allowlist without a verified,
documented reason.
