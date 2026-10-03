import { Rule } from '../models/Rule.model';
import type { IRule, ICreateRuleDto, IUpdateRuleDto } from '../interfaces/rule.interface';
import type { RuleConfig } from '../contracts/rule-config';
import { DefinitionVersionService } from './DefinitionVersion.service';
import { RulesService } from './RulesService.service';

export class RuleValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuleValidationError';
    }
}

function legacyRuleType(type: RuleConfig['type']): IRule['RuleType'] {
    switch (type) {
        case 'columnsPresent': return 'Schema Validation';
        case 'required': return 'Required Values';
        case 'type': return 'Type Check';
        case 'enum': return 'Enum Check';
        case 'range': return 'Range Check';
        default: return 'Natural Language';
    }
}

export async function validateRuleConfig(fileDefinitionId: string, rule: RuleConfig): Promise<RuleConfig> {
    const contract = await DefinitionVersionService.getDraftContract(fileDefinitionId);
    const result = await RulesService.validateRule(contract, rule);
    if (!result.ok) {
        const message = result.errors.map(error => `${error.path}: ${error.message}`).join('; ');
        throw new RuleValidationError(message || 'Rule configuration is invalid.');
    }
    return result.normalizedRule ?? rule;
}

export async function getRulesByFileDefinitionId(
    fileDefinitionId: string,
    userId: string,
): Promise<(IRule & { CreatorName?: string })[]> {
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, userId)) {
        throw new Error('Access denied to this file definition');
    }
    return Rule.findByFileDefinitionIdWithCreator(fileDefinitionId);
}

export async function getPublishedRules(
    fileDefinitionId: string,
    userId: string,
): Promise<{ rules: (IRule & { CreatorName?: string | null })[]; versionNumber: number | null }> {
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, userId)) {
        throw new Error('Access denied to this file definition');
    }
    const { activeVersion } = await DefinitionVersionService.getDraftState(fileDefinitionId);
    if (!activeVersion) {
        return { rules: await Rule.findEnabledByFileDefinitionId(fileDefinitionId), versionNumber: null };
    }

    const rules = activeVersion.Rules.map(rule => {
        const config = activeVersion.Contract.rules.find(candidate => candidate.id.toLowerCase() === rule.Id.toLowerCase());
        if (!config) throw new Error(`Published rule ${rule.Id} is missing from its contract.`);
        return {
            Id: rule.Id,
            FileDefinitionId: fileDefinitionId,
            Config: config,
            ConfigSchemaVersion: 1,
            Name: config.name,
            Description: config.description,
            RuleType: legacyRuleType(config.type),
            Severity: config.severity,
            ExecutionOrder: config.executionOrder,
            SqlQuery: rule.SqlQuery,
            TableName: config.table,
            NaturalLanguageText: config.type === 'naturalLanguage' && typeof config.params.request === 'string'
                ? config.params.request
                : null,
            IsEnabled: config.enabled,
            CreatedBy: activeVersion.CreatedBy,
            CreatorName: activeVersion.CreatedByName,
            CreatedAt: activeVersion.ActivatedAt,
            UpdatedAt: activeVersion.ActivatedAt,
        };
    });
    return { rules, versionNumber: activeVersion.VersionNumber };
}

export async function getEnabledRulesByFileDefinitionId(fileDefinitionId: string): Promise<IRule[]> {
    return Rule.findEnabledByFileDefinitionId(fileDefinitionId);
}

export async function getRuleById(ruleId: string, userId: string): Promise<IRule | null> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new Error('Access denied to this rule');
    }
    return Rule.findById(ruleId);
}

export async function createRule(dto: ICreateRuleDto, userId: string): Promise<IRule> {
    if (!await Rule.hasAccessToFileDefinition(dto.FileDefinitionId, userId)) {
        throw new Error('Access denied to this file definition');
    }
    if (!dto.Config) throw new RuleValidationError('RuleConfig is required.');

    const config = await validateRuleConfig(dto.FileDefinitionId, dto.Config);
    return Rule.create({
        FileDefinitionId: dto.FileDefinitionId,
        Config: config,
        Name: config.name,
        Description: config.description,
        RuleType: 'Required Values',
        Severity: config.severity,
        ExecutionOrder: config.executionOrder,
        SqlQuery: '',
        IsEnabled: config.enabled,
        TableName: config.table,
    }, userId);
}

export async function updateRule(
    ruleId: string,
    updates: IUpdateRuleDto,
    userId: string,
): Promise<IRule | null> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new Error('Access denied to this rule');
    }
    const existing = await Rule.findById(ruleId);
    if (!existing) return null;

    const config: RuleConfig = {
        ...existing.Config,
        ...updates.Config,
        id: existing.Id,
        name: updates.Config?.name ?? updates.Name ?? existing.Config.name,
        description: updates.Config?.description ?? updates.Description ?? existing.Config.description,
        severity: updates.Config?.severity ?? updates.Severity ?? existing.Config.severity,
        executionOrder: updates.Config?.executionOrder ?? updates.ExecutionOrder ?? existing.Config.executionOrder,
        enabled: updates.Config?.enabled ?? updates.IsEnabled ?? existing.Config.enabled,
        table: updates.Config
            ? updates.Config.table
            : updates.TableName !== undefined
                ? updates.TableName ?? null
                : existing.Config.table,
    };

    if (updates.Config || (config.enabled && !existing.Config.enabled)) {
        config.id = existing.Id;
        Object.assign(config, await validateRuleConfig(existing.FileDefinitionId, config));
    }
    return Rule.update(ruleId, { Config: config, IsEnabled: config.enabled });
}

export async function deleteRule(ruleId: string, userId: string): Promise<void> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new Error('Access denied to this rule');
    }
    await Rule.delete(ruleId);
}

export async function toggleRuleEnabled(ruleId: string, userId: string): Promise<IRule | null> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new Error('Access denied to this rule');
    }
    const rule = await Rule.findById(ruleId);
    if (!rule) return null;
    return updateRule(ruleId, { Config: { ...rule.Config, enabled: !rule.Config.enabled } }, userId);
}
