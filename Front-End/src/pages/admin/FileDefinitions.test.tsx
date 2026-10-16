import { describe, expect, it } from 'vitest';
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { FileDefinitionColumn } from '../../services/adminApi';
import { buildDefinitionContract, type DefinitionForm } from './FileDefinitions';

const createForm = (overrides: Partial<DefinitionForm> = {}): DefinitionForm => ({
  name: 'Transactions',
  description: '',
  layout: 'sheets',
  columns: [],
  tables: [{
    sheet: 'Data',
    headerRow: 3,
    allowExtraColumns: false,
    minRows: 2,
    maxRows: 100,
    columns: [{
      name: 'Amount',
      type: 'decimal',
      required: true,
      mustExist: true,
      nullable: false,
      format: ['0.00', '0,00'],
      decimalSeparator: ',',
      thousandsSeparator: '.',
      precision: 12,
      scale: 2,
      maxLength: 18,
      unique: true,
    }],
  }],
  status: 'Active',
  deliveryFolder: '',
  contract: {
    schemaVersion: 1,
    layout: 'sheets',
    ignoredSheets: ['Readme'],
    encoding: 'windows-1252',
    tables: [{
      sheet: 'Data',
      headerRow: null,
      allowExtraColumns: true,
      minRows: null,
      maxRows: null,
      columns: [],
    }],
    rules: [],
    lookups: {},
  },
  ...overrides,
});

describe('definition contract editor mapping', () => {
  it('keeps table, column, encoding, and ignored-sheet settings in the saved contract', () => {
    const contract: DefinitionContract = buildDefinitionContract(createForm());

    expect(contract).toMatchObject({
      layout: 'sheets',
      ignoredSheets: ['Readme'],
      encoding: 'windows-1252',
      tables: [{
        sheet: 'Data',
        headerRow: 3,
        allowExtraColumns: false,
        minRows: 2,
        maxRows: 100,
        columns: [{
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
        }],
      }],
    });
    expect(contract.tables[0].columns[0]).not.toHaveProperty('required');
  });

  it('maps the legacy required flag to the corresponding contract fields', () => {
    const legacyColumn: FileDefinitionColumn = { name: 'Customer', type: 'string', required: true };
    const contract = buildDefinitionContract(createForm({
      layout: 'single',
      columns: [legacyColumn],
      tables: [],
    }));

    expect(contract.tables[0].columns).toEqual([{
      name: 'Customer',
      type: 'string',
      mustExist: true,
      nullable: false,
    }]);
    expect(contract.tables[0].sheet).toBeNull();
  });

  it('derives nullable as the inverse of required', () => {
    const contract = buildDefinitionContract(createForm({
      layout: 'single',
      columns: [{ name: 'Comment', type: 'string', required: false, mustExist: true, nullable: false }],
      tables: [],
    }));

    expect(contract.tables[0].columns).toEqual([{
      name: 'Comment',
      type: 'string',
      mustExist: false,
      nullable: true,
    }]);
  });

  it('preserves explicitly cleared nullable table bounds', () => {
    const form = createForm({
      tables: [{
        sheet: 'Data',
        headerRow: null,
        minRows: null,
        maxRows: null,
        columns: [],
      }],
      contract: {
        ...createForm().contract,
        tables: [{
          sheet: 'Data',
          headerRow: 4,
          allowExtraColumns: true,
          minRows: 1,
          maxRows: 40,
          columns: [],
        }],
      },
    });

    expect(buildDefinitionContract(form).tables[0]).toMatchObject({
      headerRow: null,
      minRows: null,
      maxRows: null,
    });
  });
});
