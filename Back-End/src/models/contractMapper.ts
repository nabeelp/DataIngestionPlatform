import type { DefinitionContract, RuleConfig } from '../contracts/definition-contract';
import type { IColumn, ITable } from '../interfaces/fileDefinition.interface';
import type { ContractRule, ContractSnapshot } from '../services/validation/DefinitionContract';

type DefinitionColumn = ContractSnapshot['columns'][number];

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

const ruleTypes = new Set<RuleConfig['type']>([
    'columnsPresent', 'required', 'type', 'enum', 'range', 'pattern', 'length', 'unique',
    'lookup', 'dateRange', 'conditionalRequired', 'compare', 'rowCount', 'aggregate',
    'reconcile', 'naturalLanguage',
]);

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
        !ruleTypes.has(parsed.type as RuleConfig['type']) ||
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
    return { ...contract, rules: contract.rules.map(parseRuleConfig) };
}

const contractColumn = (column: IColumn) => ({
    name: column.name,
    type: column.type,
    mustExist: true,
    nullable: !column.required,
});

const contractTable = (table: ITable) => ({
    sheet: table.sheet,
    headerRow: null,
    allowExtraColumns: true,
    minRows: null,
    maxRows: null,
    columns: table.columns.map(contractColumn),
});

export function contractFromLegacyColumns(
    columns: IColumn[],
    tables?: ITable[],
    base: DefinitionContract = emptyDefinitionContract(),
): DefinitionContract {
    if (tables?.length) {
        const [first, ...remaining] = tables;
        return {
            ...base,
            layout: 'sheets',
            tables: [contractTable(first), ...remaining.map(contractTable)],
        };
    }

    return {
        ...base,
        layout: 'single',
        tables: [{
            sheet: null,
            headerRow: base.tables[0]?.headerRow ?? null,
            allowExtraColumns: base.tables[0]?.allowExtraColumns ?? true,
            minRows: base.tables[0]?.minRows ?? null,
            maxRows: base.tables[0]?.maxRows ?? null,
            columns: columns.map(contractColumn),
        }],
    };
}

const legacyColumn = (column: DefinitionContract['tables'][number]['columns'][number]): DefinitionColumn => ({
    name: column.name,
    type: column.type,
    required: column.mustExist && !column.nullable,
});

export function legacyColumnsFromContract(contract: DefinitionContract): IColumn[] {
    if (contract.layout !== 'single') return [];
    return contract.tables[0].columns.map(column => ({
        name: column.name,
        type: column.type === 'date' ? 'datetime' : column.type,
        required: column.mustExist && !column.nullable,
    }));
}

export function legacyTablesFromContract(contract: DefinitionContract): ITable[] {
    if (contract.layout !== 'sheets') return [];
    return contract.tables.map(table => {
        if (table.sheet === null) {
            throw new Error('A sheet-layout contract contains a table without a sheet name.');
        }
        return {
            sheet: table.sheet,
            columns: table.columns.map(column => ({
                name: column.name,
                type: column.type === 'date' ? 'datetime' : column.type,
                required: column.mustExist && !column.nullable,
            })),
        };
    });
}

const paramsOf = (rule: RuleConfig): Record<string, unknown> => rule.params;

const stringParam = (params: Record<string, unknown>, key: string): string =>
    typeof params[key] === 'string' ? params[key] as string : '';

const stringArrayParam = (params: Record<string, unknown>, key: string): string[] => {
    const value = params[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const legacyRuleType = (rule: RuleConfig): string => {
    switch (rule.type) {
        case 'columnsPresent': return 'Schema Validation';
        case 'required': return 'Required Values';
        case 'type': return 'Type Check';
        case 'enum': return 'Enum Check';
        case 'range': return 'Range Check';
        case 'naturalLanguage': return 'Natural Language';
        default: return rule.type;
    }
};

const legacyRuleExpression = (rule: RuleConfig): string => {
    const params = paramsOf(rule);
    switch (rule.type) {
        case 'columnsPresent':
        case 'required':
            return stringArrayParam(params, 'columns').join(', ');
        case 'type':
            return `${stringParam(params, 'column')}: ${stringParam(params, 'dataType')}`;
        case 'enum':
            return `${stringParam(params, 'column')}: ${stringArrayParam(params, 'values').join(', ')}`;
        case 'range': {
            const minimum = typeof params.min === 'number' ? String(params.min) : '';
            const maximum = typeof params.max === 'number' ? String(params.max) : '';
            return `${stringParam(params, 'column')}: ${minimum}..${maximum}`;
        }
        case 'naturalLanguage':
            return stringParam(params, 'request');
        default:
            return '';
    }
};

export function legacySnapshotFromContract(contract: DefinitionContract): ContractSnapshot {
    const singleTable = contract.layout === 'single' ? contract.tables[0] : undefined;
    const columns = singleTable?.columns.map(legacyColumn) ?? [];
    const tables = contract.layout === 'sheets'
        ? contract.tables.map(table => {
            if (table.sheet === null) {
                throw new Error('A sheet-layout contract contains a table without a sheet name.');
            }
            return { sheet: table.sheet, columns: table.columns.map(legacyColumn) };
        })
        : [];
    const rules: ContractRule[] = contract.rules.map(rule => ({
        Id: rule.id,
        Name: rule.name,
        Description: rule.description,
        RuleType: legacyRuleType(rule),
        Severity: rule.severity,
        ExecutionOrder: rule.executionOrder,
        SqlQuery: legacyRuleExpression(rule),
        Table: rule.table,
    }));

    return { columns, tables, rules };
}
