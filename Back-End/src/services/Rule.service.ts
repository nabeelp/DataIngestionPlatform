// =============================================================================
// Rule Service - Business logic for Rules
// =============================================================================

import { Rule } from '../models/Rule.model';
import type { 
    IRule, 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';
import { NATURAL_LANGUAGE_RULE_TYPE, SUPPORTED_RULE_TYPES, parseRuleExpression } from './validation/ValidationEngine';
import { contractRuleColumns } from './validation/DefinitionContract';
import { DefinitionVersionService } from './DefinitionVersion.service';

/**
 * Raised when a rule's type or expression is invalid (maps to HTTP 400).
 */
export class RuleValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuleValidationError';
    }
}

/**
 * Ensure a rule type is supported and its expression parses.
 */
export function assertValidRule(ruleType: string | undefined, expression: string | undefined): void {
    if (!ruleType || !(SUPPORTED_RULE_TYPES as readonly string[]).includes(ruleType)) {
        throw new RuleValidationError(`Rule type must be one of: ${SUPPORTED_RULE_TYPES.join(', ')}`);
    }
    try {
        parseRuleExpression(ruleType, expression || '');
    } catch (error) {
        throw new RuleValidationError(error instanceof Error ? error.message : 'Invalid rule expression');
    }
}

/**
 * Ensure a stored rule (declarative or natural-language) can run before it is enabled.
 */
function assertRuleCanRun(rule: Pick<IRule, 'RuleType' | 'SqlQuery' | 'GeneratedCode'>): void {
    if (rule.RuleType !== NATURAL_LANGUAGE_RULE_TYPE) {
        assertValidRule(rule.RuleType, rule.SqlQuery);
        return;
    }
    try {
        contractRuleColumns({ RuleType: rule.RuleType, SqlQuery: rule.SqlQuery, GeneratedCode: rule.GeneratedCode ?? undefined });
    } catch (error) {
        throw new RuleValidationError(error instanceof Error ? error.message : 'Invalid natural-language rule');
    }
}

/**
 * Get all rules for a file definition (with access control)
 */
export async function getRulesByFileDefinitionId(
    fileDefinitionId: string, 
    userId: string
): Promise<(IRule & { CreatorName?: string })[]> {
    // Check if user has access to this file definition
    const hasAccess = await Rule.hasAccessToFileDefinition(fileDefinitionId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this file definition');
    }

    return await Rule.findByFileDefinitionIdWithCreator(fileDefinitionId);
}

/**
 * Rules of the active version (with access control). Falls back to the enabled rules for a
 * definition that has never been versioned.
 */
export async function getPublishedRules(
    fileDefinitionId: string,
    userId: string
): Promise<{ rules: (IRule & { CreatorName?: string | null })[]; versionNumber: number | null }> {
    const hasAccess = await Rule.hasAccessToFileDefinition(fileDefinitionId, userId);
    if (!hasAccess) {
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
            Name: rule.Name,
            Description: rule.Description,
            RuleType: rule.RuleType as IRule['RuleType'],
            Severity: rule.Severity as IRule['Severity'],
            ExecutionOrder: rule.ExecutionOrder,
            SqlQuery: rule.SqlQuery,
            TableName: rule.Table,
            NaturalLanguageText: rule.NaturalLanguageText ?? null,
            Pseudocode: rule.Pseudocode ?? null,
            GeneratedCode: rule.GeneratedCode ?? null,
            IsEnabled: true,
            CreatedBy: activeVersion.CreatedBy,
            CreatorName: activeVersion.CreatedByName,
            CreatedAt: activeVersion.ActivatedAt,
            UpdatedAt: activeVersion.ActivatedAt,
        };
    });
    return { rules, versionNumber: activeVersion.VersionNumber };
}

/**
 * Get enabled rules for a file definition (for validation execution)
 */
export async function getEnabledRulesByFileDefinitionId(
    fileDefinitionId: string
): Promise<IRule[]> {
    return await Rule.findEnabledByFileDefinitionId(fileDefinitionId);
}

/**
 * Get a single rule by ID (with access control)
 */
export async function getRuleById(ruleId: string, userId: string): Promise<IRule | null> {
    // Check if user has access to the rule's file definition
    const hasAccess = await Rule.hasAccessToRule(ruleId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this rule');
    }

    return await Rule.findById(ruleId);
}

/**
 * Create a new rule (with access control)
 */
export async function createRule(
    dto: ICreateRuleDto, 
    userId: string
): Promise<IRule> {
    // Check if user has access to the file definition
    const hasAccess = await Rule.hasAccessToFileDefinition(dto.FileDefinitionId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this file definition');
    }

    assertValidRule(dto.RuleType, dto.SqlQuery);
    return await Rule.create(dto, userId);
}

/**
 * Update a rule (with access control)
 */
export async function updateRule(
    ruleId: string, 
    updates: IUpdateRuleDto,
    userId: string
): Promise<IRule | null> {
    // Check if user has access to the rule's file definition
    const hasAccess = await Rule.hasAccessToRule(ruleId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this rule');
    }

    const existing = await Rule.findById(ruleId);
    if (!existing) {
        return null;
    }

    if (existing.RuleType === NATURAL_LANGUAGE_RULE_TYPE) {
        // Generated code is bound to its columns, sheet and type; regenerate the rule to change its behaviour.
        const changesLogic = (updates.RuleType !== undefined && updates.RuleType !== existing.RuleType) ||
            (updates.SqlQuery !== undefined && updates.SqlQuery !== existing.SqlQuery) ||
            (updates.TableName !== undefined && (updates.TableName ?? null) !== (existing.TableName ?? null));
        if (changesLogic) {
            throw new RuleValidationError('The type, columns and sheet table of a natural-language rule cannot be changed; create a new rule instead');
        }
        if ((updates.IsEnabled ?? existing.IsEnabled) && !existing.IsEnabled) {
            assertRuleCanRun(existing);
        }
        return await Rule.update(ruleId, updates);
    }

    const effectiveType = updates.RuleType ?? existing.RuleType;
    const effectiveExpression = updates.SqlQuery ?? existing.SqlQuery;
    const willBeEnabled = updates.IsEnabled ?? existing.IsEnabled;
    if (updates.RuleType !== undefined || updates.SqlQuery !== undefined || (willBeEnabled && !existing.IsEnabled)) {
        assertValidRule(effectiveType, effectiveExpression);
    }

    return await Rule.update(ruleId, updates);
}

/**
 * Delete a rule (with access control)
 */
export async function deleteRule(ruleId: string, userId: string): Promise<void> {
    // Check if user has access to the rule's file definition
    const hasAccess = await Rule.hasAccessToRule(ruleId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this rule');
    }

    await Rule.delete(ruleId);
}

/**
 * Toggle rule enabled/disabled status (with access control)
 */
export async function toggleRuleEnabled(
    ruleId: string, 
    userId: string
): Promise<IRule | null> {
    // Check if user has access to the rule's file definition
    const hasAccess = await Rule.hasAccessToRule(ruleId, userId);
    
    if (!hasAccess) {
        throw new Error('Access denied to this rule');
    }

    const rule = await Rule.findById(ruleId);
    
    if (!rule) {
        return null;
    }

    if (!rule.IsEnabled) {
        assertRuleCanRun(rule);
    }

    return await Rule.update(ruleId, { IsEnabled: !rule.IsEnabled });
}
