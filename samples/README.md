# Sample files

Test files for every upload and definition scenario of the Data Ingestion Platform: file formats, encodings, one-table and one-table-per-sheet definitions, every rule type and severity, example-file proposals, rejected and corrupt files, and very large files. The manifest records the expected sample outcomes. The Python golden suite compares upload fixtures against the captured WP0 Node baselines.

> **Generated content.** This README, the sample files, `manifest.json`, `.gitignore` and `definitions/` are produced by [tools/generate_samples.py](tools/generate_samples.py). Change the generator, not the output. All data is synthetic (fixed random seed); e-mail addresses use `example.com`/`.example` domains.

## Set up the sample definitions

The files are validated against five sample definitions. The one-table ones reuse the columns of the seeded `Customer Data`, `Product Catalog` and `Sales Orders` definitions, so the column checks behave the same with those.

| Key | Definition | Layout | Tables / rules |
|---|---|---|---|
| `customers` | Sample - Customers | One table | 12 columns; 4 rules |
| `products` | Sample - Products | One table | 12 columns; 6 rules |
| `orders` | Sample - Sales Orders | One table | 11 columns; 5 rules |
| `finance` | Sample - Finance Workbook | One table per sheet | `Invoices`, `Payments`, `Credit Notes`; 8 rules |
| `hr` | Sample - HR Onboarding Workbook | One table per sheet | `Employees`, `Benefits (2026)`, `Employee Emergency Contacts '26`; 8 rules |

1. Run [definitions/sample_definitions.sql](definitions/sample_definitions.sql) against the application database (after the scripts in `Back-End/database`, including `seed_local_users.sql`), using the database configured by `SQLCMD_DATABASE` in `Back-End/.env`.
2. Publish each draft definition in the application to create its version snapshot.
3. The script gives the seeded test user access. Alternatively, create the definitions in the UI from [definitions/sample_definitions.json](definitions/sample_definitions.json).

The dedicated Playwright corpus run publishes these drafts, uploads every upload fixture through the **Upload** page, and sends every example fixture through the analysis API. It checks final status, counts, issue reports and delivery.

## Verify and regenerate

```powershell
# Regenerate (pip install xlsxwriter xlwt). --skip-large skips 05-large/, --skip-max-rows skips the 1M-row workbook.
python samples\tools\generate_samples.py

# Compare every upload sample with its captured WP0 Node baseline.
cd Validation-Service
uv run pytest tests/golden/test_node_baseline.py -q

# With .\start.ps1 running and the sample definitions seeded, exercise every fixture through the local stack.
cd ..\Front-End
npm run test:e2e:samples
```

Expected statuses: **Passed**, **Passed with warnings** (only Warning-severity checks failed; the upload is accepted and delivered when a target is configured), **Failed** (an Error-severity check failed), **Failed (read error)** (the file could not be parsed), and **Rejected at upload** (refused before validation: extension, size or CSV for a sheet-table definition).

## Behaviors these samples surface

- **One-table definitions validate every sheet.** An extra "Notes" or "Summary" sheet fails the upload (`customers_xlsx_extra_notes_sheet.xlsx`). Use a one-table-per-sheet definition when workbooks carry extra sheets.
- **Header names are case-sensitive; sheet names are not.** `customerid` does not match `CustomerId`, while a sheet named `  INVOICES ` matches `Invoices`.
- **Enum checks are case-sensitive but trimmed**: `active` fails, `  Prospect  ` passes.
- **Duplicate headers: the last one wins.** A second, empty `Email` column makes every Email look blank.
- **Title rows break the header.** The first non-empty row is the header; blank rows above it are fine.
- **An empty table sheet counts as missing.** A `Payments` sheet with no cells is reported as "Required sheet not found".
- **Date parsing is strict.** ISO dates are validated as real calendar dates; non-ISO strings need an explicit format. This intentionally differs from the WP0 Node baseline; see the recorded golden differences.
- **Excel date serials are not dates.** A date cell without a date format is read as a number and fails a datetime column.
- **1/0 columns are proposed as integer, not boolean,** by the example analyzer; change the type before saving if needed.
- **Workbook signatures are checked.** CSV text renamed to `.xlsx` is rejected as a malformed workbook.
- **A zero-byte `.xlsx` passes a one-table definition** (it is read as one empty sheet with nothing to check), whereas a zero-byte CSV fails. Sheet-table definitions fail it because the sheets are missing.
- **Encodings:** UTF-8 (with or without BOM), UTF-16LE with or without a BOM, and Windows-1252 are detected.
- **Random binary content is rejected** as an unrecoverable file-format error.
- **Excel's maximum worksheet row count is supported.** The 1,048,575-row sample is parsed by the Python reader; large workbooks still have substantial memory and processing costs.

## One-table definitions

Columns apply to a CSV file and to **every** sheet of a workbook.

