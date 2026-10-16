import type { RuleConfig } from '../../contracts/rule-config';

/** Rules the workspace is editing, next to the rules as they were saved (to show what changed). */
export interface RuleDraftState {
  rules: RuleConfig[];
  original: RuleConfig[];
}

export type RuleStatus = 'new' | 'changed' | 'unchanged';

export type RuleDraftAction =
  | { type: 'load'; rules: RuleConfig[] }
  | { type: 'upsert'; rule: RuleConfig }
  | { type: 'remove'; id: string }
  | { type: 'setEnabled'; id: string; enabled: boolean }
  | { type: 'move'; id: string; direction: -1 | 1 }
  | { type: 'swap'; id: string; otherId: string }
  | { type: 'duplicate'; id: string; newId: string }
  | { type: 'append'; rules: RuleConfig[] };

export const MAX_RULES = 50;

const byOrder = (left: RuleConfig, right: RuleConfig) =>
  left.executionOrder - right.executionOrder || left.name.localeCompare(right.name);

const sorted = (rules: RuleConfig[]) => [...rules].sort(byOrder);

const nextOrder = (rules: RuleConfig[]) => Math.max(0, ...rules.map(rule => rule.executionOrder)) + 1;

const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export const initialRuleDraft = (rules: RuleConfig[] = []): RuleDraftState => ({
  rules: sorted(rules),
  original: sorted(rules),
});

export function ruleDraftReducer(state: RuleDraftState, action: RuleDraftAction): RuleDraftState {
  switch (action.type) {
    case 'load':
      return initialRuleDraft(action.rules);
    case 'upsert': {
      const exists = state.rules.some(rule => sameId(rule.id, action.rule.id));
      if (exists) {
        return { ...state, rules: sorted(state.rules.map(rule => sameId(rule.id, action.rule.id) ? action.rule : rule)) };
      }
      if (state.rules.length >= MAX_RULES) return state;
      const rule = state.rules.some(item => item.executionOrder === action.rule.executionOrder) || action.rule.executionOrder < 1
        ? { ...action.rule, executionOrder: nextOrder(state.rules) }
        : action.rule;
      return { ...state, rules: sorted([...state.rules, rule]) };
    }
    case 'append': {
      const room = MAX_RULES - state.rules.length;
      let order = nextOrder(state.rules);
      const added = action.rules.slice(0, Math.max(0, room)).map(rule => ({ ...rule, executionOrder: order++ }));
      return { ...state, rules: sorted([...state.rules, ...added]) };
    }
    case 'remove':
      return { ...state, rules: state.rules.filter(rule => !sameId(rule.id, action.id)) };
    case 'setEnabled':
      return {
        ...state,
        rules: state.rules.map(rule => sameId(rule.id, action.id) ? { ...rule, enabled: action.enabled } : rule),
      };
    case 'move': {
      const ordered = sorted(state.rules);
      const index = ordered.findIndex(rule => sameId(rule.id, action.id));
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= ordered.length) return state;
      return ruleDraftReducer(state, { type: 'swap', id: action.id, otherId: ordered[target].id });
    }
    case 'swap': {
      const first = state.rules.find(rule => sameId(rule.id, action.id));
      const second = state.rules.find(rule => sameId(rule.id, action.otherId));
      if (!first || !second || first === second) return state;
      // Swapping two execution orders keeps every other rule untouched, so only these two show as changed.
      return {
        ...state,
        rules: sorted(state.rules.map(rule => {
          if (rule === first) return { ...rule, executionOrder: second.executionOrder };
          if (rule === second) return { ...rule, executionOrder: first.executionOrder };
          return rule;
        })),
      };
    }
    case 'duplicate': {
      if (state.rules.length >= MAX_RULES) return state;
      const source = state.rules.find(rule => sameId(rule.id, action.id));
      if (!source) return state;
      const copy = {
        ...(JSON.parse(JSON.stringify(source)) as RuleConfig),
        id: action.newId,
        name: `${source.name} (copy)`.slice(0, 255),
        executionOrder: nextOrder(state.rules),
      };
      return { ...state, rules: sorted([...state.rules, copy]) };
    }
  }
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : item);

export function ruleStatus(state: RuleDraftState, id: string): RuleStatus {
  const original = state.original.find(rule => sameId(rule.id, id));
  const current = state.rules.find(rule => sameId(rule.id, id));
  if (!original) return 'new';
  return current && stable(current) === stable(original) ? 'unchanged' : 'changed';
}

export function removedRules(state: RuleDraftState): RuleConfig[] {
  return state.original.filter(rule => !state.rules.some(current => sameId(current.id, rule.id)));
}

export function isRuleDraftDirty(state: RuleDraftState): boolean {
  return removedRules(state).length > 0
    || state.rules.some(rule => ruleStatus(state, rule.id) !== 'unchanged');
}

export function ruleChangeSummary(state: RuleDraftState): { added: number; changed: number; removed: number } {
  let added = 0;
  let changed = 0;
  for (const rule of state.rules) {
    const status = ruleStatus(state, rule.id);
    if (status === 'new') added += 1;
    else if (status === 'changed') changed += 1;
  }
  return { added, changed, removed: removedRules(state).length };
}
