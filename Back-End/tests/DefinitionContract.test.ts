import { assertPublishable, buildContractSnapshot, diffContracts } from '../src/services/validation/DefinitionContract';

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
