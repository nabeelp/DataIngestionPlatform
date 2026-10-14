"""Example files for "Start from an example file", and file-handling edge cases (formats, encodings, corrupt files)."""
import io
import shutil
import zipfile

from .data import customers, finance, hr, rng, texts
from .definitions import (COLUMNS_CHECK as COLS, CREDIT_HEADERS, CUSTOMER_HEADERS, INVOICE_HEADERS, PAYMENT_HEADERS,
                          R_COUNTRY, R_STATUS, BENEFIT_HEADERS, CONTACT_HEADERS, EMPLOYEE_HEADERS,
                          BENEFITS, CONTACTS, CREDIT_NOTES, EMPLOYEES, INVOICES, PAYMENTS, sheet_check)
from .writers import ROOT, example_case, out, sheet, upload_case, write_bytes, write_delimited, write_text, write_xls, write_xlsx

EX = '03-example-files/'
FH = '04-file-handling/'
NO_CUSTOMER_COLUMNS = dict(failed=[COLS, R_STATUS], warnings=[R_COUNTRY])


def build_examples():
    rows = customers(60, offset=20)
    write_xlsx(EX + 'example_single_sheet_customers.xlsx', [sheet('Customers', CUSTOMER_HEADERS, rows)])
    example_case(EX + 'example_single_sheet_customers.xlsx', 'Single populated sheet: proposed as one table for every sheet.',
                 layout='single', sheets=['Customers'],
                 columns={'Customers': {'CustomerId': ['string', True], 'DateOfBirth': ['datetime', True], 'CustomerStatus': ['string', True]}},
                 suggested_rules=['CustomerStatus allowed values', 'Country allowed values'], not_suggested=['City allowed values'])

    inv, pay, cn = finance(30, 20, 6, offset=5)
    write_xlsx(EX + 'example_multi_sheet_finance.xlsx', [
        sheet('Invoices', INVOICE_HEADERS, inv), sheet('Payments', PAYMENT_HEADERS, pay), sheet('Credit Notes', CREDIT_HEADERS, cn),
        sheet('ReadMe', ['Note'], [['Leave this sheet out of the definition']])])
    example_case(EX + 'example_multi_sheet_finance.xlsx', 'Four populated sheets: proposed as one table per sheet; deselect ReadMe.',
                 layout='sheets', sheets=['Invoices', 'Payments', 'Credit Notes', 'ReadMe'],
                 columns={'Invoices': {'Amount': ['decimal', True], 'InvoiceDate': ['datetime', True]},
                          'Payments': {'Method': ['string', True]}},
                 suggested_rules=['Status allowed values', 'Method allowed values', 'Currency allowed values', 'Amount range'])

    emp, ben, con = hr(25, offset=5)
    write_xlsx(EX + 'example_multi_sheet_hr.xlsx', [sheet(EMPLOYEES, EMPLOYEE_HEADERS, emp), sheet(BENEFITS, BENEFIT_HEADERS, ben),
                                                    sheet(CONTACTS, CONTACT_HEADERS, con)])
    example_case(EX + 'example_multi_sheet_hr.xlsx', 'Special-character and 31-character sheet names become sheet tables.',
                 layout='sheets', sheets=[EMPLOYEES, BENEFITS, CONTACTS],
                 columns={EMPLOYEES: {'FullTime': ['boolean', True], 'Salary': ['integer', True], 'ManagerId': ['string', False]},
                          BENEFITS: {'Dependents': ['integer', True], 'MonthlyCost': ['decimal', True]}},
                 suggested_rules=['Salary range', 'Dependents range', 'MonthlyCost range'],
                 notes='Whole-number salaries are proposed as integer; change to decimal if cents are expected.')

    r = rng(700)
    inference = []
    for i in range(40):
        inference.append({
            'Quantity': str(r.randint(1, 500)), 'Price': r.choice(['10', '12.5', '0.99', '1e2']),
            'OrderedOn': r.choice(['2026-01-05', '05/01/2026', '2026-01-05T10:00:00Z']),
            'IsGift': r.choice(['yes', 'no', 'true', 'false', 'Y']), 'Flag01': r.choice(['1', '0']),
            'Code': r.choice(['001', 'A1', '17']), 'Sparse': str(i) if i % 2 else '', 'Mixed': r.choice(['12', 'abc', '3.5'])})
    write_delimited(EX + 'example_type_inference.csv', list(inference[0]), inference)
    example_case(EX + 'example_type_inference.csv', 'Most specific common type per column; 1/0 columns are proposed as integer, not boolean.',
                 layout='single', sheets=[None],
                 columns={None: {'Quantity': ['integer', True], 'Price': ['decimal', True], 'OrderedOn': ['datetime', True],
                                 'IsGift': ['boolean', True], 'Flag01': ['integer', True], 'Code': ['string', True],
                                 'Sparse': ['integer', False], 'Mixed': ['string', True]}},
                 suggested_rules=['Quantity range', 'Price range'],
                 not_suggested=['IsGift range', 'Code range', 'Mixed range', 'OrderedOn range'])

    enum_rows = []
    regions = [f'Region {i}' for i in range(12)]
    for i in range(60):
        enum_rows.append({'Priority': ['Low', 'Medium', 'High'][i % 3], 'Region': regions[i % 12],
                          'Tags': ['red, blue', 'green'][i % 2], 'Colour': 'Blue', 'Label': ('L' * 55) + str(i % 2),
                          'RareCode': f'RC{i}' if i < 5 else '', 'Status:Code': ['A', 'B'][i % 2], 'Amount': str(i)})
    write_delimited(EX + 'example_enum_candidates.csv', list(enum_rows[0]), enum_rows)
    example_case(EX + 'example_enum_candidates.csv',
                 'Allowed-values suggestions only for repeating text columns with 2-10 short values without commas or colons.',
                 layout='single', suggested_rules=['Priority allowed values'],
                 not_suggested=['Region allowed values', 'Tags allowed values', 'Colour allowed values', 'Label allowed values',
                                'RareCode allowed values', 'Status:Code allowed values', 'Amount allowed values'])

    headers = ['OrderId', None, 'Amount', None, None, 'Status']
    write_xlsx(EX + 'example_blank_header_cells.xlsx', [sheet('Orders', headers, [[i, 'x', i * 1.5, 'y', 'z', 'Open'] for i in range(1, 11)])])
    example_case(EX + 'example_blank_header_cells.xlsx', 'Blank header cells are named by position (Column2, Column4...).',
                 warnings_contain=['header cell(s) are blank'], suggested_rules=['Amount range'], not_suggested=['OrderId range'])

    write_xlsx(EX + 'example_title_row_above_headers.xlsx',
               [sheet('Report', CUSTOMER_HEADERS, rows[:20], pre_rows=[['Quarterly customer report']])])
    example_case(EX + 'example_title_row_above_headers.xlsx', 'Title row becomes the header row; the warning suggests removing it.',
                 warnings_contain=['remove any title rows'])

    write_delimited(EX + 'example_duplicate_headers.csv', ['Id', 'Name', 'Name', 'Amount', 'Id'], [[i, 'a', 'b', i, i] for i in range(10)])
    example_case(EX + 'example_duplicate_headers.csv', 'Duplicate headers are merged, with a warning.', warnings_contain=['Duplicate headers were merged'])

    long_name = 'This column header is deliberately far longer than the one hundred characters that a definition column name allows'
    write_delimited(EX + 'example_long_column_names.csv', ['Id', long_name], [[i, 'v'] for i in range(5)])
    example_case(EX + 'example_long_column_names.csv', 'Column names over 100 characters must be shortened before saving.',
                 warnings_contain=['exceed 100 characters'])

    write_delimited(EX + 'example_header_only.csv', CUSTOMER_HEADERS, [])
    example_case(EX + 'example_header_only.csv', 'No data rows: every column defaults to an optional string.',
                 warnings_contain=['no data rows below the header'],
                 columns={None: {'CustomerId': ['string', False], 'Email': ['string', False]}})

    write_delimited(EX + 'example_5000_rows_truncated.csv', CUSTOMER_HEADERS, customers(5000, offset=21))
    example_case(EX + 'example_5000_rows_truncated.csv', 'Only the first 1,000 data rows are analyzed.',
                 warnings_contain=['Only the first 1000 data rows were analyzed.'])

    write_xlsx(EX + 'example_25_sheets.xlsx', [sheet(f'Region {i:02d}', CUSTOMER_HEADERS, customers(5, offset=30 + i, start=i * 5)) for i in range(1, 26)])
    example_case(EX + 'example_25_sheets.xlsx', 'More than 20 sheets: only the first 20 are shown.', layout='sheets',
                 warnings_contain=['Only the first 20 of 25 sheets are shown.'])

    write_xlsx(EX + 'example_one_populated_two_empty_sheets.xlsx', [sheet('Blank'), sheet('Customers', CUSTOMER_HEADERS, rows[:20]), sheet('Unused')])
    example_case(EX + 'example_one_populated_two_empty_sheets.xlsx', 'Only one populated sheet, so one table is proposed; empty sheets warn.',
                 layout='single', warnings_contain=['No header row was found.'])

    write_xlsx(EX + 'example_all_sheets_empty.xlsx', [sheet('Sheet1'), sheet('Sheet2')])
    example_case(EX + 'example_all_sheets_empty.xlsx', 'No header row anywhere: rejected.', result='REJECTED', error_contains='no header row')

    write_text(EX + 'example_not_a_workbook.xlsx', ','.join(CUSTOMER_HEADERS) + '\nCUST-1,A,B,a@example.com,,,,,,,US,Active\n')
    example_case(EX + 'example_not_a_workbook.xlsx', 'CSV text renamed to .xlsx fails the ZIP signature check.', result='REJECTED',
                 error_contains='not a valid XLSX workbook')

    write_xls(EX + 'example_legacy_format.xls', [sheet('Customers', CUSTOMER_HEADERS, rows[:10])])
    example_case(EX + 'example_legacy_format.xls', 'Example files must be CSV or XLSX (.xls is rejected here, though uploads accept it).',
                 result='REJECTED', error_contains='CSV (.csv) or Excel workbooks (.xlsx)')

    write_delimited(EX + 'example_csv_semicolon.csv', CUSTOMER_HEADERS, rows, delimiter=';')
    example_case(EX + 'example_csv_semicolon.csv', 'Semicolon-delimited example (delimiter detected like uploads).', layout='single',
                 columns={None: {'Email': ['string', True], 'DateOfBirth': ['datetime', True]}})

    target = 10 * 1024 * 1024 + 256 * 1024
    path = out(EX + 'example_too_large_over_10mb.csv')
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(','.join(CUSTOMER_HEADERS) + '\n')
        i = 0
        while handle.tell() < target:
            i += 1
            handle.write(','.join(texts([customers(1, offset=i % 97, start=i)[0]])[0][h] for h in CUSTOMER_HEADERS) + '\n')
    example_case(EX + 'example_too_large_over_10mb.csv', 'Just over the 10 MB example limit: rejected before analysis.',
                 result='REJECTED', error_contains='limited to 10 MB')


