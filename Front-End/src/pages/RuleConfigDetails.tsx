interface Props {
  naturalLanguageText?: string | null;
  explanation?: string | null;
  expression?: string | null;
  /** Show the expression expanded (for a newly authored rule) instead of collapsed. */
  expanded?: boolean;
}

/**
 * Display the request and declarative SQL expression stored in a Natural Language RuleConfig.
 */
export default function RuleConfigDetails({ naturalLanguageText, explanation, expression, expanded = false }: Props) {
  return (
    <div className="space-y-2 max-w-3xl">
      {naturalLanguageText && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Original request</p>
          <blockquote className="text-sm text-slate-700 border-l-2 border-violet-300 pl-3 whitespace-pre-wrap">{naturalLanguageText}</blockquote>
        </div>
      )}
      {explanation && (
        <details open={expanded} className="group">
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Rule explanation</summary>
          <p className="mt-1 bg-slate-100 text-slate-800 p-3 rounded-lg text-xs whitespace-pre-wrap">{explanation}</p>
        </details>
      )}
      {expression && (
        <details open={expanded}>
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Validated SQL expression</summary>
          <pre className="mt-1 bg-slate-900 text-emerald-400 p-3 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto">{expression}</pre>
        </details>
      )}
    </div>
  );
}
