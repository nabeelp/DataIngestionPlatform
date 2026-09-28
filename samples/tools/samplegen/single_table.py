"""Single-table definitions: Sample - Customers, Sample - Products, Sample - Sales Orders."""
from datetime import date, datetime

from .data import customers, orders, products, texts, with_changes
from .definitions import (COLUMNS_CHECK as COLS, CUSTOMER_HEADERS, ORDER_HEADERS, PRODUCT_HEADERS, O_CURRENCY,
                          O_DISCOUNT, O_PAYMENT, O_TOTAL, P_CATEGORY, P_PRICE, P_REORDER, P_REORDER_TYPE, P_STOCK,
                          P_WEIGHT, R_COUNTRY, R_KEY, R_PHONE, R_STATUS)
from .writers import F, sheet, upload_case, write_delimited, write_text, write_xls, write_xlsx

C = '01-single-table/customers/'
P = '01-single-table/products/'
O = '01-single-table/sales-orders/'
# Checks that fail when none of the customer columns can be found (wrong header row, wrong sheet, empty file).
NO_CUSTOMER_COLUMNS = dict(failed=[COLS, R_KEY, R_STATUS], warnings=[R_COUNTRY, R_PHONE])


def build_customers():
    rows = customers(50)
    upload_case(C + 'customers_valid.csv', 'customers', 'PASSED', 'Baseline: 50 clean rows, comma-delimited UTF-8.', rows=50)
    write_delimited(C + 'customers_valid.csv', CUSTOMER_HEADERS, rows)

    write_xlsx(C + 'customers_valid.xlsx', [sheet('Customers', CUSTOMER_HEADERS, rows, freeze=True, autofilter=True)])
    upload_case(C + 'customers_valid.xlsx', 'customers', 'PASSED', 'Baseline workbook: one sheet, native date cells.', rows=50)

    write_xls(C + 'customers_valid.xls', [sheet('Customers', CUSTOMER_HEADERS, rows)])
    upload_case(C + 'customers_valid.xls', 'customers', 'PASSED', 'Legacy Excel 97-2003 (.xls) workbook.', rows=50)

    write_delimited(C + 'customers_valid.tsv', CUSTOMER_HEADERS, rows, delimiter='\t')
    upload_case(C + 'customers_valid.tsv', 'customers', 'PASSED', 'Tab-separated (.tsv is always read as tab-delimited).', rows=50)

    write_delimited(C + 'customers_valid_semicolon_delimited.csv', CUSTOMER_HEADERS, rows, delimiter=';')
    upload_case(C + 'customers_valid_semicolon_delimited.csv', 'customers', 'PASSED', 'Semicolon delimiter is auto-detected from the header line.', rows=50)

    write_delimited(C + 'customers_valid_pipe_delimited.txt', CUSTOMER_HEADERS, rows, delimiter='|')
    upload_case(C + 'customers_valid_pipe_delimited.txt', 'customers', 'PASSED', 'Pipe-delimited .txt file.', rows=50)

    write_delimited(C + 'customers_valid_tab_delimited.txt', CUSTOMER_HEADERS, rows, delimiter='\t')
    upload_case(C + 'customers_valid_tab_delimited.txt', 'customers', 'PASSED', 'Tab-delimited .txt file (delimiter auto-detected).', rows=50)

    write_delimited(C + 'customers_valid_crlf_line_endings.csv', CUSTOMER_HEADERS, rows, newline='\r\n')
    upload_case(C + 'customers_valid_crlf_line_endings.csv', 'customers', 'PASSED', 'Windows CRLF line endings.', rows=50)

    uni = customers(40, offset=1, unicode=True)
    write_delimited(C + 'customers_valid_utf8_bom_unicode.csv', CUSTOMER_HEADERS, uni, encoding='utf-8-sig')
    upload_case(C + 'customers_valid_utf8_bom_unicode.csv', 'customers', 'PASSED',
                'UTF-8 with BOM (Excel "CSV UTF-8" export); accented, Cyrillic, Greek, CJK, RTL and emoji names.', rows=40)
    write_xlsx(C + 'customers_valid_unicode.xlsx', [sheet('Klanten – Ünïcødé', CUSTOMER_HEADERS, uni)])
    upload_case(C + 'customers_valid_unicode.xlsx', 'customers', 'PASSED', 'Unicode data and a Unicode sheet name.', rows=40)

    tricky = with_changes(rows[:10], {
        0: {'Address': '12 Main St, Apt 4, Floor 2'},
        1: {'Address': 'Unit 7\nBuilding "B"\nTech Park'},
        2: {'LastName': "O'Neil", 'Address': 'He said "deliver to the back door"'},
        3: {'City': 'Winston-Salem, NC'},
        4: {'Address': '   leading and trailing spaces   '},
    })
    write_delimited(C + 'customers_valid_quoted_fields_multiline.csv', CUSTOMER_HEADERS, tricky, quoting=1)
    upload_case(C + 'customers_valid_quoted_fields_multiline.csv', 'customers', 'PASSED',
                'Every field quoted; embedded commas, doubled quotes and multi-line values count as one record.', rows=10)

    lines = [','.join(CUSTOMER_HEADERS), '']
    for i, row in enumerate(texts(rows[:20])):
        lines.append(','.join(f'  {row[h]}  ' for h in CUSTOMER_HEADERS))
        if i % 5 == 4:
            lines += ['', ',,,,,,,,,,,', '   ']
    write_text(C + 'customers_valid_blank_lines_and_whitespace.csv', '\n'.join(lines) + '\n\n\n')
    upload_case(C + 'customers_valid_blank_lines_and_whitespace.csv', 'customers', 'PASSED',
                'Blank lines, all-empty records and padded values are skipped/trimmed.', rows=20)

    extra = ['Loyalty Tier', 'Country', 'CustomerStatus', 'Email', 'CustomerId', 'LastName', 'FirstName', 'Phone',
             'DateOfBirth', 'Internal Notes', 'City', 'Address', 'State', 'ZipCode', 'Marketing Opt-In']
    extra_rows = [{**row, 'Loyalty Tier': ['Gold', 'Silver', 'Bronze'][i % 3], 'Internal Notes': 'n/a',
                   'Marketing Opt-In': 'maybe later'} for i, row in enumerate(rows)]
    write_delimited(C + 'customers_valid_reordered_and_extra_columns.csv', extra, extra_rows)
    upload_case(C + 'customers_valid_reordered_and_extra_columns.csv', 'customers', 'PASSED',
                'Columns in a different order plus undeclared columns (ignored).', rows=50)

    write_delimited(C + 'customers_valid_padded_headers.csv', [f'  {h} ' for h in CUSTOMER_HEADERS],
                    [[row[h] for h in CUSTOMER_HEADERS] for row in rows[:15]])
    upload_case(C + 'customers_valid_padded_headers.csv', 'customers', 'PASSED', 'Header names with surrounding spaces are trimmed.', rows=15)

    formats = ['1985-04-12', '1985-04-12T08:30:00Z', '1985-04-12 08:30', '1985-04-12T08:30:00.123+02:00', '12/04/1985',
               '4/12/1985', '12.04.85', '12-4-1985 14:05', '31/12/1985 23:59:59', '12/31/1985']
    dated = [{**row, 'DateOfBirth': formats[i % len(formats)]} for i, row in enumerate(rows[:30])]
    write_delimited(C + 'customers_valid_mixed_date_formats.csv', CUSTOMER_HEADERS, dated)
    upload_case(C + 'customers_valid_mixed_date_formats.csv', 'customers', 'PASSED',
                'ISO dates/times with zones and day-first/month-first local formats are all valid datetimes.', rows=30)

    optional = [h for h in CUSTOMER_HEADERS if h not in ('Phone', 'DateOfBirth', 'Address', 'City', 'State', 'ZipCode')]
    write_delimited(C + 'customers_warning_optional_columns_missing.csv', optional, rows)
    upload_case(C + 'customers_warning_optional_columns_missing.csv', 'customers', 'WARNING',
                'Only required columns present: definition passes; the Warning rule on Phone reports the missing column.',
                warnings=[R_PHONE], rows=50)

    warn = with_changes(rows, {3: {'Country': 'NZ'}, 8: {'Country': 'BR'}, 11: {'Phone': None}, 20: {'Phone': None},
                               33: {'Country': 'us'}})
    write_delimited(C + 'customers_warning_unsupported_country_and_missing_phone.csv', CUSTOMER_HEADERS, warn)
    upload_case(C + 'customers_warning_unsupported_country_and_missing_phone.csv', 'customers', 'WARNING',
                'Only Warning-severity rules fail (unsupported/lower-case country, missing phone), so the upload is accepted.',
                warnings=[R_COUNTRY, R_PHONE], rows=50, error_counts={R_COUNTRY: 3, R_PHONE: 2})

    write_delimited(C + 'customers_invalid_missing_required_column.csv', [h for h in CUSTOMER_HEADERS if h != 'Email'], rows)
    upload_case(C + 'customers_invalid_missing_required_column.csv', 'customers', 'FAILED',
                'Required Email column is absent: definition columns and the schema rule fail.', failed=[COLS, R_KEY])

    empty = with_changes(rows, {2: {'FirstName': None}, 5: {'Country': ''}, 9: {'CustomerStatus': None},
                                14: {'LastName': '   '}, 30: {'CustomerId': None}})
    write_delimited(C + 'customers_invalid_empty_required_values.csv', CUSTOMER_HEADERS, empty)
    upload_case(C + 'customers_invalid_empty_required_values.csv', 'customers', 'FAILED',
                'Required values blank or whitespace-only in 5 rows.', failed=[COLS], error_counts={COLS: 5})

    bad_dates = ['2024-13-01', 'yesterday', '32/01/1990', '13/13/1990', '1990/01/05', 'Jan 5 1990', '19900105',
                 '1990-1-5', '00/00/0000', '5 January 1990']
    invalid_dates = with_changes(rows, {i * 4: {'DateOfBirth': v} for i, v in enumerate(bad_dates)})
    write_delimited(C + 'customers_invalid_dates.csv', CUSTOMER_HEADERS, invalid_dates)
    upload_case(C + 'customers_invalid_dates.csv', 'customers', 'FAILED',
                'Ten unparseable DateOfBirth values (invalid month/day, year-first slashes, words, compact dates).',
                failed=[COLS], error_counts={COLS: 10})

    statuses = with_changes(rows, {1: {'CustomerStatus': 'active'}, 4: {'CustomerStatus': 'ACTIVE'},
                                   7: {'CustomerStatus': 'Deleted'}, 10: {'CustomerStatus': 'Suspended'},
                                   13: {'CustomerStatus': '  Prospect  '}})
    write_delimited(C + 'customers_invalid_status_values.csv', CUSTOMER_HEADERS, statuses)
    upload_case(C + 'customers_invalid_status_values.csv', 'customers', 'FAILED',
                'Enum checks are case-sensitive (active/ACTIVE fail) but trim spaces ("  Prospect  " passes).',
                failed=[R_STATUS], error_counts={R_STATUS: 4})

    write_delimited(C + 'customers_invalid_header_case_mismatch.csv', [h.lower() for h in CUSTOMER_HEADERS], rows)
    upload_case(C + 'customers_invalid_header_case_mismatch.csv', 'customers', 'FAILED',
                'Header names are case-sensitive: lower-case headers match no definition column.', **NO_CUSTOMER_COLUMNS)

    dup_headers = CUSTOMER_HEADERS + ['Email']
    write_delimited(C + 'customers_invalid_duplicate_headers.csv', dup_headers, [[*[row[h] for h in CUSTOMER_HEADERS], ''] for row in rows[:10]])
    upload_case(C + 'customers_invalid_duplicate_headers.csv', 'customers', 'FAILED',
                'A second, empty "Email" column overrides the first (last duplicate wins), so Email looks blank.',
                failed=[COLS], error_counts={COLS: 10})

    ragged = [','.join(CUSTOMER_HEADERS)]
    for i, row in enumerate(texts(rows[:12])):
        values = [row[h] for h in CUSTOMER_HEADERS]
        ragged.append(','.join(values[:10] if i % 4 == 1 else values + (['EXTRA', 'VALUES'] if i % 4 == 2 else [])))
    write_text(C + 'customers_invalid_ragged_rows.csv', '\n'.join(ragged) + '\n')
    upload_case(C + 'customers_invalid_ragged_rows.csv', 'customers', 'FAILED',
                'Short rows (Country/CustomerStatus missing) fail; rows with extra trailing values are accepted.',
                failed=[COLS], error_counts={COLS: 6})

    write_delimited(C + 'customers_header_only.csv', CUSTOMER_HEADERS, [])
    upload_case(C + 'customers_header_only.csv', 'customers', 'PASSED', 'Header row with no data rows (0 rows) passes.', rows=0)

    write_text(C + 'customers_empty_file.csv', '')
    upload_case(C + 'customers_empty_file.csv', 'customers', 'FAILED', 'Zero-byte file: no header, so every column check fails.',
                rows=0, **NO_CUSTOMER_COLUMNS)

    text = ','.join(CUSTOMER_HEADERS) + '\n' + '\n'.join(','.join(r[h] for h in CUSTOMER_HEADERS) for r in texts(rows[:5]))
    write_text(C + 'customers_invalid_unclosed_quote.csv', text + '\nCUST-999999,"Unclosed,Quote,x@example.com,,,,,,,US,Active\n')
    upload_case(C + 'customers_invalid_unclosed_quote.csv', 'customers', 'READ_ERROR',
                'Malformed CSV (unterminated quoted field): the parser stops and the upload fails with an error message.')

    many = customers(5000, offset=2)
    for i, row in enumerate(many):
        if i % 2 == 0:
            row['CustomerStatus'] = 'Unknown'
        if i % 3 == 0:
            row['DateOfBirth'] = 'unknown'
    write_delimited(C + 'customers_invalid_many_errors_5000_rows.csv', CUSTOMER_HEADERS, many)
    upload_case(C + 'customers_invalid_many_errors_5000_rows.csv', 'customers', 'FAILED',
                'Thousands of issues: only 100 samples are stored per check, but the total count is exact.',
                failed=[COLS, R_STATUS], rows=5000, error_counts={COLS: 1667, R_STATUS: 2500})

    write_xlsx(C + 'customers_xlsx_blank_rows_above_header.xlsx',
               [sheet('Customers', CUSTOMER_HEADERS, rows[:30], start_row=3, gap_every=10)])
    upload_case(C + 'customers_xlsx_blank_rows_above_header.xlsx', 'customers', 'PASSED',
                'Header on row 4 (first non-empty row) and blank rows between data blocks are skipped.', rows=30)

    write_xlsx(C + 'customers_xlsx_title_row_above_header.xlsx',
               [sheet('Customers', CUSTOMER_HEADERS, rows[:30], pre_rows=[['Customer export - generated 2026-09-27'], []])])
    upload_case(C + 'customers_xlsx_title_row_above_header.xlsx', 'customers', 'FAILED',
                'A title row above the headers becomes the header row, so no definition column is found.', **NO_CUSTOMER_COLUMNS)

    regions = [sheet(name, CUSTOMER_HEADERS, customers(50, offset=10 + i, start=1 + i * 50))
               for i, name in enumerate(['North', 'South', 'East', 'West'])]
    write_xlsx(C + 'customers_xlsx_multi_sheet_same_columns.xlsx', regions)
    upload_case(C + 'customers_xlsx_multi_sheet_same_columns.xlsx', 'customers', 'PASSED',
                'One-table definition: every sheet is validated against the same columns (4 x 50 rows).', rows=200)

    write_xlsx(C + 'customers_xlsx_extra_notes_sheet.xlsx', [
        sheet('Customers', CUSTOMER_HEADERS, rows),
        sheet('Notes', ['Note', 'Author'], [['Exported from CRM', 'ops'], ['Do not edit column headers', 'ops']])])
    upload_case(C + 'customers_xlsx_extra_notes_sheet.xlsx', 'customers', 'FAILED',
                'One-table definitions validate EVERY sheet, so an extra "Notes" sheet fails. Use a sheet-table definition to ignore extra sheets.',
                **NO_CUSTOMER_COLUMNS)

    write_xlsx(C + 'customers_xlsx_with_empty_sheet.xlsx', [sheet('Customers', CUSTOMER_HEADERS, rows), sheet('Sheet2'), sheet('Sheet3')])
    upload_case(C + 'customers_xlsx_with_empty_sheet.xlsx', 'customers', 'PASSED',
                'Completely empty sheets have no header and are skipped by one-table definitions.', rows=50)

    native = [{**row, 'FullName': F(f'=B{i + 2}&" "&C{i + 2}', f"{row['FirstName']} {row['LastName']}"),
               'Age': F(f'=DATEDIF(F{i + 2},DATE(2026,9,27),"y")',
                        2026 - row['DateOfBirth'].year - ((row['DateOfBirth'].month, row['DateOfBirth'].day) > (9, 27))),
               'ZipCode': int(row['ZipCode']), 'Phone': int(''.join(ch for ch in row['Phone'] if ch.isdigit()))}
              for i, row in enumerate(rows)]
    write_xlsx(C + 'customers_xlsx_native_types_and_formulas.xlsx',
               [sheet('Customers', CUSTOMER_HEADERS + ['FullName', 'Age'], native, freeze=True, autofilter=True)])
    upload_case(C + 'customers_xlsx_native_types_and_formulas.xlsx', 'customers', 'PASSED',
                'Native date/number cells, numeric ZipCode/Phone in string columns, extra formula columns (cached values).', rows=50)

    write_xlsx(C + 'customers_xlsx_excel_table_object.xlsx',
               [sheet('Customers', CUSTOMER_HEADERS, rows, table=True, table_name='CustomerTable')])
    upload_case(C + 'customers_xlsx_excel_table_object.xlsx', 'customers', 'PASSED', 'Data formatted as an Excel Table (ListObject).', rows=50)

    write_xlsx(C + 'customers_xlsx_protected_sheet.xlsx', [sheet('Customers', CUSTOMER_HEADERS, rows, protect=True)])
    upload_case(C + 'customers_xlsx_protected_sheet.xlsx', 'customers', 'PASSED',
                'Sheet protection (not file encryption) does not prevent reading.', rows=50)


