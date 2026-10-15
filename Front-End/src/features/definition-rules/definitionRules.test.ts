import { describe, expect, it } from 'vitest';
import type { RuleConfig } from '../../contracts/rule-config';
import {
  initialRuleDraft,
  isRuleDraftDirty,
  MAX_RULES,
  removedRules,
  ruleChangeSummary,
  ruleDraftReducer,
  ruleStatus,
} from './ruleDraft';
import { ruleColumnReferences, ruleProblems, structureOf } from './ruleReferences';
import { describeRule, RULE_TYPE_OPTIONS } from './ruleText';
import { ruleConfigFromSuggestion } from './ruleSuggestions';
import { mapPreflightErrors, ruleHealth } from './preflight';

const rule = (id: string, overrides: Partial<RuleConfig> = {}): RuleConfig => ({
  id,
  name: `Rule ${id}`,
  description: '',
  severity: 'Error',
  executionOrder: Number(id),
  enabled: true,
  table: null,
  type: 'range',
  params: { column: 'Amount', min: 0, max: 100 },
  ...overrides,
} as RuleConfig);

describe('rule type options', () => {
  it('lists rule types alphabetically by their visible label', () => {
    const labels = RULE_TYPE_OPTIONS.map(option => option.label);
    expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
  });
});

describe('rule draft reducer', () => {
  const saved = initialRuleDraft([rule('1'), rule('3')]);

  it('starts clean and sorted by execution order', () => {
    expect(initialRuleDraft([rule('3'), rule('1')]).rules.map(item => item.id)).toEqual(['1', '3']);
    expect(isRuleDraftDirty(saved)).toBe(false);
  });

  it('appends new rules after the last one and marks them new', () => {
    const next = ruleDraftReducer(saved, { type: 'upsert', rule: rule('9', { executionOrder: 1 }) });
    expect(next.rules.map(item => item.id)).toEqual(['1', '3', '9']);
    expect(next.rules[2].executionOrder).toBe(4);
    expect(ruleStatus(next, '9')).toBe('new');
    expect(ruleStatus(next, '1')).toBe('unchanged');
  });

  it('marks edited rules as changed and unmarks them when edited back', () => {
    const edited = ruleDraftReducer(saved, { type: 'upsert', rule: rule('1', { severity: 'Warning' }) });
    expect(ruleStatus(edited, '1')).toBe('changed');
    const reverted = ruleDraftReducer(edited, { type: 'upsert', rule: rule('1') });
    expect(isRuleDraftDirty(reverted)).toBe(false);
  });

  it('tracks removed rules', () => {
    const next = ruleDraftReducer(saved, { type: 'remove', id: '1' });
    expect(removedRules(next).map(item => item.id)).toEqual(['1']);
    expect(ruleChangeSummary(next)).toEqual({ added: 0, changed: 0, removed: 1 });
    expect(isRuleDraftDirty(next)).toBe(true);
  });

  it('moves a rule by swapping execution orders with its neighbour only', () => {
    const three = initialRuleDraft([rule('1'), rule('2'), rule('3')]);
    const next = ruleDraftReducer(three, { type: 'move', id: '3', direction: -1 });
    expect(next.rules.map(item => item.id)).toEqual(['1', '3', '2']);
    expect(ruleStatus(next, '1')).toBe('unchanged');
    expect(ruleChangeSummary(next).changed).toBe(2);
    expect(ruleDraftReducer(three, { type: 'move', id: '1', direction: -1 })).toBe(three);
  });

  it('duplicates a rule with a new id at the end', () => {
    const next = ruleDraftReducer(saved, { type: 'duplicate', id: '1', newId: 'copy' });
    const copy = next.rules.find(item => item.id === 'copy')!;
    expect(copy.name).toBe('Rule 1 (copy)');
    expect(copy.executionOrder).toBe(4);
    expect(ruleStatus(next, 'copy')).toBe('new');
  });

  it('enables and disables a rule', () => {
    const next = ruleDraftReducer(saved, { type: 'setEnabled', id: '1', enabled: false });
    expect(next.rules[0].enabled).toBe(false);
    expect(ruleStatus(next, '1')).toBe('changed');
  });

  it('never exceeds the rule limit', () => {
    const full = initialRuleDraft(Array.from({ length: MAX_RULES }, (_, index) => rule(String(index + 1))));
    expect(ruleDraftReducer(full, { type: 'upsert', rule: rule('999') })).toBe(full);
    expect(ruleDraftReducer(full, { type: 'duplicate', id: '1', newId: 'x' })).toBe(full);
    expect(ruleDraftReducer(full, { type: 'append', rules: [rule('999')] }).rules).toHaveLength(MAX_RULES);
  });

  it('ignores key order when comparing a rule with its saved form', () => {
    const reordered = { ...rule('1'), params: { max: 100, min: 0, column: 'Amount' } } as RuleConfig;
    expect(ruleStatus(ruleDraftReducer(saved, { type: 'upsert', rule: reordered }), '1')).toBe('unchanged');
  });
});

