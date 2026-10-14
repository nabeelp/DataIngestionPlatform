import { isRemovedRuleConfig, parseDefinitionContract, parseRuleConfig } from '../src/models/contractMapper';
import { AuthoringInputError, parseDraftRules } from '../src/services/RuleAuthoring.service';
import { ruleConfigFromLegacy } from '../src/models/Rule.model';

jest.mock('../src/config/database', () => ({ getConnection: jest.fn() }));

const rule = (type: string, params: Record<string, unknown>, id = '11111111-1111-4111-8111-111111111111') => ({
    id, name: `${type} rule`, description: '', severity: 'Error', executionOrder: 1, enabled: true, table: null, type, params,
});

const column = { name: 'Amount', type: 'decimal', mustExist: true, nullable: false };
const contract = (rules: unknown[]) => ({
    schemaVersion: 1,
    layout: 'single',
    ignoredSheets: [],
    encoding: 'auto',
    tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [column] }],
    rules,
    lookups: {},
});

const removed = [
    rule('columnsPresent', { columns: ['Amount'] }, '22222222-2222-4222-8222-222222222222'),
    rule('required', { columns: ['Amount'] }, '33333333-3333-4333-8333-333333333333'),
    rule('type', { column: 'Amount', dataType: 'decimal' }, '44444444-4444-4444-8444-444444444444'),
];
const kept = rule('range', { column: 'Amount', min: 0 });

describe('removed rule types (required columns, required values, data type)', () => {
    it('are recognised, as objects or stored JSON', () => {
        for (const item of removed) {
            expect(isRemovedRuleConfig(item)).toBe(true);
            expect(isRemovedRuleConfig(JSON.stringify(item))).toBe(true);
        }
        expect(isRemovedRuleConfig(kept)).toBe(false);
        expect(isRemovedRuleConfig('not json')).toBe(false);
        expect(isRemovedRuleConfig(null)).toBe(false);
    });

    it('are ignored when a stored contract is read, so older definitions and published versions still load', () => {
        const parsed = parseDefinitionContract(contract([...removed, kept]));
        expect(parsed.rules.map(item => item.type)).toEqual(['range']);
    });

    it('are no longer valid rule configurations', () => {
        for (const item of removed) expect(() => parseRuleConfig(item)).toThrow('does not match the RuleConfig contract');
        expect(() => parseRuleConfig(kept)).not.toThrow();
    });

    it('cannot be created through the workspace: submitted rules are refused', () => {
        for (const item of removed) {
            expect(() => parseDraftRules([item])).toThrow(AuthoringInputError);
        }
    });

    it('cannot be created from the legacy rule labels either', () => {
        const legacy = { Id: 'r', Name: 'n', Description: '', Severity: 'Error' as const, ExecutionOrder: 1, SqlQuery: 'A', IsEnabled: true, TableName: null };
        expect(() => ruleConfigFromLegacy({ ...legacy, RuleType: 'Schema Validation' })).toThrow('no longer supported');
        expect(ruleConfigFromLegacy({ ...legacy, RuleType: 'Enum Check', SqlQuery: 'A: x, y' })).toMatchObject({ type: 'enum' });
    });
});
