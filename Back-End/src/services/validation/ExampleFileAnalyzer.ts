// =============================================================================
// Example File Analyzer - proposes file definition columns (and candidate rules) from an example file
// The example is read with the same reader uploads are validated with, so the proposed header row,
// column names and types are exactly what validation will see.
// =============================================================================

import fs from 'fs';
import { readRecords } from './FileRecordReader';
import { isEmptyValue, matchesType, parseRuleExpression, toNumber, type ColumnType } from './ValidationEngine';

export const EXAMPLE_FILE_TYPES = ['csv', 'xlsx'] as const;
export type ExampleFileType = typeof EXAMPLE_FILE_TYPES[number];

export const MAX_EXAMPLE_ROWS = 1000;
export const MAX_EXAMPLE_SHEETS = 20;
export const MAX_COLUMN_NAME_LENGTH = 100;

const MAX_SAMPLE_VALUES = 3;
const MAX_SAMPLE_LENGTH = 60;
const MAX_ENUM_VALUES = 10;
const MAX_ENUM_VALUE_LENGTH = 50;
// An allowed-values rule is only suggested when values repeat, on average, at least this often.
const MIN_ROWS_PER_ENUM_VALUE = 2;
// A range rule needs at least this many different numbers, so a single or constant value is not a range.
const MIN_RANGE_DISTINCT_VALUES = 2;
const MAX_TRACKED_NUMBERS = MIN_RANGE_DISTINCT_VALUES;
// Identifiers, codes and phone-like numbers are labels, not quantities, so no range is suggested for them.
const IDENTIFIER_WORDS = new Set([
    'id', 'key', 'code', 'number', 'num', 'no', 'nr', 'ref', 'reference', 'sku', 'ean', 'upc', 'isbn',
    'zip', 'zipcode', 'postcode', 'postalcode', 'phone', 'mobile', 'fax', 'account',
]);

// Most specific first: the first type that every sampled value matches is proposed; otherwise string.
const INFERENCE_ORDER: ColumnType[] = ['integer', 'decimal', 'datetime', 'boolean'];

export interface SuggestedColumn {
    name: string;
    type: ColumnType;
    required: boolean;
    /** Rows (of those analyzed) with a value in this column. */
    filledRows: number;
    sampleValues: string[];
}

export interface SuggestedRule {
    name: string;
    ruleType: 'Enum Check' | 'Range Check';
    expression: string;
    severity: 'Error';
    reason: string;
}

export interface ExampleSheet {
    /** Worksheet name; null for CSV files, which have no sheets. */
    name: string | null;
    headerRow: number | null;
    rowsAnalyzed: number;
    truncated: boolean;
    columns: SuggestedColumn[];
    suggestedRules: SuggestedRule[];
    warnings: string[];
}

export interface ExampleAnalysis {
    fileType: ExampleFileType;
    sheets: ExampleSheet[];
    warnings: string[];
}

export class ExampleFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExampleFileError';
    }
}

interface ColumnProfile {
    name: string;
    generatedName: boolean;
    candidates: ColumnType[];
    filled: number;
    samples: string[];
    distinct: Set<string>;
    enumEligible: boolean;
    /** Smallest and largest numeric values seen (non-numeric values are ignored). */
    min: number | null;
    max: number | null;
    /** Up to MAX_TRACKED_NUMBERS different numbers, enough to tell a range from a constant. */
    numbers: Set<number>;
}

interface SheetProfile {
    name: string | null;
    headerRow: number | null;
    rows: number;
    columns: ColumnProfile[];
    duplicateHeaders: string[];
}

const toText = (value: unknown): string => {
    if (value instanceof Date) {
        const iso = value.toISOString();
        return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
    }
    return String(value).trim();
};

const shorten = (text: string): string => (text.length > MAX_SAMPLE_LENGTH ? `${text.slice(0, MAX_SAMPLE_LENGTH)}...` : text);

// XLSX workbooks are ZIP packages; the Excel parser would otherwise accept other formats renamed to .xlsx.
async function hasZipSignature(filePath: string): Promise<boolean> {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(4);
        const { bytesRead } = await handle.read(buffer, 0, 4, 0);
        return bytesRead === 4 && buffer.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    } finally {
        await handle.close();
    }
}

