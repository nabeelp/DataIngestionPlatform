import type { RuleConfig } from '../../contracts/rule-config';

type Params = Record<string, unknown>;
export type BuiltInRuleType = Exclude<RuleConfig['type'], 'naturalLanguage'>;

export const RULE_TYPE_DESCRIPTIONS: Record<RuleConfig['type'], string> = {
  enum: 'A column must match one of a specified set of allowed values.',
  range: 'A numeric column must fall within a minimum, maximum, or both.',
  pattern: "A column's text must match a regular-expression pattern.",
  length: 'A text value must meet a minimum or maximum character count.',
  unique: 'A value or combination of columns must not be duplicated.',
  lookup: "A column's value must exist in a configured lookup set.",
  dateRange: 'A date column must fall within specified fixed or relative date bounds.',
  conditionalRequired: 'One or more columns must be populated when another column meets a specified condition.',
  compare: 'Two columns in a row must satisfy a typed comparison, such as less than, equal to, or greater than.',
  rowCount: "A table's number of rows must meet a minimum, maximum, or both.",
  aggregate: 'An aggregate of a column, such as sum, average, count, or distinct count, must meet a minimum or maximum.',
  reconcile: 'Aggregates from two tables or sheets must agree, optionally within a tolerance.',
  naturalLanguage: 'A custom condition is needed: use row mode for a single-sheet row check, or query mode for a whole-file or cross-sheet check.',
};

export const RULE_TYPE_OPTIONS: ReadonlyArray<{ value: BuiltInRuleType; label: string }> = [
  { value: 'aggregate', label: 'Aggregate' },
  { value: 'enum', label: 'Allowed values' },
  { value: 'compare', label: 'Compare columns' },
  { value: 'conditionalRequired', label: 'Conditional required values' },
  { value: 'dateRange', label: 'Date range' },
  { value: 'length', label: 'Length' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'range', label: 'Numeric range' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'reconcile', label: 'Reconcile tables' },
  { value: 'rowCount', label: 'Row count' },
  { value: 'unique', label: 'Unique values' },
];

export const ruleTypeDescription = (type: RuleConfig['type']): string => RULE_TYPE_DESCRIPTIONS[type];

export const ruleTypeLabel = (type: RuleConfig['type']): string =>
  type === 'naturalLanguage'
    ? 'Natural language'
    : RULE_TYPE_OPTIONS.find(option => option.value === type)?.label ?? type;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const list = (value: unknown): string => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item !== '').join(', ')
  : '';

const bounds = (min: unknown, max: unknown, noun: string): string => {
  const low = typeof min === 'number' || (typeof min === 'string' && min !== '') ? String(min) : null;
  const high = typeof max === 'number' || (typeof max === 'string' && max !== '') ? String(max) : null;
  if (low !== null && high !== null) return `${noun} between ${low} and ${high}`;
  if (low !== null) return `${noun} at least ${low}`;
  if (high !== null) return `${noun} at most ${high}`;
  return `${noun} within limits`;
};

const COMPARE: Record<string, string> = {
  lt: 'less than', le: 'at most', eq: 'equal to', ne: 'different from', ge: 'at least', gt: 'greater than',
};

const AGGREGATE: Record<string, string> = {
  sum: 'sum', min: 'minimum', max: 'maximum', avg: 'average', count: 'count', countDistinct: 'distinct count',
};

/** A one-line description of what the rule enforces, written for the person maintaining the definition. */
export function describeRule(rule: RuleConfig): string {
  const params = rule.params as Params;
  const column = text(params.column) || 'A column';
  switch (rule.type) {
    case 'unique':
      return `${list(params.columns) || 'Columns'} must not repeat across rows`;
    case 'enum':
      return `${column} must be one of: ${list(params.values) || '…'}`;
    case 'range':
      return bounds(params.min, params.max, `${column} must be`);
    case 'pattern':
      return `${column} must match the pattern ${text(params.pattern) || '…'}`;
    case 'length':
      return bounds(params.min, params.max, `${column} must have a length`);
    case 'lookup':
      return `${column} must exist in the chosen lookup list`;
    case 'dateRange':
      return bounds(params.min, params.max, `${column} must be a date`);
    case 'conditionalRequired': {
      const when = (params.when ?? {}) as Params;
      const condition = when.op === 'in' ? `is one of ${list(when.values)}`
        : when.op === 'empty' ? 'is empty'
          : when.op === 'notEmpty' ? 'has a value'
            : `${when.op === 'ne' ? 'is not' : 'is'} "${text(when.value)}"`;
      return `${list(params.columns) || 'Columns'} are required when ${text(when.column) || 'a column'} ${condition}`;
    }
    case 'compare':
      return `${text(params.left) || 'A column'} must be ${COMPARE[text(params.op)] ?? 'compared with'} ${text(params.right) || 'another column'}`;
    case 'rowCount':
      return bounds(params.min, params.max, 'The table must have a row count');
    case 'aggregate':
      return bounds(params.min, params.max, `The ${AGGREGATE[text(params.fn)] ?? 'aggregate'} of ${column} must be`);
    case 'reconcile': {
      const side = (value: unknown) => {
        const reference = (value ?? {}) as Params;
        return `${AGGREGATE[text(reference.fn)] ?? 'total'} of ${text(reference.table) || '?'}.${text(reference.column) || '?'}`;
      };
      return `The ${side(params.left)} must match the ${side(params.right)}`;
    }
    case 'naturalLanguage':
      return text(params.request) || rule.description || rule.name;
  }
}
