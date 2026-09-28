"""Writers for CSV/TSV/TXT, XLSX and XLS sample files, and the manifest of expected outcomes."""
import csv
from datetime import date, datetime
from pathlib import Path

import xlsxwriter
import xlwt

ROOT = Path(__file__).resolve().parents[2]  # samples/
MANIFEST = []


def out(rel):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class F:
    """A formula with the cached value Excel would show (so readers see a value without recalculating)."""

    def __init__(self, formula, value):
        self.formula, self.value = formula, value


def _cells(headers, row):
    return list(row) if isinstance(row, (list, tuple)) else [row.get(h) for h in headers]


def to_text(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, F):
        return to_text(value.value)
    return str(value)


def write_delimited(rel, headers, rows, delimiter=',', encoding='utf-8', newline='\n', quoting=csv.QUOTE_MINIMAL):
    """Write a delimited text file. `encoding='utf-8-sig'` adds a BOM; rows may be dicts or lists (or a generator)."""
    path = out(rel)
    with open(path, 'w', encoding=encoding, newline='') as handle:
        writer = csv.writer(handle, delimiter=delimiter, lineterminator=newline, quoting=quoting)
        if headers is not None:
            writer.writerow(headers)
        for row in rows:
            writer.writerow([to_text(v) for v in _cells(headers, row)])
    return path


def write_text(rel, text, encoding='utf-8'):
    path = out(rel)
    path.write_bytes(text.encode(encoding))
    return path


def write_bytes(rel, data):
    path = out(rel)
    path.write_bytes(data)
    return path


def sheet(name, headers=None, rows=(), **options):
    """Sheet spec. Options: pre_rows (rows above the header), start_row, state ('hidden'/'veryhidden'),
    table (Excel table object), freeze, autofilter, protect, widths, gap_every (blank row every N data rows)."""
    return {'name': name, 'headers': headers, 'rows': rows, **options}


def write_xlsx(rel, sheets, constant_memory=False):
    path = out(rel)
    wb = xlsxwriter.Workbook(str(path), {
        'constant_memory': constant_memory,
        'default_date_format': 'yyyy-mm-dd',
        'strings_to_numbers': False,
        'strings_to_formulas': False,
        'strings_to_urls': False,
    })
    header_fmt = wb.add_format({'bold': True, 'bg_color': '#DDEBF7', 'font_name': 'Arial', 'border': 1})
    title_fmt = wb.add_format({'bold': True, 'font_size': 14, 'font_name': 'Arial'})
    money_fmt = wb.add_format({'num_format': '#,##0.00', 'font_name': 'Arial'})
    datetime_fmt = wb.add_format({'num_format': 'yyyy-mm-dd hh:mm', 'font_name': 'Arial'})
    worksheets = []

    def put(ws, r, c, v, fmt=None):
        if v is None or (isinstance(v, str) and v == ''):
            return
        if isinstance(v, F):
            ws.write_formula(r, c, v.formula, fmt or (money_fmt if isinstance(v.value, float) else None), v.value)
        elif isinstance(v, bool):
            ws.write_boolean(r, c, v, fmt)
        elif isinstance(v, (int, float)):
            ws.write_number(r, c, v, fmt or (money_fmt if isinstance(v, float) else None))
        elif isinstance(v, datetime):
            ws.write_datetime(r, c, v, fmt or datetime_fmt)
        elif isinstance(v, date):
            ws.write_datetime(r, c, v, fmt)
        else:
            ws.write_string(r, c, str(v), fmt)

    for spec in sheets:
        ws = wb.add_worksheet(spec['name'])
        worksheets.append((ws, spec))
        r = spec.get('start_row', 0)
        for i, pre in enumerate(spec.get('pre_rows', [])):
            for c, v in enumerate(pre):
                put(ws, r, c, v, title_fmt if i == 0 and c == 0 else None)
            r += 1
        headers = spec.get('headers')
        header_row = r
        if headers:
            for c, v in enumerate(headers):
                put(ws, r, c, v, header_fmt)
            r += 1
        gap = spec.get('gap_every')
        for i, row in enumerate(spec.get('rows', ())):
            if gap and i and i % gap == 0:
                r += 1
            for c, v in enumerate(_cells(headers, row)):
                put(ws, r, c, v)
            r += 1
        if headers and not constant_memory:
            ws.set_column(0, len(headers) - 1, spec.get('widths', 16))
            if spec.get('freeze'):
                ws.freeze_panes(header_row + 1, 0)
            if spec.get('autofilter') and r > header_row + 1:
                ws.autofilter(header_row, 0, r - 1, len(headers) - 1)
            if spec.get('table') and r > header_row + 1:
                ws.add_table(header_row, 0, r - 1, len(headers) - 1, {
                    'columns': [{'header': h} for h in headers], 'style': 'Table Style Medium 2',
                    'name': spec.get('table_name')})
        if spec.get('protect'):
            ws.protect('sample')

    visible = [ws for ws, spec in worksheets if not spec.get('state')]
    if visible:
        visible[0].activate()
    for ws, spec in worksheets:
        if spec.get('state') == 'hidden':
            ws.hide()
        elif spec.get('state') == 'veryhidden':
            ws.very_hidden()
    wb.close()
    return path


def write_xls(rel, sheets):
    """Legacy Excel 97-2003 workbook."""
    path = out(rel)
    wb = xlwt.Workbook(encoding='utf-8')
    bold = xlwt.easyxf('font: bold on')
    date_style = xlwt.easyxf(num_format_str='YYYY-MM-DD')
    for spec in sheets:
        ws = wb.add_sheet(spec['name'])
        r = 0
        headers = spec.get('headers')
        if headers:
            for c, v in enumerate(headers):
                ws.write(r, c, v, bold)
            r += 1
        for row in spec.get('rows', ()):
            for c, v in enumerate(_cells(headers, row)):
                if v is None or v == '':
                    continue
                if isinstance(v, F):
                    v = v.value
                if isinstance(v, (date, datetime)):
                    ws.write(r, c, v, date_style)
                else:
                    ws.write(r, c, v)
            r += 1
    wb.save(str(path))
    return path


def upload_case(rel, definition, status, purpose, failed=(), warnings=(), rows=None, error_counts=None, notes=None):
    """Register an upload scenario. status: PASSED | WARNING | FAILED | READ_ERROR | UPLOAD_REJECTED."""
    MANIFEST.append({
        'file': rel.replace('\\', '/'), 'kind': 'upload', 'definition': definition, 'purpose': purpose,
        'expected': {k: v for k, v in {
            'status': status, 'failedChecks': sorted(failed), 'warningChecks': sorted(warnings), 'rows': rows,
            'errorCounts': error_counts}.items() if v is not None},
        **({'notes': notes} if notes else {}),
    })


def example_case(rel, purpose, result='PROPOSAL', layout=None, sheets=None, warnings_contain=(), columns=None,
                 suggested_rules=None, not_suggested=None, error_contains=None, notes=None):
    """Register an example-file (definition proposal) scenario. result: PROPOSAL | REJECTED."""
    expected = {'result': result}
    for key, value in [('layout', layout), ('sheets', sheets), ('warningsContain', list(warnings_contain) or None),
                       ('columns', columns), ('suggestedRules', suggested_rules), ('notSuggested', not_suggested),
                       ('errorContains', error_contains)]:
        if value is not None:
            expected[key] = value
    MANIFEST.append({'file': rel.replace('\\', '/'), 'kind': 'example', 'purpose': purpose, 'expected': expected,
                     **({'notes': notes} if notes else {})})