def build_products():
    rows = products(80)
    write_delimited(P + 'products_valid.csv', PRODUCT_HEADERS, rows)
    upload_case(P + 'products_valid.csv', 'products', 'PASSED', 'Baseline: 80 clean products.', rows=80)

    write_xlsx(P + 'products_valid.xlsx', [sheet('Products', PRODUCT_HEADERS, rows, autofilter=True)])
    upload_case(P + 'products_valid.xlsx', 'products', 'PASSED', 'Native numeric and TRUE/FALSE boolean cells.', rows=80)

    variants = ['true', 'false', 'TRUE', 'False', 'yes', 'No', 'Y', 'n', '1', '0']
    write_delimited(P + 'products_valid_boolean_variants.csv', PRODUCT_HEADERS,
                    [{**row, 'Active': variants[i % len(variants)]} for i, row in enumerate(rows[:20])])
    upload_case(P + 'products_valid_boolean_variants.csv', 'products', 'PASSED',
                'Every accepted boolean spelling: true/false, yes/no, y/n, 1/0 (any case).', rows=20)

    bounds = [
        {'UnitPrice': '0', 'StockQuantity': '0', 'WeightKg': '0', 'ReorderLevel': '500'},
        {'UnitPrice': '100000', 'StockQuantity': '10000', 'WeightKg': '-0', 'ReorderLevel': '0'},
        {'UnitPrice': '100000.00', 'StockQuantity': '+10', 'WeightKg': '.5'},
        {'UnitPrice': '1e3', 'CostPrice': '1.5E2', 'StockQuantity': '007'},
        {'UnitPrice': '+19.99', 'CostPrice': '0.', 'WeightKg': '', 'ReorderLevel': ''},
    ]
    write_delimited(P + 'products_valid_numeric_boundaries.csv', PRODUCT_HEADERS,
                    [{**texts([row])[0], **b} for row, b in zip(rows, bounds)])
    upload_case(P + 'products_valid_numeric_boundaries.csv', 'products', 'PASSED',
                'Inclusive range bounds, signed/leading-dot/scientific numbers and leading zeros are accepted.', rows=5)

    bad = [
        {'UnitPrice': '12,50'}, {'UnitPrice': '$10.00'}, {'CostPrice': '1 000'}, {'StockQuantity': '10.5'},
        {'StockQuantity': '1e3'}, {'Active': 'maybe'}, {'Active': '2'}, {'ReorderLevel': 'five'},
    ]
    write_delimited(P + 'products_invalid_number_formats.csv', PRODUCT_HEADERS,
                    [{**texts([row])[0], **b} for row, b in zip(rows, bad)])
    upload_case(P + 'products_invalid_number_formats.csv', 'products', 'FAILED',
                'Comma decimals, currency symbols, thousands separators, 10.5/1e3 as integers and non-boolean flags.',
                failed=[COLS, P_PRICE], warnings=[P_REORDER, P_REORDER_TYPE],
                error_counts={COLS: 8, P_PRICE: 2, P_REORDER: 1, P_REORDER_TYPE: 1})

    ranges = with_changes(rows[:20], {0: {'UnitPrice': -5.0}, 1: {'UnitPrice': 100000.01}, 2: {'StockQuantity': -1},
                                      3: {'StockQuantity': 10001}, 4: {'WeightKg': -2.0}, 5: {'ReorderLevel': 501}})
    write_delimited(P + 'products_invalid_range_violations.csv', PRODUCT_HEADERS, ranges)
    upload_case(P + 'products_invalid_range_violations.csv', 'products', 'FAILED',
                'Just outside each range bound; the weight and reorder rules are Warnings.',
                failed=[P_PRICE, P_STOCK], warnings=[P_WEIGHT, P_REORDER])

    warn = with_changes(rows[:20], {6: {'WeightKg': -0.5}, 7: {'ReorderLevel': 900}})
    write_delimited(P + 'products_warning_only_ranges.csv', PRODUCT_HEADERS, warn)
    upload_case(P + 'products_warning_only_ranges.csv', 'products', 'WARNING', 'Only Warning-severity range rules fail.',
                warnings=[P_WEIGHT, P_REORDER])

    cats = with_changes(rows[:20], {0: {'Category': 'Books'}, 1: {'Category': 'electronics'}, 2: {'Category': 'Home & Garden'}})
    write_delimited(P + 'products_invalid_category.csv', PRODUCT_HEADERS, cats)
    upload_case(P + 'products_invalid_category.csv', 'products', 'FAILED', 'Unknown and wrong-case categories.',
                failed=[P_CATEGORY], error_counts={P_CATEGORY: 3})

    write_xlsx(P + 'products_xlsx_numbers_stored_as_text.xlsx', [sheet('Products', PRODUCT_HEADERS, texts(rows))])
    upload_case(P + 'products_xlsx_numbers_stored_as_text.xlsx', 'products', 'PASSED',
                'Numbers and booleans stored as text cells (green-triangle cells) still match their types.', rows=80)

    formulas = []
    for i, row in enumerate(rows):
        r = i + 2
        formulas.append({**row, 'UnitPrice': F(f'=ROUND(F{r}*M{r},2)', round(row['CostPrice'] * 1.4, 2)), 'Markup': 1.4})
    write_xlsx(P + 'products_xlsx_formulas_with_cached_values.xlsx', [sheet('Products', PRODUCT_HEADERS + ['Markup'], formulas)])
    upload_case(P + 'products_xlsx_formulas_with_cached_values.xlsx', 'products', 'PASSED',
                "UnitPrice is a formula; its cached value is what gets validated.", rows=80)

    long_desc = ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' * 600)[:32767]
    write_xlsx(P + 'products_xlsx_max_cell_length.xlsx',
               [sheet('Products', PRODUCT_HEADERS, [{**row, 'Description': long_desc} for row in rows[:10]])])
    upload_case(P + 'products_xlsx_max_cell_length.xlsx', 'products', 'PASSED',
                "Description cells at Excel's 32,767-character limit.", rows=10)


