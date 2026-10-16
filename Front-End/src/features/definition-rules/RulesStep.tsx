import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { AlertTriangle, ListChecks, Plus, Search, Sparkles, X } from 'lucide-react';
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import DefinitionStructureSummary from '../../components/DefinitionStructureSummary';
import { getLookups } from '../../services/lookupApi';
import NaturalLanguageRuleForm from './NaturalLanguageRuleForm';
import RuleEditorPanel from './RuleEditorPanel';
import RuleList from './RuleList';
import type { RuleHealth, PreflightState } from './preflight';
import { MAX_RULES, ruleStatus, type RuleDraftAction, type RuleDraftState } from './ruleDraft';
import type { DraftContext } from './ruleDraftApi';
import { structureOf } from './ruleReferences';

interface Props {
  draft: RuleDraftState;
  dispatch: Dispatch<RuleDraftAction>;
  /** The definition's structure as currently edited in the workspace. */
  contract: DefinitionContract;
  /** The saved definition; null while it is being created. */
  definitionId: string | null;
  token: string | null;
  health: RuleHealth;
  preflight: PreflightState;
  /** Set when the draft was loaded from the server and rules could not be read. */
  loadError?: string | null;
  loading?: boolean;
  /** How many rules came from the example file and still deserve a look. */
  suggestedCount?: number;
}

type Editor =
  | { kind: 'closed' }
  | { kind: 'new-typed' }
  | { kind: 'new-nl' }
  | { kind: 'edit'; id: string };

type SeverityFilter = 'all' | 'Error' | 'Warning';

/**
 * The Rules section of the definition workspace: every rule of the draft, with search, ordering, validation against
 * the unsaved structure and an editor that never leaves the workspace.
 */