| File | Definition | Expected | Checks | Scenario | Size |
|---|---|---|---|---|---|
| [customers/customers_valid.csv](<01-single-table/customers/customers_valid.csv>) | `customers` | Passed |  | Baseline: 50 clean rows, comma-delimited UTF-8. | 6.2 KB |
| [customers/customers_valid.xlsx](<01-single-table/customers/customers_valid.xlsx>) | `customers` | Passed |  | Baseline workbook: one sheet, native date cells. | 10.2 KB |
| [customers/customers_valid.xls](<01-single-table/customers/customers_valid.xls>) | `customers` | Passed |  | Legacy Excel 97-2003 (.xls) workbook. | 17.5 KB |
| [customers/customers_valid.tsv](<01-single-table/customers/customers_valid.tsv>) | `customers` | Passed |  | Tab-separated (.tsv is always read as tab-delimited). | 6.2 KB |
| [customers/customers_valid_semicolon_delimited.csv](<01-single-table/customers/customers_valid_semicolon_delimited.csv>) | `customers` | Passed |  | Semicolon delimiter is auto-detected from the header line. | 6.2 KB |
| [customers/customers_valid_pipe_delimited.txt](<01-single-table/customers/customers_valid_pipe_delimited.txt>) | `customers` | Passed |  | Pipe-delimited .txt file. | 6.2 KB |
| [customers/customers_valid_tab_delimited.txt](<01-single-table/customers/customers_valid_tab_delimited.txt>) | `customers` | Passed |  | Tab-delimited .txt file (delimiter auto-detected). | 6.2 KB |
| [customers/customers_valid_crlf_line_endings.csv](<01-single-table/customers/customers_valid_crlf_line_endings.csv>) | `customers` | Passed |  | Windows CRLF line endings. | 6.2 KB |
| [customers/customers_valid_utf8_bom_unicode.csv](<01-single-table/customers/customers_valid_utf8_bom_unicode.csv>) | `customers` | Passed |  | UTF-8 with BOM (Excel "CSV UTF-8" export); accented, Cyrillic, Greek, CJK, RTL and emoji names. | 5.1 KB |
| [customers/customers_valid_unicode.xlsx](<01-single-table/customers/customers_valid_unicode.xlsx>) | `customers` | Passed |  | Unicode data and a Unicode sheet name. | 9.3 KB |
| [customers/customers_valid_quoted_fields_multiline.csv](<01-single-table/customers/customers_valid_quoted_fields_multiline.csv>) | `customers` | Passed |  | Every field quoted; embedded commas, doubled quotes and multi-line values count as one record. | 1.6 KB |
| [customers/customers_valid_blank_lines_and_whitespace.csv](<01-single-table/customers/customers_valid_blank_lines_and_whitespace.csv>) | `customers` | Passed |  | Blank lines, all-empty records and padded values are skipped/trimmed. | 3.5 KB |
| [customers/customers_valid_reordered_and_extra_columns.csv](<01-single-table/customers/customers_valid_reordered_and_extra_columns.csv>) | `customers` | Passed |  | Columns in a different order plus undeclared columns (ignored). | 7.3 KB |
| [customers/customers_valid_padded_headers.csv](<01-single-table/customers/customers_valid_padded_headers.csv>) | `customers` | Passed |  | Header names with surrounding spaces are trimmed. | 2.0 KB |
| [customers/customers_valid_mixed_date_formats.csv](<01-single-table/customers/customers_valid_mixed_date_formats.csv>) | `customers` | Passed |  | ISO dates/times with zones and day-first/month-first local formats are all valid datetimes. | 3.9 KB |
| [customers/customers_warning_optional_columns_missing.csv](<01-single-table/customers/customers_warning_optional_columns_missing.csv>) | `customers` | Passed with warnings | warns: Phone number provided | Only required columns present: definition passes; the Warning rule on Phone reports the missing column. | 3.1 KB |
| [customers/customers_warning_unsupported_country_and_missing_phone.csv](<01-single-table/customers/customers_warning_unsupported_country_and_missing_phone.csv>) | `customers` | Passed with warnings | warns: Country is a supported market; Phone number provided | Only Warning-severity rules fail (unsupported/lower-case country, missing phone), so the upload is accepted. | 6.2 KB |
| [customers/customers_invalid_missing_required_column.csv](<01-single-table/customers/customers_invalid_missing_required_column.csv>) | `customers` | Failed | fails: File definition columns; Key customer columns present | Required Email column is absent: definition columns and the schema rule fail. | 4.9 KB |
| [customers/customers_invalid_empty_required_values.csv](<01-single-table/customers/customers_invalid_empty_required_values.csv>) | `customers` | Failed | fails: File definition columns | Required values blank or whitespace-only in 5 rows. | 6.2 KB |
| [customers/customers_invalid_dates.csv](<01-single-table/customers/customers_invalid_dates.csv>) | `customers` | Failed | fails: File definition columns | Ten unparseable DateOfBirth values (invalid month/day, year-first slashes, words, compact dates). | 6.2 KB |
| [customers/customers_invalid_status_values.csv](<01-single-table/customers/customers_invalid_status_values.csv>) | `customers` | Failed | fails: Customer status allowed values | Enum checks are case-sensitive (active/ACTIVE fail) but trim spaces ("  Prospect  " passes). | 6.2 KB |
| [customers/customers_invalid_header_case_mismatch.csv](<01-single-table/customers/customers_invalid_header_case_mismatch.csv>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | Header names are case-sensitive: lower-case headers match no definition column. | 0.7 KB |
| [customers/customers_invalid_duplicate_headers.csv](<01-single-table/customers/customers_invalid_duplicate_headers.csv>) | `customers` | Failed | fails: File definition columns | A second, empty "Email" column overrides the first (last duplicate wins), so Email looks blank. | 1.3 KB |
| [customers/customers_invalid_ragged_rows.csv](<01-single-table/customers/customers_invalid_ragged_rows.csv>) | `customers` | Failed | fails: File definition columns | Short rows (Country/CustomerStatus missing) fail; rows with extra trailing values are accepted. | 1.6 KB |
| [customers/customers_header_only.csv](<01-single-table/customers/customers_header_only.csv>) | `customers` | Passed |  | Header row with no data rows (0 rows) passes. | 0.1 KB |
| [customers/customers_empty_file.csv](<01-single-table/customers/customers_empty_file.csv>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | Zero-byte file: no header, so every column check fails. | 0.0 KB |
| [customers/customers_invalid_unclosed_quote.csv](<01-single-table/customers/customers_invalid_unclosed_quote.csv>) | `customers` | Failed (read error) |  | Malformed CSV (unterminated quoted field): the parser stops and the upload fails with an error message. | 0.8 KB |
| [customers/customers_invalid_many_errors_5000_rows.csv](<01-single-table/customers/customers_invalid_many_errors_5000_rows.csv>) | `customers` | Failed | fails: Customer status allowed values; File definition columns | Thousands of issues: only 100 samples are stored per check, but the total count is exact. | 614.1 KB |
| [customers/customers_xlsx_blank_rows_above_header.xlsx](<01-single-table/customers/customers_xlsx_blank_rows_above_header.xlsx>) | `customers` | Passed |  | Header on row 4 (first non-empty row) and blank rows between data blocks are skipped. | 8.5 KB |
| [customers/customers_xlsx_title_row_above_header.xlsx](<01-single-table/customers/customers_xlsx_title_row_above_header.xlsx>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | A title row above the headers becomes the header row, so no definition column is found. | 8.5 KB |
| [customers/customers_xlsx_multi_sheet_same_columns.xlsx](<01-single-table/customers/customers_xlsx_multi_sheet_same_columns.xlsx>) | `customers` | Passed |  | One-table definition: every sheet is validated against the same columns (4 x 50 rows). | 23.7 KB |
| [customers/customers_xlsx_extra_notes_sheet.xlsx](<01-single-table/customers/customers_xlsx_extra_notes_sheet.xlsx>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | One-table definitions validate EVERY sheet, so an extra "Notes" sheet fails. Use a sheet-table definition to ignore extra sheets. | 10.7 KB |
| [customers/customers_xlsx_with_empty_sheet.xlsx](<01-single-table/customers/customers_xlsx_with_empty_sheet.xlsx>) | `customers` | Passed |  | Completely empty sheets have no header and are skipped by one-table definitions. | 10.9 KB |
| [customers/customers_xlsx_native_types_and_formulas.xlsx](<01-single-table/customers/customers_xlsx_native_types_and_formulas.xlsx>) | `customers` | Passed |  | Native date/number cells, numeric ZipCode/Phone in string columns, extra formula columns (cached values). | 11.4 KB |
| [customers/customers_xlsx_excel_table_object.xlsx](<01-single-table/customers/customers_xlsx_excel_table_object.xlsx>) | `customers` | Passed |  | Data formatted as an Excel Table (ListObject). | 10.8 KB |
| [customers/customers_xlsx_protected_sheet.xlsx](<01-single-table/customers/customers_xlsx_protected_sheet.xlsx>) | `customers` | Passed |  | Sheet protection (not file encryption) does not prevent reading. | 10.1 KB |
| [products/products_valid.csv](<01-single-table/products/products_valid.csv>) | `products` | Passed |  | Baseline: 80 clean products. | 10.1 KB |
| [products/products_valid.xlsx](<01-single-table/products/products_valid.xlsx>) | `products` | Passed |  | Native numeric and TRUE/FALSE boolean cells. | 12.3 KB |
| [products/products_valid_boolean_variants.csv](<01-single-table/products/products_valid_boolean_variants.csv>) | `products` | Passed |  | Every accepted boolean spelling: true/false, yes/no, y/n, 1/0 (any case). | 2.6 KB |
| [products/products_valid_numeric_boundaries.csv](<01-single-table/products/products_valid_numeric_boundaries.csv>) | `products` | Passed |  | Inclusive range bounds, signed/leading-dot/scientific numbers and leading zeros are accepted. | 0.7 KB |
| [products/products_invalid_number_formats.csv](<01-single-table/products/products_invalid_number_formats.csv>) | `products` | Failed | fails: File definition columns; Unit price range<br>warns: Reorder level ceiling; Reorder level is a whole number | Comma decimals, currency symbols, thousands separators, 10.5/1e3 as integers and non-boolean flags. | 1.1 KB |
| [products/products_invalid_range_violations.csv](<01-single-table/products/products_invalid_range_violations.csv>) | `products` | Failed | fails: Stock quantity range; Unit price range<br>warns: Reorder level ceiling; Weight is not negative | Just outside each range bound; the weight and reorder rules are Warnings. | 2.6 KB |
| [products/products_warning_only_ranges.csv](<01-single-table/products/products_warning_only_ranges.csv>) | `products` | Passed with warnings | warns: Reorder level ceiling; Weight is not negative | Only Warning-severity range rules fail. | 2.6 KB |
| [products/products_invalid_category.csv](<01-single-table/products/products_invalid_category.csv>) | `products` | Failed | fails: Category allowed values | Unknown and wrong-case categories. | 2.6 KB |
| [products/products_xlsx_numbers_stored_as_text.xlsx](<01-single-table/products/products_xlsx_numbers_stored_as_text.xlsx>) | `products` | Passed |  | Numbers and booleans stored as text cells (green-triangle cells) still match their types. | 12.4 KB |
| [products/products_xlsx_formulas_with_cached_values.xlsx](<01-single-table/products/products_xlsx_formulas_with_cached_values.xlsx>) | `products` | Passed |  | UnitPrice is a formula; its cached value is what gets validated. | 13.2 KB |
| [products/products_xlsx_max_cell_length.xlsx](<01-single-table/products/products_xlsx_max_cell_length.xlsx>) | `products` | Passed |  | Description cells at Excel's 32,767-character limit. | 6.7 KB |
| [sales-orders/orders_valid.csv](<01-single-table/sales-orders/orders_valid.csv>) | `orders` | Passed |  | Baseline: 500 orders, optional ShipDate/Notes sometimes blank. | 58.1 KB |
| [sales-orders/orders_valid.xlsx](<01-single-table/sales-orders/orders_valid.xlsx>) | `orders` | Passed |  | Baseline workbook. | 39.6 KB |
| [sales-orders/orders_valid_date_format_variants.csv](<01-single-table/sales-orders/orders_valid_date_format_variants.csv>) | `orders` | Passed |  | Accepted date/time spellings in both date columns. | 5.3 KB |
| [sales-orders/orders_invalid_dates.csv](<01-single-table/sales-orders/orders_invalid_dates.csv>) | `orders` | Failed | fails: File definition columns | Invalid OrderDate values and an invalid optional ShipDate. _"2026-02-30" style dates that roll over are accepted; see orders_quirk_impossible_dates_accepted.csv._ | 4.8 KB |
| [sales-orders/orders_quirk_impossible_dates_accepted.csv](<01-single-table/sales-orders/orders_quirk_impossible_dates_accepted.csv>) | `orders` | Passed |  | Impossible calendar dates (30 Feb, 31 Apr, 29 Feb in a non-leap year) are accepted: ISO dates roll over and local dates only check day <= 31 and month <= 12. _Gap: stricter date validation would reject these._ | 1.3 KB |
| [sales-orders/orders_invalid_currency_and_payment_status.csv](<01-single-table/sales-orders/orders_invalid_currency_and_payment_status.csv>) | `orders` | Failed | fails: Currency allowed values; Payment status allowed values | Enum violations in two columns. | 4.8 KB |
| [sales-orders/orders_warning_negative_discount.csv](<01-single-table/sales-orders/orders_warning_negative_discount.csv>) | `orders` | Passed with warnings | warns: Discount is not negative | Negative discounts only trip a Warning rule. | 4.8 KB |
| [sales-orders/orders_invalid_long_text_values.csv](<01-single-table/sales-orders/orders_invalid_long_text_values.csv>) | `orders` | Failed | fails: File definition columns; Order total range | A 500+ character invalid value (reported values are truncated to 200 characters) and a 5,000 character note. | 6.7 KB |
| [sales-orders/orders_xlsx_one_sheet_per_month.xlsx](<01-single-table/sales-orders/orders_xlsx_one_sheet_per_month.xlsx>) | `orders` | Passed |  | 12 monthly sheets, all validated by the one-table definition. | 93.2 KB |
| [sales-orders/orders_xlsx_dates_as_serial_numbers.xlsx](<01-single-table/sales-orders/orders_xlsx_dates_as_serial_numbers.xlsx>) | `orders` | Failed | fails: File definition columns | Dates stored as plain numbers (Excel serials without a date format) are not datetimes. | 7.2 KB |
| [sales-orders/orders_valid_datetimes.xls](<01-single-table/sales-orders/orders_valid_datetimes.xls>) | `orders` | Passed |  | Legacy .xls with date-time cells. | 9.5 KB |

## One-table-per-sheet definitions

Each table matches a sheet by name (case-insensitive, trimmed); other sheets are ignored; CSV is rejected.

| File | Definition | Expected | Checks | Scenario | Size |
|---|---|---|---|---|---|
| [finance/finance_valid.xlsx](<02-sheet-tables/finance/finance_valid.xlsx>) | `finance` | Passed |  | All three table sheets plus ignored Instructions/Lookups/Summary (formulas), a hidden and a very-hidden sheet. | 21.1 KB |
| [finance/finance_valid.xls](<02-sheet-tables/finance/finance_valid.xls>) | `finance` | Passed |  | Legacy .xls workbook with the three table sheets. | 37.5 KB |
| [finance/finance_valid_sheet_names_case_and_spacing.xlsx](<02-sheet-tables/finance/finance_valid_sheet_names_case_and_spacing.xlsx>) | `finance` | Passed |  | Sheets matched ignoring case and surrounding spaces, in any order. | 18.6 KB |
| [finance/finance_valid_20_ignored_sheets.xlsx](<02-sheet-tables/finance/finance_valid_20_ignored_sheets.xlsx>) | `finance` | Passed |  | 20 extra sheets full of invalid data are ignored (not validated). | 36.3 KB |
| [finance/finance_valid_similar_named_ignored_sheets.xlsx](<02-sheet-tables/finance/finance_valid_similar_named_ignored_sheets.xlsx>) | `finance` | Passed |  | Look-alike sheets ("Invoices (old)", "Invoices_backup", "Payments 2025") contain bad data but are not table sheets. | 21.8 KB |
| [finance/finance_valid_hidden_table_sheet.xlsx](<02-sheet-tables/finance/finance_valid_hidden_table_sheet.xlsx>) | `finance` | Passed |  | A hidden table sheet (Payments) is still found and validated. | 18.1 KB |
| [finance/finance_valid_header_only_credit_notes.xlsx](<02-sheet-tables/finance/finance_valid_header_only_credit_notes.xlsx>) | `finance` | Passed |  | Credit Notes has a header row and no data rows: the table is present, so it passes. | 17.4 KB |
| [finance/finance_valid_excel_tables_and_formulas.xlsx](<02-sheet-tables/finance/finance_valid_excel_tables_and_formulas.xlsx>) | `finance` | Passed |  | Each table sheet is an Excel Table; Invoice Amount is a formula (=Net+Tax) with extra helper columns. | 23.6 KB |
| [finance/finance_warning_missing_po_and_reason.xlsx](<02-sheet-tables/finance/finance_warning_missing_po_and_reason.xlsx>) | `finance` | Passed with warnings | warns: Credit note reason provided; Invoice has a PO number | Optional PONumber/Reason missing: only the Warning rules for those sheets fail. | 18.0 KB |
| [finance/finance_invalid_missing_credit_notes_sheet.xlsx](<02-sheet-tables/finance/finance_invalid_missing_credit_notes_sheet.xlsx>) | `finance` | Failed | fails: Sheet "Credit Notes" columns | A required table sheet is missing: its columns check fails; its rules have nothing to check. | 17.4 KB |
| [finance/finance_invalid_similar_sheet_names_only.xlsx](<02-sheet-tables/finance/finance_invalid_similar_sheet_names_only.xlsx>) | `finance` | Failed | fails: Sheet "Credit Notes" columns; Sheet "Invoices" columns; Sheet "Payments" columns | Near-miss names ("Invoice", "Payments 2026", "CreditNotes") do not match, so all three sheets are missing. | 18.1 KB |
| [finance/finance_invalid_empty_payments_sheet.xlsx](<02-sheet-tables/finance/finance_invalid_empty_payments_sheet.xlsx>) | `finance` | Failed | fails: Sheet "Payments" columns | A completely empty "Payments" sheet has no header row and is reported as not found. | 13.9 KB |
| [finance/finance_invalid_errors_in_every_sheet.xlsx](<02-sheet-tables/finance/finance_invalid_errors_in_every_sheet.xlsx>) | `finance` | Failed | fails: Credit note amount range; Invoice amount is positive; Invoice currency allowed values; Invoice status allowed values; Payment amount range; Payment method allowed values; Sheet "Credit Notes" columns; Sheet "Invoices" columns; Sheet "Payments" columns | Type, enum, range and required-value errors in each table; issues are reported with their sheet name. | 18.7 KB |
| [finance/finance_invalid_missing_required_column.xlsx](<02-sheet-tables/finance/finance_invalid_missing_required_column.xlsx>) | `finance` | Failed | fails: Payment method allowed values; Sheet "Payments" columns | Payments lacks its required Method column: the sheet check and the Method rule fail. | 17.6 KB |
| [finance/finance_invalid_unrelated_workbook.xlsx](<02-sheet-tables/finance/finance_invalid_unrelated_workbook.xlsx>) | `finance` | Failed | fails: Sheet "Credit Notes" columns; Sheet "Invoices" columns; Sheet "Payments" columns | The wrong workbook (a customer list) for a sheet-table definition: every table sheet is missing. | 7.6 KB |
| [finance/finance_rejected_csv_upload.csv](<02-sheet-tables/finance/finance_rejected_csv_upload.csv>) | `finance` | Rejected at upload |  | CSV files have no sheets, so sheet-table definitions reject them at upload (HTTP 400). | 8.8 KB |
| [finance/finance_valid_values_stored_as_text.xlsx](<02-sheet-tables/finance/finance_valid_values_stored_as_text.xlsx>) | `finance` | Passed |  | All dates and amounts are text cells (e.g. pasted from a CSV). | 18.1 KB |
| [hr/hr_valid.xlsx](<02-sheet-tables/hr/hr_valid.xlsx>) | `hr` | Passed |  | Sheet names with parentheses and a 31-character name with an apostrophe; Instructions and Org Chart are ignored. | 13.7 KB |
| [hr/hr_valid_unicode_and_emoji.xlsx](<02-sheet-tables/hr/hr_valid_unicode_and_emoji.xlsx>) | `hr` | Passed |  | Non-Latin scripts, accents and emoji in names. | 11.1 KB |
| [hr/hr_invalid_values.xlsx](<02-sheet-tables/hr/hr_invalid_values.xlsx>) | `hr` | Failed | fails: Benefit plan allowed values; Department allowed values; Dependents range; Salary range | Enum and range errors in the Employees and Benefits sheets. | 12.3 KB |
| [hr/hr_invalid_sheet_name_without_apostrophe.xlsx](<02-sheet-tables/hr/hr_invalid_sheet_name_without_apostrophe.xlsx>) | `hr` | Failed | fails: Sheet "Employee Emergency Contacts '26" columns | The contacts sheet is named without the apostrophe, so it is not matched. | 12.2 KB |
| [hr/hr_warning_cost_relationship_alt_phone.xlsx](<02-sheet-tables/hr/hr_warning_cost_relationship_alt_phone.xlsx>) | `hr` | Passed with warnings | warns: Alternate phone provided; Monthly cost within budget; Relationship allowed values | Only Warning rules in two sheets fail. | 12.2 KB |
| [hr/hr_invalid_boolean_integer_and_date_types.xlsx](<02-sheet-tables/hr/hr_invalid_boolean_integer_and_date_types.xlsx>) | `hr` | Failed | fails: Dependents range; Sheet "Benefits (2026)" columns; Sheet "Employees" columns | Non-boolean FullTime (text and the number 2), non-integer Dependents, bad and missing dates. | 12.2 KB |
| [hr/hr_invalid_missing_employees_and_benefits.xlsx](<02-sheet-tables/hr/hr_invalid_missing_employees_and_benefits.xlsx>) | `hr` | Failed | fails: Sheet "Benefits (2026)" columns; Sheet "Employees" columns | Only one of the three table sheets is present. | 8.4 KB |

## Example files (Admin → File Definitions → Start from an example file)

CSV/XLSX up to 10 MB; up to 1,000 rows per sheet and 20 sheets are analyzed.

| File | Expected | Details | Scenario | Size |
|---|---|---|---|---|
| [example_single_sheet_customers.xlsx](<03-example-files/example_single_sheet_customers.xlsx>) | Proposal | one table | Single populated sheet: proposed as one table for every sheet. | 10.9 KB |
| [example_multi_sheet_finance.xlsx](<03-example-files/example_multi_sheet_finance.xlsx>) | Proposal | one table per sheet | Four populated sheets: proposed as one table per sheet; deselect ReadMe. | 10.2 KB |
| [example_multi_sheet_hr.xlsx](<03-example-files/example_multi_sheet_hr.xlsx>) | Proposal | one table per sheet | Special-character and 31-character sheet names become sheet tables. _Whole-number salaries are proposed as integer; change to decimal if cents are expected._ | 10.3 KB |
| [example_type_inference.csv](<03-example-files/example_type_inference.csv>) | Proposal | one table | Most specific common type per column; 1/0 columns are proposed as integer, not boolean. | 1.5 KB |
| [example_enum_candidates.csv](<03-example-files/example_enum_candidates.csv>) | Proposal | one table | Allowed-values suggestions only for repeating text columns with 2-10 short values without commas or colons. | 5.4 KB |
| [example_blank_header_cells.xlsx](<03-example-files/example_blank_header_cells.xlsx>) | Proposal | warning: "header cell(s) are blank" | Blank header cells are named by position (Column2, Column4...). | 5.7 KB |
| [example_title_row_above_headers.xlsx](<03-example-files/example_title_row_above_headers.xlsx>) | Proposal | warning: "remove any title rows" | Title row becomes the header row; the warning suggests removing it. | 7.6 KB |
| [example_duplicate_headers.csv](<03-example-files/example_duplicate_headers.csv>) | Proposal | warning: "Duplicate headers were merged" | Duplicate headers are merged, with a warning. | 0.1 KB |
| [example_long_column_names.csv](<03-example-files/example_long_column_names.csv>) | Proposal | warning: "exceed 100 characters" | Column names over 100 characters must be shortened before saving. | 0.1 KB |
| [example_header_only.csv](<03-example-files/example_header_only.csv>) | Proposal | warning: "no data rows below the header" | No data rows: every column defaults to an optional string. | 0.1 KB |
| [example_5000_rows_truncated.csv](<03-example-files/example_5000_rows_truncated.csv>) | Proposal | warning: "Only the first 1000 data rows were analyzed." | Only the first 1,000 data rows are analyzed. | 619.9 KB |
| [example_25_sheets.xlsx](<03-example-files/example_25_sheets.xlsx>) | Proposal | one table per sheet<br>warning: "Only the first 20 of 25 sheets are shown." | More than 20 sheets: only the first 20 are shown. | 30.6 KB |
| [example_one_populated_two_empty_sheets.xlsx](<03-example-files/example_one_populated_two_empty_sheets.xlsx>) | Proposal | one table<br>warning: "No header row was found." | Only one populated sheet, so one table is proposed; empty sheets warn. | 8.4 KB |
| [example_all_sheets_empty.xlsx](<03-example-files/example_all_sheets_empty.xlsx>) | Rejected | error: "no header row" | No header row anywhere: rejected. | 5.2 KB |
| [example_not_a_workbook.xlsx](<03-example-files/example_not_a_workbook.xlsx>) | Rejected | error: "not a valid XLSX workbook" | CSV text renamed to .xlsx fails the ZIP signature check. | 0.1 KB |
| [example_legacy_format.xls](<03-example-files/example_legacy_format.xls>) | Rejected | error: "CSV (.csv) or Excel workbooks (.xlsx)" | Example files must be CSV or XLSX (.xls is rejected here, though uploads accept it). | 9.5 KB |
| [example_csv_semicolon.csv](<03-example-files/example_csv_semicolon.csv>) | Proposal | one table | Semicolon-delimited example (delimiter detected like uploads). | 7.5 KB |
| [example_too_large_over_10mb.csv](<03-example-files/example_too_large_over_10mb.csv>) | Rejected | error: "limited to 10 MB" | Just over the 10 MB example limit: rejected before analysis. | 10.3 MB |

## File handling: extensions, encodings, line endings and corrupt files

| File | Definition | Expected | Checks | Scenario | Size |
|---|---|---|---|---|---|
| [customers_unsupported_extension.json](<04-file-handling/customers_unsupported_extension.json>) | `customers` | Rejected at upload |  | Extension not in .csv/.tsv/.txt/.xlsx/.xls. | 0.0 KB |
| [customers_zipped_archive.zip](<04-file-handling/customers_zipped_archive.zip>) | `customers` | Rejected at upload |  | Compressed archives are not accepted. | 1.4 KB |
| [CUSTOMERS_UPPERCASE_EXTENSION.XLSX](<04-file-handling/CUSTOMERS_UPPERCASE_EXTENSION.XLSX>) | `customers` | Passed |  | Upper-case file extension is accepted. | 8.0 KB |
| [customers_macro_enabled.xlsm](<04-file-handling/customers_macro_enabled.xlsm>) | `customers` | Rejected at upload |  | Macro-enabled workbooks (.xlsm) are not accepted. | 8.0 KB |
| [customers export (Q3) – José & Zoë.csv](<04-file-handling/customers export (Q3) – José & Zoë.csv>) | `customers` | Passed |  | File name with spaces, brackets, an en dash, accents and an ampersand (sanitized when stored). | 3.2 KB |
| [customers_corrupt_truncated.xlsx](<04-file-handling/customers_corrupt_truncated.xlsx>) | `customers` | Failed (read error) |  | Truncated ZIP package: the workbook cannot be opened. | 4.0 KB |
| [customers_zero_bytes.xlsx](<04-file-handling/customers_zero_bytes.xlsx>) | `customers` | Passed |  | Empty file with an .xlsx extension is read as one empty sheet, so a one-table definition has nothing to check. _Gap: consider rejecting empty workbooks (a zero-byte CSV fails because it has no header)._ | 0.0 KB |
| [finance_zero_bytes.xlsx](<04-file-handling/finance_zero_bytes.xlsx>) | `finance` | Failed | fails: Sheet "Credit Notes" columns; Sheet "Invoices" columns; Sheet "Payments" columns | The same empty workbook against a sheet-table definition: every table sheet is missing. | 0.0 KB |
| [customers_csv_renamed_to_xlsx.xlsx](<04-file-handling/customers_csv_renamed_to_xlsx.xlsx>) | `customers` | Passed |  | CSV text renamed to .xlsx: the upload reader sniffs the content and reads it as a single sheet. _Unlike example files, uploads do not check the ZIP signature; consider adding that check._ | 3.2 KB |
| [customers_random_binary.csv](<04-file-handling/customers_random_binary.csv>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | Binary content with a .csv extension: no recognizable header. | 4.0 KB |
| [customers_utf16le_bom_encoded.csv](<04-file-handling/customers_utf16le_bom_encoded.csv>) | `customers` | Passed |  | UTF-16LE with a BOM (Excel "Unicode Text") is detected from the BOM and decoded. | 6.3 KB |
| [customers_utf16le_no_bom.csv](<04-file-handling/customers_utf16le_no_bom.csv>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | UTF-16 without a BOM is read as UTF-8, so the headers do not match. Re-save as UTF-8. | 6.3 KB |
| [customers_windows1252_encoded.csv](<04-file-handling/customers_windows1252_encoded.csv>) | `customers` | Passed |  | Windows-1252 (ANSI) encoding: validates, but accented letters are read as replacement characters. | 2.6 KB |
| [customers_cr_only_line_endings.csv](<04-file-handling/customers_cr_only_line_endings.csv>) | `customers` | Passed |  | Classic Mac CR-only line endings. | 3.2 KB |
| [customers_no_trailing_newline.csv](<04-file-handling/customers_no_trailing_newline.csv>) | `customers` | Passed |  | Last record without a trailing newline. | 3.2 KB |
| [customers_single_column_no_delimiter.txt](<04-file-handling/customers_single_column_no_delimiter.txt>) | `customers` | Failed | fails: Customer status allowed values; File definition columns; Key customer columns present<br>warns: Country is a supported market; Phone number provided | A single-column text file: only CustomerId is present. | 0.3 KB |

## Large files (git-ignored, regenerate with the generator)

Row-count, byte-size (100 MB upload limit), width and cell-length stress tests.

| File | Definition | Expected | Checks | Scenario | Size |
|---|---|---|---|---|---|
| [orders_large_250k_rows.csv](<05-large/orders_large_250k_rows.csv>) | `orders` | Passed |  | 250,000 valid rows (~30 MB CSV). | 28.5 MB |
| [orders_large_near_100mb_limit.csv](<05-large/orders_large_near_100mb_limit.csv>) | `orders` | Passed |  | Just under the default 100 MB upload limit (859,000 rows). | 98.0 MB |
| [orders_large_over_100mb_limit.csv](<05-large/orders_large_over_100mb_limit.csv>) | `orders` | Rejected at upload |  | Just over the default 100 MB upload limit (894,000 rows): rejected with HTTP 413/400 (UPLOAD_MAX_FILE_SIZE). | 102.0 MB |
| [orders_large_200k_rows_with_errors.csv](<05-large/orders_large_200k_rows_with_errors.csv>) | `orders` | Failed | fails: Currency allowed values; Order total range | 200,000 rows with 1% bad currencies and 0.4% negative totals: exact totals, 100 samples each. | 22.8 MB |
| [orders_large_250k_rows.xlsx](<05-large/orders_large_250k_rows.xlsx>) | `orders` | Passed |  | 250,000-row single-sheet workbook (~150 MB of sheet XML). | 15.8 MB |
| [orders_large_500k_rows.xlsx](<05-large/orders_large_500k_rows.xlsx>) | `orders` | Passed |  | 500,000-row workbook (~310 MB of sheet XML): near the practical ceiling of the in-memory Excel reader. | 31.5 MB |
| [orders_xlsx_excel_max_rows.xlsx](<05-large/orders_xlsx_excel_max_rows.xlsx>) | `orders` | Failed (read error) |  | Excel's row limit: header + 1,048,575 data rows. The ~650 MB sheet XML exceeds the JavaScript string limit, so the sheet cannot be parsed and the upload fails with a read error. _Gap: the error surfaces as "Cannot read properties of undefined (reading '!ref')"; consider a streaming Excel reader or a clear row/size limit message._ | 66.2 MB |
| [finance_large_used_and_ignored_sheets.xlsx](<05-large/finance_large_used_and_ignored_sheets.xlsx>) | `finance` | Passed |  | Sheet-table definition on 540k rows across 6 sheets; 250k rows are in ignored sheets. | 24.5 MB |
| [customers_wide_500_columns.csv](<05-large/customers_wide_500_columns.csv>) | `customers` | Passed |  | 500 columns (488 undeclared) x 2,000 rows. | 4.7 MB |
| [customers_xlsx_excel_max_columns.xlsx](<05-large/customers_xlsx_excel_max_columns.xlsx>) | `customers` | Passed |  | Excel's column limit (16,384 columns, A..XFD) x 200 rows. | 15.8 MB |
| [products_xlsx_2k_rows_max_length_cells.xlsx](<05-large/products_xlsx_2k_rows_max_length_cells.xlsx>) | `products` | Passed |  | 2,000 rows each with a 32,767-character Description (~65 MB of cell text once read). | 562.4 KB |
