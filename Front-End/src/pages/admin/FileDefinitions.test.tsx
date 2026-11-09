import { describe, expect, it } from 'vitest';
import type { Column, DefinitionContract, Table } from '../../contracts/definition-contract';
import { buildDefinitionContract, type DefinitionForm } from './FileDefinitions';

const amount: Column = {
  name: 'Amount',
  type: 'decimal',
  mustExist: true,
  nullable: false,
  format: ['0.00', '0,00'],
  decimalSeparator: ',',
  thousandsSeparator: '.',
  precision: 12,
  scale: 2,
  maxLength: 18,
  unique: true,
};

const table = (overrides: Partial<Table> = {}): Table => ({
  sheet: 'Data',
  headerRow: 3,
  allowExtraColumns: false,
  minRows: 2,
  maxRows: 100,
  columns: [amount],
  ...overrides,
});

const createForm = (overrides: Partial<DefinitionForm> = {}): DefinitionForm => ({
  name: 'Transactions',
  description: '',
  layout: 'sheets',
  columns: [],
  tables: [table()],
  status: 'Active',
  deliveryFolder: '',
  contract: {
    schemaVersion: 1,
    layout: 'sheets',
    ignoredSheets: ['Readme'],
    encoding: 'windows-1252',
    tables: [table({ headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [] })],
    rules: [],
    lookups: {},
  },
  ...overrides,
});

describe('definition contract editor mapping', () => {
  it('keeps sheet table, column, encoding, and ignored-sheet settings in the saved contract', () => {
    const contract: DefinitionContract = buildDefinitionContract(createForm());

    expect(contract).toMatchObject({
      layout: 'sheets',
      ignoredSheets: ['Readme'],
      encoding: 'windows-1252',
      tables: [table()],
    });
    expect(contract.tables[0].columns[0]).not.toHaveProperty('required');
  });

  it('builds every sheet table from the editor tables', () => {
    const contract = buildDefinitionContract(createForm({
      tables: [
        table({ sheet: 'Orders', headerRow: null }),
        table({ sheet: 'Refunds', minRows: null, maxRows: null, columns: [{ name: 'Reason', type: 'string', mustExist: true, nullable: true }] }),
      ],
    }));

    expect(contract.tables.map(item => item.sheet)).toEqual(['Orders', 'Refunds']);
    expect(contract.tables[1]).toMatchObject({ headerRow: 3, minRows: null, maxRows: null });
  });

  it('takes the single table columns from the editor and its settings from the contract', () => {
    const customer: Column = { name: 'Customer', type: 'string', mustExist: true, nullable: false };
    const contract = buildDefinitionContract(createForm({
      layout: 'single',
      columns: [customer],
      tables: [],
      contract: { ...createForm().contract, layout: 'single', tables: [table({ sheet: null, headerRow: 2, columns: [amount] })] },
    }));

    expect(contract.layout).toBe('single');
    expect(contract.tables).toEqual([table({ sheet: null, headerRow: 2, columns: [customer] })]);
  });

  it('keeps must-exist and nullable independent instead of deriving one from the other', () => {
    const columns: Column[] = [
      { name: 'Required', type: 'string', mustExist: true, nullable: false },
      { name: 'Optional', type: 'string', mustExist: false, nullable: true },
      { name: 'PresentButEmpty', type: 'string', mustExist: true, nullable: true },
      { name: 'OptionalNoBlanks', type: 'string', mustExist: false, nullable: false },
    ];
    const contract = buildDefinitionContract(createForm({ layout: 'single', columns, tables: [] }));

    expect(contract.tables[0].columns).toEqual(columns);
    expect(contract.tables[0].sheet).toBeNull();
  });

  it('preserves explicitly cleared nullable table bounds', () => {
    const form = createForm({
      tables: [table({ headerRow: null, minRows: null, maxRows: null, columns: [] })],
      contract: { ...createForm().contract, tables: [table({ headerRow: 4, minRows: 1, maxRows: 40, columns: [] })] },
    });

    expect(buildDefinitionContract(form).tables[0]).toMatchObject({
      headerRow: null,
      minRows: null,
      maxRows: null,
    });
  });
});
