import type { Column as ContractColumn, DefinitionContract, Table as ContractTable } from '../../../contracts/definition-contract';
import type { FileDefinitionAdmin } from '../../../services/adminApi';
import type { DefinitionLayout, ExampleProposal } from '../exampleProposal';

export const INITIAL_COLUMNS: ContractColumn[] = [
  { name: 'Column1', type: 'string', mustExist: true, nullable: false }
];
export const EMPTY_COLUMN: ContractColumn = {
  name: '',
  type: 'string',
  mustExist: false,
  nullable: true,
};

export const EMPTY_CONTRACT: DefinitionContract = {
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
    columns: [{ name: 'Column1', type: 'string', mustExist: true, nullable: false }],
  }],
  rules: [],
  lookups: {},
};

export const newTable = (sheet: string, columns: ContractColumn[]): ContractTable => ({
  sheet,
  headerRow: null,
  allowExtraColumns: true,
  minRows: null,
  maxRows: null,
  columns,
});

export interface DefinitionForm {
  name: string;
  description: string;
  layout: DefinitionLayout;
  /** Columns of the single table (layout "single"); its other settings live in `contract.tables[0]`. */
  columns: ContractColumn[];
  /** One table per workbook sheet (layout "sheets"). */
  tables: ContractTable[];
  status: string;
  deliveryFolder: string;
  contract: DefinitionContract;
}

export const EMPTY_FORM: DefinitionForm = {
  name: '',
  description: '',
  layout: 'single',
  columns: INITIAL_COLUMNS,
  tables: [],
  status: 'Active',
  deliveryFolder: '',
  contract: EMPTY_CONTRACT,
};

export const buildDefinitionContract = (form: Pick<DefinitionForm, 'layout' | 'columns' | 'tables' | 'contract'>): DefinitionContract => {
  const singleTable = form.contract.tables[0];
  const tables: ContractTable[] = form.layout === 'single'
    ? [{
        ...singleTable,
        sheet: null,
        headerRow: singleTable?.headerRow ?? null,
        allowExtraColumns: singleTable?.allowExtraColumns ?? true,
        minRows: singleTable?.minRows ?? null,
        maxRows: singleTable?.maxRows ?? null,
        columns: form.columns,
      }]
    : form.tables;

  return {
    ...form.contract,
    schemaVersion: 1,
    layout: form.layout,
    tables: [tables[0] ?? newTable('Sheet1', []), ...tables.slice(1)],
  };
};

/** Every table has at least one named column, and tables of a multi-table definition have sheet names. */
export const isStructureComplete = (form: Pick<DefinitionForm, 'layout' | 'columns' | 'tables'>): boolean => {
  const tables: Array<Pick<ContractTable, 'sheet' | 'columns'>> = form.layout === 'single'
    ? [{ sheet: null, columns: form.columns }]
    : form.tables;
  return tables.length > 0
    && tables.every(table => table.columns.length > 0 && table.columns.every(column => column.name.trim()))
    && (tables.length === 1 || tables.every(table => table.sheet?.trim()));
};

export const formFromDefinition = (def: FileDefinitionAdmin): DefinitionForm => {
  const { contract } = def;
  const layout: DefinitionLayout = contract.layout;
  const singleColumns = contract.tables[0]?.columns ?? [];
  return {
    name: def.name,
    description: def.description || '',
    layout,
    columns: layout === 'single' && singleColumns.length > 0 ? singleColumns : INITIAL_COLUMNS,
    tables: layout === 'sheets' ? contract.tables : [],
    status: def.status,
    deliveryFolder: def.deliveryFolder || '',
    contract: { ...contract, rules: [] },
  };
};

export const applyProposalToForm = (prev: DefinitionForm, proposal: ExampleProposal): DefinitionForm => ({
  ...prev,
  name: prev.name.trim() ? prev.name : proposal.suggestedName,
  layout: proposal.layout,
  columns: proposal.layout === 'single' ? proposal.columns : prev.columns,
  tables: proposal.layout === 'sheets' ? proposal.tables : prev.tables,
});

export const startFromCleanSlate = (prev: DefinitionForm): DefinitionForm => ({
  ...prev,
  layout: 'single',
  columns: INITIAL_COLUMNS.map(column => ({ ...column })),
  tables: [],
  contract: {
    ...prev.contract,
    layout: 'single',
    tables: [{
      ...EMPTY_CONTRACT.tables[0],
      columns: EMPTY_CONTRACT.tables[0].columns.map(column => ({ ...column })),
    }],
  },
});

/** The tables shown while editing the structure; a single-table definition appears as "Table 1". */
export const cleanSlateTablesOf = (form: DefinitionForm): ContractTable[] => form.layout === 'single'
  ? [{
      ...form.contract.tables[0],
      sheet: 'Table 1',
      columns: form.columns,
    }]
  : form.tables;

export const summaryTablesOf = (form: DefinitionForm): ContractTable[] => form.layout === 'single'
  ? [{
      sheet: 'Single table',
      headerRow: form.contract.tables[0]?.headerRow ?? null,
      allowExtraColumns: form.contract.tables[0]?.allowExtraColumns ?? true,
      minRows: form.contract.tables[0]?.minRows ?? null,
      maxRows: form.contract.tables[0]?.maxRows ?? null,
      columns: form.columns,
    }]
  : form.tables;

export const updateTableInForm = (prev: DefinitionForm, index: number, changes: Partial<ContractTable>): DefinitionForm => {
  if (prev.layout === 'single') {
    return {
      ...prev,
      columns: changes.columns ?? prev.columns,
      contract: {
        ...prev.contract,
        tables: [{
          ...prev.contract.tables[0],
          ...changes,
          sheet: null,
          columns: prev.contract.tables[0]?.columns ?? [],
        }],
      },
    };
  }
  return {
    ...prev,
    tables: prev.tables.map((table, current) => current === index ? { ...table, ...changes } : table),
  };
};

export const addTableToForm = (prev: DefinitionForm): DefinitionForm => {
  // The single table keeps its settings (header row, row limits, ...) when it becomes the first sheet table.
  const existing = prev.layout === 'single'
    ? [{ ...prev.contract.tables[0], sheet: 'Table 1', columns: prev.columns }]
    : prev.tables;
  return {
    ...prev,
    layout: 'sheets',
    tables: [...existing, newTable(`Table ${existing.length + 1}`, [{ ...EMPTY_COLUMN }])],
  };
};

export const removeTableFromForm = (prev: DefinitionForm, index: number): DefinitionForm => {
  const remaining = prev.tables.filter((_, current) => current !== index);
  if (remaining.length === 1) {
    return {
      ...prev,
      layout: 'single',
      columns: remaining[0].columns,
      tables: [],
      contract: { ...prev.contract, tables: [{ ...remaining[0], sheet: null }] },
    };
  }
  return { ...prev, tables: remaining };
};
