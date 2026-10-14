import type { RuleConfig } from '../../contracts/rule-config';
import type { InitialRule } from '../../services/adminApi';

/**
 * Turn a rule suggested from an example file (a column plus a short expression such as "Status: A, B" or
 * "Amount: 0..100") into a typed RuleConfig, or null when the suggestion is not one the editor understands.
 */
export function ruleConfigFromSuggestion(
  suggestion: InitialRule,
  executionOrder: number,
  newId: () => string,
): RuleConfig | null {
  const separator = suggestion.expression.indexOf(':');
  if (separator < 1) return null;
  const column = suggestion.expression.slice(0, separator).trim();
  const value = suggestion.expression.slice(separator + 1).trim();
  if (!column || !value) return null;

  const kind = suggestion.ruleType.trim().toLowerCase();
  let type: RuleConfig['type'];
  let params: Record<string, unknown>;
  if (kind === 'enum check' || kind === 'enum') {
    const values = value.split(',').map(item => item.trim()).filter(Boolean);
    if (values.length === 0) return null;
    type = 'enum';
    params = { column, values };
  } else if (kind === 'range check' || kind === 'range') {
    const match = value.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*\.\.\s*(-?(?:\d+\.?\d*|\.\d+))$/);
    if (!match) return null;
    type = 'range';
    params = { column, min: Number(match[1]), max: Number(match[2]) };
  } else {
    return null;
  }

  return {
    id: newId(),
    name: suggestion.name.trim() || `Suggested rule ${executionOrder}`,
    description: '',
    severity: suggestion.severity === 'Warning' ? 'Warning' : 'Error',
    executionOrder,
    enabled: true,
    table: suggestion.table?.trim() || null,
    type,
    params,
  } as RuleConfig;
}
