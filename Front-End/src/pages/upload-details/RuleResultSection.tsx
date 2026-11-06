import type { RuleResult } from './types';
import { statusTextClass } from './uploadDetailsModel';

const ErrorRow = ({ col, err, row, val }: { col: string; err: string; row?: number; val: string }) => (
  <tr className="text-[12px] text-gray-700">
    <td className="px-4 py-2 font-medium">{col}</td>
    <td className="px-4 py-2">{err}</td>
    <td className="px-4 py-2 text-[#991b1b] font-bold">{row ?? 'File-level'}</td>
    <td className="px-4 py-2 font-mono text-[11px]">{val}</td>
  </tr>
);

/** One validation check: a collapsed line when it passed, otherwise its issue count and sample issues. */
export default function RuleResultSection({ rule }: { rule: RuleResult }) {
  const isPassed = rule.status === 'Passed';
  const isWarning = rule.status === 'Warning';
  const isError = rule.status === 'Error';
  const samples = rule.errors?.slice(0, 10) ?? [];
  const issueCount = rule.errorCount ?? samples.length;
  const color = statusTextClass(rule.status);
  const badgeBackground = isPassed ? 'bg-[#f0fdf4]' :
    rule.status === 'Failed' || isError ? 'bg-[#fef2f2]' : 'bg-[#fffbeb]';

  if (isPassed) {
    return (
      <details className="rounded-lg border border-gray-200 bg-white px-5 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-emerald-700">
          {rule.title} <span className="ml-2 text-xs font-normal text-gray-500">{rule.type} · Passed</span>
        </summary>
        <p className="mt-2 text-xs text-gray-500">Completed in {rule.time || '0ms'} with no issues.</p>
      </details>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <h4 className={`text-[15px] font-bold ${color}`}>{rule.title}</h4>
          <span className="text-[11px] text-gray-400 font-medium">{rule.type}</span>
        </div>
        <span className={`${badgeBackground} ${color} text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight`}>
          {isError ? 'ERROR' : rule.status}
        </span>
      </div>
      {isError && (
        <p className="text-xs text-red-700 mb-2">This check could not complete. Review the issue details before retrying.</p>
      )}
      {!isPassed && (issueCount > 0 || samples.length > 0) && (
        <>
          <p className={`text-[13px] ${color} font-bold mb-1`}>{issueCount} {isWarning ? 'warning' : 'issue'}{issueCount !== 1 ? 's' : ''}</p>
          <p className="text-[11px] text-gray-400 mb-4">
            Sample {isWarning ? 'warnings' : 'issues'} (showing {samples.length} of {issueCount}):
          </p>

          <div className="overflow-x-auto border border-gray-100 rounded">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 text-[11px] text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">column</th>
                  <th className="px-4 py-2 font-medium">error</th>
                  <th className="px-4 py-2 font-medium">row / scope</th>
                  <th className="px-4 py-2 font-medium">value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {samples.map((err, idx) => (
                  <ErrorRow key={idx} col={err.column} err={err.error} row={err.rowNumber} val={err.value} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[10px] text-gray-300 mt-2">Executed in {rule.time || '0ms'}</p>
    </section>
  );
}
