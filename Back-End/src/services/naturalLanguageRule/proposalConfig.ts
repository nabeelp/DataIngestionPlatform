import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { appConfig } from '../../config/appConfig';
import { MAX_EXAMPLES } from './constants';
import type { ModelProposal, Proposal, ProposalExample } from './types';
import { isObject } from './util';

interface ContractTableInfo {
    name: string;
    columns: string[];
}

function declaredTables(contract: DefinitionContract): ContractTableInfo[] {
    return contract.tables.map(table => ({
        name: table.sheet ?? '',
        columns: table.columns.map(column => column.name),
    }));
}

function tableFor(contract: DefinitionContract, name: string | null): ContractTableInfo | undefined {
    const tables = declaredTables(contract);
    if (contract.layout === 'single') return name === null || name === '' ? tables[0] : undefined;
    return tables.find(table => table.name === name);
}

function canonicalProposalTable(contract: DefinitionContract, name: string | null): string | null {
    if (contract.layout === 'single' && (name === null || name === '' || name === 't_0')) return null;
    const declared = contract.tables.find(table => table.sheet === name);
    if (declared) return declared.sheet;
    const alias = name?.match(/^t_(\d+)$/);
    if (alias) return contract.tables[Number(alias[1])]?.sheet ?? name;
    return name;
}

interface ConfigOutcome {
    config?: RuleConfig;
    examples?: unknown[];
    /** Precise feedback for the model: names the example, sheet and column and lists what is declared. */
    problem?: string;
    /** What to show the user when it differs from `problem` (model-supplied names are not echoed to users). */
    detail?: string;
    /** `examples` problems can be fixed by regenerating only the examples; `rule` problems need a new proposal. */
    scope?: 'rule' | 'examples';
}

/** Names come from the model, so they are quoted, trimmed and stripped of control characters before they are echoed back. */
const quoted = (value: string): string => JSON.stringify(
    [...value].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').slice(0, 80),
);
const sheetLabel = (name: string): string => name === '' ? 'the single table' : `sheet ${quoted(name)}`;

