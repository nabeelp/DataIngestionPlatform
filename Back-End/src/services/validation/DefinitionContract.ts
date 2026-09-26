// =============================================================================
// Definition Contract - the versioned part of a file definition
// A contract is the definition's columns plus its enabled rules: everything that decides
// whether an upload is valid. Operational settings (name, status, delivery folder) are not versioned.
// =============================================================================

import { SUPPORTED_RULE_TYPES, parseRuleExpression, type DefinitionColumn } from './ValidationEngine';

export interface ContractRule {
    Id: string;
    Name: string;
    Description: string;
    RuleType: string;
    Severity: string;
    ExecutionOrder: number;
    SqlQuery: string;
}

export interface ContractSnapshot {
    columns: DefinitionColumn[];
    rules: ContractRule[];
}

export interface ContractChanges {
    added: string[];
    removed: string[];
    changed: string[];
}

export interface ContractDiff {
    hasChanges: boolean;
    columns: ContractChanges;
    rules: ContractChanges;
}

interface SourceRule {
    Id: string;
    Name: string;
    Description?: string | null;
    RuleType: string;
    Severity?: string | null;
    ExecutionOrder?: number | null;
    SqlQuery: string;
    IsEnabled?: boolean | number | null;
}

export class ContractValidationError extends Error {}

const ruleKey = (rule: Pick<ContractRule, 'Id'>): string => String(rule.Id).toLowerCase();

const isEnabled = (rule: SourceRule): boolean => rule.IsEnabled === undefined || rule.IsEnabled === null || Boolean(rule.IsEnabled);

/**
 * Build the contract for a definition from its columns and rules. Disabled rules are not part of the contract.
 */
export function buildContractSnapshot(columns: unknown, rules: SourceRule[]): ContractSnapshot {
    const contractColumns = (Array.isArray(columns) ? columns : [])
        .filter(column => column && typeof column.name === 'string' && column.name.trim())
        .map(column => ({ name: column.name.trim(), type: String(column.type || 'string'), required: Boolean(column.required) }));

    const contractRules = rules
        .filter(isEnabled)
        .map(rule => ({
            Id: ruleKey(rule),
            Name: rule.Name,
            Description: rule.Description || '',
            RuleType: rule.RuleType,
            Severity: rule.Severity || 'Error',
            ExecutionOrder: Number(rule.ExecutionOrder ?? 0),
            SqlQuery: rule.SqlQuery,
        }))
        .sort((a, b) => a.ExecutionOrder - b.ExecutionOrder || a.Id.localeCompare(b.Id));

    return { columns: contractColumns, rules: contractRules };
}

const columnBehaviour = (column: DefinitionColumn): string => `${column.type.toLowerCase()}|${column.required}`;

// Description is documentation only; everything else changes how a file is validated or reported.
const ruleBehaviour = (rule: ContractRule): string =>
    JSON.stringify([rule.Name, rule.RuleType, rule.Severity, rule.ExecutionOrder, rule.SqlQuery]);

function diffBy<T>(previous: T[], next: T[], key: (item: T) => string, label: (item: T) => string, behaviour: (item: T) => string): ContractChanges {
    const previousByKey = new Map(previous.map(item => [key(item), item]));
    const nextKeys = new Set(next.map(key));
    const changes: ContractChanges = { added: [], removed: [], changed: [] };

    for (const item of next) {
        const before = previousByKey.get(key(item));
        if (!before) changes.added.push(label(item));
        else if (behaviour(before) !== behaviour(item)) changes.changed.push(label(item));
    }
    for (const item of previous) {
        if (!nextKeys.has(key(item))) changes.removed.push(label(item));
    }
    return changes;
}

const hasAny = (changes: ContractChanges): boolean =>
    changes.added.length + changes.removed.length + changes.changed.length > 0;

/**
 * Describe what publishing `draft` would change compared with the `active` contract (null when none is published).
 */
export function diffContracts(active: ContractSnapshot | null, draft: ContractSnapshot): ContractDiff {
    const previous = active ?? { columns: [], rules: [] };
    const columns = diffBy(previous.columns, draft.columns, column => column.name, column => column.name, columnBehaviour);
    const rules = diffBy(previous.rules, draft.rules, ruleKey, rule => rule.Name, ruleBehaviour);
    return { hasChanges: active === null || hasAny(columns) || hasAny(rules), columns, rules };
}

/**
 * Throw a ContractValidationError when a contract cannot be used to validate uploads.
 */
export function assertPublishable(contract: ContractSnapshot): void {
    if (contract.columns.length === 0) {
        throw new ContractValidationError('A version needs at least one column');
    }
    for (const rule of contract.rules) {
        try {
            if (!(SUPPORTED_RULE_TYPES as readonly string[]).includes(rule.RuleType)) {
                throw new Error(`Unsupported rule type: ${rule.RuleType}`);
            }
            parseRuleExpression(rule.RuleType, rule.SqlQuery);
        } catch (error) {
            throw new ContractValidationError(`Rule "${rule.Name}" is invalid: ${(error as Error).message}`);
        }
    }
}
