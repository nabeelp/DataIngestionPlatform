import type { DefinitionContract } from '../src/contracts/definition-contract';
import { emptyDefinitionContract } from '../src/models/contractMapper';
import { COLUMN_TYPES, MAX_SHEET_NAME_LENGTH, diffContracts, schemaCheckName } from '../src/services/validation/DefinitionContract';
import { validateContractLayout } from '../src/services/validation/ContractLayout';

type Column = DefinitionContract['tables'][number]['columns'][number];
type Rule = DefinitionContract['rules'][number];

const column = (name: string, type: Column['type'] = 'string', nullable = false): Column => ({ name, type, mustExist: true, nullable });

const columns = [column('CustomerId'), column('Amount', 'decimal', true)];

const rule = (overrides: Partial<Rule> = {}): Rule => ({
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    name: 'Amount range',
    description: 'Keeps amounts sane',
    severity: 'Error',
    executionOrder: 1,
    enabled: true,
    table: null,
    type: 'range',
    params: { column: 'Amount', min: 0, max: 100 },
    ...overrides,
} as Rule);

const single = (tableColumns: Column[], rules: Rule[] = [], extra: Partial<DefinitionContract> = {}): DefinitionContract => {
    const contract = emptyDefinitionContract();
    contract.tables[0].columns = tableColumns;
    return { ...contract, rules, ...extra };
};

const sheets = (tables: Array<{ sheet: string; columns: Column[] }>, rules: Rule[] = []): DefinitionContract => ({
    ...emptyDefinitionContract(),
    layout: 'sheets',
    tables: tables.map(table => ({
        sheet: table.sheet,
        headerRow: null,
        allowExtraColumns: true,
        minRows: null,
        maxRows: null,
        columns: table.columns,
    })) as DefinitionContract['tables'],
    rules,
});

describe('contract diffs', () => {
    it('treats a description-only edit as unchanged', () => {
        const active = single(columns, [rule()]);
        const draft = single(columns, [rule({ description: 'Reworded description' })]);

        expect(diffContracts(active, draft).hasChanges).toBe(false);
    });

    it('ignores disabled rules, which are not part of a published version', () => {
        const active = single(columns, [rule()]);
        const draft = single(columns, [rule(), rule({ id: 'r-off', name: 'Disabled', enabled: false })]);

        expect(diffContracts(active, draft).hasChanges).toBe(false);
    });

    it('reports added, removed and changed columns and rules', () => {
        const status = rule({ id: 'r-status', name: 'Status values', type: 'enum', params: { column: 'Status', values: ['A', 'B'] } });
        const active = single(columns, [rule(), status]);
        const draft = single(
            [column('CustomerId'), column('Amount', 'integer'), column('Email')],
            [
                rule({ params: { column: 'Amount', min: 0, max: 500 } }),
                rule({ id: 'r-new', name: 'Email values', type: 'enum', params: { column: 'Email', values: ['a', 'b'] } }),
            ],
        );

        expect(diffContracts(active, draft)).toEqual({
            hasChanges: true,
            columns: { added: ['Email'], removed: [], changed: ['Amount'] },
            rules: { added: ['Email values'], removed: ['Status values'], changed: ['Amount range'] },
        });
    });

    it('sees column parsing options and nullability, not just name and type', () => {
        const active = single([column('Amount', 'decimal')]);
        const nullable = single([column('Amount', 'decimal', true)]);
        const separators = single([{ ...column('Amount', 'decimal'), decimalSeparator: ',', thousandsSeparator: '.' }]);

        expect(diffContracts(active, nullable).columns.changed).toEqual(['Amount']);
        expect(diffContracts(active, separators).columns.changed).toEqual(['Amount']);
    });

    it('sees file settings and table limits that change how a file is validated', () => {
        const active = single(columns);
        const draft = single(columns, [], { encoding: 'utf-8', ignoredSheets: ['Notes'] });
        const limited = single(columns);
        limited.tables[0].maxRows = 1000;

        expect(diffContracts(active, draft).columns.changed).toEqual(['File settings']);
        expect(diffContracts(active, limited).columns.changed).toEqual(['File settings']);
    });

    it('sees changes to the values of a lookup a rule uses', () => {
        const lookupRule = rule({ id: 'r-lookup', name: 'Country', type: 'lookup', params: { column: 'Country', lookupId: 'l1' } });
        const active = single(columns, [lookupRule], { lookups: { l1: { name: 'Countries', values: ['FR'] } } });
        const draft = single(columns, [lookupRule], { lookups: { l1: { name: 'Countries', values: ['FR', 'DE'] } } });

        expect(diffContracts(active, draft).rules.changed).toEqual(['Country']);
    });

    it('is not affected by property order in rule parameters', () => {
        const active = single(columns, [rule({ params: { column: 'Amount', min: 0, max: 100 } })]);
        const draft = single(columns, [rule({ params: { max: 100, min: 0, column: 'Amount' } })]);

        expect(diffContracts(active, draft).hasChanges).toBe(false);
    });

    it('reports everything as added when nothing has been published yet', () => {
        const diff = diffContracts(null, single(columns, [rule()]));

        expect(diff.hasChanges).toBe(true);
        expect(diff.columns.added).toEqual(['CustomerId', 'Amount']);
        expect(diff.rules.added).toEqual(['Amount range']);
    });
});

