// =============================================================================
// Rule Interface - Defines types for Validation Rules
// =============================================================================

/**
 * Rule type options. Expressions are stored in the SqlQuery column for backward compatibility:
 * - Schema Validation / Required Values: "ColumnA, ColumnB"
 * - Type Check: "Column: integer|decimal|datetime|boolean|string"
 * - Enum Check: "Column: ValueA, ValueB"
 * - Range Check: "Column: min..max" (either bound may be omitted)
 * - Natural Language: "ColumnA, ColumnB" (the columns its generated code reads)
 */
export type RuleType = 'Schema Validation' | 'Required Values' | 'Type Check' | 'Enum Check' | 'Range Check' | 'Natural Language';

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
    /** Sheet table the rule applies to (definitions with one table per sheet); null otherwise. */
    TableName?: string | null;
    /** Natural Language rules only: the request the rule was created from. */
    NaturalLanguageText?: string | null;
    /** Natural Language rules only: model-generated pseudocode of the implementation. */
    Pseudocode?: string | null;
    /** Natural Language rules only: model-generated TypeScript run by the validation engine. */
    GeneratedCode?: string | null;
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
    TableName?: string | null;
    NaturalLanguageText?: string | null;
    Pseudocode?: string | null;
    GeneratedCode?: string | null;
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
    TableName?: string | null;
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