describe('rule references', () => {
  const single = structureOf({
    layout: 'single',
    tables: [{ sheet: null, columns: [{ name: 'Amount' }, { name: 'Status' }] }],
  });
  const sheets = structureOf({
    layout: 'sheets',
    tables: [
      { sheet: 'Orders', columns: [{ name: 'Amount' }] },
      { sheet: 'Refunds', columns: [{ name: 'Total' }] },
    ],
  });

  it('finds no problems when the structure still fits', () => {
    expect(ruleProblems(rule('1'), single)).toEqual([]);
    expect(ruleProblems(rule('1', { table: 'orders' }), sheets)).toEqual([]);
  });

  it('flags a removed or renamed column once, ignoring case and spacing', () => {
    expect(ruleProblems(rule('1', { type: 'unique', params: { columns: ['amount ', 'Gone', 'Gone'] } } as Partial<RuleConfig>), single))
      .toEqual(['Column "Gone" is no longer defined.']);
  });

  it('flags a sheet that was removed and a sheet-less rule in a sheet layout', () => {
    expect(ruleProblems(rule('1', { table: 'Archive' }), sheets)).toEqual(['Sheet "Archive" is no longer defined.']);
    expect(ruleProblems(rule('1', { table: null }), sheets)[0]).toMatch(/Choose the sheet/);
  });

  it('checks both tables of a reconcile rule', () => {
    const reconcile = rule('1', {
      type: 'reconcile',
      params: {
        left: { table: 'Orders', column: 'Amount', fn: 'sum' },
        right: { table: 'Refunds', column: 'Missing', fn: 'sum' },
      },
    } as Partial<RuleConfig>);
    expect(ruleProblems(reconcile, sheets)).toEqual(['Column "Missing" in sheet "Refunds" is no longer defined.']);
  });

  it('reads columns of every rule shape', () => {
    const refs = (overrides: Partial<RuleConfig>) => ruleColumnReferences(rule('1', overrides)).map(item => item.column);
    expect(refs({ type: 'compare', params: { left: 'A', right: 'B', op: 'lt', as: 'number' } } as Partial<RuleConfig>)).toEqual(['A', 'B']);
    expect(refs({ type: 'conditionalRequired', params: { columns: ['A'], when: { column: 'B', op: 'empty' } } } as Partial<RuleConfig>)).toEqual(['A', 'B']);
    expect(refs({ type: 'rowCount', params: { min: 1 } } as Partial<RuleConfig>)).toEqual([]);
    expect(ruleColumnReferences(rule('1', { type: 'naturalLanguage', params: { columns: { Orders: ['Amount'] } } } as Partial<RuleConfig>)))
      .toEqual([{ table: 'Orders', column: 'Amount' }]);
  });

  it('does not treat a natural-language rule without a sheet as a problem in a sheet layout', () => {
    expect(ruleProblems(rule('1', { type: 'naturalLanguage', params: { columns: { Orders: ['Amount'] } } } as Partial<RuleConfig>), sheets)).toEqual([]);
  });

  describe('cross-sheet query rules', () => {
    const query = (columns: Record<string, string[]>, sql: string) => rule('1', {
      type: 'naturalLanguage',
      table: null,
      params: { mode: 'query', query: sql, columns },
    } as Partial<RuleConfig>);
    const join = 'SELECT 1 FROM t_0 AS o JOIN t_1 AS r ON o.Amount = r.Total';

    it('accepts a query whose aliases still point at the sheets it declares', () => {
      expect(ruleProblems(query({ Orders: ['Amount'], Refunds: ['Total'] }, join), sheets)).toEqual([]);
    });

    it('flags an alias that now points at a sheet the rule did not declare (sheets reordered)', () => {
      const reordered = structureOf({
        layout: 'sheets',
        tables: [
          { sheet: 'Refunds', columns: [{ name: 'Total' }] },
          { sheet: 'Orders', columns: [{ name: 'Amount' }] },
          { sheet: 'Notes', columns: [{ name: 'Text' }] },
        ],
      });
      const problems = ruleProblems(query({ Orders: ['Amount'], Notes: ['Text'] }, join), reordered);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/t_0.*now sheet "Refunds".*regenerate/);
    });

    it('flags an alias beyond the remaining sheets (sheet removed)', () => {
      const problems = ruleProblems(query({ Orders: ['Amount'], Refunds: ['Total'] }, 'SELECT 1 FROM t_0 JOIN t_2 ON 1 = 1'), sheets);
      expect(problems).toEqual(['The query uses table t_2, which no longer exists. Regenerate the rule.']);
    });

    it('reports every sheet of a query rule that was removed', () => {
      const onlyOrders = structureOf({ layout: 'sheets', tables: [{ sheet: 'Orders', columns: [{ name: 'Amount' }] }] });
      const problems = ruleProblems(query({ Orders: ['Amount'], Refunds: ['Total'] }, 'SELECT 1 FROM t_0'), onlyOrders);
      expect(problems).toEqual(['Sheet "Refunds" is no longer defined.']);
    });
  });
});

