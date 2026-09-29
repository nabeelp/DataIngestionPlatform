interface Props {
  naturalLanguageText?: string | null;
  pseudocode?: string | null;
  generatedCode?: string | null;
  /** Show the pseudocode and code expanded (for a newly generated rule) instead of collapsed. */
  expanded?: boolean;
}

/**
 * The request a Natural Language rule was created from, the model's pseudocode, and the TypeScript the validation
 * engine runs.
 */
export default function GeneratedRuleDetails({ naturalLanguageText, pseudocode, generatedCode, expanded = false }: Props) {
  return (
    <div className="space-y-2 max-w-3xl">
      {naturalLanguageText && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Original request</p>
          <blockquote className="text-sm text-slate-700 border-l-2 border-violet-300 pl-3 whitespace-pre-wrap">{naturalLanguageText}</blockquote>
        </div>
      )}
      {pseudocode && (
        <details open={expanded} className="group">
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Pseudocode</summary>
          <pre className="mt-1 bg-slate-100 text-slate-800 p-3 rounded-lg text-xs whitespace-pre-wrap overflow-x-auto">{pseudocode}</pre>
        </details>
      )}
      {generatedCode && (
        <details open={expanded}>
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">TypeScript implementation</summary>
          <pre aria-label="TypeScript implementation" className="mt-1 bg-slate-900 text-emerald-400 p-3 rounded-lg text-xs overflow-x-auto">{generatedCode}</pre>
        </details>
      )}
    </div>
  );
}
