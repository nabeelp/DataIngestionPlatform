import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { ActivityLevel, ReviewActivity } from './ruleDraftApi';

interface Props {
  entries: ReviewActivity[];
  /** Whether the review is still running. */
  running: boolean;
  /** Milliseconds since the review started, for the running timer. */
  elapsedMs: number;
}

const ICONS: Record<ActivityLevel, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-slate-400' },
  success: { icon: CheckCircle2, className: 'text-emerald-600' },
  warning: { icon: AlertTriangle, className: 'text-amber-500' },
  error: { icon: XCircle, className: 'text-red-600' },
};

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Live activity of a natural-language rule review, so the admin can see the model working.
 */
export default function RuleReviewActivity({ entries, running, elapsedMs }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  if (entries.length === 0 && !running) return null;

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
        <span>Activity</span>
        {running && (
          <span className="flex items-center gap-1.5 normal-case font-medium text-blue-600" aria-hidden="true">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working… {Math.floor(elapsedMs / 1000)} s
          </span>
        )}
      </div>
      <ol ref={listRef} role="log" aria-live="polite" aria-label="Rule review activity" className="max-h-56 overflow-y-auto px-3 py-2 space-y-1.5 text-xs">
        {entries.map((entry, index) => {
          const { icon: Icon, className } = ICONS[entry.level] ?? ICONS.info;
          return (
            <li key={index} className="flex items-start gap-2">
              <span className="text-slate-400 tabular-nums w-12 shrink-0 text-right">{formatSeconds(entry.elapsedMs)}</span>
              <Icon className={`w-3.5 h-3.5 mt-px shrink-0 ${className}`} aria-label={entry.level} />
              <span className={entry.level === 'error' ? 'text-red-700' : 'text-slate-700'}>{entry.message}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
