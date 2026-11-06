import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { RuleConfig } from '../../contracts/rule-config';
import { defaultRuleParams, ruleConfigFromForm, ruleConfigExpression, updateRuleConfigFromForm } from '../../services/ruleConfig';
import DryRunSection from './DryRunSection';
import NaturalLanguageExamplesEditor from './NaturalLanguageExamplesEditor';
import { naturalLanguageExamples } from './naturalLanguageExamples';
import RuleConfigDetails from './RuleConfigDetails';
import RuleConfigFields from './RuleConfigFields';
import RuleReviewActivity from './RuleReviewActivity';
import {
  proposeNaturalLanguageRule,
  testDraftRuleExamples,
  validateDraftRule,
  type DraftContext,
  type ReviewActivity,
  type RuleConfigValidationResult,
  type RuleExampleTestResult,
} from './ruleDraftApi';
import { ruleProblems, type RuleStructure } from './ruleReferences';
import { RULE_TYPE_OPTIONS, ruleTypeDescription, type BuiltInRuleType } from './ruleText';
import { initialForm, scopeParamsToColumns, type FormState } from './ruleEditorForm';

interface Props {
  /** The rule being edited; null creates a rule of a built-in type. */
  rule: RuleConfig | null;
  context: DraftContext;
  structure: RuleStructure;
  lookups: Array<{ id: string; name: string }>;
  token: string | null;
  /** The saved definition, for dry runs; null while it is being created. */
  definitionId: string | null;
  onSave: (rule: RuleConfig) => void;
  onCancel: () => void;
}

