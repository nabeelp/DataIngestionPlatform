import {
    createDefinitionSchemaEvaluator,
    createRuleEvaluator,
    matchesType,
    parseRuleExpression,
    scopeToSheet,
    MAX_SAMPLE_ERRORS,
    type RowEvaluator,
} from '../src/services/validation/ValidationEngine';

const run = (evaluator: RowEvaluator, headers: string[], rows: Record<string, unknown>[]) => {
    evaluator.onHeaders(headers);
    rows.forEach((row, index) => evaluator.onRow(row, index + 2));
    return evaluator.result();
};

const runSheets = (evaluator: RowEvaluator, sheets: Record<string, { headers: string[]; rows: Record<string, unknown>[] }>) => {
    for (const [sheet, { headers, rows }] of Object.entries(sheets)) {
        evaluator.onHeaders(headers, sheet);
        rows.forEach((row, index) => evaluator.onRow(row, index + 2, sheet));
    }
    return evaluator.result();
};

describe('scopeToSheet', () => {
    const amountColumns = [{ name: 'Amount', type: 'decimal', required: true }];

    it('only evaluates the named sheet, matching its name case-insensitively', () => {
        const result = runSheets(scopeToSheet(createDefinitionSchemaEvaluator(amountColumns), 'Orders', { reportMissing: true }), {
            ' orders ': { headers: ['Amount'], rows: [{ Amount: '1.5' }] },
            Notes: { headers: ['Text'], rows: [{ Text: 'not an amount' }] },
        });
        expect(result).toEqual({ passed: true, errorCount: 0, errors: [] });
    });

    it('reports issues with the sheet name', () => {
        const result = runSheets(scopeToSheet(createDefinitionSchemaEvaluator(amountColumns), 'Orders', { reportMissing: true }), {
            Orders: { headers: ['Amount'], rows: [{ Amount: 'x' }] },
        });
        expect(result.errors).toEqual([{ sheet: 'Orders', row: 2, column: 'Amount', value: 'x', error: 'Value is not a valid decimal' }]);
    });

    it('fails when the sheet is missing, or the file is a CSV', () => {
        const missing = runSheets(scopeToSheet(createDefinitionSchemaEvaluator(amountColumns), 'Orders', { reportMissing: true }), {
            Notes: { headers: ['Text'], rows: [] },
        });
        expect(missing).toEqual({ passed: false, errorCount: 1, errors: [{ sheet: 'Orders', error: 'Required sheet "Orders" not found' }] });

        const csv = run(scopeToSheet(createDefinitionSchemaEvaluator(amountColumns), 'Orders', { reportMissing: true }), ['Amount'], [{ Amount: '1' }]);
        expect(csv.errors[0].error).toContain('CSV files have no sheets');
    });

    it('lets rules pass silently when their sheet is missing (the columns check reports it)', () => {
        const result = runSheets(scopeToSheet(createRuleEvaluator('Enum Check', 'Status: Open'), 'Orders', { reportMissing: false }), {
            Refunds: { headers: ['Status'], rows: [{ Status: 'Other' }] },
        });
        expect(result.passed).toBe(true);
    });
});

describe('matchesType', () => {
    it.each([
        ['42', 'integer', true],
        ['-7', 'integer', true],
        ['4.2', 'integer', false],
        [42, 'integer', true],
        ['4.20', 'decimal', true],
        ['1e3', 'decimal', true],
        ['abc', 'decimal', false],
        ['2024-01-31', 'datetime', true],
        ['2024-01-31T10:15:00Z', 'datetime', true],
        ['31/01/2024', 'datetime', true],
        ['2024-13-45', 'datetime', false],
        ['not a date', 'datetime', false],
        [new Date('2024-01-01'), 'datetime', true],
        ['Yes', 'boolean', true],
        ['0', 'boolean', true],
        ['maybe', 'boolean', false],
        [true, 'boolean', true],
        ['anything', 'string', true],
    ])('%p as %s -> %p', (value, type, expected) => {
        expect(matchesType(value, type)).toBe(expected);
    });
});

