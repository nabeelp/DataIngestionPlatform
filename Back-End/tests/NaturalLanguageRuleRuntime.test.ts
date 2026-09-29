import {
    createNaturalLanguageRuleEvaluator,
    findExampleMismatch,
    loadRuleSandbox,
    transpileRuleCode,
    typeCheckRuleCode,
} from '../src/services/validation/NaturalLanguageRuleRuntime';
import { scopeToSheet, type RowEvaluator } from '../src/services/validation/ValidationEngine';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';

const SUFFIX_RULE = `
const SUFFIX = '@contoso.example';
function validateRow(row: Row, rowNumber: number): string | null {
    const email = row['Email'];
    if (email === null || email === '') return null;
    return String(email).toLowerCase().endsWith(SUFFIX) ? null : 'Email must end with ' + SUFFIX;
}`;

const UNIQUE_RULE = `
const seen = new Map<string, number>();
const validateRow = (row: Row, rowNumber: number): string | null => {
    const id = row['Id'];
    if (id === null || id === '') return null;
    const key = String(id);
    const first = seen.get(key);
    if (first !== undefined) return 'Duplicate Id, first seen on row ' + first;
    seen.set(key, rowNumber);
    return null;
};`;

const run = (evaluator: RowEvaluator, headers: string[], rows: Record<string, unknown>[], sheet?: string) => {
    evaluator.onHeaders(headers, sheet);
    rows.forEach((row, index) => evaluator.onRow(row, index + 2, sheet));
    return evaluator.result();
};

