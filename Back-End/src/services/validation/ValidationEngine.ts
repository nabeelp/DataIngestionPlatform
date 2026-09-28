// =============================================================================
// Validation Engine - declarative, streaming validation of tabular upload data
// =============================================================================

export const DEFINITION_SCHEMA_RULE_TYPE = 'Definition Schema';

export const SUPPORTED_RULE_TYPES = [
    'Schema Validation',
    'Required Values',
    'Type Check',
    'Enum Check',
    'Range Check',
] as const;

export type SupportedRuleType = typeof SUPPORTED_RULE_TYPES[number];

export const COLUMN_TYPES = ['string', 'integer', 'decimal', 'datetime', 'boolean'] as const;
export type ColumnType = typeof COLUMN_TYPES[number];

export const MAX_SAMPLE_ERRORS = 100;

export interface DefinitionColumn {
    name: string;
    type: string;
    required: boolean;
}

export interface ValidationIssue {
    sheet?: string;
    row?: number;
    column?: string;
    value?: string | null;
    error: string;
}

export interface EvaluationResult {
    passed: boolean;
    errorCount: number;
    errors: ValidationIssue[];
}

export interface RowEvaluator {
    onHeaders(headers: string[], sheet?: string): void;
    onRow(row: Record<string, unknown>, rowNumber: number, sheet?: string): void;
    result(): EvaluationResult;
}

export type ParsedRule =
    | { type: 'Schema Validation'; columns: string[] }
    | { type: 'Required Values'; columns: string[] }
    | { type: 'Type Check'; column: string; dataType: ColumnType }
    | { type: 'Enum Check'; column: string; values: string[] }
    | { type: 'Range Check'; column: string; min?: number; max?: number };

// -----------------------------------------------------------------------------
// Value helpers
// -----------------------------------------------------------------------------

const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const LOCAL_DATE_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})( \d{1,2}:\d{2}(:\d{2})?)?$/;
const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '1', '0']);

export const isEmptyValue = (value: unknown): boolean =>
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const displayValue = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = value instanceof Date ? value.toISOString() : String(value);
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
};

export const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && DECIMAL_PATTERN.test(value.trim())) return Number(value.trim());
    return null;
};

// Accepts both day-first and month-first local formats.
const isValidDateParts = (first: number, second: number): boolean =>
    (first >= 1 && first <= 31 && second >= 1 && second <= 12) || (first >= 1 && first <= 12 && second >= 1 && second <= 31);

/**
 * Returns true when a non-empty value conforms to the given column type.
 */
export function matchesType(value: unknown, type: string): boolean {
    switch ((type || 'string').toLowerCase()) {
        case 'integer':
            if (typeof value === 'number') return Number.isInteger(value);
            return typeof value === 'string' && INTEGER_PATTERN.test(value.trim());
        case 'decimal':
        case 'number':
            return toNumber(value) !== null;
        case 'datetime':
        case 'date': {
            if (value instanceof Date) return !Number.isNaN(value.getTime());
            if (typeof value !== 'string') return false;
            const text = value.trim();
            if (ISO_DATE_PATTERN.test(text)) return !Number.isNaN(Date.parse(text));
            const local = LOCAL_DATE_PATTERN.exec(text);
            return local ? isValidDateParts(Number(local[1]), Number(local[2])) : false;
        }
        case 'boolean':
            if (typeof value === 'boolean') return true;
            if (typeof value === 'number') return value === 0 || value === 1;
            return typeof value === 'string' && BOOLEAN_VALUES.has(value.trim().toLowerCase());
        case 'string':
        default:
            return true;
    }
}

// -----------------------------------------------------------------------------
// Rule expression parsing
// -----------------------------------------------------------------------------

const splitList = (text: string): string[] =>
    text.split(',').map(item => item.trim()).filter(Boolean);

const splitColumnExpression = (expression: string, example: string): [string, string] => {
    const index = expression.indexOf(':');
    const column = index > 0 ? expression.slice(0, index).trim() : '';
    const rest = index > 0 ? expression.slice(index + 1).trim() : '';
    if (!column || !rest) {
        throw new Error(`Expected "column: value" (for example "${example}")`);
    }
    return [column, rest];
};

const parseBound = (text: string, label: string): number | undefined => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const value = toNumber(trimmed);
    if (value === null) throw new Error(`${label} must be a number`);
    return value;
};