def build_orders():
    rows = orders(500)
    write_delimited(O + 'orders_valid.csv', ORDER_HEADERS, rows)
    upload_case(O + 'orders_valid.csv', 'orders', 'PASSED', 'Baseline: 500 orders, optional ShipDate/Notes sometimes blank.', rows=500)

    write_xlsx(O + 'orders_valid.xlsx', [sheet('Orders', ORDER_HEADERS, rows, freeze=True)])
    upload_case(O + 'orders_valid.xlsx', 'orders', 'PASSED', 'Baseline workbook.', rows=500)

    stamps = ['2026-01-05', '2026-01-05T10:30:00Z', '2026-01-05 10:30', '2026-01-05T10:30:00.123+02:00',
              '2026-01-05T10:30:00-0500', '05/01/2026', '1/5/2026', '05.01.26', '5-1-2026 14:05', '31/12/2026 23:59:59']
    write_delimited(O + 'orders_valid_date_format_variants.csv', ORDER_HEADERS,
                    [{**row, 'OrderDate': stamps[i % 10], 'ShipDate': stamps[(i + 3) % 10]} for i, row in enumerate(rows[:40])])
    upload_case(O + 'orders_valid_date_format_variants.csv', 'orders', 'PASSED', 'Accepted date/time spellings in both date columns.', rows=40)

    bad = ['2026-13-01', '2026/01/05', 'Jan 5 2026', '32/01/2026', 'tomorrow', '20260105', '2026-1-5', 'N/A']
    invalid = with_changes(rows[:40], {i * 2: {'OrderDate': v} for i, v in enumerate(bad)})
    invalid[1]['ShipDate'] = 'TBC'
    write_delimited(O + 'orders_invalid_dates.csv', ORDER_HEADERS, invalid)
    upload_case(O + 'orders_invalid_dates.csv', 'orders', 'FAILED', 'Invalid OrderDate values and an invalid optional ShipDate.',
                failed=[COLS], error_counts={COLS: 9},
                notes='"2026-02-30" style dates that roll over are accepted; see orders_quirk_impossible_dates_accepted.csv.')

    impossible = ['2026-02-30', '2026-04-31', '2025-02-29', '31/02/2026', '30/02/2026']
    write_delimited(O + 'orders_quirk_impossible_dates_accepted.csv', ORDER_HEADERS,
                    with_changes(rows[:10], {i: {'OrderDate': v} for i, v in enumerate(impossible)}))
    upload_case(O + 'orders_quirk_impossible_dates_accepted.csv', 'orders', 'PASSED',
                'Impossible calendar dates (30 Feb, 31 Apr, 29 Feb in a non-leap year) are accepted: ISO dates roll over and '
                'local dates only check day <= 31 and month <= 12.', rows=10,
                notes='Gap: stricter date validation would reject these.')

    enums = with_changes(rows[:40], {0: {'Currency': 'usd'}, 1: {'Currency': 'AUD'}, 2: {'PaymentStatus': 'PAID'},
                                     3: {'PaymentStatus': 'Cancelled'}, 4: {'Currency': 'US$', 'PaymentStatus': 'Unpaid'}})
    write_delimited(O + 'orders_invalid_currency_and_payment_status.csv', ORDER_HEADERS, enums)
    upload_case(O + 'orders_invalid_currency_and_payment_status.csv', 'orders', 'FAILED', 'Enum violations in two columns.',
                failed=[O_CURRENCY, O_PAYMENT], error_counts={O_CURRENCY: 3, O_PAYMENT: 3})

    warn = with_changes(rows[:40], {5: {'DiscountAmount': -10.0}, 6: {'DiscountAmount': -0.01}})
    write_delimited(O + 'orders_warning_negative_discount.csv', ORDER_HEADERS, warn)
    upload_case(O + 'orders_warning_negative_discount.csv', 'orders', 'WARNING', 'Negative discounts only trip a Warning rule.',
                warnings=[O_DISCOUNT], error_counts={O_DISCOUNT: 2})

    long_text = 'This total cannot be parsed because it is a paragraph of text. ' * 8
    write_delimited(O + 'orders_invalid_long_text_values.csv', ORDER_HEADERS,
                    with_changes(rows[:10], {0: {'TotalAmount': long_text}, 1: {'Notes': 'x' * 5000}}))
    upload_case(O + 'orders_invalid_long_text_values.csv', 'orders', 'FAILED',
                'A 500+ character invalid value (reported values are truncated to 200 characters) and a 5,000 character note.',
                failed=[COLS, O_TOTAL])

    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    write_xlsx(O + 'orders_xlsx_one_sheet_per_month.xlsx',
               [sheet(f'{m} 2026', ORDER_HEADERS, orders(100, offset=10 + i, start=1 + i * 100)) for i, m in enumerate(months)])
    upload_case(O + 'orders_xlsx_one_sheet_per_month.xlsx', 'orders', 'PASSED', '12 monthly sheets, all validated by the one-table definition.', rows=1200)

    serial = [{**row, 'OrderDate': (row['OrderDate'] - date(1899, 12, 30)).days, 'ShipDate': None} for row in rows[:20]]
    write_xlsx(O + 'orders_xlsx_dates_as_serial_numbers.xlsx', [sheet('Orders', ORDER_HEADERS, serial)])
    upload_case(O + 'orders_xlsx_dates_as_serial_numbers.xlsx', 'orders', 'FAILED',
                'Dates stored as plain numbers (Excel serials without a date format) are not datetimes.',
                failed=[COLS], error_counts={COLS: 20})

    timestamps = [{**row, 'OrderDate': datetime(2026, 3, 1, 8, 15) , 'ShipDate': datetime(2026, 3, 2, 17, 45, 30)} for row in rows[:20]]
    write_xls(O + 'orders_valid_datetimes.xls', [sheet('Orders', ORDER_HEADERS, timestamps)])
    upload_case(O + 'orders_valid_datetimes.xls', 'orders', 'PASSED', 'Legacy .xls with date-time cells.', rows=20)


def build():
    build_customers()
    build_products()
    build_orders()
