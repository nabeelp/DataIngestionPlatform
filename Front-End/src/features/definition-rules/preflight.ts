import { useEffect, useMemo, useRef, useState } from 'react';
import type { RuleConfig } from '../../contracts/rule-config';
import { preflightDefinition, type DraftContext, type PreflightResult } from './ruleDraftApi';
import { ruleProblems, type RuleStructure } from './ruleReferences';

export interface RuleHealth {
  /** Messages per rule id (instant structure checks plus the rules service's findings). */
  problemsByRule: Record<string, string[]>;
  /** Findings that are not about one rule (for example the structure itself). */
  general: string[];
  /** Enabled rules that must be fixed, disabled or removed before the definition can be saved. */
  blocking: number;
}

const RULE_PATH = /\$?\.?rules\[(\d+)\]/;

/**
 * Attach the rules service's findings to the rules they belong to. `rules` must be in the order they were sent.
 */
export function mapPreflightErrors(
  errors: PreflightResult['errors'],
  rules: RuleConfig[],
): { byRule: Record<string, string[]>; general: string[] } {
  const byRule: Record<string, string[]> = {};
  const general: string[] = [];
  for (const error of errors) {
    const match = RULE_PATH.exec(error.path);
    const rule = match ? rules[Number(match[1])] : undefined;
    if (rule) {
      const messages = byRule[rule.id] ?? [];
      if (!messages.includes(error.message)) messages.push(error.message);
      byRule[rule.id] = messages;
    } else {
      general.push(error.path ? `${error.path}: ${error.message}` : error.message);
    }
  }
  return { byRule, general };
}

export function ruleHealth(
  rules: RuleConfig[],
  structure: RuleStructure,
  preflight: PreflightResult | null,
): RuleHealth {
  const problemsByRule: Record<string, string[]> = {};
  // Only enabled rules are checked by the rules service (disabled rules do not take part in validation).
  const sent = rules.filter(rule => rule.enabled);
  const server = preflight && !preflight.ok ? mapPreflightErrors(preflight.errors, sent) : { byRule: {}, general: [] };
  for (const rule of rules) {
    const messages = [...ruleProblems(rule, structure)];
    for (const message of server.byRule[rule.id] ?? []) {
      if (!messages.some(existing => existing === message)) messages.push(message);
    }
    if (messages.length > 0) problemsByRule[rule.id] = messages;
  }
  const blocking = rules.filter(rule => rule.enabled && problemsByRule[rule.id]).length;
  return { problemsByRule, general: server.general, blocking };
}

export interface PreflightState {
  loading: boolean;
  result: PreflightResult | null;
  error: string | null;
}

/**
 * Validate the whole draft (structure and rules) with the rules service and preview what publishing would change.
 * Runs shortly after the draft stops changing; pass `null` while the draft is incomplete.
 */
export function usePreflight(context: DraftContext | null, definitionId: string | null): PreflightState {
  const [state, setState] = useState<PreflightState>({ loading: false, result: null, error: null });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (!context) {
      setState({ loading: false, result: null, error: null });
      return;
    }
    setState(previous => ({ ...previous, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      preflightDefinition(context, definitionId)
        .then(result => { if (requestId.current === id) setState({ loading: false, result, error: null }); })
        .catch(failure => {
          if (requestId.current === id) {
            setState({ loading: false, result: null, error: failure instanceof Error ? failure.message : 'Could not check the definition.' });
          }
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [context, definitionId]);

  return useMemo(() => state, [state]);
}
