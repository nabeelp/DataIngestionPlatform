// =============================================================================
// Definition Contract - the versioned part of a file definition
// A contract is the definition's tables (columns) plus its enabled rules: everything that decides
// whether an upload is valid. Operational settings (name, status, delivery folder) are not versioned.
//
// Layouts:
// - Single table: `columns` apply to a CSV file and to every sheet of a workbook; `tables` is empty.
// - Sheet tables: each entry of `tables` applies to the workbook sheet with that name (case-insensitive);
//   `columns` is empty, and every rule names the table it applies to.
// =============================================================================

import {
    NATURAL_LANGUAGE_RULE_TYPE,
    SUPPORTED_RULE_TYPES,
    parseRuleExpression,
    sameSheet,
    splitList,
    type DefinitionColumn,
    type ParsedRule,
} from './ValidationEngine';

export { sameSheet };

/** Excel's limit on worksheet name length. */
export const MAX_SHEET_NAME_LENGTH = 31;

export interface ContractTable {
    sheet: string;
    columns: DefinitionColumn[];
}

export interface ContractRule {
    Id: string;
    Name: string;
    Description: string;
    RuleType: string;
    Severity: string;
    ExecutionOrder: number;
    SqlQuery: string;
    /** Sheet table the rule applies to; null for single-table definitions. */
    Table: string | null;
    /** Natural-language rules only: the request the rule was created from. */
    NaturalLanguageText?: string;
    /** Natural-language rules only: model-generated pseudocode describing the code. */
    Pseudocode?: string;
    /** Natural-language rules only: the TypeScript the validation engine runs. */
    GeneratedCode?: string;
}

export interface ContractSnapshot {
    columns: DefinitionColumn[];
    tables: ContractTable[];
    rules: ContractRule[];
}

/** A table as validation sees it: `sheet` is null for the single table that applies to every sheet (or CSV). */
export interface ValidationTable {
    sheet: string | null;
    columns: DefinitionColumn[];
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
    /** Rules table column (live rules). */
    TableName?: string | null;
    /** Snapshot property (published versions). */
    Table?: string | null;
    NaturalLanguageText?: string | null;
    Pseudocode?: string | null;
    GeneratedCode?: string | null;
}

export class ContractValidationError extends Error {}

const ruleKey = (rule: Pick<ContractRule, 'Id'>): string => String(rule.Id).toLowerCase();

const isEnabled = (rule: SourceRule): boolean => rule.IsEnabled === undefined || rule.IsEnabled === null || Boolean(rule.IsEnabled);

const sheetKey = (sheet: string): string => sheet.trim().toLowerCase();

const normalizeColumns = (columns: unknown): DefinitionColumn[] =>
    (Array.isArray(columns) ? columns : [])
        .filter(column => column && typeof column.name === 'string' && column.name.trim())
        .map(column => ({ name: column.name.trim(), type: String(column.type || 'string'), required: Boolean(column.required) }));

const normalizeTables = (tables: unknown): ContractTable[] =>
    (Array.isArray(tables) ? tables : [])
        .filter(table => table && typeof table.sheet === 'string' && table.sheet.trim())
        .map(table => ({ sheet: table.sheet.trim(), columns: normalizeColumns(table.columns) }));

const tableOf = (rule: SourceRule): string | null => {
    const table = rule.TableName ?? rule.Table;
    return typeof table === 'string' && table.trim() ? table.trim() : null;
};

// Only natural-language rules carry generated content, so snapshots of declarative rules keep their shape.
const generatedContent = (rule: SourceRule): Pick<ContractRule, 'NaturalLanguageText' | 'Pseudocode' | 'GeneratedCode'> =>
    rule.RuleType === NATURAL_LANGUAGE_RULE_TYPE
        ? { NaturalLanguageText: rule.NaturalLanguageText || '', Pseudocode: rule.Pseudocode || '', GeneratedCode: rule.GeneratedCode || '' }
        : {};

/**
 * Build the contract for a definition from its columns, sheet tables and rules. Disabled rules are not part of
 * the contract. When sheet tables are present they replace the single-table columns.
 */
export function buildContractSnapshot(columns: unknown, rules: SourceRule[], tables?: unknown): ContractSnapshot {
    const contractTables = normalizeTables(tables);
    const contractColumns = contractTables.length > 0 ? [] : normalizeColumns(columns);

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
            Table: tableOf(rule),
            ...generatedContent(rule),
        }))
        .sort((a, b) => a.ExecutionOrder - b.ExecutionOrder || a.Id.localeCompare(b.Id));

    return { columns: contractColumns, tables: contractTables, rules: contractRules };
}

/**
 * The tables uploads are validated against: the sheet tables, or the single table (sheet null).
 */
export const validationTables = (contract: Pick<ContractSnapshot, 'columns' | 'tables'>): ValidationTable[] =>
    contract.tables.length > 0 ? contract.tables : [{ sheet: null, columns: contract.columns }];

export const hasSheetTables = (contract: Pick<ContractSnapshot, 'tables'>): boolean => contract.tables.length > 0;

/** Name of the validation check that enforces a table's columns (stable, so a check can be matched to its table). */
export const schemaCheckName = (sheet: string | null): string =>
    sheet === null ? 'File definition columns' : `Sheet "${sheet}" columns`;

