import { describe, expect, it } from 'vitest';
import type { Column } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import type { ExampleAnalysis, ExampleSheet } from '../../services/adminApi';
import {
  defaultSheetIndex,
  hintKey,
  proposalFromSheet,
  proposalFromSheets,
  proposesSheetTables,
  rulesForLayout,
  suggestedDefinitionName,
  suggestionKey,
} from './exampleProposal';

const suggestion = (table: string | null) => ({
  rule: {
    id: `status-${table}`,
    name: 'Status allowed values',
    description: '',
    severity: 'Error' as const,
    executionOrder: 1,
    enabled: true,
    table,
    type: 'enum' as const,
    params: { column: 'Status', values: ['Closed', 'Open'] },
  } as RuleConfig,
  reason: 'repeats',
});

const orders: ExampleSheet = {
  name: 'Orders',
  headerRow: 1,
  rowsAnalyzed: 4,
  truncated: false,
  columns: [
    { name: 'Id', type: 'integer', mustExist: true, nullable: false, filledRows: 4, sampleValues: ['1', '2'] },
    { name: 'Status', type: 'string', mustExist: true, nullable: true, filledRows: 3, sampleValues: ['Open'] },
  ],
  suggestedRules: [suggestion('Orders')],
  warnings: [],
};

const refunds: ExampleSheet = {
  ...orders,
  name: 'Refunds',
  rowsAnalyzed: 1,
  columns: [{ name: 'Reason', type: 'string', mustExist: true, nullable: false, filledRows: 1, sampleValues: ['Damaged'] }],
  suggestedRules: [],
};

const analysis: ExampleAnalysis = {
  fileName: 'customer_orders-2024.xlsx',
  fileType: 'xlsx',
  warnings: [],
  sheets: [
    { name: 'Cover', headerRow: null, rowsAnalyzed: 0, truncated: false, columns: [], suggestedRules: [], warnings: [] },
    orders,
    refunds,
  ],
};

const statusKey = suggestionKey('Orders', 'Status allowed values');

const tableDefaults = { headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null };

describe('example proposals', () => {
  it('derives a readable definition name from the file name', () => {
    expect(suggestedDefinitionName('customer_orders-2024.xlsx')).toBe('customer orders 2024');
    expect(suggestedDefinitionName('orders.csv')).toBe('orders');
  });

  it('defaults to the first sheet with columns and proposes sheet tables for multi-sheet workbooks', () => {
    expect(defaultSheetIndex(analysis)).toBe(1);
    expect(proposesSheetTables(analysis)).toBe(true);
    expect(proposesSheetTables({ ...analysis, sheets: [analysis.sheets[0], orders] })).toBe(false);
    expect(proposesSheetTables({ ...analysis, fileType: 'csv', sheets: [{ ...orders, name: null }] })).toBe(false);
  });

  it('builds contract columns with hints and only the selected rules from one sheet', () => {
    const proposal = proposalFromSheet(analysis, 1, new Set([statusKey]));

    expect(proposal).toMatchObject({ source: 'customer_orders-2024.xlsx › Orders', layout: 'single', tables: [] });
    expect(proposal.columns).toEqual([
      { name: 'Id', type: 'integer', mustExist: true, nullable: false },
      { name: 'Status', type: 'string', mustExist: true, nullable: true },
    ]);
    expect(proposal.hints[hintKey(null, 'Status')]).toEqual({ filledRows: 3, rowsAnalyzed: 4, sampleValues: ['Open'] });
    // A single table has no sheet, so the suggested rule is no longer scoped to the sheet it came from.
    expect(proposal.rules).toEqual([{ ...suggestion(null).rule, id: 'status-Orders', table: null }]);
    expect(proposalFromSheet(analysis, 1, new Set()).rules).toEqual([]);
  });

  it('uses the file name alone for CSV examples', () => {
    const csv: ExampleAnalysis = {
      ...analysis,
      fileName: 'orders.csv',
      fileType: 'csv',
      sheets: [{ ...orders, name: null, suggestedRules: [suggestion(null)] }],
    };
    expect(proposalFromSheet(csv, 0, new Set([suggestionKey(null, 'Status allowed values')])).source).toBe('orders.csv');
    expect(proposalFromSheet(csv, 0, new Set([suggestionKey(null, 'Status allowed values')])).rules).toHaveLength(1);
  });

  it('builds one contract table per chosen sheet, with rules scoped to their sheet', () => {
    const proposal = proposalFromSheets(analysis, [1, 2], new Set([statusKey]));

    expect(proposal).toMatchObject({ source: 'customer_orders-2024.xlsx (2 sheets)', layout: 'sheets', columns: [] });
    expect(proposal.tables).toEqual([
      {
        ...tableDefaults,
        sheet: 'Orders',
        columns: [
          { name: 'Id', type: 'integer', mustExist: true, nullable: false },
          { name: 'Status', type: 'string', mustExist: true, nullable: true },
        ],
      },
      { ...tableDefaults, sheet: 'Refunds', columns: [{ name: 'Reason', type: 'string', mustExist: true, nullable: false }] },
    ]);
    expect(proposal.rules).toEqual([expect.objectContaining({ name: 'Status allowed values', table: 'Orders', type: 'enum' })]);
    expect(proposal.hints[hintKey('Refunds', 'Reason')]).toMatchObject({ filledRows: 1 });

    // An excluded sheet contributes neither a table nor its rules.
    const onlyRefunds = proposalFromSheets(analysis, [2], new Set([statusKey]));
    expect(onlyRefunds.tables.map(t => t.sheet)).toEqual(['Refunds']);
    expect(onlyRefunds.rules).toEqual([]);
  });

  it('skips rules whose table or column no longer fits the definition', () => {
    const single = proposalFromSheet(analysis, 1, new Set([statusKey])).rules;
    const scoped = proposalFromSheets(analysis, [1, 2], new Set([statusKey])).rules;
    const status: Column[] = [{ name: 'Status', type: 'string', mustExist: true, nullable: false }];
    const state: Column[] = [{ name: 'State', type: 'string', mustExist: true, nullable: false }];
    const table = (sheet: string, columns: Column[]) => ({ ...tableDefaults, sheet, columns });

    expect(rulesForLayout(single, { layout: 'single', columns: status, tables: [] })).toEqual({ kept: single, skipped: [] });
    expect(rulesForLayout(single, { layout: 'single', columns: state, tables: [] }).skipped).toEqual(single);
    expect(rulesForLayout(scoped, { layout: 'sheets', columns: [], tables: [table('orders', status)] }).kept).toEqual(scoped);
    expect(rulesForLayout(scoped, { layout: 'sheets', columns: [], tables: [table('Refunds', status)] }).skipped).toEqual(scoped);
    // Switching layout after applying rules leaves them unusable.
    expect(rulesForLayout(scoped, { layout: 'single', columns: status, tables: [] }).skipped).toEqual(scoped);
  });
});