describe('describeRule', () => {
  const text = (overrides: Partial<RuleConfig>) => describeRule(rule('1', overrides));

  it('reads like a sentence', () => {
    expect(text({})).toBe('Amount must be between 0 and 100');
    expect(text({ params: { column: 'Amount', min: 5 } })).toBe('Amount must be at least 5');
    expect(text({ type: 'enum', params: { column: 'Status', values: ['A', 'B'] } } as Partial<RuleConfig>)).toBe('Status must be one of: A, B');
    expect(text({ type: 'unique', params: { columns: ['A', 'B'] } } as Partial<RuleConfig>)).toBe('A, B must not repeat across rows');
    expect(text({ type: 'compare', params: { left: 'Start', op: 'le', right: 'End', as: 'date' } } as Partial<RuleConfig>)).toBe('Start must be at most End');
    expect(text({ type: 'naturalLanguage', params: { request: 'No refunds on Sundays' } } as Partial<RuleConfig>)).toBe('No refunds on Sundays');
  });
});

describe('ruleConfigFromSuggestion', () => {
  const id = () => 'new-id';
  const base = { name: 'Suggested', severity: 'Error' as const };

  it('converts the suggestion kinds an example file produces', () => {
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Enum Check', expression: 'Status: A, B' }, 1, id))
      .toMatchObject({ type: 'enum', params: { column: 'Status', values: ['A', 'B'] }, table: null });
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Range Check', expression: 'Amount: 0..100', table: 'Orders' }, 2, id))
      .toMatchObject({ type: 'range', params: { column: 'Amount', min: 0, max: 100 }, table: 'Orders', executionOrder: 2 });
  });

  it('rejects suggestions it cannot represent', () => {
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Mystery', expression: 'A: b' }, 1, id)).toBeNull();
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Required Values', expression: 'Id: required' }, 1, id)).toBeNull();
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Range Check', expression: 'A: soon' }, 1, id)).toBeNull();
    expect(ruleConfigFromSuggestion({ ...base, ruleType: 'Enum Check', expression: 'no separator' }, 1, id)).toBeNull();
  });
});

describe('rule health', () => {
  const structure = structureOf({ layout: 'single', tables: [{ sheet: null, columns: [{ name: 'Amount' }] }] });

  it('maps the rules service findings onto the enabled rules that were sent, by position', () => {
    const rules = [rule('1', { enabled: false }), rule('2'), rule('3')];
    const mapped = mapPreflightErrors([
      { path: '$.rules[0].params.column', message: 'Unknown column "X".' },
      { path: '$.rules[1].params.min', message: 'min must be a number.' },
      { path: '$.tables[0]', message: 'Table has no columns.' },
    ], rules.filter(item => item.enabled));
    expect(mapped.byRule).toEqual({ '2': ['Unknown column "X".'], '3': ['min must be a number.'] });
    expect(mapped.general).toEqual(['$.tables[0]: Table has no columns.']);
  });

  it('counts only enabled rules that need attention as blocking', () => {
    const broken = (id: string, enabled: boolean) => rule(id, {
      enabled,
      type: 'unique',
      params: { columns: ['Gone'] },
    } as Partial<RuleConfig>);
    const health = ruleHealth([rule('1'), broken('2', true), broken('3', false)], structure, null);
    expect(health.blocking).toBe(1);
    expect(Object.keys(health.problemsByRule).sort()).toEqual(['2', '3']);
  });

  it('attributes friendly nested configuration errors without repeating them or affecting other rules', () => {
    const rules = [rule('1', { enabled: false }), rule('2'), rule('3'), rule('4')];
    const health = ruleHealth(rules, structure, {
      ok: false,
      errors: [
        { path: '$.rules[0].params', message: 'Enter a minimum or maximum row count.' },
        { path: '$.rules[1].params.when.values', message: 'Specify the values.' },
        { path: '$.rules[1].params.when.values', message: 'Specify the values.' },
      ],
      diff: null,
    });
    expect(health.problemsByRule).toEqual({
      '2': ['Enter a minimum or maximum row count.'],
      '3': ['Specify the values.'],
    });
    expect(health.general).toEqual([]);
    expect(health.blocking).toBe(2);
  });

  it('merges instant structure checks with the rules service findings without repeating a message', () => {
    const rules = [rule('1', { type: 'unique', params: { columns: ['Gone'] } } as Partial<RuleConfig>)];
    const health = ruleHealth(rules, structure, {
      ok: false,
      errors: [
        { path: '$.rules[0].params.columns', message: 'Column "Gone" is no longer defined.' },
        { path: '$.rules[0].params.columns', message: 'Another finding.' },
      ],
      diff: null,
    });
    expect(health.problemsByRule['1']).toEqual(['Column "Gone" is no longer defined.', 'Another finding.']);
    expect(health.blocking).toBe(1);
  });
});
