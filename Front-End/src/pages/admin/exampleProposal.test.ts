import { describe, expect, it } from 'vitest';
import type { ExampleAnalysis } from '../../services/adminApi';
import { defaultSheetIndex, proposalFromSheet, rulesForColumns, suggestedDefinitionName } from './exampleProposal';

const analysis: ExampleAnalysis = {
  fileName: 'customer_orders-2024.xlsx',
  fileType: 'xlsx',
  warnings: [],
  sheets: [
    { name: 'Cover', headerRow: null, rowsAnalyzed: 0, truncated: false, columns: [], suggestedRules: [], warnings: [] },
    {
      name: 'Orders',
      headerRow: 1,
      rowsAnalyzed: 4,
      truncated: false,
      columns: [
        { name: 'Id', type: 'integer', required: true, filledRows: 4, sampleValues: ['1', '2'] },
        { name: 'Status', type: 'string', required: false, filledRows: 3, sampleValues: ['Open'] },
      ],
      suggestedRules: [
        { name: 'Status allowed values', ruleType: 'Enum Check', expression: 'Status: Closed, Open', severity: 'Error', reason: 'repeats' },
      ],
      warnings: [],
    },
  ],
};

describe('example proposals', () => {
  it('derives a readable definition name from the file name', () => {
    expect(suggestedDefinitionName('customer_orders-2024.xlsx')).toBe('customer orders 2024');
    expect(suggestedDefinitionName('orders.csv')).toBe('orders');
  });

  it('defaults to the first sheet with columns', () => {
    expect(defaultSheetIndex(analysis)).toBe(1);
  });

  it('builds columns, hints and only the selected rules from a sheet', () => {
    const proposal = proposalFromSheet(analysis, 1, new Set(['Status allowed values']));

    expect(proposal.source).toBe('customer_orders-2024.xlsx › Orders');
    expect(proposal.columns).toEqual([
      { name: 'Id', type: 'integer', required: true },
      { name: 'Status', type: 'string', required: false },
    ]);
    expect(proposal.hints.Status).toEqual({ filledRows: 3, rowsAnalyzed: 4, sampleValues: ['Open'] });
    expect(proposal.rules).toEqual([{ name: 'Status allowed values', ruleType: 'Enum Check', expression: 'Status: Closed, Open', severity: 'Error' }]);
    expect(proposalFromSheet(analysis, 1, new Set()).rules).toEqual([]);
  });

  it('uses the file name alone for CSV examples', () => {
    const csv: ExampleAnalysis = { ...analysis, fileName: 'orders.csv', fileType: 'csv', sheets: [{ ...analysis.sheets[1], name: null }] };
    expect(proposalFromSheet(csv, 0, new Set()).source).toBe('orders.csv');
  });

  it('skips rules whose column was removed or renamed', () => {
    const rules = proposalFromSheet(analysis, 1, new Set(['Status allowed values'])).rules;

    expect(rulesForColumns(rules, [{ name: 'Status', type: 'string', required: true }])).toEqual({ kept: rules, skipped: [] });
    expect(rulesForColumns(rules, [{ name: 'State', type: 'string', required: true }])).toEqual({ kept: [], skipped: rules });
  });
});
