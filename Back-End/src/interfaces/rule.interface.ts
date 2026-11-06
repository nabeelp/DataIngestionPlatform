// =============================================================================
// Rule Interface - Defines types for Validation Rules
// A rule is stored and exchanged as a versioned RuleConfig; the other fields are read-only projections of it.
// =============================================================================

import type { RuleConfig } from '../contracts/rule-config';

/**
 * Severity options for rules
 */
export type RuleSeverity = 'Error' | 'Warning';

/**
 * Rule entity interface
 */
export interface IRule {
    Id: string;
    FileDefinitionId: string;
    Config: RuleConfig;
    ConfigSchemaVersion: number;
    Name: string;
    Description: string;
    Severity: RuleSeverity;
    ExecutionOrder: number;
    IsEnabled: boolean;
    /** One target sheet, or null when the rule is not scoped to a sheet. */
    TableName: string | null;
    CreatedBy: string | null;
    CreatedAt: Date;
    UpdatedAt: Date;
}

/**
 * Create Rule DTO
 */
export interface ICreateRuleDto {
    FileDefinitionId: string;
    Config: RuleConfig;
    IsEnabled?: boolean;
}

/**
 * Update Rule DTO. Individual fields override the stored configuration.
 */
export interface IUpdateRuleDto {
    Config?: RuleConfig;
    Name?: string;
    Description?: string;
    Severity?: RuleSeverity;
    ExecutionOrder?: number;
    IsEnabled?: boolean;
    TableName?: string | null;
}
