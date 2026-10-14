import type { RuleConfig } from './rule-config';

export const RULE_CONFIG_TYPES = [
    'enum', 'range', 'pattern', 'length', 'unique',
    'lookup', 'dateRange', 'conditionalRequired', 'compare', 'rowCount', 'aggregate',
    'reconcile', 'naturalLanguage',
] as const satisfies readonly RuleConfig['type'][];
