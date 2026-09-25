import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { readRecords, detectDelimiter } from '../src/services/validation/FileRecordReader';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-'));
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const write = (name: string, content: string | Buffer) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
};

const collect = async (filePath: string, type: string) => {
    const headers: { headers: string[]; sheet?: string }[] = [];
    const rows: { row: Record<string, unknown>; rowNumber: number; sheet?: string }[] = [];
    const summary = await readRecords(filePath, type, {
        onHeaders: (h, sheet) => headers.push({ headers: h, sheet }),
        onRow: (row, rowNumber, sheet) => rows.push({ row, rowNumber, sheet }),
    });
    return { headers, rows, summary };
};

describe('readRecords (delimited)', () => {
    it('reads every row, handles quoted delimiters, BOM, and blank lines', async () => {
        const filePath = write('data.csv', '\uFEFFId,Name,Note\r\n1,"Smith, J","said ""hi"""\r\n\r\n2,Lee,\r\n3,Kim,x\r\n');
        const { headers, rows, summary } = await collect(filePath, 'csv');

        expect(headers).toEqual([{ headers: ['Id', 'Name', 'Note'], sheet: undefined }]);
        expect(summary.rowCount).toBe(3);
        expect(rows[0].row).toEqual({ Id: '1', Name: 'Smith, J', Note: 'said "hi"' });
        expect(rows.map(r => r.rowNumber)).toEqual([2, 4, 5]);
    });

    it('reads beyond the first 10 rows', async () => {
        const lines = ['Id', ...Array.from({ length: 2500 }, (_, i) => String(i))];
        const { summary, rows } = await collect(write('big.csv', lines.join('\n')), 'csv');
        expect(summary.rowCount).toBe(2500);
        expect(rows[2499].row.Id).toBe('2499');
    });

    it('detects semicolon and tab delimiters', async () => {
        expect(await detectDelimiter(write('semi.txt', 'a;b;c\n1;2;3'), 'txt')).toBe(';');
        expect(await detectDelimiter(write('tab.tsv', 'a,b\n1,2'), 'tsv')).toBe('\t');
        const { rows } = await collect(write('semi2.txt', 'a;b\n1;2'), 'txt');
        expect(rows[0].row).toEqual({ a: '1', b: '2' });
    });

    it('rejects non-tabular file types', async () => {
        await expect(collect(write('data.json', '{}'), 'json')).rejects.toThrow(/cannot be validated/);
    });
});

describe('readRecords (Excel)', () => {
    it('reads all sheets with their own headers', async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Id', 'Amount'], [1, 10.5], [], [2, 20]]), 'First');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Code'], ['X']]), 'Second');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

        const { headers, rows, summary } = await collect(write('book.xlsx', buffer), 'xlsx');

        expect(headers).toEqual([
            { headers: ['Id', 'Amount'], sheet: 'First' },
            { headers: ['Code'], sheet: 'Second' },
        ]);
        expect(summary).toEqual({ rowCount: 3, sheets: [{ name: 'First', rowCount: 2 }, { name: 'Second', rowCount: 1 }] });
        expect(rows[1]).toEqual({ row: { Id: 2, Amount: 20 }, rowNumber: 4, sheet: 'First' });
    });
});
