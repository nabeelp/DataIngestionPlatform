interface Props {
  naturalLanguageText?: string | null;
  explanation?: string | null;
  expression?: string | null;
  provenance?: unknown;
  examples?: unknown;
  /** Show the expression expanded (for a newly authored rule) instead of collapsed. */
  expanded?: boolean;
}

/**
 * Display the request and declarative SQL expression stored in a Natural Language RuleConfig.
 */
export default function RuleConfigDetails({
  naturalLanguageText,
  explanation,
  expression,
  provenance,
  examples,
  expanded = false,
}: Props) {
  const provenanceDetails = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? provenance as Record<string, unknown>
    : null;
  const exampleRows = Array.isArray(examples) ? examples.filter((example): example is Record<string, unknown> =>
    Boolean(example) && typeof example === 'object' && !Array.isArray(example)) : [];

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
      {provenanceDetails && (
        <details open={expanded}>
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Model provenance</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
            {['model', 'responseId', 'createdAt', 'promptSha256'].map(key => {
              const field = provenanceDetails[key];
              return typeof field === 'string' && field ? (
                <div key={key} className="contents">
                  <dt className="font-semibold">{key}</dt>
                  <dd className="break-all">{field}</dd>
                </div>
              ) : null;
            })}
          </dl>
        </details>
      )}
      {exampleRows.length > 0 && (
        <details open={expanded}>
          <summary className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none">Validated examples ({exampleRows.length})</summary>
          <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-2">Table</th><th className="p-2">Expected</th><th className="p-2">Source</th><th className="p-2">Values</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exampleRows.map((example, index) => (
                  <tr key={index}>
                    <td className="p-2">{typeof example.table === 'string' ? example.table : ''}</td>
                    <td className="p-2">{example.expectedValid === true ? 'Pass' : example.expectedValid === false ? 'Fail' : '—'}</td>
                    <td className="p-2 capitalize">{typeof example.source === 'string' ? example.source : '—'}</td>
                    <td className="p-2">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(example.values ?? {}, null, 2)}</pre>
                      {Array.isArray(example.relatedRows) && example.relatedRows.length > 0 && (
                        <div className="mt-1 border-t border-slate-100 pt-1">
                          <p className="font-semibold text-slate-500">Related rows</p>
                          <pre className="whitespace-pre-wrap">{JSON.stringify(example.relatedRows, null, 2)}</pre>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
