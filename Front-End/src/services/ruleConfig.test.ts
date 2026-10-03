import { describe, expect, it } from 'vitest';
import type { RuleConfig } from '../contracts/rule-config';
import {
  ruleConfigColumns,
  ruleConfigExpression,
  ruleConfigFromForm,
  ruleConfigTypeLabel,
  updateRuleConfigFromForm,
} from './ruleConfig';

const form = {
  id: 'rule-1',
  name: 'Amount range',
  description: 'Amount must be in range.',
  executionOrder: 2,
  severity: 'Error' as const,
  enabled: true,
  ruleType: 'Range Check',
  expression: 'Amount: -1.5..100',
  table: 'Orders',
};

describe('RuleConfig editor mapping', () => {
  it('maps a range editor expression to a typed RuleConfig', () => {
    expect(ruleConfigFromForm(form)).toEqual({
      id: 'rule-1',
      name: 'Amount range',
      description: 'Amount must be in range.',
      severity: 'Error',
      executionOrder: 2,
      enabled: true,
      table: 'Orders',
      type: 'range',
      params: { column: 'Amount', min: -1.5, max: 100 },
    });
  });

  it('requires at least one range boundary', () => {
    expect(() => ruleConfigFromForm({ ...form, expression: 'Amount: ..' }))
      .toThrow('with at least one bound');
  });

  it('preserves advanced RuleConfig logic when editing presentation fields', () => {
    const original: RuleConfig = {
      ...ruleConfigFromForm(form),
      type: 'pattern',
      params: { column: 'Email', pattern: '.*@example\\.com' },
    };

    expect(updateRuleConfigFromForm(original, { ...form, name: 'Updated' })).toMatchObject({
      id: 'rule-1',
      name: 'Updated',
      type: 'pattern',
      params: { column: 'Email', pattern: '.*@example\\.com' },
    });
  });

  it('formats RuleConfig types and declared columns for display', () => {
    const config: RuleConfig = {
      ...ruleConfigFromForm(form),
      type: 'naturalLanguage',
      table: null,
      params: {
        mode: 'query',
        query: "SELECT message FROM t_0 WHERE NOT ENDS_WITH(Email, '@example.com')",
        columns: { Orders: ['Email', 'Status'] },
      },
    };

    expect(ruleConfigTypeLabel(config)).toBe('Natural Language');
    expect(ruleConfigExpression(config)).toContain('ENDS_WITH');
    expect(ruleConfigColumns(config)).toBe('Orders: Email, Status');
  });
});