/** Edits one rule of the workspace's draft. Nothing is saved to the server; Save hands the rule back to the draft. */
export default function RuleEditorPanel({ rule, context, structure, lookups, token, definitionId, onSave, onCancel }: Props) {
  const [base, setBase] = useState<RuleConfig | null>(rule);
  const [form, setForm] = useState<FormState>(() => initialForm(rule));
  const [validation, setValidation] = useState<RuleConfigValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const newId = useRef(crypto.randomUUID());
  const requestId = useRef(0);
  const editVersion = useRef(0);

  const editForm = (update: (current: FormState) => FormState) => {
    editVersion.current += 1;
    setFeedbackVisible(false);
    setSaveError(null);
    setForm(update);
  };

  const generated = base?.type === 'naturalLanguage';
  const sheetLayout = structure.layout === 'sheets';
  const sheets = structure.tables.flatMap(table => table.sheet ? [table.sheet] : []);
  const scoped = sheetLayout && form.ruleType !== 'reconcile' && form.ruleType !== 'naturalLanguage';

  const [request, setRequest] = useState(() => {
    const params = (rule?.params ?? {}) as Record<string, unknown>;
    return typeof params.request === 'string' ? params.request : rule?.description ?? '';
  });
  const [regenerating, setRegenerating] = useState(false);
  const [activity, setActivity] = useState<ReviewActivity[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [regenerated, setRegenerated] = useState<{ reason: string; config: RuleConfig } | { reason: string; config: null } | null>(null);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [exampleTest, setExampleTest] = useState<RuleExampleTestResult | null>(null);
  const [testingExamples, setTestingExamples] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);

  // A different rule was opened: start from its values.
  useEffect(() => {
    editVersion.current += 1;
    setBase(rule);
    setForm(initialForm(rule));
    newId.current = crypto.randomUUID();
    setValidation(null);
    setFeedbackVisible(false);
    setSaveError(null);
    setRegenerated(null);
    setExampleTest(null);
    setActivity([]);
    const params = (rule?.params ?? {}) as Record<string, unknown>;
    setRequest(typeof params.request === 'string' ? params.request : rule?.description ?? '');
  }, [rule]);

  useEffect(() => {
    if (!regenerating) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [regenerating]);

  useEffect(() => () => abort.current?.abort(), []);

  const candidate = useMemo((): { config: RuleConfig | null; error: string | null } => {
    if (!form.name.trim()) return { config: null, error: 'Give the rule a name.' };
    const input = {
      id: base?.id ?? newId.current,
      name: form.name,
      description: form.description,
      executionOrder: base?.executionOrder ?? 0,
      severity: form.severity,
      enabled: base?.enabled ?? true,
      ruleType: form.ruleType,
      params: form.params,
      table: scoped ? form.tableName || null : form.ruleType === 'reconcile' ? null : base?.table ?? null,
    };
    try {
      return { config: base ? updateRuleConfigFromForm(base, input) : ruleConfigFromForm(input), error: null };
    } catch (failure) {
      return { config: null, error: failure instanceof Error ? failure.message : 'The rule is incomplete.' };
    }
  }, [base, form, scoped]);

  const structureProblems = useMemo(
    () => (candidate.config ? ruleProblems(candidate.config, structure) : []),
    [candidate.config, structure],
  );

  // Check the rule against the unsaved structure as it is being edited.
  useEffect(() => {
    const id = ++requestId.current;
    setValidation(null);
    setValidationError(null);
    if (!candidate.config) {
      setValidating(false);
      return;
    }
    const config = candidate.config;
    const timer = window.setTimeout(() => {
      setValidating(true);
      void validateDraftRule(context, config)
        .then(result => { if (requestId.current === id) setValidation(result); })
        .catch(failure => {
          if (requestId.current === id) setValidationError(failure instanceof Error ? failure.message : 'Could not validate the rule.');
        })
        .finally(() => { if (requestId.current === id) setValidating(false); });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      if (requestId.current === id) requestId.current += 1;
    };
  }, [candidate.config, context]);

  const submit = async () => {
    if (saving || regenerating) return;
    const version = editVersion.current;
    setFeedbackVisible(true);
    if (!candidate.config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await validateDraftRule(context, candidate.config);
      if (version !== editVersion.current) return;
      setValidation(result);
      if (result.ok && structureProblems.length === 0) onSave(candidate.config);
    } catch (failure) {
      if (version === editVersion.current) {
        setSaveError(failure instanceof Error ? failure.message : 'Could not validate the rule.');
      }
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (!base || regenerating || !request.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    const started = Date.now();
    setRegenerating(true);
    setStartedAt(started);
    setNow(started);
    setRegenerated(null);
    setRegenerationError(null);
    setActivity([{ level: 'info', message: 'Sending the revised rule to the server', elapsedMs: 0 }]);
    try {
      const result = await proposeNaturalLanguageRule({
        token,
        context,
        request: request.trim(),
        existing: base,
        signal: controller.signal,
        onActivity: entry => setActivity(previous => [...previous, entry]),
      });
      setRegenerated(result.outcome === 'rejected'
        ? { reason: result.reason, config: null }
        : { reason: result.reason, config: result.config });
    } catch (failure) {
      if (controller.signal.aborted) {
        setActivity(previous => [...previous, { level: 'warning', message: 'You stopped the regeneration', elapsedMs: Date.now() - started }]);
      } else {
        const message = failure instanceof Error ? failure.message : 'Could not regenerate the rule';
        setRegenerationError(`Could not regenerate the rule: ${message}`);
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setRegenerating(false);
    }
  };

  const useRegenerated = () => {
    if (!regenerated?.config) return;
    editVersion.current += 1;
    setFeedbackVisible(false);
    setBase(regenerated.config);
    setForm(previous => ({ ...previous, name: regenerated.config!.name, params: regenerated.config!.params as Record<string, unknown> }));
    setRegenerated(null);
    setExampleTest(null);
  };

  const runExamples = async () => {
    if (!candidate.config || !generated) return;
    setTestingExamples(true);
    setExampleTest(null);
    setExampleError(null);
    try {
      setExampleTest(await testDraftRuleExamples(context, candidate.config, naturalLanguageExamples(form.params)));
    } catch (failure) {
      setExampleError(failure instanceof Error ? failure.message : 'Could not run rule examples.');
    } finally {
      setTestingExamples(false);
    }
  };

  const columnsForTable = (sheet: string): string[] => {
    const table = sheetLayout
      ? structure.tables.find(item => item.sheet?.toLowerCase() === sheet.toLowerCase())
      : structure.tables[0];
    return table?.columns ?? [];
  };
  const allColumns = [...new Set(structure.tables.flatMap(table => table.columns))];
  const suggestedColumns = scoped
    ? (form.tableName ? columnsForTable(form.tableName) : [])
    : allColumns;
  const columnsByTable = Object.fromEntries(
    structure.tables.flatMap(table => table.sheet ? [[table.sheet, table.columns] as const] : []),
  );

  const dryRunContext: DraftContext = useMemo(() => ({
    contract: context.contract,
    rules: candidate.config
      ? [...context.rules.filter(item => item.id !== candidate.config!.id), candidate.config]
      : context.rules,
  }), [candidate.config, context]);

  const unchangedRequest = request.trim() === (typeof (base?.params as Record<string, unknown> | undefined)?.request === 'string'
    ? (base!.params as Record<string, unknown>).request as string
    : '').trim();

  return (
    <section
      aria-label={rule ? `Edit rule ${rule.name}` : 'New rule'}
      className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-100 p-4">
        <h3 className="text-base font-bold text-slate-900">{rule ? 'Edit rule' : 'New rule'}</h3>
        <p className="text-xs text-slate-500">Changes join the definition's draft; nothing is saved until you save the definition.</p>
      </div>

      <div className="space-y-4 p-4">
        {saveError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{saveError}</p>}

        <div className="space-y-1.5">
          <label htmlFor="ruleName" className="text-xs font-bold text-slate-600">Rule name <span className="text-red-500">*</span></label>
          <input
            id="ruleName"
            type="text"
            maxLength={255}
            placeholder="e.g. Amount cannot be negative"
            value={form.name}
            onChange={event => editForm(current => ({ ...current, name: event.target.value }))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ruleDescription" className="text-xs font-bold text-slate-600">Description</label>
          <textarea
            id="ruleDescription"
            rows={2}
            value={form.description}
            onChange={event => editForm(current => ({ ...current, description: event.target.value }))}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ruleSeverity" className="text-xs font-bold text-slate-600">When the check fails</label>
          <select
            id="ruleSeverity"
            value={form.severity}
            onChange={event => editForm(current => ({ ...current, severity: event.target.value as FormState['severity'] }))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="Error">Error - the upload fails validation</option>
            <option value="Warning">Warning - reported, the upload can still pass</option>
          </select>
        </div>

        {scoped && (
          <div className="space-y-1.5">
            <label htmlFor="ruleTable" className="text-xs font-bold text-slate-600">Sheet <span className="text-red-500">*</span></label>
            <select
              id="ruleTable"
              value={form.tableName}
              onChange={event => {
                const tableName = event.target.value;
                editForm(current => ({
                  ...current,
                  tableName,
                  params: scopeParamsToColumns(current.ruleType, current.params, columnsForTable(tableName)),
                }));
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a sheet...</option>
              {form.tableName && !sheets.some(sheet => sheet.toLowerCase() === form.tableName.toLowerCase()) && (
                <option value={form.tableName}>{form.tableName} (no longer defined)</option>
              )}
              {sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
            <p className="text-[11px] text-slate-500">The rule checks rows of this sheet only.</p>
          </div>
        )}

        {generated ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-600">Natural language rule</p>
            <p className="text-[11px] text-slate-500">
              Edit the request and regenerate to change what the rule checks. The current rule stays as it is if regeneration fails or you stop it.
            </p>
            <label htmlFor="regenerateRequest" className="block text-xs font-bold text-slate-600">Request</label>
            <textarea
              id="regenerateRequest"
              maxLength={1000}
              rows={4}
              disabled={regenerating}
              value={request}
              onChange={event => {
                editVersion.current += 1;
                setFeedbackVisible(false);
                setSaveError(null);
                setRequest(event.target.value);
                setRegenerated(null);
              }}
              className="w-full resize-y rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {regenerating ? (
              <button type="button" onClick={() => abort.current?.abort()}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Stop regeneration
              </button>
            ) : (
              <button
                type="button"
                disabled={!request.trim() || unchangedRequest}
                onClick={() => void regenerate()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-slate-300"
              >
                <Sparkles className="h-4 w-4" />
                {regenerating ? `Regenerating… ${startedAt ? Math.floor((now - startedAt) / 1000) : 0} s` : 'Regenerate from request'}
              </button>
            )}
            <RuleReviewActivity entries={activity} running={regenerating} elapsedMs={startedAt ? now - startedAt : 0} />
            {regenerationError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{regenerationError}</p>}
            {regenerated && regenerated.config === null && (
              <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Cannot regenerate rule: {regenerated.reason}</p>
            )}
            {regenerated?.config && (
              <div role="status" className="space-y-2 rounded-lg border border-violet-200 p-3">
                <p className="text-sm font-medium text-emerald-700">Regenerated: <code>{ruleConfigExpression(regenerated.config)}</code></p>
                <p className="text-xs text-slate-500">{regenerated.reason}</p>
                <button type="button" onClick={useRegenerated}
                  className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">
                  Use regenerated rule
                </button>
              </div>
            )}
            <RuleConfigDetails
              naturalLanguageText={typeof form.params.request === 'string' ? form.params.request : null}
              explanation={typeof form.params.explanation === 'string' ? form.params.explanation : null}
              expression={base ? ruleConfigExpression(base) : null}
              provenance={form.params.provenance}
              examples={form.params.examples}
            />
            <NaturalLanguageExamplesEditor
              examples={naturalLanguageExamples(form.params)}
              tableOptions={sheets}
              allowRelatedRows={form.ruleType === 'naturalLanguage' && form.params.mode === 'query'}
              results={exampleTest?.results ?? null}
              running={testingExamples}
              onChange={examples => { setForm(previous => ({ ...previous, params: { ...previous.params, examples } })); setExampleTest(null); }}
              onRun={() => void runExamples()}
            />
            {exampleError && <p role="alert" className="text-xs text-red-700">{exampleError}</p>}
            {exampleTest && exampleTest.errors.length > 0 && (
              <ul role="alert" className="space-y-1 rounded bg-red-50 p-3 text-xs text-red-700">
                {exampleTest.errors.map((item, index) => <li key={`${item.path}-${index}`}>{item.message}</li>)}
              </ul>
            )}
            <DryRunSection context={dryRunContext} definitionId={definitionId} />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="ruleType" className="text-xs font-bold text-slate-600">Rule type</label>
              <select
                id="ruleType"
                value={form.ruleType}
                aria-describedby="ruleTypeDescription"
                onChange={event => {
                  const ruleType = event.target.value as BuiltInRuleType;
                  editForm(current => ({ ...current, ruleType, params: defaultRuleParams(ruleType) }));
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {RULE_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value} title={ruleTypeDescription(option.value)}>
                    {option.label} - {ruleTypeDescription(option.value)}
                  </option>
                ))}
              </select>
              <p id="ruleTypeDescription" className="text-xs leading-relaxed text-slate-600">
                {ruleTypeDescription(form.ruleType)}
              </p>
            </div>
            <RuleConfigFields
              type={form.ruleType as BuiltInRuleType}
              params={form.params}
              columns={suggestedColumns}
              columnsDisabled={scoped && !form.tableName}
              tables={sheetLayout ? sheets : []}
              columnsByTable={columnsByTable}
              lookups={lookups}
              onChange={params => editForm(current => ({ ...current, params }))}
            />
          </>
        )}

        {feedbackVisible && (
          <div aria-live="polite" className="space-y-1">
            {candidate.error && <p className="text-xs text-slate-500">{candidate.error}</p>}
            {structureProblems.length > 0 && (
              <ul role="alert" className="space-y-1 rounded bg-amber-50 p-3 text-xs text-amber-900">
                {structureProblems.map(problem => <li key={problem}>{problem}</li>)}
              </ul>
            )}
            {validating && <p role="status" className="text-xs text-slate-500">Checking the rule…</p>}
            {validationError && <p role="alert" className="text-xs text-red-700">{validationError}</p>}
            {validation?.errors.length ? (
              <ul role="alert" className="space-y-1 rounded bg-amber-50 p-3 text-xs text-amber-900">
                {validation.errors.map((item, index) => <li key={`${item.path}-${index}`}>{item.message}</li>)}
              </ul>
            ) : validation?.ok ? (
              <p role="status" className="text-xs text-emerald-700">The rule is valid for this definition.</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-100 p-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || regenerating}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {saving ? 'Checking…' : rule ? 'Update rule' : 'Add rule'}
        </button>
        <button type="button" onClick={onCancel} disabled={regenerating}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </section>
  );
}