describe('parseRuleExpression', () => {
    it('parses each supported rule type', () => {
        expect(parseRuleExpression('Schema Validation', 'A, B')).toEqual({ type: 'Schema Validation', columns: ['A', 'B'] });
        expect(parseRuleExpression('Required Values', 'A')).toEqual({ type: 'Required Values', columns: ['A'] });
        expect(parseRuleExpression('Type Check', 'Amount: Decimal')).toEqual({ type: 'Type Check', column: 'Amount', dataType: 'decimal' });
        expect(parseRuleExpression('Enum Check', 'Status: Active, Inactive')).toEqual({ type: 'Enum Check', column: 'Status', values: ['Active', 'Inactive'] });
        expect(parseRuleExpression('Range Check', 'Qty: 0..')).toEqual({ type: 'Range Check', column: 'Qty', min: 0, max: undefined });
    });

    it.each([
        ['Custom SQL', 'SELECT 1'],
        ['Regex Pattern', 'Col: ^a$'],
        ['Type Check', 'Amount: money'],
        ['Range Check', 'Qty: 10..1'],
        ['Range Check', 'Qty: ..'],
        ['Enum Check', 'Status'],
        ['Schema Validation', '   '],
    ])('rejects %s with %p', (type, expression) => {
        expect(() => parseRuleExpression(type, expression)).toThrow();
    });
});

describe('createDefinitionSchemaEvaluator', () => {
    const columns = [
        { name: 'Id', type: 'integer', required: true },
        { name: 'Email', type: 'string', required: true },
        { name: 'Joined', type: 'datetime', required: false },
        { name: 'Region', type: 'string', required: true },
    ];

    it('reports missing required columns, empty required values, and type mismatches', () => {
        const result = run(createDefinitionSchemaEvaluator(columns), ['Id', 'Email', 'Joined'], [
            { Id: '1', Email: 'a@x.com', Joined: '2024-01-01' },
            { Id: 'x', Email: '', Joined: '' },
        ]);

        expect(result.passed).toBe(false);
        expect(result.errorCount).toBe(3);
        expect(result.errors.map(e => e.error)).toEqual([
            'Required column "Region" not found',
            'Value is not a valid integer',
            'Required value missing for "Email"',
        ]);
        expect(result.errors[1]).toMatchObject({ row: 3, column: 'Id', value: 'x' });
    });

    it('passes a conforming file', () => {
        const result = run(createDefinitionSchemaEvaluator(columns), ['Id', 'Email', 'Joined', 'Region'], [
            { Id: '1', Email: 'a@x.com', Joined: '', Region: 'EU' },
        ]);
        expect(result).toEqual({ passed: true, errorCount: 0, errors: [] });
    });

    it('caps stored samples but keeps the full count', () => {
        const rows = Array.from({ length: MAX_SAMPLE_ERRORS + 50 }, () => ({ Id: 'bad', Email: 'a', Region: 'EU' }));
        const result = run(createDefinitionSchemaEvaluator(columns), ['Id', 'Email', 'Region'], rows);
        expect(result.errorCount).toBe(MAX_SAMPLE_ERRORS + 50);
        expect(result.errors).toHaveLength(MAX_SAMPLE_ERRORS);
    });
});

describe('createRuleEvaluator', () => {
    const headers = ['Status', 'Amount', 'Code'];
    const rows = [
        { Status: 'Active', Amount: '10', Code: 'A1' },
        { Status: 'Bogus', Amount: '5000', Code: '' },
        { Status: '', Amount: 'abc', Code: 'B2' },
    ];

    it('checks enum values and ignores empty cells', () => {
        const result = run(createRuleEvaluator('Enum Check', 'Status: Active, Inactive'), headers, rows);
        expect(result.errorCount).toBe(1);
        expect(result.errors[0]).toMatchObject({ row: 3, value: 'Bogus' });
    });

    it('checks numeric ranges and non-numeric values', () => {
        const result = run(createRuleEvaluator('Range Check', 'Amount: 0..1000'), headers, rows);
        expect(result.errors.map(e => e.error)).toEqual(['Value outside allowed range 0..1000', 'Value is not a number']);
    });

    it('checks required values', () => {
        const result = run(createRuleEvaluator('Required Values', 'Code'), headers, rows);
        expect(result.errorCount).toBe(1);
        expect(result.errors[0]).toMatchObject({ row: 3, column: 'Code' });
    });

    it('checks types', () => {
        const result = run(createRuleEvaluator('Type Check', 'Amount: integer'), headers, rows);
        expect(result.errorCount).toBe(1);
    });

    it('reports a missing column once per sheet', () => {
        const result = run(createRuleEvaluator('Type Check', 'Missing: integer'), headers, rows);
        expect(result.errorCount).toBe(1);
        expect(result.errors[0].error).toBe('Column "Missing" not found');
    });

    it('fails with a configuration error for invalid expressions instead of passing', () => {
        const result = run(createRuleEvaluator('Custom SQL', 'SELECT * FROM x'), headers, rows);
        expect(result.passed).toBe(false);
        expect(result.errors[0].error).toMatch(/Rule configuration error/);
    });
});
