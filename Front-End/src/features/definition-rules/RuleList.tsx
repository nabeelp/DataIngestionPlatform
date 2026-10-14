import { AlertTriangle, ArrowDown, ArrowUp, Copy, Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { RuleConfig } from '../../contracts/rule-config';
import RuleConfigDetails from './RuleConfigDetails';
import type { RuleStatus } from './ruleDraft';
import { describeRule, ruleTypeLabel } from './ruleText';

export interface RuleListProps {
  rules: RuleConfig[];
  layout: 'single' | 'sheets';
  /** Without handlers the list is a read-only view of published rules. */
  statusOf?: (rule: RuleConfig) => RuleStatus;
  problemsOf?: (rule: RuleConfig) => string[];
  selectedId?: string | null;
  onEdit?: (rule: RuleConfig) => void;
  onToggle?: (rule: RuleConfig, enabled: boolean) => void;
  onSwap?: (rule: RuleConfig, other: RuleConfig) => void;
  onDuplicate?: (rule: RuleConfig) => void;
  onRemove?: (rule: RuleConfig) => void;
  canAdd?: boolean;
  emptyMessage?: string;
}

const MULTI_TABLE = 'Several sheets';

const groupKey = (rule: RuleConfig, layout: 'single' | 'sheets'): string => {
  if (layout === 'single') return '';
  return rule.table || MULTI_TABLE;
};

const STATUS_STYLE: Record<Exclude<RuleStatus, 'unchanged'>, string> = {
  new: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  changed: 'border-blue-200 bg-blue-50 text-blue-800',
};

export default function RuleList({
  rules,
  layout,
  statusOf,
  problemsOf,
  selectedId,
  onEdit,
  onToggle,
  onSwap,
  onDuplicate,
  onRemove,
  canAdd = true,
  emptyMessage = 'No rules.',
}: RuleListProps) {
  const editable = Boolean(onEdit);
  if (rules.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  const groups = new Map<string, RuleConfig[]>();
  for (const rule of rules) {
    const key = groupKey(rule, layout);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([group, members]) => (
        <section key={group || 'all'} aria-label={group ? `Rules for ${group}` : 'Rules'}>
          {layout === 'sheets' && (
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3>
          )}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {members.map((rule, index) => {
              const status = statusOf?.(rule) ?? 'unchanged';
              const problems = problemsOf?.(rule) ?? [];
              const generated = rule.type === 'naturalLanguage';
              return (
                <li
                  key={rule.id}
                  aria-label={`Rule ${rule.name}`}
                  className={`p-3 ${selectedId === rule.id ? 'bg-blue-50/60' : ''} ${rule.enabled ? '' : 'bg-slate-50'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {generated && <Sparkles className="h-3.5 w-3.5 text-violet-600" aria-label="Natural language rule" />}
                        <span className={`font-medium ${rule.enabled ? 'text-slate-900' : 'text-slate-500'}`}>{rule.name}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          rule.severity === 'Error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-amber-100 bg-amber-50 text-amber-800'
                        }`}>{rule.severity}</span>
                        {!rule.enabled && (
                          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">Disabled</span>
                        )}
                        {status !== 'unchanged' && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[status]}`}>
                            {status === 'new' ? 'New' : 'Changed'}
                          </span>
                        )}
                        {problems.length > 0 && rule.enabled && (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Needs attention
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-600">{describeRule(rule)}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{ruleTypeLabel(rule.type)}</p>
                      {problems.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-amber-900">
                          {problems.map(problem => <li key={problem}>{problem}</li>)}
                        </ul>
                      )}
                      {!editable && generated && (
                        <div className="mt-2">
                          <RuleConfigDetails
                            explanation={typeof rule.params.explanation === 'string' ? rule.params.explanation : null}
                            expression={String(rule.params.mode === 'query' ? rule.params.query ?? '' : rule.params.failWhen ?? '')}
                          />
                        </div>
                      )}
                    </div>

                    {editable && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <label className="mr-1 inline-flex cursor-pointer items-center gap-1 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={event => onToggle?.(rule, event.target.checked)}
                            aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                          />
                          On
                        </label>
                        <button type="button" onClick={() => onSwap?.(rule, members[index - 1])} disabled={index === 0}
                          aria-label={`Move ${rule.name} up`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onSwap?.(rule, members[index + 1])} disabled={index === members.length - 1}
                          aria-label={`Move ${rule.name} down`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onEdit?.(rule)} aria-label={`Edit ${rule.name}`}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-100">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onDuplicate?.(rule)} disabled={!canAdd}
                          aria-label={`Duplicate ${rule.name}`} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                          <Copy className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onRemove?.(rule)} aria-label={`Delete ${rule.name}`}
                          className="rounded p-1.5 text-red-600 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
