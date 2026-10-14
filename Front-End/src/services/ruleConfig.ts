import type { RuleConfig } from '../contracts/rule-config';

export interface RuleConfigForm {
  id: string;
  name: string;
  description: string;
  executionOrder: number;
  severity: 'Error' | 'Warning';
  enabled: boolean;
  ruleType: RuleConfig['type'];
  params: Record<string, unknown>;
  table: string | null;
}

const common = (form: RuleConfigForm) => ({
  id: form.id,
  name: form.name.trim(),
  description: form.description,
  severity: form.severity,
  executionOrder: form.executionOrder,
  enabled: form.enabled,
  table: form.table,
});

const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]),
  );
};

export function defaultRuleParams(type: RuleConfig['type']): Record<string, unknown> {
  switch (type) {
    case 'unique':
      return { columns: [''] };
    case 'enum':
      return { column: '', values: [''], caseSensitive: true, trim: true };
    case 'range':
      return { column: '', min: undefined, max: undefined, minInclusive: true, maxInclusive: true };
    case 'pattern':
      return { column: '', pattern: '', caseSensitive: true };
    case 'length':
      return { column: '', min: undefined, max: undefined };
    case 'lookup':
      return { column: '', lookupId: '', caseSensitive: true };
    case 'dateRange':
      return { column: '', min: undefined, max: undefined };
    case 'conditionalRequired':
      return { columns: [''], when: { column: '', op: 'eq', value: '' } };
    case 'compare':
      return { left: '', op: 'eq', right: '', as: 'string' };
    case 'rowCount':
      return { min: undefined, max: undefined };
    case 'aggregate':
      return { column: '', fn: 'sum', min: undefined, max: undefined };
    case 'reconcile':
      return {
        left: { table: '', column: '', fn: 'sum' },
        right: { table: '', column: '', fn: 'sum' },
        tolerance: 0,
      };
    case 'naturalLanguage':
      return {};
  }
}

export function ruleConfigFromForm(form: RuleConfigForm): RuleConfig {
  if (form.ruleType === 'naturalLanguage') {
    throw new Error('Natural Language rules must be created through the review workflow.');
  }
  return {
    ...common(form),
    type: form.ruleType,
    params: withoutUndefined(form.params) as Record<string, unknown>,
  } as RuleConfig;
}

export function updateRuleConfigFromForm(config: RuleConfig, form: RuleConfigForm): RuleConfig {
  if (config.type !== form.ruleType) return ruleConfigFromForm({ ...form, id: config.id });
  if (config.type === 'naturalLanguage') {
    return {
      ...config,
      ...common({ ...form, id: config.id }),
      params: withoutUndefined(form.params) as RuleConfig['params'],
    };
  }
  return {
    ...ruleConfigFromForm({ ...form, id: config.id }),
  };
}

export function ruleConfigTypeLabel(config: RuleConfig): string {
  const labels: Partial<Record<RuleConfig['type'], string>> = {
    enum: 'Enum Check',
    range: 'Range Check',
    naturalLanguage: 'Natural Language',
  };
  return labels[config.type] ?? config.type.replace(/[A-Z]/g, letter => ` ${letter}`).replace(/^./, letter => letter.toUpperCase());
}

export function ruleConfigExpression(config: RuleConfig): string {
  const params = config.params as Record<string, unknown>;
  switch (config.type) {
    case 'unique':
      return Array.isArray(params.columns) ? params.columns.join(', ') : '';
    case 'enum':
      return `${String(params.column ?? '')}: ${Array.isArray(params.values) ? params.values.join(', ') : ''}`;
    case 'range':
      return `${String(params.column ?? '')}: ${typeof params.min === 'number' ? params.min : ''}..${typeof params.max === 'number' ? params.max : ''}`;
    case 'naturalLanguage':
      return String(params.mode === 'query' ? params.query ?? '' : params.failWhen ?? '');
    default:
      return JSON.stringify(params);
  }
}

export function ruleConfigColumns(config: RuleConfig): string {
  const columns = (config.params as Record<string, unknown>).columns;
  if (!columns || typeof columns !== 'object' || Array.isArray(columns)) return '';
  return Object.entries(columns as Record<string, unknown>)
    .filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every(column => typeof column === 'string'))
    .map(([table, names]) => table ? `${table}: ${names.join(', ')}` : names.join(', '))
    .join(' | ');
}