describe('natural-language rule runtime', () => {
    let quickjs: QuickJSWASMModule;
    beforeAll(async () => {
        quickjs = await loadRuleSandbox();
    });

    describe('typeCheckRuleCode', () => {
        it('accepts code that implements the validateRow contract', () => {
            expect(() => typeCheckRuleCode(SUFFIX_RULE)).not.toThrow();
            expect(() => typeCheckRuleCode(UNIQUE_RULE)).not.toThrow();
        });

        it.each([
            ['module syntax', `export ${SUFFIX_RULE.trim()}`, 'must not use import or export'],
            ['a missing validateRow', 'function check(row: Row) { return null; }', "Cannot find name 'validateRow'"],
            ['a wrong return type', 'function validateRow(row: Row, rowNumber: number) { return 1; }', 'check.ts'],
            ['a type error', 'function validateRow(row: Row, rowNumber: number): string | null { return row.Email.length ? null : "x"; }', 'rule.ts'],
            ['Node.js globals', 'function validateRow(row: Row, rowNumber: number): string | null { return process.env.X ?? null; }', "Cannot find name 'process'"],
        ])('rejects %s', (_label, code, message) => {
            expect(() => typeCheckRuleCode(code)).toThrow(message);
        });
    });

    it('validates rows the declarative types cannot express, reporting row, column and value', () => {
        const evaluator = createNaturalLanguageRuleEvaluator(quickjs, SUFFIX_RULE, ['Email']);
        const result = run(evaluator, ['Email', 'Name'], [
            { Email: 'a@contoso.example', Name: 'A' },
            { Email: 'b@elsewhere.example', Name: 'B' },
            { Email: '' },
            { Email: 'C@CONTOSO.EXAMPLE' },
        ]);
        expect(result).toEqual({
            passed: false,
            errorCount: 1,
            errors: [{ row: 3, column: 'Email', value: 'b@elsewhere.example', error: 'Email must end with @contoso.example' }],
        });
    });

    it('keeps state across rows and batches, and converts Excel values', () => {
        const rows = Array.from({ length: 1200 }, (_, index) => ({ Id: index % 1000 }));
        rows.push({ Id: new Date('2026-01-01T00:00:00Z') as unknown as number }, { Id: '2026-01-01T00:00:00.000Z' as unknown as number });
        const result = run(createNaturalLanguageRuleEvaluator(quickjs, UNIQUE_RULE, ['Id']), ['Id'], rows);
        expect(result.errorCount).toBe(201);
        expect(result.errors[0]).toMatchObject({ row: 1002, error: 'Duplicate Id, first seen on row 2' });
    });

    it('reports columns missing from the header without running the code', () => {
        const result = run(createNaturalLanguageRuleEvaluator(quickjs, SUFFIX_RULE, ['Email']), ['Name'], [{ Name: 'A' }]);
        expect(result.errors).toEqual([{ column: 'Email', value: null, error: 'Column "Email" not found' }]);
    });

    it('applies to its sheet only when scoped', () => {
        const evaluator = scopeToSheet(createNaturalLanguageRuleEvaluator(quickjs, SUFFIX_RULE, ['Email']), 'Staff', { reportMissing: false });
        evaluator.onHeaders(['Email'], 'Other');
        evaluator.onRow({ Email: 'x@y.z' }, 2, 'Other');
        evaluator.onHeaders(['Email'], 'Staff');
        evaluator.onRow({ Email: 'x@y.z' }, 2, 'Staff');
        expect(evaluator.result().errors).toEqual([expect.objectContaining({ sheet: 'Staff', row: 2 })]);
    });

    it('cannot reach Node.js, the file system or the network', () => {
        const code = `function validateRow(row: Row, rowNumber: number): string | null {
            const g = globalThis as any;
            return [typeof g.require, typeof g.process, typeof g.fetch, typeof g.module].join(',');
        }`;
        const result = run(createNaturalLanguageRuleEvaluator(quickjs, code, ['A']), ['A'], [{ A: '1' }]);
        expect(result.errors[0].error).toBe('undefined,undefined,undefined,undefined');
    });

    it('fails the rule when the code exceeds its time limit', () => {
        const code = 'function validateRow(row: Row, rowNumber: number): string | null { while (true) {} }';
        const evaluator = createNaturalLanguageRuleEvaluator(quickjs, code, ['A'], { timeLimitMs: 200, memoryLimitBytes: 16 * 1024 * 1024 });
        const result = run(evaluator, ['A'], [{ A: '1' }]);
        expect(result).toMatchObject({ passed: false, errors: [{ error: 'Rule exceeded its time limit of 0 seconds' }] });
    });

    it('fails the rule when the code exceeds its memory limit', () => {
        const code = `const kept: number[][] = [];
        function validateRow(row: Row, rowNumber: number): string | null { for (;;) kept.push(new Array(100000).fill(kept.length)); }`;
        const evaluator = createNaturalLanguageRuleEvaluator(quickjs, code, ['A'], { timeLimitMs: 10_000, memoryLimitBytes: 4 * 1024 * 1024 });
        expect(run(evaluator, ['A'], [{ A: '1' }]).errors).toEqual([{ error: 'Rule exceeded its memory limit of 4 MB' }]);
    });

    it.each([
        ['throws', 'function validateRow(row: Row, rowNumber: number): string | null { throw new Error("boom"); }', 'Rule execution error: validateRow threw on row 2: boom'],
        ['returns a non-string', 'function validateRow(row: Row, rowNumber: number): string | null { return 5 as any; }', 'Rule execution error: validateRow must return a string or null (row 2)'],
        ['does not define validateRow', 'const other = 1;', 'Rule execution error: The rule code does not define a validateRow function'],
        ['has a syntax error', 'function validateRow(row: Row {', 'Rule configuration error'],
    ])('fails the rule when the code %s', (_label, code, message) => {
        const result = run(createNaturalLanguageRuleEvaluator(quickjs, code, ['A']), ['A'], [{ A: '1' }, { A: '2' }]);
        expect(result.passed).toBe(false);
        expect(result.errors[0].error).toContain(message);
    });

    it('cannot replace the engine helpers', () => {
        const code = `(globalThis as any).__runBatch = () => '{"failures":[]}';
        function validateRow(row: Row, rowNumber: number): string | null { return 'always fails'; }`;
        const result = run(createNaturalLanguageRuleEvaluator(quickjs, code, ['A']), ['A'], [{ A: '1' }]);
        expect(result.errors).toEqual([expect.objectContaining({ error: 'always fails' })]);
    });

    it('transpiles TypeScript to the JavaScript that runs', () => {
        expect(transpileRuleCode(SUFFIX_RULE)).not.toContain(': Row');
    });

    describe('findExampleMismatch', () => {
        it('accepts code that matches its examples, evaluated in order', () => {
            expect(findExampleMismatch(quickjs, UNIQUE_RULE, ['Id'], [
                { values: { Id: '1' }, expectedValid: true },
                { values: { Id: '2' }, expectedValid: true },
                { values: { Id: '1' }, expectedValid: false },
            ])).toBeNull();
        });

        it('describes the first example the code gets wrong', () => {
            expect(findExampleMismatch(quickjs, SUFFIX_RULE, ['Email'], [
                { values: { Email: 'a@contoso.example' }, expectedValid: false },
            ])).toBe('Example 1 {"Email":"a@contoso.example"} was expected to fail, but it passed');
        });
    });
});
