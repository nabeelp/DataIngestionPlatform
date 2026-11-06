import { Rule } from '../models/Rule.model';
import type { IRule } from '../interfaces/rule.interface';
import { DefinitionVersionService } from './DefinitionVersion.service';
import { ForbiddenError } from '../utils/httpError';

export async function getRulesByFileDefinitionId(
    fileDefinitionId: string,
    userId: string,
): Promise<(IRule & { CreatorName?: string })[]> {
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, userId)) {
        throw new ForbiddenError('Access denied to this file definition');
    }
    return Rule.findByFileDefinitionIdWithCreator(fileDefinitionId);
}

export async function getPublishedRules(
    fileDefinitionId: string,
    userId: string,
): Promise<{ rules: (IRule & { CreatorName?: string | null })[]; versionNumber: number | null }> {
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, userId)) {
        throw new ForbiddenError('Access denied to this file definition');
    }
    const { activeVersion } = await DefinitionVersionService.getDraftState(fileDefinitionId);
    if (!activeVersion) {
        return { rules: await Rule.findEnabledByFileDefinitionId(fileDefinitionId), versionNumber: null };
    }

    const rules = activeVersion.Contract.rules.map(config => ({
        Id: config.id,
        FileDefinitionId: fileDefinitionId,
        Config: config,
        ConfigSchemaVersion: 1,
        Name: config.name,
        Description: config.description,
        Severity: config.severity,
        ExecutionOrder: config.executionOrder,
        TableName: config.table,
        IsEnabled: config.enabled,
        CreatedBy: activeVersion.CreatedBy,
        CreatorName: activeVersion.CreatedByName,
        CreatedAt: activeVersion.ActivatedAt,
        UpdatedAt: activeVersion.ActivatedAt,
    })).sort((left, right) => left.ExecutionOrder - right.ExecutionOrder);
    return { rules, versionNumber: activeVersion.VersionNumber };
}

export async function getRuleById(ruleId: string, userId: string): Promise<IRule | null> {
    if (!await Rule.hasAccessToRule(ruleId, userId)) {
        throw new ForbiddenError('Access denied to this rule');
    }
    return Rule.findById(ruleId);
}