/** Columns a parsed rule refers to. */
export const ruleColumns = (parsed: ParsedRule): string[] => ('columns' in parsed ? parsed.columns : [parsed.column]);

/**
 * Columns any contract rule refers to; throws for an invalid rule. A natural-language rule's expression lists the
 * columns its code reads, and the rule needs generated code.
 */
export function contractRuleColumns(rule: Pick<ContractRule, 'RuleType' | 'SqlQuery' | 'GeneratedCode'>): string[] {
    if (rule.RuleType === NATURAL_LANGUAGE_RULE_TYPE) {
        const columns = splitList(rule.SqlQuery || '');
        if (columns.length === 0) throw new Error('A natural-language rule must list the columns it reads');
        if (!rule.GeneratedCode?.trim()) throw new Error('A natural-language rule needs generated code');
        return columns;
    }
    if (!(SUPPORTED_RULE_TYPES as readonly string[]).includes(rule.RuleType)) {
        throw new Error(`Unsupported rule type: ${rule.RuleType}`);
    }
    return ruleColumns(parseRuleExpression(rule.RuleType, rule.SqlQuery));
}

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

interface ColumnEntry {
    key: string;
    label: string;
    behaviour: string;
}

// Columns (and sheet tables) as comparable entries; sheet table columns are labelled "Sheet › Column".
function columnEntries(contract: ContractSnapshot): ColumnEntry[] {
    const entries: ColumnEntry[] = contract.columns.map(column => ({
        key: `\u0000${column.name}`,
        label: column.name,
        behaviour: `${column.type.toLowerCase()}|${column.required}`,
    }));
    for (const table of contract.tables) {
        entries.push({ key: `${sheetKey(table.sheet)}\u0001`, label: `Sheet "${table.sheet}"`, behaviour: '' });
        for (const column of table.columns) {
            entries.push({
                key: `${sheetKey(table.sheet)}\u0000${column.name}`,
                label: `${table.sheet} › ${column.name}`,
                behaviour: `${column.type.toLowerCase()}|${column.required}`,
            });
        }
    }
    return entries;
}

// Description is documentation only; everything else changes how a file is validated or reported.
const ruleBehaviour = (rule: ContractRule): string =>
    JSON.stringify([
        rule.Name, rule.RuleType, rule.Severity, rule.ExecutionOrder, rule.SqlQuery, rule.Table ? sheetKey(rule.Table) : null,
        ...(rule.GeneratedCode === undefined ? [] : [rule.GeneratedCode]),
    ]);

/**
 * Describe what publishing `draft` would change compared with the `active` contract (null when none is published).
 */
export function diffContracts(active: ContractSnapshot | null, draft: ContractSnapshot): ContractDiff {
    const previous = active ?? { columns: [], tables: [], rules: [] };
    const columns = diffBy(columnEntries(previous), columnEntries(draft), entry => entry.key, entry => entry.label, entry => entry.behaviour);
    const rules = diffBy(previous.rules, draft.rules, ruleKey, rule => rule.Name, ruleBehaviour);
    return { hasChanges: active === null || hasAny(columns) || hasAny(rules), columns, rules };
}

/**
 * Throw a ContractValidationError when a contract cannot be used to validate uploads.
 */
export function assertPublishable(contract: ContractSnapshot): void {
    const sheetTables = hasSheetTables(contract);
    if (!sheetTables && contract.columns.length === 0) {
        throw new ContractValidationError('A version needs at least one column');
    }

    const seenSheets = new Set<string>();
    for (const table of contract.tables) {
        if (table.sheet.length > MAX_SHEET_NAME_LENGTH) {
            throw new ContractValidationError(`Sheet name "${table.sheet}" is longer than ${MAX_SHEET_NAME_LENGTH} characters`);
        }
        if (seenSheets.has(sheetKey(table.sheet))) {
            throw new ContractValidationError(`Sheet "${table.sheet}" is defined more than once`);
        }
        seenSheets.add(sheetKey(table.sheet));
        if (table.columns.length === 0) {
            throw new ContractValidationError(`Sheet "${table.sheet}" needs at least one column`);
        }
    }

    for (const rule of contract.rules) {
        let columns: string[];
        try {
            columns = contractRuleColumns(rule);
        } catch (error) {
            throw new ContractValidationError(`Rule "${rule.Name}" is invalid: ${(error as Error).message}`);
        }

        if (!sheetTables) {
            if (rule.Table) {
                throw new ContractValidationError(`Rule "${rule.Name}" is for sheet "${rule.Table}", but this definition has a single table`);
            }
            continue;
        }
        if (!rule.Table) {
            throw new ContractValidationError(`Rule "${rule.Name}" must name the sheet table it applies to`);
        }
        const table = contract.tables.find(t => sameSheet(t.sheet, rule.Table!));
        if (!table) {
            throw new ContractValidationError(`Rule "${rule.Name}" is for sheet "${rule.Table}", which is not defined`);
        }
        const names = new Set(table.columns.map(column => column.name));
        const missing = columns.find(column => !names.has(column));
        if (missing) {
            throw new ContractValidationError(`Rule "${rule.Name}" refers to column "${missing}", which is not in sheet "${table.sheet}"`);
        }
    }
}