function profileHeaders(headers: string[], name: string | null, headerRow: number | null): SheetProfile {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const columns: ColumnProfile[] = [];
    headers.forEach((header, index) => {
        if (seen.has(header)) {
            duplicates.add(header);
            return;
        }
        seen.add(header);
        columns.push({
            name: header,
            // FileRecordReader names blank header cells "Column<position>".
            generatedName: header === `Column${index + 1}`,
            candidates: [...INFERENCE_ORDER],
            filled: 0,
            samples: [],
            distinct: new Set(),
            enumEligible: true,
            min: null,
            max: null,
            numbers: new Set(),
        });
    });
    return { name, headerRow, rows: 0, columns, duplicateHeaders: [...duplicates] };
}

function profileRow(sheet: SheetProfile, row: Record<string, unknown>): void {
    sheet.rows++;
    for (const column of sheet.columns) {
        const value = row[column.name];
        if (isEmptyValue(value)) continue;

        column.filled++;
        column.candidates = column.candidates.filter(type => matchesType(value, type));
        const text = toText(value);
        if (column.samples.length < MAX_SAMPLE_VALUES && !column.samples.includes(shorten(text))) {
            column.samples.push(shorten(text));
        }
        const numeric = toNumber(value);
        if (numeric !== null) {
            column.min = column.min === null ? numeric : Math.min(column.min, numeric);
            column.max = column.max === null ? numeric : Math.max(column.max, numeric);
            if (column.numbers.size < MAX_TRACKED_NUMBERS) column.numbers.add(numeric);
        }
        if (column.enumEligible) {
            // Enum expressions are comma separated, so values containing commas cannot be listed.
            if (typeof value !== 'string' || text.length > MAX_ENUM_VALUE_LENGTH || text.includes(',')) {
                column.enumEligible = false;
            } else {
                column.distinct.add(text);
                if (column.distinct.size > MAX_ENUM_VALUES) column.enumEligible = false;
            }
        }
    }
}

function suggestEnumRule(column: ColumnProfile, type: ColumnType): SuggestedRule | null {
    const values = [...column.distinct];
    if (type !== 'string' || !column.enumEligible || column.name.includes(':')) return null;
    if (values.length < 2 || column.filled < values.length * MIN_ROWS_PER_ENUM_VALUE) return null;

    const expression = `${column.name}: ${values.sort((a, b) => a.localeCompare(b)).join(', ')}`;
    try {
        parseRuleExpression('Enum Check', expression);
    } catch {
        return null;
    }
    return {
        name: `${column.name} allowed values`,
        ruleType: 'Enum Check',
        expression,
        severity: 'Error',
        reason: `${values.length} distinct values repeat across ${column.filled} filled rows. Only values seen in the example would be allowed`,
    };
}

const nameWords = (name: string): string[] =>
    name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** True for columns named like identifiers or codes ("CustomerId", "Order No", "ZipCode", "SKU"). */
export const looksLikeIdentifier = (name: string): boolean => {
    const words = nameWords(name);
    return words.length > 0 && (IDENTIFIER_WORDS.has(words[words.length - 1]) || IDENTIFIER_WORDS.has(words.join('')));
};

/** The smallest 1, 2 or 5 x 10^n that is at least value (value > 0), so a range bound leaves headroom. */
export const niceCeiling = (value: number): number => {
    const base = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 5, 10].find(multiplier => multiplier * base >= value) ?? 10;
    return Number((step * base).toPrecision(12));
};

const formatNumber = (value: number): string => String(Number(value.toPrecision(12)));

function suggestRangeRule(column: ColumnProfile, type: ColumnType): SuggestedRule | null {
    if ((type !== 'integer' && type !== 'decimal') || column.name.includes(':') || column.generatedName) return null;
    if (column.min === null || column.max === null || column.numbers.size < MIN_RANGE_DISTINCT_VALUES) return null;
    if (looksLikeIdentifier(column.name)) return null;

    const min = column.min >= 0 ? 0 : -niceCeiling(-column.min);
    const max = column.max > 0 ? niceCeiling(column.max) : 0;
    const expression = `${column.name}: ${formatNumber(min)}..${formatNumber(max)}`;
    try {
        parseRuleExpression('Range Check', expression);
    } catch {
        return null;
    }
    const observed = `Values in the example range from ${formatNumber(column.min)} to ${formatNumber(column.max)}`;
    return {
        name: `${column.name} range`,
        ruleType: 'Range Check',
        expression,
        severity: 'Error',
        reason: `${observed}. The bounds are rounded out to leave headroom${min === 0 ? ' and reject negative values' : ''}`,
    };
}

function suggestRules(column: ColumnProfile, type: ColumnType): SuggestedRule[] {
    return [suggestEnumRule(column, type), suggestRangeRule(column, type)].filter((rule): rule is SuggestedRule => rule !== null);
}

