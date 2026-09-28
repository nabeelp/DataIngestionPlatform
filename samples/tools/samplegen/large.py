"""Very large files: row-count, byte-size, width and cell-size stress tests (git-ignored; regenerate on demand)."""
import csv

from .data import customers, finance, order_text_rows, orders, products
from .definitions import (CUSTOMER_HEADERS, ORDER_HEADERS, O_CURRENCY, O_TOTAL, INVOICE_HEADERS, PAYMENT_HEADERS,
                          CREDIT_HEADERS)
from .writers import out, sheet, to_text, upload_case, write_delimited, write_xlsx

L = '05-large/'
UPLOAD_LIMIT = 100 * 1024 * 1024
EXCEL_MAX_ROWS = 1_048_576
EXCEL_MAX_COLS = 16_384


def csv_until(rel, headers, rows, max_bytes):
    """Write rows until the file reaches max_bytes; returns the number of data rows written."""
    path = out(rel)
    count = 0
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
            count += 1
            if count % 1000 == 0 and handle.tell() >= max_bytes:
                break
    return count


def build(include_max_rows=True):
    n = 250_000
    write_delimited(L + 'orders_large_250k_rows.csv', ORDER_HEADERS, order_text_rows(n))
    upload_case(L + 'orders_large_250k_rows.csv', 'orders', 'PASSED', '250,000 valid rows (~30 MB CSV).', rows=n)

    near = csv_until(L + 'orders_large_near_100mb_limit.csv', ORDER_HEADERS, order_text_rows(10_000_000, offset=1), UPLOAD_LIMIT - 2 * 1024 * 1024)
    upload_case(L + 'orders_large_near_100mb_limit.csv', 'orders', 'PASSED', f'Just under the default 100 MB upload limit ({near:,} rows).', rows=near)

    over = csv_until(L + 'orders_large_over_100mb_limit.csv', ORDER_HEADERS, order_text_rows(10_000_000, offset=2), UPLOAD_LIMIT + 2 * 1024 * 1024)
    upload_case(L + 'orders_large_over_100mb_limit.csv', 'orders', 'UPLOAD_REJECTED',
                f'Just over the default 100 MB upload limit ({over:,} rows): rejected with HTTP 413/400 (UPLOAD_MAX_FILE_SIZE).')

    def with_errors(total):
        for i, row in enumerate(order_text_rows(total, offset=3)):
            if i % 100 == 0:
                row[5] = 'XXX'
            if i % 250 == 0:
                row[4] = '-1.00'
            yield row
    n_err = 200_000
    write_delimited(L + 'orders_large_200k_rows_with_errors.csv', ORDER_HEADERS, with_errors(n_err))
    upload_case(L + 'orders_large_200k_rows_with_errors.csv', 'orders', 'FAILED',
                '200,000 rows with 1% bad currencies and 0.4% negative totals: exact totals, 100 samples each.',
                failed=[O_CURRENCY, O_TOTAL], rows=n_err, error_counts={O_CURRENCY: 2000, O_TOTAL: 800})

    n_x = 250_000
    write_xlsx(L + 'orders_large_250k_rows.xlsx', [sheet('Orders', ORDER_HEADERS, order_text_rows(n_x, offset=4))], constant_memory=True)
    upload_case(L + 'orders_large_250k_rows.xlsx', 'orders', 'PASSED', '250,000-row single-sheet workbook (~150 MB of sheet XML).', rows=n_x)

    n_half = 500_000
    write_xlsx(L + 'orders_large_500k_rows.xlsx', [sheet('Orders', ORDER_HEADERS, order_text_rows(n_half, offset=6))], constant_memory=True)
    upload_case(L + 'orders_large_500k_rows.xlsx', 'orders', 'PASSED',
                '500,000-row workbook (~310 MB of sheet XML): near the practical ceiling of the in-memory Excel reader.', rows=n_half)

    if include_max_rows:
        max_rows = EXCEL_MAX_ROWS - 1
        write_xlsx(L + 'orders_xlsx_excel_max_rows.xlsx', [sheet('Orders', ORDER_HEADERS, order_text_rows(max_rows, offset=5))], constant_memory=True)
        upload_case(L + 'orders_xlsx_excel_max_rows.xlsx', 'orders', 'READ_ERROR',
                    f"Excel's row limit: header + {max_rows:,} data rows. The ~650 MB sheet XML exceeds the JavaScript string limit, "
                    "so the sheet cannot be parsed and the upload fails with a read error.",
                    notes="Gap: the error surfaces as \"Cannot read properties of undefined (reading '!ref')\"; "
                          'consider a streaming Excel reader or a clear row/size limit message.')

    inv, pay, cn = finance(150_000, 120_000, 20_000, offset=9)
    raw = orders(150_000, offset=9)
    write_xlsx(L + 'finance_large_used_and_ignored_sheets.xlsx', [
        sheet('Instructions', rows=[['Large month-end pack']]),
        sheet('Invoices', INVOICE_HEADERS, inv), sheet('Payments', PAYMENT_HEADERS, pay), sheet('Credit Notes', CREDIT_HEADERS, cn),
        sheet('Raw Export (ignored)', ORDER_HEADERS, raw), sheet('Audit Trail', ['When', 'Who', 'What'],
                                                                ([f'2026-09-{1 + i % 28:02d}', f'user{i % 50}', 'edit'] for i in range(100_000)))],
        constant_memory=True)
    upload_case(L + 'finance_large_used_and_ignored_sheets.xlsx', 'finance', 'PASSED',
                'Sheet-table definition on 540k rows across 6 sheets; 250k rows are in ignored sheets.',
                rows=150_000 + 120_000 + 20_000 + 150_000 + 100_000)

    extra = [f'Extra{i:03d}' for i in range(1, 489)]
    wide_rows = ([*[to_text(r[h]) for h in CUSTOMER_HEADERS], *[f'v{j}' for j in range(488)]] for r in customers(2000, offset=50))
    write_delimited(L + 'customers_wide_500_columns.csv', CUSTOMER_HEADERS + extra, wide_rows)
    upload_case(L + 'customers_wide_500_columns.csv', 'customers', 'PASSED', '500 columns (488 undeclared) x 2,000 rows.', rows=2000)

    wide_headers = CUSTOMER_HEADERS + [f'X{i}' for i in range(EXCEL_MAX_COLS - len(CUSTOMER_HEADERS))]
    cust = customers(200, offset=51)
    write_xlsx(L + 'customers_xlsx_excel_max_columns.xlsx',
               [sheet('Customers', wide_headers, ([*[r[h] for h in CUSTOMER_HEADERS], *range(EXCEL_MAX_COLS - 12)] for r in cust))],
               constant_memory=True)
    upload_case(L + 'customers_xlsx_excel_max_columns.xlsx', 'customers', 'PASSED', f"Excel's column limit ({EXCEL_MAX_COLS:,} columns, A..XFD) x 200 rows.", rows=200)

    long_desc = ('Stress text for very long cells. ' * 1100)[:32767]
    write_xlsx(L + 'products_xlsx_2k_rows_max_length_cells.xlsx',
               [sheet('Products', list(products(1)[0]), ({**p, 'Description': long_desc} for p in products(2_000, offset=52)))],
               constant_memory=True)
    upload_case(L + 'products_xlsx_2k_rows_max_length_cells.xlsx', 'products', 'PASSED',
                '2,000 rows each with a 32,767-character Description (~65 MB of cell text once read).', rows=2_000)
