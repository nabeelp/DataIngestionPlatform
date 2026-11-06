import { useReducer, useRef, useState } from 'react';
import type { RuleConfig } from '../../../contracts/rule-config';
import { getDraftRules, initialRuleDraft, ruleDraftReducer } from '../../../features/definition-rules';
import type { ExampleProposal } from '../exampleProposal';

/** The rule draft of the definition being edited: its reducer, the saved revision and the loading state. */
export function useRuleDraft() {
  const [ruleDraft, dispatchRules] = useReducer(ruleDraftReducer, undefined, () => initialRuleDraft());
  const [rulesState, setRulesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('ready');
  const [rulesLoadError, setRulesLoadError] = useState<string | null>(null);
  const [suggestedRuleCount, setSuggestedRuleCount] = useState(0);
  const draftRevision = useRef<string | null>(null);
  const appliedProposal = useRef<ExampleProposal | null>(null);
  const rulesRequest = useRef(0);

  const resetRules = (rules: RuleConfig[] = [], revision: string | null = null) => {
    dispatchRules({ type: 'load', rules });
    draftRevision.current = revision;
    appliedProposal.current = null;
    setSuggestedRuleCount(0);
  };

  /** Drops any in-flight rules request and marks the (empty) draft as ready. */
  const settleRules = () => {
    rulesRequest.current += 1;
    setRulesState('ready');
    setRulesLoadError(null);
  };

  const loadRules = async (definitionId: string) => {
    const request = ++rulesRequest.current;
    setRulesState('loading');
    setRulesLoadError(null);
    try {
      const saved = await getDraftRules(definitionId);
      if (rulesRequest.current !== request) return;
      resetRules(saved.rules, saved.revision);
      setRulesState('ready');
    } catch (err) {
      if (rulesRequest.current !== request) return;
      setRulesState('error');
      setRulesLoadError(err instanceof Error ? err.message : 'Failed to load the rules');
    }
  };

  /** Applies the rules suggested by an example file once per analysis. */
  const applyProposalRules = (proposal: ExampleProposal) => {
    resetRules();
    appliedProposal.current = proposal;
    // Fresh ids keep rules from one analysis independent when it is applied to more than one definition.
    const suggested = proposal.rules.map(rule => ({ ...rule, id: crypto.randomUUID() }));
    dispatchRules({ type: 'append', rules: suggested });
    setSuggestedRuleCount(suggested.length);
  };

  const isProposalApplied = (proposal: ExampleProposal) => appliedProposal.current === proposal;

  return {
    ruleDraft,
    dispatchRules,
    rulesState,
    rulesLoadError,
    suggestedRuleCount,
    draftRevision,
    resetRules,
    settleRules,
    loadRules,
    applyProposalRules,
    isProposalApplied,
  };
}
