import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { RuleConfig } from '../../contracts/rule-config';
import RuleConfigDetails from './RuleConfigDetails';
import RuleReviewActivity from './RuleReviewActivity';
import { proposeNaturalLanguageRule, type DraftContext, type ReviewActivity } from './ruleDraftApi';
import { ruleConfigExpression } from '../../services/ruleConfig';

interface Props {
  context: DraftContext;
  onAdd: (rule: RuleConfig, options: { review: boolean }) => void;
  onCancel: () => void;
}

type Outcome =
  | { kind: 'rejected'; reason: string }
  | { kind: 'proposed'; reason: string; config: RuleConfig };

/**
 * Describe a rule in plain language. The server reviews it against the unsaved definition and proposes a rule,
 * which only joins the draft once the admin accepts it.
 */
export default function NaturalLanguageRuleForm({ context, onAdd, onCancel }: Props) {
  const [request, setRequest] = useState('');
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<ReviewActivity[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Closing the panel stops a running review so the server does not keep calling the model.
  useEffect(() => () => abort.current?.abort(), []);

  const review = async () => {
    if (running || !request.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    const started = Date.now();
    setRunning(true);
    setStartedAt(started);
    setNow(started);
    setError(null);
    setOutcome(null);
    setActivity([{ level: 'info', message: 'Sending the rule to the server', elapsedMs: 0 }]);
    try {
      const result = await       proposeNaturalLanguageRule({
              context,
        request: request.trim(),
        signal: controller.signal,
        onActivity: entry => setActivity(previous => [...previous, entry]),
      });
      setOutcome(result.outcome === 'rejected'
        ? { kind: 'rejected', reason: result.reason }
        : { kind: 'proposed', reason: result.reason, config: result.config });
    } catch (failure) {
      if (controller.signal.aborted) {
        setActivity(previous => [...previous, { level: 'warning', message: 'You stopped the review', elapsedMs: Date.now() - started }]);
      } else {
        const message = failure instanceof Error ? failure.message : 'Could not review the rule';
        setError(`Could not review the rule: ${message}`);
        setActivity(previous => previous.some(entry => entry.level === 'error' && entry.message === message)
          ? previous
          : [...previous, { level: 'error', message, elapsedMs: Date.now() - started }]);
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false);
    }
  };

  const sheetNames = context.contract.layout === 'sheets'
    ? context.contract.tables.map(table => table.sheet).filter((sheet): sheet is string => !!sheet)
    : [];
  const crossSheet = sheetNames.length > 1;

  return (
    <section className="space-y-3" aria-label="Describe a rule">
      <p className="text-xs text-slate-500">
        Describe one check. The model prefers a matching built-in rule type; otherwise it proposes restricted SQL.
        The rules service validates every proposal and runs its examples before you can add it.
      </p>
      {crossSheet && (
        <p className="text-xs text-slate-500">
          A rule can use data from several sheets. Name each sheet, for example:
          {' '}<em>Every row in the {sheetNames[0]} sheet must have a matching row in the {sheetNames[1]} sheet.</em>
        </p>
      )}
      <label htmlFor="naturalLanguageRule" className="block text-xs font-bold text-slate-600">
        Rule to enforce <span className="text-red-500">*</span>
      </label>
      <textarea
        id="naturalLanguageRule"
        maxLength={1000}
        rows={4}
        disabled={running || outcome?.kind === 'proposed'}
        value={request}
        onChange={event => { setRequest(event.target.value); setOutcome(null); }}
        placeholder="For example: The Amount column must be between 0 and 100"
        className="w-full resize-y rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {outcome?.kind !== 'proposed' && (
        <div className="flex gap-2">
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Stop generation
            </button>
          ) : (
            <button type="button" onClick={() => void review()} disabled={!request.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-slate-300">
              <Sparkles className="h-4 w-4" /> Generate rule
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={running}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      <RuleReviewActivity entries={activity} running={running} elapsedMs={startedAt ? now - startedAt : 0} />

      {outcome?.kind === 'rejected' && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Cannot create rule: {outcome.reason}</p>
      )}

      {outcome?.kind === 'proposed' && (
        <div role="status" className="space-y-2">
          <p className="text-sm font-medium text-emerald-700">
            Proposed rule "{outcome.config.name}": <code>{ruleConfigExpression(outcome.config)}</code>
          </p>
          <p className="text-xs text-slate-500">{outcome.reason}</p>
          <RuleConfigDetails
            naturalLanguageText={request}
            explanation={typeof outcome.config.params.explanation === 'string' ? outcome.config.params.explanation : null}
            expression={ruleConfigExpression(outcome.config)}
            provenance={outcome.config.params.provenance}
            examples={outcome.config.params.examples}
            expanded
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onAdd(outcome.config, { review: false })}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
              Add to definition
            </button>
            <button type="button" onClick={() => onAdd(outcome.config, { review: true })}
              className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
              Add and review examples
            </button>
            <button type="button" onClick={() => { setOutcome(null); setActivity([]); }}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
              Discard and rewrite
            </button>
          </div>
        </div>
      )}

    </section>
  );
}
