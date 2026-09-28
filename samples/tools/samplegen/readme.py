"""Renders samples/README.md from the manifest so the catalog always matches the generated files."""

FOLDERS = [
    ('01-single-table', 'One-table definitions', 'Columns apply to a CSV file and to **every** sheet of a workbook.'),
    ('02-sheet-tables', 'One-table-per-sheet definitions',
     'Each table matches a sheet by name (case-insensitive, trimmed); other sheets are ignored; CSV is rejected.'),
    ('03-example-files', 'Example files (Admin → File Definitions → Start from an example file)',
     'CSV/XLSX up to 10 MB; up to 1,000 rows per sheet and 20 sheets are analyzed.'),
    ('04-file-handling', 'File handling: extensions, encodings, line endings and corrupt files', ''),
    ('05-large', 'Large files (git-ignored, regenerate with the generator)',
     'Row-count, byte-size (100 MB upload limit), width and cell-length stress tests.'),
]

STATUS_TEXT = {
    'PASSED': 'Passed', 'WARNING': 'Passed with warnings', 'FAILED': 'Failed', 'READ_ERROR': 'Failed (read error)',
    'UPLOAD_REJECTED': 'Rejected at upload', 'PROPOSAL': 'Proposal', 'REJECTED': 'Rejected',
}

OBSERVATIONS = [
    '**One-table definitions validate every sheet.** An extra "Notes" or "Summary" sheet fails the upload '
    '(`customers_xlsx_extra_notes_sheet.xlsx`). Use a one-table-per-sheet definition when workbooks carry extra sheets.',
    '**Header names are case-sensitive; sheet names are not.** `customerid` does not match `CustomerId`, while a sheet named '
    '`  INVOICES ` matches `Invoices`.',
    '**Enum checks are case-sensitive but trimmed**: `active` fails, `  Prospect  ` passes.',
    '**Duplicate headers: the last one wins.** A second, empty `Email` column makes every Email look blank.',
    '**Title rows break the header.** The first non-empty row is the header; blank rows above it are fine.',
    '**An empty table sheet counts as missing.** A `Payments` sheet with no cells is reported as "Required sheet not found".',
    '**Impossible dates are accepted.** `2026-02-30` and `31/02/2026` pass as datetimes: ISO dates roll over (JavaScript '
    'date parsing) and local formats only check day ≤ 31 and month ≤ 12.',
    '**Excel date serials are not dates.** A date cell without a date format is read as a number and fails a datetime column.',
    '**1/0 columns are proposed as integer, not boolean,** by the example analyzer; change the type before saving if needed.',
    '**Uploads do not check the ZIP signature.** CSV text renamed to `.xlsx` is read as a workbook and passes; example files are rejected.',
    '**A zero-byte `.xlsx` passes a one-table definition** (it is read as one empty sheet with nothing to check), whereas a '
    'zero-byte CSV fails. Sheet-table definitions fail it because the sheets are missing.',
    '**Encodings:** UTF-8 (with or without BOM) and UTF-16LE *with* a BOM are decoded. UTF-16 without a BOM fails (headers '
    'unreadable); Windows-1252 accents become replacement characters but still validate as text.',
    '**Random binary content is read as garbage text** and fails the column checks rather than crashing the worker.',
    "**Excel's row limit is out of reach for the in-memory Excel reader.** A 1,048,575-row sheet (~650 MB of sheet XML) "
    'exceeds the JavaScript string limit and fails with a read error; 500,000 rows (~310 MB) still validate.',
]


def _status(expected):
    return STATUS_TEXT.get(expected.get('status') or expected.get('result'), expected.get('status') or expected.get('result'))


def _checks(expected):
    parts = []
    if expected.get('failedChecks'):
        parts.append('fails: ' + '; '.join(expected['failedChecks']))
    if expected.get('warningChecks'):
        parts.append('warns: ' + '; '.join(expected['warningChecks']))
    if expected.get('layout'):
        parts.append({'single': 'one table', 'sheets': 'one table per sheet'}[expected['layout']])
    if expected.get('warningsContain'):
        parts.append('warning: "' + '", "'.join(expected['warningsContain']) + '"')
    if expected.get('errorContains'):
        parts.append(f'error: "{expected["errorContains"]}"')
    return '<br>'.join(parts)


def _size(entry):
    size = entry.get('sizeBytes') or 0
    return f'{size / 1024 / 1024:,.1f} MB' if size >= 1024 * 1024 else f'{size / 1024:,.1f} KB'