export default function RulesStep({
  draft,
  dispatch,
  contract,
  definitionId,
  token,
  health,
  preflight,
  loadError,
  loading,
  suggestedCount = 0,
}: Props) {
  const [editor, setEditor] = useState<Editor>({ kind: 'closed' });
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [lookups, setLookups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let active = true;
    getLookups().then(items => {
      if (active) setLookups(items.map(item => ({ id: item.id, name: item.name })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const context: DraftContext = useMemo(() => ({ contract, rules: draft.rules }), [contract, draft.rules]);
  const structure = useMemo(() => structureOf(contract), [contract]);

  const query = search.trim().toLowerCase();
  const visible = draft.rules.filter(rule =>
    (severity === 'all' || rule.severity === severity)
    && (!query || rule.name.toLowerCase().includes(query) || rule.description.toLowerCase().includes(query)
      || JSON.stringify(rule.params).toLowerCase().includes(query)));

  const active = draft.rules.filter(rule => rule.enabled).length;
  const warnings = draft.rules.filter(rule => rule.severity === 'Warning').length;
  const full = draft.rules.length >= MAX_RULES;
  const editingRule = editor.kind === 'edit' ? draft.rules.find(rule => rule.id === editor.id) ?? null : null;

  const remove = (rule: RuleConfig) => {
    if (!window.confirm(`Delete the rule "${rule.name}"? It is removed when you save the definition.`)) return;
    dispatch({ type: 'remove', id: rule.id });
    if (editor.kind === 'edit' && editor.id === rule.id) setEditor({ kind: 'closed' });
  };

  const panelOpen = editor.kind !== 'closed';
  const panelRef = useRef<HTMLDivElement>(null);
  const editorKey = editor.kind === 'edit' ? `edit:${editor.id}` : editor.kind;

  // Bring the editor into view and move focus to it, so keyboard and small-screen users land on it.
  useEffect(() => {
    if (editorKey === 'closed') return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    panel.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
  }, [editorKey]);

  useEffect(() => {
    if (!panelOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditor({ kind: 'closed' });
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [panelOpen]);

  return (
    <div className="space-y-4" aria-label="Rules">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ListChecks className="h-5 w-5 text-blue-600" aria-hidden="true" /> Validation rules
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Column types and required flags from <span className="font-medium">Tables and columns</span> are checked automatically.
          Add rules for the business logic on top: ranges, allowed values, cross-column checks and more. A rule set can be empty.
        </p>
      </div>

      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}

      {suggestedCount > 0 && (
        <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {suggestedCount} rule{suggestedCount === 1 ? ' was' : 's were'} suggested from your example file. Review them below, then remove or edit any that do not fit.
        </p>
      )}

      {(health.blocking > 0 || health.general.length > 0) && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {health.blocking > 0
              ? `${health.blocking} rule${health.blocking === 1 ? ' needs' : 's need'} attention`
              : 'The definition has a problem'}
          </p>
          {health.blocking > 0 && (
            <p className="mt-1 text-xs">
              The structure changed or a rule is invalid. Edit each flagged rule, disable it, or delete it before you save the definition.
            </p>
          )}
          {health.general.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {health.general.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}
        </div>
      )}
      {preflight.error && <p role="alert" className="text-xs text-red-700">{preflight.error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600" aria-live="polite">
          <span className="font-semibold text-slate-900">{draft.rules.length}</span> rule{draft.rules.length === 1 ? '' : 's'}
          {' · '}{active} active{' · '}{warnings} warning{warnings === 1 ? '' : 's'}
          {preflight.loading && <span className="ml-2 text-xs text-slate-400">checking…</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={full}
            onClick={() => setEditor({ kind: 'new-nl' })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:bg-slate-300"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Describe a rule
          </button>
          <button
            type="button"
            disabled={full}
            onClick={() => setEditor({ kind: 'new-typed' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Choose a rule type
          </button>
        </div>
      </div>
      {full && <p className="text-xs text-amber-800">A definition can have at most {MAX_RULES} rules.</p>}

      {draft.rules.length > 4 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex max-w-sm flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search rules"
              placeholder="Search rules"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X className="h-4 w-4 text-slate-400" /></button>
            )}
          </div>
          <div role="group" aria-label="Filter by severity" className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-sm">
            {(['all', 'Error', 'Warning'] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={severity === option}
                onClick={() => setSeverity(option)}
                className={`rounded-md px-3 py-1 ${severity === option ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-slate-600'}`}
              >
                {option === 'all' ? 'All' : option}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={panelOpen ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-4' : ''}>
        <div>
          {loading ? (
            <p role="status" className="rounded-lg border border-slate-200 p-6 text-center text-sm text-slate-500">Loading rules…</p>
          ) : (
            <RuleList
              rules={visible}
              layout={contract.layout}
              statusOf={rule => ruleStatus(draft, rule.id)}
              problemsOf={rule => health.problemsByRule[rule.id] ?? []}
              selectedId={editor.kind === 'edit' ? editor.id : null}
              canAdd={!full}
              onEdit={rule => setEditor({ kind: 'edit', id: rule.id })}
              onToggle={(rule, enabled) => dispatch({ type: 'setEnabled', id: rule.id, enabled })}
              onSwap={(rule, other) => other && dispatch({ type: 'swap', id: rule.id, otherId: other.id })}
              onDuplicate={rule => dispatch({ type: 'duplicate', id: rule.id, newId: crypto.randomUUID() })}
              onRemove={remove}
              emptyMessage={draft.rules.length === 0
                ? 'No rules yet. Files are checked against the structure only. Describe a rule in plain language or choose a rule type to add one.'
                : 'No rules match your search.'}
            />
          )}
        </div>

        {panelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="rule-editor-dialog-title"
              className="flex max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            >
              <aside className="hidden w-[42%] overflow-y-auto border-r border-slate-200 bg-slate-100 p-4 brightness-95 saturate-50 md:block">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Definition structure</h3>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                    {contract.layout === 'single' ? 'Single table' : `${structure.tables.length} sheets`}
                  </span>
                </div>
                <DefinitionStructureSummary
                  tables={contract.tables}
                  showColumnCount={false}
                  showTableDetails={false}
                />
              </aside>

              <div ref={panelRef} className="flex-1 overflow-y-auto p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rule editor</p>
                    <h3 id="rule-editor-dialog-title" className="text-lg font-bold text-slate-900">
                      {editor.kind === 'new-nl' ? 'Describe a rule' : editor.kind === 'new-typed' ? 'New rule' : `Edit rule ${editingRule?.name ?? ''}`}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditor({ kind: 'closed' })}
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    aria-label="Close rule editor"
                  >
                    Close
                  </button>
                </div>

                {editor.kind === 'new-nl' && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <NaturalLanguageRuleForm
                      context={context}
                      token={token}
                      onCancel={() => setEditor({ kind: 'closed' })}
                      onAdd={(rule, options) => {
                        dispatch({ type: 'upsert', rule });
                        setEditor(options.review ? { kind: 'edit', id: rule.id } : { kind: 'closed' });
                      }}
                    />
                  </div>
                )}

                {(editor.kind === 'new-typed' || (editor.kind === 'edit' && editingRule)) && (
                  <RuleEditorPanel
                    key={editingRule?.id ?? 'new'}
                    rule={editingRule}
                    context={context}
                    structure={structure}
                    lookups={lookups}
                    token={token}
                    definitionId={definitionId}
                    onCancel={() => setEditor({ kind: 'closed' })}
                    onSave={rule => {
                      dispatch({ type: 'upsert', rule });
                      setEditor({ kind: 'closed' });
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