/**
 * Parse and validate a rule expression. Throws a descriptive error for invalid expressions.
 */
export function parseRuleExpression(ruleType: string, expression: string): ParsedRule {
    const text = (expression || '').trim();
    if (!text) throw new Error('Rule expression is required');

    switch (ruleType) {
        case 'Schema Validation':
        case 'Required Values': {
            const columns = splitList(text);
            if (columns.length === 0) throw new Error('List at least one column, separated by commas');
            return { type: ruleType, columns };
        }
        case 'Type Check': {
            const [column, typeText] = splitColumnExpression(text, 'Amount: decimal');
            const dataType = typeText.toLowerCase() as ColumnType;
            if (!COLUMN_TYPES.includes(dataType)) {
                throw new Error(`Type must be one of: ${COLUMN_TYPES.join(', ')}`);
            }
            return { type: 'Type Check', column, dataType };
        }
        case 'Enum Check': {
            const [column, valuesText] = splitColumnExpression(text, 'Status: Active, Inactive');
            const values = splitList(valuesText);
            if (values.length === 0) throw new Error('List at least one allowed value');
            return { type: 'Enum Check', column, values };
        }
        case 'Range Check': {
            const [column, rangeText] = splitColumnExpression(text, 'Amount: 0..1000');
            const parts = rangeText.split('..');
            if (parts.length !== 2) throw new Error('Range must use "min..max" (either side may be omitted)');
            const min = parseBound(parts[0], 'Minimum');
            const max = parseBound(parts[1], 'Maximum');
            if (min === undefined && max === undefined) throw new Error('Specify a minimum, a maximum, or both');
            if (min !== undefined && max !== undefined && min > max) throw new Error('Minimum cannot exceed maximum');
            return { type: 'Range Check', column, min, max };
        }
        default:
            throw new Error(`Unsupported rule type: ${ruleType}`);
    }
}

// -----------------------------------------------------------------------------
// Evaluators
// -----------------------------------------------------------------------------

class IssueCollector {
    private count = 0;
    private readonly samples: ValidationIssue[] = [];

    add(issue: ValidationIssue): void {
        this.count++;
        if (this.samples.length < MAX_SAMPLE_ERRORS) {
            this.samples.push(issue);
        }
    }

    result(): EvaluationResult {
        return { passed: this.count === 0, errorCount: this.count, errors: this.samples };
    }
}

const withSheet = (issue: ValidationIssue, sheet?: string): ValidationIssue =>
    sheet ? { sheet, ...issue } : issue;

/** Whether two sheet names refer to the same sheet: case-insensitive, ignoring surrounding spaces. */
export const sameSheet = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Restrict an evaluator to the workbook sheet named `sheet`: other sheets are not passed on. When `reportMissing`
 * is set, a file without that sheet (including a CSV file, which has no sheets) fails with an issue.
 */
export function scopeToSheet(inner: RowEvaluator, sheet: string, options: { reportMissing: boolean }): RowEvaluator {
    let found = false;
    let sawCsv = false;
    return {
        onHeaders(headers, currentSheet) {
            if (currentSheet === undefined) sawCsv = true;
            if (currentSheet !== undefined && sameSheet(currentSheet, sheet)) {
                found = true;
                inner.onHeaders(headers, currentSheet);
            }
        },
        onRow(row, rowNumber, currentSheet) {
            if (currentSheet !== undefined && sameSheet(currentSheet, sheet)) inner.onRow(row, rowNumber, currentSheet);
        },
        result() {
            const result = inner.result();
            if (found || !options.reportMissing) return result;
            const error = sawCsv
                ? `Sheet "${sheet}" is required, but CSV files have no sheets; upload an Excel workbook`
                : `Required sheet "${sheet}" not found`;
            return {
                passed: false,
                errorCount: result.errorCount + 1,
                errors: [{ sheet, error }, ...result.errors].slice(0, MAX_SAMPLE_ERRORS),
            };
        },
    };
}

/**
 * Evaluator enforcing a file definition's columns: required headers, required values, and types.
 */
