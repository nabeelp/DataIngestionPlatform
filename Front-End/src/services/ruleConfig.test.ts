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
  ruleType: 'range' as const,
  params: { column: 'Amount', min: -1.5, max: 100, minInclusive: true, maxInclusive: true },
  table: 'Orders',
};

describe('RuleConfig editor mapping', () => {
  it('maps typed fields to a RuleConfig and omits unset optional parameters', () => {
    expect(ruleConfigFromForm(form)).toEqual({
      id: 'rule-1',
      name: 'Amount range',
      description: 'Amount must be in range.',
      severity: 'Error',
      executionOrder: 2,
      enabled: true,
      table: 'Orders',
      type: 'range',
      params: { column: 'Amount', min: -1.5, max: 100, minInclusive: true, maxInclusive: true },
    });
    expect(ruleConfigFromForm({ ...form, params: { column: 'Amount', min: undefined } }).params)
      .toEqual({ column: 'Amount' });
  });

  it('updates a typed rule with its edited parameters', () => {
    const original = ruleConfigFromForm({ ...form, ruleType: 'pattern', params: { column: 'Email', pattern: '^.+@example\\.com$' } });
    expect(updateRuleConfigFromForm(original, {
      ...form,
      ruleType: 'pattern',
      name: 'Updated',
      params: { column: 'Email', pattern: '^.+@contoso\\.com$' },
    })).toMatchObject({
      id: 'rule-1',
      name: 'Updated',
      type: 'pattern',
      params: { column: 'Email', pattern: '^.+@contoso\\.com$' },
    });
  });

  it('retains Natural Language SQL, examples, and provenance when presentation fields change', () => {
    const params = {
      mode: 'row',
      request: 'Email must use the corporate domain.',
      failWhen: "NOT ENDS_WITH(Email, '@example.com')",
      examples: [{ table: 'Orders', values: { Email: 'a@example.com' }, expectedValid: true, source: 'model' }],
      provenance: { model: 'model-1', responseId: 'response-1' },
    };
    const original: RuleConfig = {
      ...ruleConfigFromForm(form),
      type: 'naturalLanguage',
      params,
    };
    expect(updateRuleConfigFromForm(original, {
      ...form,
      ruleType: 'naturalLanguage',
      name: 'Updated',
      params,
    })).toMatchObject({ name: 'Updated', type: 'naturalLanguage', params });
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

  it('labels advanced declarative types and formats their parameters safely', () => {
    const config: RuleConfig = {
      ...ruleConfigFromForm(form),
      type: 'conditionalRequired',
      params: {
        columns: ['TaxId'],
        when: { column: 'Country', op: 'eq', value: 'US' },
      },
    };
    expect(ruleConfigTypeLabel(config)).toBe('Conditional Required');
    expect(ruleConfigExpression(config)).toContain('"TaxId"');
  });
});
