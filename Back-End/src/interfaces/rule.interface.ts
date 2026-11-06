// =============================================================================
// Rule Interface - Defines types for Validation Rules
// =============================================================================

/**
 * Rule type options. SqlQuery is retained for backward-compatible API responses:
 * - Enum Check: "Column: ValueA, ValueB"
 * - Range Check: "Column: min..max" (either bound may be omitted)
 * - Natural Language: the request text, also available as NaturalLanguageText
 */
export type RuleType = 'Schema Validation' | 'Enum Check' | 'Range Check' | 'Natural Language';

/**
 * Severity options for rules
 */
export type RuleSeverity = 'Error' | 'Warning';

/**
 * Rule entity interface
 */
import type { RuleConfig } from '../contracts/rule-config';

export interface IRule {
    Id: string;
    FileDefinitionId: string;
    Config: RuleConfig;
    ConfigSchemaVersion: number;
    Name: string;
    Description: string;
    RuleType: RuleType;
    Severity: RuleSeverity;
    ExecutionOrder: number;
    SqlQuery: string;
    IsEnabled: boolean;
    /** One target sheet, or null when the rule is not scoped to a sheet. */
    TableName?: string | null;
    /** Natural Language rules only: the request the rule was created from. */
    NaturalLanguageText?: string | null;
    CreatedBy: string | null;
    CreatedAt: Date;
    UpdatedAt: Date;
}

/**
 * Create Rule DTO
 */
export interface ICreateRuleDto {
    FileDefinitionId: string;
    Config?: RuleConfig;
    Name: string;
    Description?: string;
    RuleType: RuleType;
    Severity?: RuleSeverity;
    ExecutionOrder?: number;
    SqlQuery: string;
    IsEnabled?: boolean;
    TableName?: string | null;
    NaturalLanguageText?: string | null;
}

/**
 * Update Rule DTO
 */
export interface IUpdateRuleDto {
    Config?: RuleConfig;
    Name?: string;
    Description?: string;
    RuleType?: RuleType;
    Severity?: RuleSeverity;
    ExecutionOrder?: number;
    SqlQuery?: string;
    IsEnabled?: boolean;
    TableName?: string | null;
    NaturalLanguageText?: string | null;
}