export function createDefinitionSchemaEvaluator(columns: DefinitionColumn[]): RowEvaluator {
    const issues = new IssueCollector();
    const definitionColumns = columns
        .filter(column => column && typeof column.name === 'string' && column.name.trim())
        .map(column => ({ ...column, name: column.name.trim() }));
    let presentColumns: DefinitionColumn[] = [];

    return {
        onHeaders(headers, sheet) {
            const headerSet = new Set(headers);
            presentColumns = definitionColumns.filter(column => headerSet.has(column.name));
            for (const column of definitionColumns) {
                if (column.required && !headerSet.has(column.name)) {
                    issues.add(withSheet({ column: column.name, value: null, error: `Required column "${column.name}" not found` }, sheet));
                }
            }
        },
        onRow(row, rowNumber, sheet) {
            for (const column of presentColumns) {
                const value = row[column.name];
                if (isEmptyValue(value)) {
                    if (column.required) {
                        issues.add(withSheet({ row: rowNumber, column: column.name, value: null, error: `Required value missing for "${column.name}"` }, sheet));
                    }
                } else if (!matchesType(value, column.type)) {
                    issues.add(withSheet({ row: rowNumber, column: column.name, value: displayValue(value), error: `Value is not a valid ${column.type}` }, sheet));
                }
            }
        },
        result: () => issues.result(),
    };
}

/**
 * Evaluator for a single configured rule. Invalid expressions produce a configuration error.
 */
export function createRuleEvaluator(ruleType: string, expression: string): RowEvaluator {
    const issues = new IssueCollector();
    let parsed: ParsedRule;
    try {
        parsed = parseRuleExpression(ruleType, expression);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid rule expression';
        issues.add({ error: `Rule configuration error: ${message}` });
        return { onHeaders: () => undefined, onRow: () => undefined, result: () => issues.result() };
    }

    let headerSet = new Set<string>();
    let columnPresent = true;

    return {
        onHeaders(headers, sheet) {
            headerSet = new Set(headers);
            if (parsed.type === 'Schema Validation' || parsed.type === 'Required Values') {
                for (const column of parsed.columns) {
                    if (!headerSet.has(column)) {
                        issues.add(withSheet({ column, value: null, error: `Required column "${column}" not found` }, sheet));
                    }
                }
            } else {
                columnPresent = headerSet.has(parsed.column);
                if (!columnPresent) {
                    issues.add(withSheet({ column: parsed.column, value: null, error: `Column "${parsed.column}" not found` }, sheet));
                }
            }
        },
        onRow(row, rowNumber, sheet) {
            switch (parsed.type) {
                case 'Schema Validation':
                    return;
                case 'Required Values':
                    for (const column of parsed.columns) {
                        if (headerSet.has(column) && isEmptyValue(row[column])) {
                            issues.add(withSheet({ row: rowNumber, column, value: null, error: `Required value missing for "${column}"` }, sheet));
                        }
                    }
                    return;
                case 'Type Check': {
                    if (!columnPresent) return;
                    const value = row[parsed.column];
                    if (!isEmptyValue(value) && !matchesType(value, parsed.dataType)) {
                        issues.add(withSheet({ row: rowNumber, column: parsed.column, value: displayValue(value), error: `Value is not a valid ${parsed.dataType}` }, sheet));
                    }
                    return;
                }
                case 'Enum Check': {
                    if (!columnPresent) return;
                    const value = row[parsed.column];
                    if (!isEmptyValue(value) && !parsed.values.includes(String(value).trim())) {
                        issues.add(withSheet({ row: rowNumber, column: parsed.column, value: displayValue(value), error: `Value not in allowed values: ${parsed.values.join(', ')}` }, sheet));
                    }
                    return;
                }
                case 'Range Check': {
                    if (!columnPresent) return;
                    const value = row[parsed.column];
                    if (isEmptyValue(value)) return;
                    const numeric = toNumber(value);
                    if (numeric === null) {
                        issues.add(withSheet({ row: rowNumber, column: parsed.column, value: displayValue(value), error: 'Value is not a number' }, sheet));
                    } else if ((parsed.min !== undefined && numeric < parsed.min) || (parsed.max !== undefined && numeric > parsed.max)) {
                        const range = `${parsed.min ?? ''}..${parsed.max ?? ''}`;
                        issues.add(withSheet({ row: rowNumber, column: parsed.column, value: displayValue(value), error: `Value outside allowed range ${range}` }, sheet));
                    }
                    return;
                }
            }
        },
        result: () => issues.result(),
    };
}
