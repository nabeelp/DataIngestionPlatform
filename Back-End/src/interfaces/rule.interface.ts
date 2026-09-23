// =============================================================================
// Rule Interface - Defines types for Validation Rules
// =============================================================================

/**
 * Rule type options
 */
export type RuleType = 'Custom SQL' | 'Schema Validation' | 'Enum Check' | 'Regex Pattern';

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
    Name: string;
    Description: string;
    RuleType: RuleType;
    Severity: RuleSeverity;
    ExecutionOrder: number;
    SqlQuery: string;
    IsEnabled: boolean;
    CreatedBy: string | null;
    CreatedAt: Date;
    UpdatedAt: Date;
}

/**
 * Create Rule DTO
 */
export interface ICreateRuleDto {
    FileDefinitionId: string;
    Name: string;
    Description?: string;
    RuleType?: RuleType;
    Severity?: RuleSeverity;
    ExecutionOrder?: number;
    SqlQuery: string;
    IsEnabled?: boolean;
}

/**
 * Update Rule DTO
 */
export interface IUpdateRuleDto {
    Name?: string;
    Description?: string;
    RuleType?: RuleType;
    Severity?: RuleSeverity;
    ExecutionOrder?: number;
    SqlQuery?: string;
    IsEnabled?: boolean;
}

/**
 * API Response for rules list
 */
export interface IRulesResponse {
    success: boolean;
    rules: IRule[];
    total?: number;
}

/**
 * API Response for single rule
 */
export interface IRuleResponse {
    success: boolean;
    rule: IRule;
}

