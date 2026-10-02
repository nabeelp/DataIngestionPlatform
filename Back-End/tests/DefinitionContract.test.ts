import {
    assertPublishable,
    buildContractSnapshot,
    contractRuleColumns,
    diffContracts,
    naturalLanguageColumnsBySheet,
    schemaCheckName,
    serializeNaturalLanguageColumnsBySheet,
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

        expect(snapshot.rules.map(r => r.Name)).toEqual(['First', 'Second']);
        expect(snapshot.columns).toEqual(columns);
    });

    it('treats a draft with the same validation behaviour as unchanged', () => {
        const active = buildContractSnapshot(columns, [rule()]);
        const draft = buildContractSnapshot(columns, [
            rule({ Id: 'a1b2c3d4-0000-0000-0000-000000000001', Description: 'Reworded description' }),
        ]);

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

        expect(diff.hasChanges).toBe(true);
        expect(diff.columns).toEqual({ added: ['Email'], removed: [], changed: ['Amount'] });
        expect(diff.rules).toEqual({ added: ['Email required'], removed: ['Status values'], changed: ['Amount range'] });
    });

    it('reports everything as added when nothing has been published yet', () => {
        const diff = diffContracts(null, buildContractSnapshot(columns, [rule()]));

        expect(diff.hasChanges).toBe(true);
        expect(diff.columns.added).toEqual(['CustomerId', 'Amount']);
        expect(diff.rules.added).toEqual(['Amount range']);
    });

    it('refuses to publish a contract without columns or with an invalid rule', () => {
        expect(() => assertPublishable(buildContractSnapshot([], []))).toThrow('at least one column');
        expect(() => assertPublishable(buildContractSnapshot(columns, [rule({ SqlQuery: 'Amount: 9..1' })])))
            .toThrow('Rule "Amount range" is invalid: Minimum cannot exceed maximum');
        expect(() => assertPublishable(buildContractSnapshot(columns, [rule({ RuleType: 'Custom SQL' })])))
            .toThrow('Rule "Amount range" is invalid: Unsupported rule type: Custom SQL');
        expect(() => assertPublishable(buildContractSnapshot(columns, [rule()]))).not.toThrow();
    });
});

describe('natural-language rules in the contract', () => {
    const nlRule = (overrides: Record<string, unknown> = {}) => rule({
        Id: 'r-nl', Name: 'Contoso email', RuleType: 'Natural Language', SqlQuery: 'CustomerId',
        NaturalLanguageText: 'CustomerId must start with C', Pseudocode: 'IF CustomerId does not start with C: report issue',
        GeneratedCode: 'function validateRow(row: Row, rowNumber: number): string | null { return null; }',
        ...overrides,
    });

    it('snapshots the request, pseudocode and code of natural-language rules only', () => {
        const snapshot = buildContractSnapshot(columns, [rule(), nlRule()]);
        const [declarative, generated] = snapshot.rules;
        expect(declarative).not.toHaveProperty('GeneratedCode');
        expect(generated).toMatchObject({
            NaturalLanguageText: 'CustomerId must start with C',
            Pseudocode: 'IF CustomerId does not start with C: report issue',
            GeneratedCode: expect.stringContaining('validateRow'),
        });
        // A published snapshot rebuilt from JSON keeps the generated content.
        expect(buildContractSnapshot(columns, JSON.parse(JSON.stringify(snapshot.rules))).rules).toEqual(snapshot.rules);
    });

    it('treats a code change as a behaviour change, but not a pseudocode rewording', () => {
        const active = buildContractSnapshot(columns, [nlRule()]);
        expect(diffContracts(active, buildContractSnapshot(columns, [nlRule({ Pseudocode: 'reworded' })])).hasChanges).toBe(false);
        expect(diffContracts(active, buildContractSnapshot(columns, [nlRule({ GeneratedCode: 'function validateRow() { return "x"; }' })])).rules.changed)
            .toEqual(['Contoso email']);
    });

    it('refuses to publish a natural-language rule without code or columns in its table', () => {
        expect(() => assertPublishable(buildContractSnapshot(columns, [nlRule()]))).not.toThrow();
        expect(() => assertPublishable(buildContractSnapshot(columns, [nlRule({ GeneratedCode: '' })])))
            .toThrow('Rule "Contoso email" is invalid: A natural-language rule needs generated code');
        expect(() => assertPublishable(buildContractSnapshot(columns, [nlRule({ SqlQuery: '' })])))
            .toThrow('must list the columns it reads');
        const tables = [{ sheet: 'Orders', columns }];
        expect(() => assertPublishable(buildContractSnapshot([], [nlRule({ TableName: 'Orders', SqlQuery: 'Email' })], tables)))
            .toThrow('refers to column "Email", which is not in sheet "Orders"');
    });
});

