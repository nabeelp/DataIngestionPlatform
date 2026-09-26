// =============================================================================
// File Record Reader - streams every record of a CSV/TXT/TSV or Excel upload
// =============================================================================

import fs from 'fs';
import { parse } from 'csv-parse';

export interface RecordHandlers {
    /** headerRowNumber is the 1-based position of the header row in the source. */
    onHeaders(headers: string[], sheet?: string, headerRowNumber?: number): void;
    onRow(row: Record<string, unknown>, rowNumber: number, sheet?: string): void;
    onProgress?(percent: number): void;
}

export interface ReadOptions {
    /** Stop after this many data rows per sheet (or per delimited file); the summary marks the cut as truncated. */
    maxRowsPerSheet?: number;
}

export interface ReadSummary {
    rowCount: number;
    sheets: { name: string; rowCount: number; truncated?: boolean }[];
    truncated?: boolean;
}

// With a row limit, Excel parsing stops this many rows past the limit so leading blank/title rows still fit.
const EXCEL_LEADING_ROW_ALLOWANCE = 100;

export const TABULAR_FILE_TYPES = ['csv', 'txt', 'tsv', 'xlsx', 'xls'];

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

interface CsvRecordInfo {
    records: number;
    empty_lines: number;
    comment_lines: number;
}

const normalizeHeaders = (values: unknown[]): string[] =>
    values.map((value, index) => {
        const header = value === null || value === undefined ? '' : String(value).trim();
        return header || `Column${index + 1}`;
    });

const toRow = (headers: string[], values: unknown[]): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
        row[header] = values[index] ?? null;
    });
    return row;
};

const isBlankRecord = (values: unknown[]): boolean =>
    values.every(value => value === null || value === undefined || (typeof value === 'string' && value.trim() === ''));

/**
 * Detect the delimiter from the header line of a delimited text file.
 */
export async function detectDelimiter(filePath: string, fileType: string): Promise<string> {
    if (fileType === 'tsv') return '\t';

    const handle = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)[0] || '';
        let best = ',';
        let bestCount = 0;
        for (const delimiter of CANDIDATE_DELIMITERS) {
            const count = firstLine.split(delimiter).length - 1;
            if (count > bestCount) {
                best = delimiter;
                bestCount = count;
            }
        }
        return best;
    } finally {
        await handle.close();
    }
}

async function readDelimited(filePath: string, fileType: string, handlers: RecordHandlers, options: ReadOptions): Promise<ReadSummary> {
    const delimiter = await detectDelimiter(filePath, fileType);
    const totalBytes = (await fs.promises.stat(filePath)).size || 1;
    let bytesRead = 0;
    let lastReported = -1;

    const source = fs.createReadStream(filePath);
    source.on('data', chunk => {
        bytesRead += chunk.length;
        const percent = Math.min(99, Math.floor((bytesRead / totalBytes) * 100));
        if (handlers.onProgress && percent !== lastReported) {
            lastReported = percent;
            handlers.onProgress(percent);
        }
    });

    const parser = source.pipe(parse({
        bom: true,
        delimiter,
        info: true,
        relax_column_count: true,
        relax_quotes: false,
        skip_empty_lines: true,
        trim: true,
    }));

    let headers: string[] | null = null;
    let rowCount = 0;
    let truncated = false;
    const limit = options.maxRowsPerSheet;

    try {
        for await (const { record, info } of parser as AsyncIterable<{ record: string[]; info: CsvRecordInfo }>) {
            // Record position including skipped blank lines; multi-line quoted fields count as one row.
            const position = info.records + info.empty_lines + info.comment_lines;
            if (!headers) {
                headers = normalizeHeaders(record);
                handlers.onHeaders(headers, undefined, position);
                continue;
            }
            if (isBlankRecord(record)) continue;
            if (limit !== undefined && rowCount >= limit) {
                truncated = true;
                break;
            }
            rowCount++;
            handlers.onRow(toRow(headers, record), position);
        }
    } finally {
        source.destroy();
    }

    if (!headers) {
        handlers.onHeaders([]);
    }

    return truncated ? { rowCount, sheets: [], truncated } : { rowCount, sheets: [] };
}

async function readExcel(filePath: string, handlers: RecordHandlers, options: ReadOptions): Promise<ReadSummary> {
    const XLSX = await import('xlsx');
    const limit = options.maxRowsPerSheet;
    const sheetRows = limit === undefined ? undefined : limit + 1 + EXCEL_LEADING_ROW_ALLOWANCE;
    const workbook = XLSX.readFile(filePath, { cellDates: true, dense: true, ...(sheetRows ? { sheetRows } : {}) });
    const sheets: ReadSummary['sheets'] = [];
    let rowCount = 0;
    const sheetNames = workbook.SheetNames;

    sheetNames.forEach((sheetName, sheetIndex) => {
        const worksheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, blankrows: true, raw: true });
        const headerIndex = records.findIndex(record => Array.isArray(record) && !isBlankRecord(record));
        // Records start at the sheet's used range, which excludes empty rows above it.
        const firstRow = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']).s.r : 0;

        if (headerIndex < 0) {
            sheets.push({ name: sheetName, rowCount: 0 });
            return;
        }

        const headers = normalizeHeaders(records[headerIndex]);
        handlers.onHeaders(headers, sheetName, firstRow + headerIndex + 1);

        let sheetRowCount = 0;
        let truncated = false;
        for (let i = headerIndex + 1; i < records.length; i++) {
            const record = records[i];
            if (!Array.isArray(record) || isBlankRecord(record)) continue;
            if (limit !== undefined && sheetRowCount >= limit) {
                truncated = true;
                break;
            }
            sheetRowCount++;
            handlers.onRow(toRow(headers, record), firstRow + i + 1, sheetName);
        }
        // sheetRows cuts parsing short; a cut sheet keeps its original range in !fullref.
        const fullRef = (worksheet as Record<string, unknown>)['!fullref'];
        if (sheetRows !== undefined && fullRef && fullRef !== worksheet['!ref']) truncated = true;

        sheets.push(truncated ? { name: sheetName, rowCount: sheetRowCount, truncated } : { name: sheetName, rowCount: sheetRowCount });
        rowCount += sheetRowCount;
        handlers.onProgress?.(Math.min(99, Math.floor(((sheetIndex + 1) / sheetNames.length) * 100)));
    });

    return { rowCount, sheets };
}

/**
 * Read every record of a tabular file, calling handlers for headers and rows.
 * Row numbers are 1-based positions in the source (header row included).
 */
export async function readRecords(filePath: string, fileType: string, handlers: RecordHandlers, options: ReadOptions = {}): Promise<ReadSummary> {
    const type = (fileType || '').toLowerCase().replace(/^\./, '');
    if (type === 'csv' || type === 'txt' || type === 'tsv') {
        return readDelimited(filePath, type, handlers, options);
    }
    if (type === 'xlsx' || type === 'xls') {
        return readExcel(filePath, handlers, options);
    }
    throw new Error(`File type "${fileType}" cannot be validated. Supported types: ${TABULAR_FILE_TYPES.join(', ')}`);
}
