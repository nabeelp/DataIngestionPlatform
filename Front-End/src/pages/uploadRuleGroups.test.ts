import { describe, expect, it } from 'vitest';
import { groupRulesBySheet } from './uploadRuleGroups';

const rule = (title: string, sheet: string | null) => ({ title, sheet });

describe('groupRulesBySheet', () => {
  it('renders each check once, grouped by its sheet in workbook order', () => {
    const sheets = [
      { name: 'Instructions', status: 'Validated' },
      { name: '  INVOICES ', status: 'Validated' },
      { name: 'payments', status: 'Failed' },
    ];
    const groups = groupRulesBySheet([
      rule('Sheet "Payments" columns', 'Payments'),
      rule('Sheet "Invoices" columns', 'Invoices'),
      rule('Status allowed values (Invoices)', 'Invoices'),
      rule('Sheet "Summary" columns', 'Summary'),
      rule('Method allowed values (Payments)', 'Payments'),
    ], sheets, 'Validation Failed');

    expect(groups.map(g => [g.label, g.status, g.rules.map(r => r.title)])).toEqual([
      ['Invoices', 'Validated', ['Sheet "Invoices" columns', 'Status allowed values (Invoices)']],
      ['Payments', 'Failed', ['Sheet "Payments" columns', 'Method allowed values (Payments)']],
      ['Summary', 'Validation Failed', ['Sheet "Summary" columns']],
    ]);
  });

  it('puts checks that apply to every sheet in a single group', () => {
    const sheets = [{ name: 'Jan', status: 'Validated' }, { name: 'Feb', status: 'Validated' }];
    const groups = groupRulesBySheet([rule('File definition columns', null), rule('Status check', null)], sheets, 'Validated');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'All sheets', status: 'Validated' });
    expect(groups[0].rules).toHaveLength(2);
  });

  it('labels a CSV or single-sheet upload by its sheet or as the file', () => {
    expect(groupRulesBySheet([rule('File definition columns', null)], [{ name: 'Data', status: 'Validated' }], 'Validated')[0].label).toBe('Data');
    expect(groupRulesBySheet([rule('File definition columns', null)], [], 'Validated')[0].label).toBe('File');
  });

  it('returns no groups when there are no checks', () => {
    expect(groupRulesBySheet([], [{ name: 'Data', status: 'Validated' }], 'Validated')).toEqual([]);
  });

  it('puts structural checks first without changing workbook or rule order', () => {
    const rules = [
      { ...rule('Second sheet rule', 'Second'), type: 'required' },
      { ...rule('First rule', 'First'), type: 'required' },
      { ...rule('First structure', 'FIRST'), type: 'structural' },
      { ...rule('Second rule', 'First'), type: 'range' },
      { ...rule('File rule', null), type: 'reconcile' },
      { ...rule('File structure', null), type: 'structural' },
    ];
    const groups = groupRulesBySheet(rules, [
      { name: 'First', status: 'Failed' },
      { name: 'Second', status: 'Validated' },
    ], 'Validation Failed');
    expect(groups.map(group => group.rules.map(check => check.title))).toEqual([
      ['File structure', 'File rule'],
      ['First structure', 'First rule', 'Second rule'],
      ['Second sheet rule'],
    ]);
    expect(rules.map(check => check.title)).toEqual([
      'Second sheet rule', 'First rule', 'First structure', 'Second rule', 'File rule', 'File structure',
    ]);
  });
});
