// =============================================================================
// Rule Interface - Defines types for Validation Rules
// =============================================================================

/**
 * Rule type options. Expressions are stored in the SqlQuery column for backward compatibility:
 * - Schema Validation / Required Values: "ColumnA, ColumnB"
 * - Type Check: "Column: integer|decimal|datetime|boolean|string"
 * - Enum Check: "Column: ValueA, ValueB"
 * - Range Check: "Column: min..max" (either bound may be omitted)
 */
export type RuleType = 'Schema Validation' | 'Required Values' | 'Type Check' | 'Enum Check' | 'Range Check';

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
    RuleType: RuleType;
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