describe('sheet table contracts', () => {
    const tables = [
        { sheet: ' Orders ', columns },
        { sheet: 'Refunds', columns: [{ name: 'Reason', type: 'string', required: true }] },
    ];

    it('uses sheet tables instead of single-table columns and records each rule\'s table', () => {
        const snapshot = buildContractSnapshot(columns, [rule({ TableName: ' Orders ' })], tables);

        expect(snapshot.columns).toEqual([]);
        expect(snapshot.tables.map(t => t.sheet)).toEqual(['Orders', 'Refunds']);
        expect(snapshot.rules[0].Table).toBe('Orders');
        expect(validationTables(snapshot).map(t => t.sheet)).toEqual(['Orders', 'Refunds']);
        expect(validationTables(buildContractSnapshot(columns, []))).toEqual([{ sheet: null, columns }]);
    });

    it('reads the rule table from published snapshots too', () => {
        const published = buildContractSnapshot([], [{ ...rule(), Table: 'Orders' }], tables);
        expect(published.rules[0].Table).toBe('Orders');
    });

    it('publishes a cross-sheet natural-language rule with columns validated against each named sheet', () => {
        const columnsBySheet = {
            Orders: ['OrderId', 'Amount'],
            Payments: ['PaymentOrderId', 'Amount'],
        };
        const sqlQuery = serializeNaturalLanguageColumnsBySheet(columnsBySheet);
        const crossSheetRule = rule({
            RuleType: 'Natural Language',
            SqlQuery: sqlQuery,
            TableName: null,
            GeneratedCode: 'function validateRow(row: Row, rowNumber: number, sheet?: string): string | null { return null; }',
        });
        const contract = buildContractSnapshot([], [crossSheetRule], [
            { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string', required: true }, { name: 'Amount', type: 'decimal', required: true }] },
            { sheet: 'Payments', columns: [{ name: 'PaymentOrderId', type: 'string', required: true }, { name: 'Amount', type: 'decimal', required: true }] },
        ]);

        expect(naturalLanguageColumnsBySheet(sqlQuery)).toEqual(columnsBySheet);
        expect(contractRuleColumns(contract.rules[0])).toEqual(['OrderId', 'Amount', 'PaymentOrderId']);
        expect(() => assertPublishable(contract)).not.toThrow();
        expect(() => assertPublishable(buildContractSnapshot([], [rule({
            ...crossSheetRule,
            SqlQuery: serializeNaturalLanguageColumnsBySheet({ Orders: ['Missing'], Payments: ['PaymentOrderId'] }),
        })], [
            { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string', required: true }] },
            { sheet: 'Payments', columns: [{ name: 'PaymentOrderId', type: 'string', required: true }] },
        ]))).toThrow('not in sheet "Orders"');
    });

    it('labels sheet table changes with the sheet name', () => {
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
        // Sheet names match case-insensitively, so re-casing a rule's table is not a change.
        expect(diff.rules.changed).toEqual([]);
    });

    it('reports switching from a single table to sheet tables', () => {
        const diff = diffContracts(buildContractSnapshot(columns, []), buildContractSnapshot([], [], tables));
        expect(diff.columns.removed).toEqual(['CustomerId', 'Amount']);
        expect(diff.columns.added).toContain('Sheet "Orders"');
    });

    it.each([
        ['a rule without a table', [rule()], tables, 'must name the sheet table'],
        ['a rule for an unknown sheet', [rule({ TableName: 'Credits' })], tables, 'sheet "Credits", which is not defined'],
        ['a rule column missing from its sheet', [rule({ TableName: 'Refunds' })], tables, 'column "Amount", which is not in sheet "Refunds"'],
        ['duplicate sheets', [], [...tables, { sheet: 'orders', columns }], 'Sheet "orders" is defined more than once'],
        ['a sheet without columns', [], [{ sheet: 'Empty', columns: [] }], 'Sheet "Empty" needs at least one column'],
        ['a long sheet name', [], [{ sheet: 'x'.repeat(32), columns }], 'longer than 31 characters'],
    ])('refuses to publish %s', (_label, rules, sheetTables, message) => {
        expect(() => assertPublishable(buildContractSnapshot([], rules, sheetTables))).toThrow(message);
    });

    it('refuses a sheet rule on a single-table definition and accepts a valid sheet contract', () => {
        expect(() => assertPublishable(buildContractSnapshot(columns, [rule({ TableName: 'Orders' })])))
            .toThrow('this definition has a single table');
        expect(() => assertPublishable(buildContractSnapshot([], [rule({ TableName: 'ORDERS' })], tables))).not.toThrow();
    });

    it('names columns checks per table', () => {
        expect(schemaCheckName(null)).toBe('File definition columns');
        expect(schemaCheckName('Orders')).toBe('Sheet "Orders" columns');
    });
});
