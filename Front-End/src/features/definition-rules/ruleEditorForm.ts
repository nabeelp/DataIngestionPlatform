import type { RuleConfig } from '../../contracts/rule-config';
import { defaultRuleParams } from '../../services/ruleConfig';
import { RULE_TYPE_OPTIONS } from './ruleText';

export interface FormState {
  name: string;
  description: string;
  severity: 'Error' | 'Warning';
  ruleType: RuleConfig['type'];
  tableName: string;
  params: Record<string, unknown>;
}

/** Drops column references that are not among the given columns (e.g. after the rule's table changed). */
export const scopeParamsToColumns = (
  type: RuleConfig['type'],
  params: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> => {
  const available = new Set(columns.map(column => column.trim().toLowerCase()));
  const keep = (column: unknown): string =>
    typeof column === 'string' && available.has(column.trim().toLowerCase()) ? column : '';
  const keepMany = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((column): column is string => typeof column === 'string' && available.has(column.trim().toLowerCase())) : [];

  if (type === 'unique') return { ...params, columns: keepMany(params.columns) };
  if (type === 'conditionalRequired') {
    const when = params.when && typeof params.when === 'object' && !Array.isArray(params.when)
      ? params.when as Record<string, unknown>
      : {};
    return { ...params, columns: keepMany(params.columns), when: { ...when, column: keep(when.column) } };
  }
  if (type === 'compare') return { ...params, left: keep(params.left), right: keep(params.right) };
  if (type === 'rowCount' || type === 'reconcile' || type === 'naturalLanguage') return params;
  return { ...params, column: keep(params.column) };
};

export const initialForm = (rule: RuleConfig | null): FormState => rule
  ? {
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      ruleType: rule.type,
      tableName: rule.table ?? '',
      params: rule.params as Record<string, unknown>,
    }
  : {
      name: '',
      description: '',
      severity: 'Error',
      ruleType: RULE_TYPE_OPTIONS[0].value,
      tableName: '',
      params: defaultRuleParams(RULE_TYPE_OPTIONS[0].value),
    };
