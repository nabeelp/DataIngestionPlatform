import { assertValidRule, RuleValidationError, toggleRuleEnabled, updateRule } from '../src/services/Rule.service';
import { Rule } from '../src/models/Rule.model';

jest.mock('../src/models/Rule.model', () => ({
    Rule: { hasAccessToRule: jest.fn(), findById: jest.fn(), update: jest.fn() },
}));

describe('assertValidRule', () => {
    it('accepts supported types with valid expressions', () => {
        expect(() => assertValidRule('Range Check', 'Amount: 0..100')).not.toThrow();
    });

    it.each([
        ['Custom SQL', 'SELECT * FROM upload_data'],
        ['Regex Pattern', 'Code: ^[A-Z]+$'],
        [undefined, 'A'],
        ['Enum Check', 'Status'],
        ['Natural Language', 'Email'],
    ])('rejects %p / %p with a RuleValidationError', (type, expression) => {
        expect(() => assertValidRule(type as string | undefined, expression)).toThrow(RuleValidationError);
    });
});

describe('natural-language rule updates', () => {
    const generated = {
        Id: 'rule-1', RuleType: 'Natural Language', SqlQuery: 'Email', TableName: null, IsEnabled: false,
        GeneratedCode: 'function validateRow(row: Row, rowNumber: number): string | null { return null; }',
    };

    beforeEach(() => {
        jest.mocked(Rule.hasAccessToRule).mockResolvedValue(true);
        jest.mocked(Rule.findById).mockResolvedValue(generated as never);
        jest.mocked(Rule.update).mockImplementation(async (_id, updates) => ({ ...generated, ...updates }) as never);
    });

    it('allows renaming, re-ordering, severity changes and enabling', async () => {
        await expect(updateRule('rule-1', { Name: 'Renamed', Severity: 'Warning', ExecutionOrder: 3, IsEnabled: true }, 'admin'))
            .resolves.toMatchObject({ Name: 'Renamed', IsEnabled: true });
        await expect(toggleRuleEnabled('rule-1', 'admin')).resolves.toMatchObject({ IsEnabled: true });
    });

    it.each([
        ['type', { RuleType: 'Range Check' as const }],
        ['columns', { SqlQuery: 'Name' }],
        ['sheet table', { TableName: 'Orders' }],
    ])('refuses to change the %s', async (_label, updates) => {
        await expect(updateRule('rule-1', updates, 'admin')).rejects.toThrow('cannot be changed');
        expect(Rule.update).not.toHaveBeenCalled();
    });

    it('refuses to enable a natural-language rule without code', async () => {
        jest.mocked(Rule.findById).mockResolvedValue({ ...generated, GeneratedCode: null } as never);
        await expect(toggleRuleEnabled('rule-1', 'admin')).rejects.toThrow('needs generated code');
    });
});