export function configFor(
    proposal: Proposal,
    request: string,
    contract: DefinitionContract,
    provenance: ModelProposal,
    identity: { id: string; executionOrder: number; enabled: boolean },
): ConfigOutcome {
    if (!proposal.name.trim() || proposal.name.length > 200 || !proposal.reason.trim() || proposal.reason.length > 1000) {
        return { problem: 'The proposal has an empty or too long name, or an invalid explanation.' };
    }

    const params: Record<string, unknown> = { ...proposal.params };
    // Query and reconcile rules read several sheets, so they never target one; this is deterministic, not a model choice.
    const table = (proposal.type === 'naturalLanguage' && params.mode === 'query') || proposal.type === 'reconcile'
        ? null
        : canonicalProposalTable(contract, proposal.table);
    if (proposal.type === 'naturalLanguage' && isObject(params.columns)) {
        const canonicalColumns: Record<string, unknown> = {};
        for (const [name, columns] of Object.entries(params.columns)) {
            const canonicalName = canonicalProposalTable(contract, name) ?? '';
            if (Object.prototype.hasOwnProperty.call(canonicalColumns, canonicalName)) {
                return {
                    problem: `Natural Language params declare ${sheetLabel(canonicalName)} more than once in tableColumns; merge them into one entry.`,
                    detail: 'Natural Language params declare the same table more than once.',
                };
            }
            // __row is the engine's internal row id, not a schema column; models sometimes list it, so it is dropped.
            canonicalColumns[canonicalName] = Array.isArray(columns)
                ? columns.filter(column => typeof column !== 'string' || column.trim().toLowerCase() !== '__row')
                : columns;
        }
        params.columns = canonicalColumns;
    }
    const config = {
        id: identity.id,
        name: proposal.name.trim(),
        description: request,
        severity: proposal.severity,
        executionOrder: identity.executionOrder,
        enabled: identity.enabled,
        table,
        type: proposal.type,
        params,
    } as unknown as RuleConfig;

    if (proposal.decision === 'mapped') {
        // A built-in rule has no examples; any the model added are ignored rather than treated as an error.
        if (proposal.type === 'naturalLanguage') {
            return { problem: 'A declarative rule must use a built-in type; use decision natural_language for naturalLanguage.' };
        }
        return { config };
    }
    if (proposal.decision !== 'natural_language' || proposal.type !== 'naturalLanguage') {
        return { problem: 'A rule that needs SQL must use the naturalLanguage RuleConfig type.' };
    }

    const mode = params.mode;
    if (mode !== 'row' && mode !== 'query') return { problem: 'Natural Language params must specify row or query mode.' };
    const target = tableFor(contract, table);
    if (mode === 'row' && !target) {
        return {
            problem: `The row rule targets ${table === null ? 'no sheet' : sheetLabel(table)}, which is not in the schema; target one declared sheet.`,
            detail: 'The row rule must target a declared table.',
        };
    }

    const columns = params.columns;
    if (!isObject(columns)) return { problem: 'Natural Language params must declare their columns by table.' };
    const available = new Map(declaredTables(contract).map(table => [table.name, new Set(table.columns)]));
    const schemaSummary = declaredTables(contract)
        .map(entry => `${sheetLabel(entry.name)} has columns [${entry.columns.map(quoted).join(', ')}]`).join('; ');
    for (const [tableName, names] of Object.entries(columns)) {
        const declared = available.get(tableName);
        if (!declared) {
            return {
                problem: `tableColumns names ${sheetLabel(tableName)}, which is not in the schema. Schema: ${schemaSummary}.`,
                detail: 'Natural Language params include an undeclared table or column.',
            };
        }
        if (!Array.isArray(names)) {
            return {
                problem: `tableColumns for ${sheetLabel(tableName)} must be an array of column names.`,
                detail: 'Natural Language params must declare their columns by table.',
            };
        }
        const unknown = names.filter(name => typeof name !== 'string' || !declared.has(name));
        if (unknown.length > 0) {
            return {
                problem: `tableColumns lists ${unknown.map(name => quoted(String(name))).join(', ')} for ${sheetLabel(tableName)}, `
                    + `which does not exist. Schema: ${schemaSummary}.`,
                detail: 'Natural Language params include an undeclared table or column.',
            };
        }
    }
    const targetColumns = target ? columns[target.name] : undefined;
    if (mode === 'row' && (!target || !Array.isArray(targetColumns) || targetColumns.length === 0)) {
        return { problem: `A row rule must declare at least one column of its target ${sheetLabel(target?.name ?? '')} in tableColumns.` };
    }
    if (typeof params.message !== 'string' || !params.message.trim()
        || typeof params.explanation !== 'string' || !params.explanation.trim()) {
        return { problem: 'Natural Language params must include an explanation and failure message.' };
    }
    if (mode === 'row' && (typeof params.failWhen !== 'string' || !params.failWhen.trim() || params.query !== null)) {
        return { problem: 'A row rule must provide failWhen SQL and a null query.' };
    }
    if (mode === 'query' && (typeof params.query !== 'string' || !params.query.trim() || params.failWhen !== null)) {
        return { problem: 'A query rule must provide query SQL and a null failWhen.' };
    }

    const passing = proposal.examples.filter(example => example.expectedValid).length;
    const failing = proposal.examples.length - passing;
    if (proposal.examples.length < 2 || proposal.examples.length > MAX_EXAMPLES || passing < 1 || failing < 1) {
        return {
            problem: `Natural Language rules require 2 to ${MAX_EXAMPLES} examples including passing and failing cases. `
                + `Provide at least one passingExamples and one failingExamples entry (got ${passing} passing and ${failing} failing).`,
            detail: `Natural Language rules require 2 to ${MAX_EXAMPLES} examples including passing and failing cases.`,
            scope: 'examples',
        };
    }

    const examples: Array<Record<string, unknown>> = [];
    const exampleRow = (
        where: string,
        tableName: string | null,
        items: ProposalExample['values'],
    ): ConfigOutcome | { table: string; values: Record<string, string> } => {
        const exampleTable = tableFor(contract, canonicalProposalTable(contract, tableName || null));
        if (!exampleTable) {
            return {
                problem: `${where} uses ${sheetLabel(tableName ?? '')}, which is not in the schema. Schema: ${schemaSummary}.`,
                detail: 'An example names a table that is not declared in the schema.',
                scope: 'examples',
            };
        }
        const schemaColumns = available.get(exampleTable.name);
        for (const item of items) {
            if (!schemaColumns?.has(item.column)) {
                return {
                    problem: `${where} uses column ${quoted(item.column)}, which does not exist in ${sheetLabel(exampleTable.name)}. Schema: ${schemaSummary}.`,
                    detail: 'An example contains a column that is not declared for the rule.',
                    scope: 'examples',
                };
            }
        }
        const used = Array.isArray(columns[exampleTable.name]) ? columns[exampleTable.name] as string[] : null;
        const missing = items.map(item => item.column).filter(column => !used?.includes(column));
        if (missing.length > 0) {
            if (mode === 'row') {
                return {
                    problem: `${where} uses ${missing.map(quoted).join(', ')} of ${sheetLabel(exampleTable.name)}, which the rule does not declare in tableColumns `
                        + `(declared: [${(used ?? []).map(quoted).join(', ')}]). A row rule's example may only use its declared columns.`,
                    detail: 'An example contains a column that is not declared for the rule.',
                    scope: 'examples',
                };
            }
            // A query only reads what it selects, so declaring more schema columns for the examples does not change the rule.
            columns[exampleTable.name] = [...(used ?? []), ...missing.filter((column, index) => missing.indexOf(column) === index)];
        }
        const values: Record<string, string> = {};
        for (const item of items) values[item.column] = item.value ?? '';
        return { table: exampleTable.name, values };
    };
    for (const example of proposal.examples) {
        const primary = exampleRow(example.label, example.table, example.values);
        if (!('values' in primary)) return primary;
        if (mode === 'row' && target?.name !== primary.table) {
            return {
                problem: `${example.label} uses ${sheetLabel(primary.table)} but the row rule targets ${sheetLabel(target?.name ?? '')}; row examples must use the target sheet.`,
                detail: 'A row-rule example must use the rule target table.',
                scope: 'examples',
            };
        }
        const relatedRows: Array<{ table: string; values: Record<string, string> }> = [];
        // A row rule reads one table, so related rows cannot affect it; they are dropped instead of failing the proposal.
        for (const [relatedIndex, related] of (mode === 'row' ? [] : example.relatedRows).entries()) {
            const row = exampleRow(`${example.label}.relatedRows[${relatedIndex}]`, related.table, related.values);
            if (!('values' in row)) return row;
            relatedRows.push(row);
        }
        examples.push({
            ...primary,
            expectedValid: example.expectedValid,
            source: 'model',
            ...(relatedRows.length > 0 ? { relatedRows } : {}),
        });
    }
    params.request = request;
    params.examples = examples;
    params.provenance = {
        model: appConfig.azure.foundry.model,
        responseId: provenance.responseId,
        promptSha256: provenance.promptSha256,
        createdAt: new Date().toISOString(),
    };
    return { config, examples };
}
