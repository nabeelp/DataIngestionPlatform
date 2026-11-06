import { parseRuleConfig } from '../src/models/contractMapper';
import { AuthoringInputError, parseDraftRules } from '../src/services/RuleDraft.service';

jest.mock('../src/config/database', () => ({ getConnection: jest.fn() }));

const rule = (type: string, params: Record<string, unknown>, id = '11111111-1111-4111-8111-111111111111') => ({
    id, name: `${type} rule`, description: '', severity: 'Error', executionOrder: 1, enabled: true, table: null, type, params,
});

const removed = [
    rule('columnsPresent', { columns: ['Amount'] }, '22222222-2222-4222-8222-222222222222'),
    rule('required', { columns: ['Amount'] }, '33333333-3333-4333-8333-333333333333'),
    rule('type', { column: 'Amount', dataType: 'decimal' }, '44444444-4444-4444-8444-444444444444'),
];
const kept = rule('range', { column: 'Amount', min: 0 });

describe('removed rule types (required columns, required values, data type)', () => {
    it('are no longer valid rule configurations', () => {
        for (const item of removed) expect(() => parseRuleConfig(item)).toThrow('does not match the RuleConfig contract');
        expect(() => parseRuleConfig(kept)).not.toThrow();
    });

    it('cannot be created through the workspace: submitted rules are refused', () => {
        for (const item of removed) {
            expect(() => parseDraftRules([item])).toThrow(AuthoringInputError);
        }
    });
});
