// =============================================================================
// Rule Service - Business logic for Rules
// =============================================================================

import { Rule } from '../models/Rule.model';
import type { 
    IRule, 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';

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

    return await Rule.update(ruleId, { IsEnabled: !rule.IsEnabled });
}