describe('sheet-table contracts', () => {
    const tables = [
        { sheet: 'Orders', columns },
        { sheet: 'Refunds', columns: [column('Reason')] },
    ];

    it('treats sheet-name casing as equivalent in version diffs', () => {
        const active = sheets(tables, [rule({ table: 'Orders' })]);
        const draft = sheets([
            { sheet: 'Orders', columns: [columns[0], column('Amount', 'integer', true)] },
            { sheet: 'Credits', columns: [column('Code')] },
        ], [rule({ table: 'orders' })]);

        const diff = diffContracts(active, draft);

        expect(diff.columns).toEqual({
            added: ['Sheet "Credits"', 'Credits › Code'],
            removed: ['Sheet "Refunds"', 'Refunds › Reason'],
            changed: ['Orders › Amount'],
        });
        expect(diff.rules.changed).toEqual([]);
    });

    it('reports switching between single-table and sheet-table layouts', () => {
        const diff = diffContracts(single(columns), sheets(tables));

        expect(diff.columns.removed).toEqual(['CustomerId', 'Amount']);
        expect(diff.columns.added).toContain('Sheet "Orders"');
        expect(diff.columns.changed).toEqual(['File settings']);
    });

    it('preserves stable schema check labels and current column limits', () => {
        expect(schemaCheckName(null)).toBe('File definition columns');
        expect(schemaCheckName('Orders')).toBe('Sheet "Orders" columns');
        expect(COLUMN_TYPES).toEqual(['string', 'integer', 'decimal', 'date', 'datetime', 'boolean']);
        expect(MAX_SHEET_NAME_LENGTH).toBe(31);
    });
});

describe('contract layout validation', () => {
    it('accepts a single table with unique supported columns', () => {
        expect(() => validateContractLayout(single(columns))).not.toThrow();
    });

    it('requires columns, unique names and supported types', () => {
        expect(() => validateContractLayout(single([]))).toThrow('At least one column is required');
        expect(() => validateContractLayout(single([column('A'), column('A')]))).toThrow('Duplicate column name "A"');
        expect(() => validateContractLayout(single([column(' ')]))).toThrow('Every column needs a name');
        expect(() => validateContractLayout(single([{ ...column('A'), type: 'money' as Column['type'] }]))).toThrow('unsupported type "money"');
    });

    it('requires exactly one table for a single-table layout', () => {
        const contract = single(columns);
        contract.tables = [contract.tables[0], contract.tables[0]];
        expect(() => validateContractLayout(contract)).toThrow('exactly one table');
    });

    it('validates sheet names and each sheet table', () => {
        expect(() => validateContractLayout(sheets([{ sheet: 'Orders', columns }, { sheet: 'orders', columns }]))).toThrow('defined more than once');
        expect(() => validateContractLayout(sheets([{ sheet: 'A'.repeat(MAX_SHEET_NAME_LENGTH + 1), columns }]))).toThrow('longer than');
        expect(() => validateContractLayout(sheets([{ sheet: 'Bad/Name', columns }]))).toThrow('cannot contain');
        expect(() => validateContractLayout(sheets([{ sheet: 'Orders', columns: [] }]))).toThrow('At least one column is required in sheet "Orders"');
        expect(() => validateContractLayout(sheets([{ sheet: 'Orders', columns }, { sheet: 'Refunds', columns }]))).not.toThrow();
    });
});
