import { Rule } from '../src/models/Rule.model';
import type { IRule } from '../src/interfaces/rule.interface';
import type { RuleConfig } from '../src/contracts/rule-config';
import type { DefinitionContract } from '../src/contracts/definition-contract';
import { DefinitionVersionService } from '../src/services/DefinitionVersion.service';
import { RulesService } from '../src/services/RulesService.service';
import {
    RuleValidationError,
    toggleRuleEnabled,
    validateRuleConfig,
} from '../src/services/Rule.service';

jest.mock('../src/models/Rule.model', () => ({
    Rule: {
        hasAccessToRule: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
    },
}));
jest.mock('../src/services/DefinitionVersion.service', () => ({
    DefinitionVersionService: { getDraftContract: jest.fn() },
}));
jest.mock('../src/services/RulesService.service', () => ({
    RulesService: { validateRule: jest.fn() },
}));

const contract = { schemaVersion: 1 } as DefinitionContract;
const ruleConfig: RuleConfig = {
    id: 'rule-1',
    name: 'Email required',
    description: 'Email must be present.',
    severity: 'Error',
    executionOrder: 1,
    enabled: true,
    table: null,
    type: 'required',
    params: { columns: ['Email'] },
};
const existingRule: IRule = {
    Id: 'rule-1',
    FileDefinitionId: 'definition-1',
    Config: { ...ruleConfig, enabled: false },
    ConfigSchemaVersion: 1,
    Name: ruleConfig.name,
    Description: ruleConfig.description,
    RuleType: 'Required Values',
    Severity: 'Error',
    ExecutionOrder: 1,
    SqlQuery: 'Email',
    IsEnabled: false,
    TableName: null,
    NaturalLanguageText: null,
    Pseudocode: null,
    GeneratedCode: null,
    CreatedBy: 'user-1',
    CreatedAt: new Date(0),
    UpdatedAt: new Date(0),
};

describe('RuleConfig validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(DefinitionVersionService.getDraftContract).mockResolvedValue(contract);
        jest.mocked(RulesService.validateRule).mockImplementation(async (_contract, rule) => ({
            ok: true,
            errors: [],
            normalizedRule: rule,
            explanation: null,
        }));
    });

    it('validates RuleConfig through the Python rules service', async () => {
        await expect(validateRuleConfig('definition-1', ruleConfig)).resolves.toEqual(ruleConfig);
        expect(RulesService.validateRule).toHaveBeenCalledWith(contract, ruleConfig);
    });

    it('rejects a RuleConfig the Python rules service reports as invalid', async () => {
        jest.mocked(RulesService.validateRule).mockResolvedValue({
            ok: false,
            errors: [{ path: 'params.columns', message: 'Unknown column.' }],
            normalizedRule: null,
            explanation: null,
        });

        await expect(validateRuleConfig('definition-1', ruleConfig))
            .rejects.toThrow(RuleValidationError);
    });
});

describe('RuleConfig rule updates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(Rule.hasAccessToRule).mockResolvedValue(true);
        jest.mocked(Rule.findById).mockResolvedValue(existingRule);
        jest.mocked(Rule.update).mockImplementation(async (_id, updates) => ({
            ...existingRule,
            ...updates,
            Config: updates.Config ?? existingRule.Config,
        }));
        jest.mocked(DefinitionVersionService.getDraftContract).mockResolvedValue(contract);
        jest.mocked(RulesService.validateRule).mockImplementation(async (_contract, rule) => ({
            ok: true,
            errors: [],
            normalizedRule: rule,
            explanation: null,
        }));
    });

    it('validates the complete configuration before enabling a rule', async () => {
        await expect(toggleRuleEnabled('rule-1', 'user-1')).resolves.toMatchObject({
            Config: { id: 'rule-1', enabled: true },
            IsEnabled: true,
        });
        expect(RulesService.validateRule).toHaveBeenCalledWith(
            contract,
            expect.objectContaining({ id: 'rule-1', enabled: true }),
        );
    });

    it('does not update a rule when Python validation fails', async () => {
        jest.mocked(RulesService.validateRule).mockResolvedValue({
            ok: false,
            errors: [{ path: 'params.columns', message: 'Unknown column.' }],
            normalizedRule: null,
            explanation: null,
        });

        await expect(toggleRuleEnabled('rule-1', 'user-1')).rejects.toThrow(RuleValidationError);
        expect(Rule.update).not.toHaveBeenCalled();
    });
});
