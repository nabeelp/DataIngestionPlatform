import type { RuleConfig } from '../contracts/rule-config';

export interface RuleConfigForm {
  id: string;
  name: string;
  description: string;
  executionOrder: number;
  severity: 'Error' | 'Warning';
  enabled: boolean;
  ruleType: string;
  expression: string;
  table: string | null;
}

const EXPRESSION_TYPES = new Set(['columnsPresent', 'required', 'type', 'enum', 'range']);

const list = (value: string, field: string): [string, ...string[]] => {
  const values = value.split(',').map(item => item.trim()).filter(Boolean);
  if (!values.length) throw new Error(`${field} must contain at least one column or value.`);
  return [values[0], ...values.slice(1)];
};

const common = (form: RuleConfigForm) => ({
  id: form.id,
  name: form.name.trim(),
  description: form.description,
  severity: form.severity,
  executionOrder: form.executionOrder,
  enabled: form.enabled,
  table: form.table,
});

export function ruleConfigFromForm(form: RuleConfigForm): RuleConfig {
  const base = common(form);
  switch (form.ruleType) {
    case 'Schema Validation':
      return { ...base, type: 'columnsPresent', params: { columns: list(form.expression, 'Columns') } };
    case 'Required Values':
      return { ...base, type: 'required', params: { columns: list(form.expression, 'Columns') } };
    case 'Type Check': {
      const match = /^\s*([^:]+?)\s*:\s*(string|integer|decimal|date|datetime|boolean)\s*$/i.exec(form.expression);
      if (!match) throw new Error('Data type must use the form "Column: type".');
      return {
        ...base,
        type: 'type',
        params: { column: match[1].trim(), dataType: match[2].toLowerCase() as 'string' | 'integer' | 'decimal' | 'date' | 'datetime' | 'boolean' },
      };
    }
    case 'Enum Check': {
      const separator = form.expression.indexOf(':');
      if (separator < 1) throw new Error('Allowed values must use the form "Column: Value1, Value2".');
      const column = form.expression.slice(0, separator).trim();
      if (!column) throw new Error('Allowed values require a column name.');
      return {
        ...base,
        type: 'enum',
        params: { column, values: list(form.expression.slice(separator + 1), 'Allowed values') },
      };
    }
    case 'Range Check': {
      const match = /^\s*([^:]+?)\s*:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))?\s*\.\.\s*(-?(?:\d+(?:\.\d*)?|\.\d+))?\s*$/.exec(form.expression);
      if (!match || (!match[2] && !match[3])) {
        throw new Error('Numeric range must use "Column: minimum..maximum" with at least one bound.');
      }
      return {
        ...base,
        type: 'range',
        params: {
          column: match[1].trim(),
          ...(match[2] ? { min: Number(match[2]) } : {}),
          ...(match[3] ? { max: Number(match[3]) } : {}),
        },
      };
    }
    default:
      throw new Error(`The ${form.ruleType} rule editor is not supported.`);
  }
}

export function updateRuleConfigFromForm(config: RuleConfig, form: RuleConfigForm): RuleConfig {
  if (EXPRESSION_TYPES.has(config.type)) {
    return ruleConfigFromForm({ ...form, id: config.id });
  }
  return {
    ...config,
    ...common({ ...form, id: config.id }),
  };
}

export function ruleConfigTypeLabel(config: RuleConfig): string {
  const labels: Partial<Record<RuleConfig['type'], string>> = {
    columnsPresent: 'Schema Validation',
    required: 'Required Values',
    type: 'Type Check',
    enum: 'Enum Check',
    range: 'Range Check',
    naturalLanguage: 'Natural Language',
  };
  return labels[config.type] ?? config.type.replace(/[A-Z]/g, letter => ` ${letter}`).replace(/^./, letter => letter.toUpperCase());
}

export function ruleConfigExpression(config: RuleConfig): string {
  const params = config.params as Record<string, unknown>;
  switch (config.type) {
    case 'columnsPresent':
    case 'required':
    case 'unique':
      return Array.isArray(params.columns) ? params.columns.join(', ') : '';
    case 'type':
      return `${String(params.column ?? '')}: ${String(params.dataType ?? '')}`;
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
