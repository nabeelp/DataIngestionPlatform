import type { DefinitionContract, RuleConfig } from '../contracts/definition-contract';
import { RULE_CONFIG_TYPES } from '../contracts/rule-config-types';

export const emptyDefinitionContract = (): DefinitionContract => ({
    schemaVersion: 1,
    layout: 'single',
    ignoredSheets: [],
    encoding: 'auto',
    tables: [{
        sheet: null,
        headerRow: null,
        allowExtraColumns: true,
        minRows: null,
        maxRows: null,
        columns: [],
    }],
    rules: [],
    lookups: {},
});

const ruleTypes = new Set<string>(RULE_CONFIG_TYPES);

type ContractColumn = DefinitionContract['tables'][number]['columns'][number];

const canonicalColumn = (column: ContractColumn): ContractColumn => ({
    name: column.name,
    type: column.type,
    mustExist: column.mustExist,
    nullable: column.nullable,
    ...(column.format !== undefined ? { format: column.format } : {}),
    ...(column.decimalSeparator !== undefined ? { decimalSeparator: column.decimalSeparator } : {}),
    ...(column.thousandsSeparator !== undefined ? { thousandsSeparator: column.thousandsSeparator } : {}),
    ...(column.precision !== undefined ? { precision: column.precision } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
    ...(column.maxLength !== undefined ? { maxLength: column.maxLength } : {}),
    ...(column.unique !== undefined ? { unique: column.unique } : {}),
});

export function parseRuleConfig(value: unknown): RuleConfig {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            throw new Error('Stored rule configuration is not valid JSON.');
        }
    }

    if (
        !parsed || typeof parsed !== 'object' ||
        !('id' in parsed) || typeof parsed.id !== 'string' ||
        !('name' in parsed) || typeof parsed.name !== 'string' ||
        !('description' in parsed) || typeof parsed.description !== 'string' ||
        !('severity' in parsed) || (parsed.severity !== 'Error' && parsed.severity !== 'Warning') ||
        !('executionOrder' in parsed) || typeof parsed.executionOrder !== 'number' ||
        !('enabled' in parsed) || typeof parsed.enabled !== 'boolean' ||
        !('table' in parsed) || !(typeof parsed.table === 'string' || parsed.table === null) ||
        !('type' in parsed) || typeof parsed.type !== 'string' ||
        !ruleTypes.has(parsed.type) ||
        !('params' in parsed) || !parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)
    ) {
        throw new Error('Stored rule configuration does not match the RuleConfig contract.');
    }

    return parsed as RuleConfig;
}

export function parseDefinitionContract(value: unknown): DefinitionContract {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            throw new Error('Stored definition contract is not valid JSON.');
        }
    }

    if (
        !parsed || typeof parsed !== 'object' ||
        !('schemaVersion' in parsed) || parsed.schemaVersion !== 1 ||
        !('layout' in parsed) || (parsed.layout !== 'single' && parsed.layout !== 'sheets') ||
        !('tables' in parsed) || !Array.isArray(parsed.tables) || parsed.tables.length === 0 ||
        !('rules' in parsed) || !Array.isArray(parsed.rules) ||
        !('lookups' in parsed) || !parsed.lookups || typeof parsed.lookups !== 'object'
    ) {
        throw new Error('Stored definition contract does not match schema version 1.');
    }

    const contract = parsed as DefinitionContract;
    return {
        ...contract,
        tables: contract.tables.map(table => ({
            ...table,
            columns: table.columns.map(canonicalColumn),
        })) as DefinitionContract['tables'],
        rules: contract.rules.map(parseRuleConfig),
    };
}