def build_file_handling():
    rows = customers(25, offset=40)
    csv_text = ','.join(CUSTOMER_HEADERS) + '\n' + '\n'.join(','.join(r[h] for h in CUSTOMER_HEADERS) for r in texts(rows)) + '\n'

    write_text(FH + 'customers_unsupported_extension.json', '[{"CustomerId": "CUST-1"}]')
    upload_case(FH + 'customers_unsupported_extension.json', 'customers', 'UPLOAD_REJECTED', 'Extension not in .csv/.tsv/.txt/.xlsx/.xls.')

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('customers.csv', csv_text)
    write_bytes(FH + 'customers_zipped_archive.zip', buffer.getvalue())
    upload_case(FH + 'customers_zipped_archive.zip', 'customers', 'UPLOAD_REJECTED', 'Compressed archives are not accepted.')

    valid_xlsx = write_xlsx(FH + 'CUSTOMERS_UPPERCASE_EXTENSION.XLSX', [sheet('Customers', CUSTOMER_HEADERS, rows)])
    upload_case(FH + 'CUSTOMERS_UPPERCASE_EXTENSION.XLSX', 'customers', 'PASSED', 'Upper-case file extension is accepted.', rows=25)

    shutil.copyfile(valid_xlsx, out(FH + 'customers_macro_enabled.xlsm'))
    upload_case(FH + 'customers_macro_enabled.xlsm', 'customers', 'UPLOAD_REJECTED', 'Macro-enabled workbooks (.xlsm) are not accepted.')

    write_text(FH + 'customers export (Q3) – José & Zoë.csv', csv_text)
    upload_case(FH + 'customers export (Q3) – José & Zoë.csv', 'customers', 'PASSED',
                'File name with spaces, brackets, an en dash, accents and an ampersand (sanitized when stored).', rows=25)

    data = valid_xlsx.read_bytes()
    write_bytes(FH + 'customers_corrupt_truncated.xlsx', data[: len(data) // 2])
    upload_case(FH + 'customers_corrupt_truncated.xlsx', 'customers', 'READ_ERROR', 'Truncated ZIP package: the workbook cannot be opened.')

    write_bytes(FH + 'customers_zero_bytes.xlsx', b'')
    upload_case(FH + 'customers_zero_bytes.xlsx', 'customers', 'PASSED',
                'Empty file with an .xlsx extension is read as one empty sheet, so a one-table definition has nothing to check.',
                rows=0, notes='Gap: consider rejecting empty workbooks (a zero-byte CSV fails because it has no header).')

    write_bytes(FH + 'finance_zero_bytes.xlsx', b'')
    upload_case(FH + 'finance_zero_bytes.xlsx', 'finance', 'FAILED',
                'The same empty workbook against a sheet-table definition: every table sheet is missing.',
                failed=[sheet_check(INVOICES), sheet_check(PAYMENTS), sheet_check(CREDIT_NOTES)])

    write_text(FH + 'customers_csv_renamed_to_xlsx.xlsx', csv_text)
    upload_case(FH + 'customers_csv_renamed_to_xlsx.xlsx', 'customers', 'PASSED',
                'CSV text renamed to .xlsx: the upload reader sniffs the content and reads it as a single sheet.',
                notes='Unlike example files, uploads do not check the ZIP signature; consider adding that check.')

    write_bytes(FH + 'customers_random_binary.csv', bytes(rng(800).getrandbits(8) for _ in range(4096)))
    upload_case(FH + 'customers_random_binary.csv', 'customers', 'FAILED', 'Binary content with a .csv extension: no recognizable header.',
                **NO_CUSTOMER_COLUMNS)

    write_text(FH + 'customers_utf16le_bom_encoded.csv', csv_text, encoding='utf-16')
    upload_case(FH + 'customers_utf16le_bom_encoded.csv', 'customers', 'PASSED',
                'UTF-16LE with a BOM (Excel "Unicode Text") is detected from the BOM and decoded.', rows=25)

    write_text(FH + 'customers_utf16le_no_bom.csv', csv_text, encoding='utf-16-le')
    upload_case(FH + 'customers_utf16le_no_bom.csv', 'customers', 'FAILED',
                'UTF-16 without a BOM is read as UTF-8, so the headers do not match. Re-save as UTF-8.', **NO_CUSTOMER_COLUMNS)

    uni = customers(20, offset=41)
    for i, row in enumerate(uni):
        row['FirstName'] = ['José', 'Zoë', 'Renée', 'Björn'][i % 4]
    write_delimited(FH + 'customers_windows1252_encoded.csv', CUSTOMER_HEADERS, uni, encoding='cp1252')
    upload_case(FH + 'customers_windows1252_encoded.csv', 'customers', 'PASSED',
                'Windows-1252 (ANSI) encoding: validates, but accented letters are read as replacement characters.', rows=20)

    write_text(FH + 'customers_cr_only_line_endings.csv', csv_text.replace('\n', '\r'))
    upload_case(FH + 'customers_cr_only_line_endings.csv', 'customers', 'PASSED', 'Classic Mac CR-only line endings.', rows=25)

    write_text(FH + 'customers_no_trailing_newline.csv', csv_text.rstrip('\n'))
    upload_case(FH + 'customers_no_trailing_newline.csv', 'customers', 'PASSED', 'Last record without a trailing newline.', rows=25)

    write_text(FH + 'customers_single_column_no_delimiter.txt', 'CustomerId\n' + '\n'.join(r['CustomerId'] for r in rows) + '\n')
    upload_case(FH + 'customers_single_column_no_delimiter.txt', 'customers', 'FAILED',
                'A single-column text file: only CustomerId is present.', failed=[COLS, R_STATUS], warnings=[R_COUNTRY])


def build():
    build_examples()
    build_file_handling()