def render_readme(manifest, definitions):
    lines = [
        '# Sample files',
        '',
        'Test files for every upload and definition scenario of the Data Ingestion Platform: file formats, encodings, '
        'one-table and one-table-per-sheet definitions, every rule type and severity, example-file proposals, rejected '
        'and corrupt files, and very large files. Each file has an expected outcome in [manifest.json](manifest.json), '
        'which the verification script checks against the real validation engine.',
        '',
        '> **Generated content.** This README, the sample files, `manifest.json`, `.gitignore` and `definitions/` are '
        'produced by [tools/generate_samples.py](tools/generate_samples.py). Change the generator, not the output. '
        'All data is synthetic (fixed random seed); e-mail addresses use `example.com`/`.example` domains.',
        '',
        '## Set up the sample definitions',
        '',
        'The files are validated against five sample definitions. The one-table ones reuse the columns of the seeded '
        '`Customer Data`, `Product Catalog` and `Sales Orders` definitions, so the column checks behave the same with those.',
        '',
        '| Key | Definition | Layout | Tables / rules |',
        '|---|---|---|---|',
    ]
    for key, d in definitions.items():
        layout = 'One table per sheet' if d['tables'] else 'One table'
        tables = ', '.join(f'`{t["sheet"]}`' for t in d['tables']) or f'{len(d["columns"])} columns'
        lines.append(f'| `{key}` | {d["name"]} | {layout} | {tables}; {len(d["rules"])} rules |')
    lines += [
        '',
        '1. Run [definitions/sample_definitions.sql](definitions/sample_definitions.sql) against the application database '
        '(after the scripts in `Back-End/database`, including `seed_local_users.sql`), for example '
        '`sqlcmd -S "(localdb)\\MSSQLLocalDB" -d FileValidationPlatform -I -i samples\\definitions\\sample_definitions.sql`.',
        '2. Re-run `Back-End/database/file_definition_versions_schema.sql` to publish version 1 of each new definition.',
        '3. The script gives the seeded test user access. Alternatively, create the definitions in the UI from '
        '[definitions/sample_definitions.json](definitions/sample_definitions.json).',
        '',
        'Then upload a file on the **Upload** page against the definition in the catalog below and compare the result.',
        '',
        '## Verify and regenerate',
        '',
        '```powershell',
        '# Regenerate (pip install xlsxwriter xlwt). --skip-large skips 05-large/, --skip-max-rows skips the 1M-row workbook.',
        'python samples\\tools\\generate_samples.py',
        '',
        '# Check every expected outcome with the backend\'s reader, validation engine and example analyzer (no database needed).',
        'cd Back-End',
        'node --max-old-space-size=8192 -r ts-node/register/transpile-only ..\\samples\\tools\\verify_samples.ts',
        '# Options: --skip-large, --only <text>',
        '```',
        '',
        'Expected statuses: **Passed**, **Passed with warnings** (only Warning-severity checks failed; the file is accepted '
        'and delivered), **Failed** (an Error-severity check failed), **Failed (read error)** (the file could not be parsed), '
        'and **Rejected at upload** (refused before validation: extension, size or CSV for a sheet-table definition).',
        '',
        '## Behaviors these samples surface',
        '',
    ]
    lines += [f'- {item}' for item in OBSERVATIONS]
    lines.append('')

    for folder, title, blurb in FOLDERS:
        entries = [e for e in manifest if e['file'].startswith(folder + '/')]
        if not entries:
            continue
        lines += [f'## {title}', '']
        if blurb:
            lines += [blurb, '']
        is_example = folder == '03-example-files'
        lines += (['| File | Expected | Details | Scenario | Size |', '|---|---|---|---|---|'] if is_example else
                  ['| File | Definition | Expected | Checks | Scenario | Size |', '|---|---|---|---|---|---|'])
        for e in entries:
            name = e['file'][len(folder) + 1:]
            link = f'[{name}](<{e["file"]}>)'
            purpose = e['purpose'] + (f' _{e["notes"]}_' if e.get('notes') else '')
            if is_example:
                lines.append(f'| {link} | {_status(e["expected"])} | {_checks(e["expected"])} | {purpose} | {_size(e)} |')
            else:
                lines.append(f'| {link} | `{e["definition"]}` | {_status(e["expected"])} | {_checks(e["expected"])} | {purpose} | {_size(e)} |')
        lines.append('')
    return '\n'.join(lines).replace('\r', '')
