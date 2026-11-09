// =============================================================================
// Definition Contract helpers - what a versioned definition validates, and how two versions differ.
//
// A DefinitionContract has one table for a single-table definition (`sheet` null; applies to a CSV and to every
// sheet of a workbook) or one table per workbook sheet (`layout: 'sheets'`), each with its own columns, and the
// rules that name the table they apply to.
// =============================================================================

import type { DefinitionContract } from '../../contracts/definition-contract';

/** Excel's limit on worksheet name length. */
export const MAX_SHEET_NAME_LENGTH = 31;
export const COLUMN_TYPES = ['string', 'integer', 'decimal', 'date', 'datetime', 'boolean'] as const;
export const DEFINITION_SCHEMA_RULE_TYPE = 'Definition Schema';

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

interface ComparableEntry {
    key: string;
    label: string;
    behaviour: string;
}

type ContractTable = DefinitionContract['tables'][number];

const sheetKey = (sheet: string): string => sheet.trim().toLowerCase();

/** Name of the validation check that enforces a table's columns (stable, so a check can be matched to its table). */
export const schemaCheckName = (sheet: string | null): string =>
    sheet === null ? 'File definition columns' : `Sheet "${sheet}" columns`;

/** JSON with sorted object keys, so equal values compare equal whatever order a client sent them in. */
function stable(value: unknown): string {
    const sorted = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(sorted);
        if (input && typeof input === 'object') {
            return Object.fromEntries(
                Object.entries(input as Record<string, unknown>)
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([key, item]) => [key, sorted(item)]),
            );
        }
        return input;
    };
    return JSON.stringify(sorted(value));
}

function diffEntries(previous: ComparableEntry[], next: ComparableEntry[]): ContractChanges {
    const previousByKey = new Map(previous.map(entry => [entry.key, entry]));
    const nextKeys = new Set(next.map(entry => entry.key));
    const changes: ContractChanges = { added: [], removed: [], changed: [] };

    for (const entry of next) {
        const before = previousByKey.get(entry.key);
        if (!before) changes.added.push(entry.label);
        else if (before.behaviour !== entry.behaviour) changes.changed.push(entry.label);
    }
    for (const entry of previous) {
        if (!nextKeys.has(entry.key)) changes.removed.push(entry.label);
    }
    return changes;
}

const hasAny = (changes: ContractChanges): boolean =>
    changes.added.length + changes.removed.length + changes.changed.length > 0;

const tableSettings = (table: ContractTable) => ({
    headerRow: table.headerRow,
    allowExtraColumns: table.allowExtraColumns,
    minRows: table.minRows,
    maxRows: table.maxRows,
});

// Everything about the file and its tables that changes how it is validated: file-level settings, each sheet table's
// settings and every column with all of its parsing options. Sheet table columns are labelled "Sheet › Column".
function structureEntries(contract: DefinitionContract): ComparableEntry[] {
    const entries: ComparableEntry[] = [{
        key: '\u0002file',
        label: 'File settings',
        behaviour: stable({
            layout: contract.layout,
            encoding: contract.encoding,
            ignoredSheets: contract.ignoredSheets.map(sheetKey).sort(),
            ...(contract.layout === 'single' ? tableSettings(contract.tables[0]) : {}),
        }),
    }];
    for (const table of contract.tables) {
        const sheet = table.sheet === null ? null : table.sheet.trim();
        const prefix = sheet === null ? '' : sheetKey(sheet);
        if (sheet !== null) {
            entries.push({ key: `${prefix}\u0001`, label: `Sheet "${sheet}"`, behaviour: stable(tableSettings(table)) });
        }
        for (const column of table.columns) {
            entries.push({
                key: `${prefix}\u0000${column.name}`,
                label: sheet === null ? column.name : `${sheet} › ${column.name}`,
                behaviour: stable(column),
            });
        }
    }
    return entries;
}

// Description is documentation only; everything else changes how a file is validated or reported. Disabled rules are
// not part of a published version, so they are ignored.
function ruleEntries(contract: DefinitionContract): ComparableEntry[] {
    return contract.rules.filter(rule => rule.enabled).map(rule => {
        const lookupId = rule.type === 'lookup' && typeof rule.params.lookupId === 'string' ? rule.params.lookupId : null;
        return {
            key: rule.id.toLowerCase(),
            label: rule.name,
            behaviour: stable({
                name: rule.name,
                type: rule.type,
                severity: rule.severity,
                executionOrder: rule.executionOrder,
                table: rule.table ? sheetKey(rule.table) : null,
                params: rule.params,
                lookup: lookupId ? contract.lookups[lookupId] ?? null : null,
            }),
        };
    });
}

const emptyContract = (): DefinitionContract => ({
    schemaVersion: 1,
    layout: 'single',
    ignoredSheets: [],
    encoding: 'auto',
    tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [] }],
    rules: [],
    lookups: {},
});

/**
 * Describe what publishing `draft` would change compared with the `active` contract (null when none is published).
 */
export function diffContracts(active: DefinitionContract | null, draft: DefinitionContract): ContractDiff {
    const previous = active ?? emptyContract();
    const columns = diffEntries(structureEntries(previous), structureEntries(draft));
    const rules = diffEntries(ruleEntries(previous), ruleEntries(draft));
    return { hasChanges: active === null || hasAny(columns) || hasAny(rules), columns, rules };
}