function summarizeSheet(profile: SheetProfile, truncated: boolean): ExampleSheet {
    const warnings: string[] = [];
    const columns = profile.columns.map(column => {
        const type: ColumnType = column.filled > 0 && column.candidates.length > 0 ? column.candidates[0] : 'string';
        return {
            column,
            suggestion: {
                name: column.name,
                type,
                required: profile.rows > 0 && column.filled === profile.rows,
                filledRows: column.filled,
                sampleValues: column.samples,
            },
        };
    });

    if (profile.columns.length === 0) {
        warnings.push('No header row was found.');
    }
    const blankHeaders = profile.columns.filter(column => column.generatedName).length;
    if (blankHeaders > 0) {
        const titleHint = blankHeaders * 2 > profile.columns.length
            ? ' Uploads use the first non-empty row as the header, so remove any title rows above the headers.'
            : '';
        warnings.push(`${blankHeaders} header cell(s) are blank and were named by position (for example "${profile.columns.find(c => c.generatedName)!.name}").${titleHint}`);
    }
    if (profile.duplicateHeaders.length > 0) {
        warnings.push(`Duplicate headers were merged: ${profile.duplicateHeaders.join(', ')}. Validation reads only one of each; rename them in the source file.`);
    }
    const longNames = profile.columns.filter(column => column.name.length > MAX_COLUMN_NAME_LENGTH).length;
    if (longNames > 0) {
        warnings.push(`${longNames} column name(s) exceed ${MAX_COLUMN_NAME_LENGTH} characters and must be shortened before saving.`);
    }
    if (profile.columns.length > 0 && profile.rows === 0) {
        warnings.push('There are no data rows below the header, so every column defaults to an optional string.');
    }
    if (truncated) {
        warnings.push(`Only the first ${MAX_EXAMPLE_ROWS} data rows were analyzed.`);
    }

    return {
        name: profile.name,
        headerRow: profile.headerRow,
        rowsAnalyzed: profile.rows,
        truncated,
        columns: columns.map(entry => entry.suggestion),
        suggestedRules: columns.flatMap(entry => suggestRules(entry.column, entry.suggestion.type)),
        warnings,
    };
}

/**
 * Analyze an example CSV or XLSX file and propose, per sheet, the columns (name, type, required) and
 * candidate allowed-values (Enum Check) and numeric range (Range Check) rules. Proposals describe the example
 * only; admins review them before saving.
 * Throws ExampleFileError for unsupported or unreadable files.
 */
export async function analyzeExampleFile(filePath: string, fileType: string): Promise<ExampleAnalysis> {
    const type = (fileType || '').toLowerCase().replace(/^\./, '');
    if (!(EXAMPLE_FILE_TYPES as readonly string[]).includes(type)) {
        throw new ExampleFileError(`Example files must be ${EXAMPLE_FILE_TYPES.map(t => t.toUpperCase()).join(' or ')}`);
    }

    const profiles = new Map<string | null, SheetProfile>();
    let current: SheetProfile | null = null;

    if (type === 'xlsx' && !(await hasZipSignature(filePath))) {
        throw new ExampleFileError('The example file is not a valid XLSX workbook');
    }
    let summary;
    try {
        summary = await readRecords(filePath, type, {
            onHeaders: (headers, sheet, headerRow) => {
                current = profileHeaders(headers, sheet ?? null, headerRow ?? null);
                profiles.set(current.name, current);
            },
            onRow: row => {
                if (current) profileRow(current, row);
            },
        }, { maxRowsPerSheet: MAX_EXAMPLE_ROWS });
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw new ExampleFileError(`The example file could not be read: ${reason}`);
    }

    const warnings: string[] = [];
    let sheets: ExampleSheet[];
    if (type === 'csv') {
        const profile = profiles.get(null) ?? profileHeaders([], null, null);
        sheets = [summarizeSheet(profile, Boolean(summary.truncated))];
    } else {
        sheets = summary.sheets.map(sheet => {
            const profile = profiles.get(sheet.name) ?? profileHeaders([], sheet.name, null);
            return summarizeSheet(profile, Boolean(sheet.truncated));
        });
        if (sheets.length > MAX_EXAMPLE_SHEETS) {
            warnings.push(`Only the first ${MAX_EXAMPLE_SHEETS} of ${sheets.length} sheets are shown.`);
            sheets = sheets.slice(0, MAX_EXAMPLE_SHEETS);
        }
    }

    if (sheets.every(sheet => sheet.columns.length === 0)) {
        throw new ExampleFileError('The example file has no header row to build columns from');
    }
    return { fileType: type as ExampleFileType, sheets, warnings };
}
