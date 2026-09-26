import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { analyzeExampleFile, MAX_EXAMPLE_ROWS } from '../src/services/validation/ExampleFileAnalyzer';
import { readRecords } from '../src/services/validation/FileRecordReader';
import { createDefinitionSchemaEvaluator, createRuleEvaluator } from '../src/services/validation/ValidationEngine';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'example-analyzer-test-'));
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const write = (name: string, content: string | Buffer) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
};

const workbook = (sheets: Record<string, unknown[][]>): Buffer => {
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    }
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const CSV = [
    'OrderId,Amount,OrderDate,Paid,Status,Customer,Notes',
    '1,10.50,2024-01-05,true,Open,"Smith, J",',
    '2,20,2024-01-06,false,Closed,Lee,rush',
    '3,5.25,2024-02-01,true,Open,Kim,',
    '4,7,2024-02-03,false,Closed,Ng,',
].join('\n');

describe('analyzeExampleFile (CSV)', () => {
    it('proposes one unnamed table with inferred types, required flags and samples', async () => {
        const analysis = await analyzeExampleFile(write('orders.csv', CSV), 'csv');

        expect(analysis.fileType).toBe('csv');
        expect(analysis.sheets).toHaveLength(1);
        const [sheet] = analysis.sheets;
        expect(sheet).toMatchObject({ name: null, headerRow: 1, rowsAnalyzed: 4, truncated: false });
        expect(sheet.columns.map(c => [c.name, c.type, c.required])).toEqual([
            ['OrderId', 'integer', true],
            ['Amount', 'decimal', true],
            ['OrderDate', 'datetime', true],
            ['Paid', 'boolean', true],
            ['Status', 'string', true],
            ['Customer', 'string', true],
            ['Notes', 'string', false],
        ]);
        expect(sheet.columns.find(c => c.name === 'Notes')).toMatchObject({ filledRows: 1, sampleValues: ['rush'] });
        expect(sheet.columns[0].sampleValues).toEqual(['1', '2', '3']);
    });

    it('suggests allowed-values rules only for repeating categories that can be expressed', async () => {
        const [sheet] = (await analyzeExampleFile(write('orders-rules.csv', CSV), 'csv')).sheets;

        expect(sheet.suggestedRules).toEqual([
            expect.objectContaining({ name: 'Status allowed values', ruleType: 'Enum Check', expression: 'Status: Closed, Open', severity: 'Error' }),
        ]);
    });

    it('proposes columns and rules that the example itself passes', async () => {
        const filePath = write('roundtrip.csv', CSV);
        const [sheet] = (await analyzeExampleFile(filePath, 'csv')).sheets;
        const evaluators = [
            createDefinitionSchemaEvaluator(sheet.columns),
            ...sheet.suggestedRules.map(rule => createRuleEvaluator(rule.ruleType, rule.expression)),
        ];

        await readRecords(filePath, 'csv', {
            onHeaders: (headers, name) => evaluators.forEach(e => e.onHeaders(headers, name)),
            onRow: (row, rowNumber, name) => evaluators.forEach(e => e.onRow(row, rowNumber, name)),
        });

        expect(evaluators.map(e => e.result())).toEqual(evaluators.map(() => ({ passed: true, errorCount: 0, errors: [] })));
    });

    it(`analyzes at most ${MAX_EXAMPLE_ROWS} rows and says so`, async () => {
        const lines = ['Id', ...Array.from({ length: MAX_EXAMPLE_ROWS + 50 }, (_, i) => String(i))];
        const [sheet] = (await analyzeExampleFile(write('big.csv', lines.join('\n')), 'csv')).sheets;

        expect(sheet).toMatchObject({ rowsAnalyzed: MAX_EXAMPLE_ROWS, truncated: true });
        expect(sheet.warnings).toContain(`Only the first ${MAX_EXAMPLE_ROWS} data rows were analyzed.`);
    });

    it('warns about blank and duplicate headers and a header-only file', async () => {
        const [sheet] = (await analyzeExampleFile(write('headers.csv', 'Id,,Id\n'), 'csv')).sheets;

        expect(sheet.columns.map(c => [c.name, c.type, c.required])).toEqual([['Id', 'string', false], ['Column2', 'string', false]]);
        expect(sheet.warnings.join('\n')).toMatch(/1 header cell\(s\) are blank/);
        expect(sheet.warnings.join('\n')).toMatch(/Duplicate headers were merged: Id/);
        expect(sheet.warnings.join('\n')).toMatch(/no data rows/);
    });

    it('rejects an empty file', async () => {
        await expect(analyzeExampleFile(write('empty.csv', ''), 'csv')).rejects.toThrow('no header row');
    });
});

describe('analyzeExampleFile (XLSX)', () => {
    it('proposes columns per sheet, using the header row validation uses', async () => {
        const buffer = workbook({
            Orders: [[], [], ['Id', 'Placed', 'Region'], [1, new Date(Date.UTC(2024, 0, 5)), 'North'], [2, new Date(Date.UTC(2024, 0, 6)), 'South'], [3, new Date(Date.UTC(2024, 0, 7)), 'North'], [4, new Date(Date.UTC(2024, 0, 8)), 'South']],
            Refunds: [['Id', 'Reason'], [9, 'Damaged']],
            Blank: [],
        });
        const analysis = await analyzeExampleFile(write('book.xlsx', buffer), 'xlsx');

        expect(analysis.fileType).toBe('xlsx');
        expect(analysis.sheets.map(s => [s.name, s.headerRow, s.rowsAnalyzed])).toEqual([
            ['Orders', 3, 4],
            ['Refunds', 1, 1],
            ['Blank', null, 0],
        ]);
        expect(analysis.sheets[0].columns.map(c => [c.name, c.type, c.required])).toEqual([
            ['Id', 'integer', true],
            ['Placed', 'datetime', true],
            ['Region', 'string', true],
        ]);
        expect(analysis.sheets[0].columns[1].sampleValues[0]).toMatch(/^2024-01-0\d/);
        expect(analysis.sheets[0].suggestedRules.map(r => r.expression)).toEqual(['Region: North, South']);
        expect(analysis.sheets[2].warnings).toContain('No header row was found.');
        expect(analysis.warnings).toEqual([]);
    });

    it('does not warn about sheets with different columns, which become separate tables', async () => {
        const buffer = workbook({ Jan: [['Id'], [1]], Feb: [['Id'], [2]] });
        expect((await analyzeExampleFile(write('same.xlsx', buffer), 'xlsx')).warnings).toEqual([]);
    });

    it('flags truncated sheets', async () => {
        const rows = [['Id'], ...Array.from({ length: MAX_EXAMPLE_ROWS + 200 }, (_, i) => [i])];
        const [sheet] = (await analyzeExampleFile(write('long.xlsx', workbook({ Data: rows })), 'xlsx')).sheets;
        expect(sheet).toMatchObject({ rowsAnalyzed: MAX_EXAMPLE_ROWS, truncated: true });
    });

    it('rejects files that are not XLSX workbooks', async () => {
        await expect(analyzeExampleFile(write('fake.xlsx', 'Id\n1\n'), 'xlsx')).rejects.toThrow('not a valid XLSX workbook');
    });
});

describe('analyzeExampleFile (file types)', () => {
    it.each(['xls', 'txt', 'tsv', 'json'])('rejects .%s examples', async type => {
        await expect(analyzeExampleFile(write(`example.${type}`, 'Id\n1\n'), type)).rejects.toThrow('CSV or XLSX');
    });
});
