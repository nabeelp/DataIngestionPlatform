import {
    buildContractSnapshot,
    COLUMN_TYPES,
    diffContracts,
    hasSheetTables,
    MAX_SHEET_NAME_LENGTH,
    schemaCheckName,
    validationTables,
} from '../src/services/validation/DefinitionContract';

const columns = [
    { name: 'CustomerId', type: 'string', required: true },
    { name: 'Amount', type: 'decimal', required: false },
];

const rule = (overrides: Record<string, unknown> = {}) => ({
    Id: 'A1B2C3D4-0000-0000-0000-000000000001',
    FileDefinitionId: 'def-1',
    Name: 'Amount range',
    Description: 'Keeps amounts sane',
    RuleType: 'Range Check',
    Severity: 'Error',
    ExecutionOrder: 1,
    SqlQuery: 'Amount: 0..100',
    IsEnabled: true,
    ...overrides,
});

describe('definition contract snapshots', () => {
    it('only includes enabled rules, ordered by execution order', () => {
        const snapshot = buildContractSnapshot(columns, [
            rule({ Id: 'r-2', Name: 'Second', ExecutionOrder: 2 }),
            rule({ Id: 'r-off', Name: 'Disabled', IsEnabled: false }),
            rule({ Id: 'r-1', Name: 'First', ExecutionOrder: 1 }),
        ]);

        expect(snapshot.rules.map(candidate => candidate.Name)).toEqual(['First', 'Second']);
        expect(snapshot.columns).toEqual(columns);
    });

    it('treats a description-only edit as unchanged', () => {
        const active = buildContractSnapshot(columns, [rule()]);
        const draft = buildContractSnapshot(columns, [rule({ Description: 'Reworded description' })]);

        expect(diffContracts(active, draft).hasChanges).toBe(false);
    });

    it('reports added, removed and changed columns and rules', () => {
        const active = buildContractSnapshot(columns, [
            rule(),
            rule({ Id: 'r-status', Name: 'Status values', RuleType: 'Enum Check', SqlQuery: 'Status: A, B' }),
        ]);
        const draft = buildContractSnapshot(
            [
                { name: 'CustomerId', type: 'string', required: true },
                { name: 'Amount', type: 'integer', required: true },
                { name: 'Email', type: 'string', required: false },
            ],
            [rule({ SqlQuery: 'Amount: 0..500' }), rule({ Id: 'r-new', Name: 'Email required', RuleType: 'Required Values', SqlQuery: 'Email' })],
        );

        const diff = diffContracts(active, draft);

        expect(diff).toEqual({
            hasChanges: true,
            columns: { added: ['Email'], removed: [], changed: ['Amount'] },
            rules: { added: ['Email required'], removed: ['Status values'], changed: ['Amount range'] },
        });
    });

    it('reports everything as added when nothing has been published yet', () => {
        const diff = diffContracts(null, buildContractSnapshot(columns, [rule()]));

        expect(diff.hasChanges).toBe(true);
        expect(diff.columns.added).toEqual(['CustomerId', 'Amount']);
        expect(diff.rules.added).toEqual(['Amount range']);
    });

    it('tracks natural-language requests without storing or comparing executable code', () => {
        const snapshot = buildContractSnapshot(columns, [rule({
            RuleType: 'Natural Language',
            SqlQuery: 'CustomerId must start with C',
            NaturalLanguageText: 'CustomerId must start with C',
        })]);
        const changedRequest = buildContractSnapshot(columns, [rule({
            RuleType: 'Natural Language',
            SqlQuery: 'CustomerId must start with X',
            NaturalLanguageText: 'CustomerId must start with X',
        })]);

        expect(snapshot.rules[0].NaturalLanguageText).toBe('CustomerId must start with C');
        expect(snapshot.rules[0]).not.toHaveProperty('GeneratedCode');
        expect(diffContracts(snapshot, changedRequest).rules.changed).toEqual(['Amount range']);
    });
});

describe('sheet-table contracts', () => {
    const tables = [
        { sheet: ' Orders ', columns },
        { sheet: 'Refunds', columns: [{ name: 'Reason', type: 'string', required: true }] },
    ];

    it('uses sheet tables instead of single-table columns and records each rule table', () => {
        const snapshot = buildContractSnapshot(columns, [rule({ TableName: ' Orders ' })], tables);

        expect(snapshot.columns).toEqual([]);
        expect(snapshot.tables.map(table => table.sheet)).toEqual(['Orders', 'Refunds']);
        expect(snapshot.rules[0].Table).toBe('Orders');
        expect(hasSheetTables(snapshot)).toBe(true);
        expect(validationTables(snapshot).map(table => table.sheet)).toEqual(['Orders', 'Refunds']);
        expect(validationTables(buildContractSnapshot(columns, []))).toEqual([{ sheet: null, columns }]);
        expect(hasSheetTables(buildContractSnapshot(columns, []))).toBe(false);
    });

    it('treats sheet-name casing as equivalent in version diffs', () => {
        const active = buildContractSnapshot([], [rule({ TableName: 'Orders' })], tables);
        const draft = buildContractSnapshot([], [rule({ TableName: 'orders' })], [
            { sheet: 'Orders', columns: [columns[0], { name: 'Amount', type: 'integer', required: false }] },
            { sheet: 'Credits', columns: [{ name: 'Code', type: 'string', required: true }] },
        ]);

        const diff = diffContracts(active, draft);

        expect(diff.columns).toEqual({
            added: ['Sheet "Credits"', 'Credits › Code'],
            removed: ['Sheet "Refunds"', 'Refunds › Reason'],
            changed: ['Orders › Amount'],
        });
        expect(diff.rules.changed).toEqual([]);
    });

    it('reports switching between single-table and sheet-table layouts', () => {
        const diff = diffContracts(buildContractSnapshot(columns, []), buildContractSnapshot([], [], tables));

        expect(diff.columns.removed).toEqual(['CustomerId', 'Amount']);
        expect(diff.columns.added).toContain('Sheet "Orders"');
        expect(validationTables(buildContractSnapshot([], [], tables))).toHaveLength(2);
    });

    it('preserves stable schema check labels and current column limits', () => {
        expect(schemaCheckName(null)).toBe('File definition columns');
        expect(schemaCheckName('Orders')).toBe('Sheet "Orders" columns');
        expect(COLUMN_TYPES).toEqual(['string', 'integer', 'decimal', 'date', 'datetime', 'boolean']);
        expect(MAX_SHEET_NAME_LENGTH).toBe(31);
    });
});
