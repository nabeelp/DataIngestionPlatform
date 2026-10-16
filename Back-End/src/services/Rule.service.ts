import { Rule } from '../models/Rule.model';
import type { IRule } from '../interfaces/rule.interface';
import type { RuleConfig } from '../contracts/rule-config';
import { DefinitionVersionService } from './DefinitionVersion.service';

function legacyRuleType(type: RuleConfig['type']): IRule['RuleType'] {
    switch (type) {
        case 'enum': return 'Enum Check';
        case 'range': return 'Range Check';
        default: return 'Natural Language';
    }
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

export async function getRuleById(ruleId: string, userId: string): Promise<IRule | null> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new Error('Access denied to this rule');
    }
    return Rule.findById(ruleId);
}
