import { apiConfig } from '../../config/api';
import { groupRulesBySheet } from '../uploadRuleGroups';
import RuleResultSection from './RuleResultSection';
import type { UploadDetail } from './types';
import { statusTextClass } from './uploadDetailsModel';

interface UploadValidationResultsProps {
  upload: Pick<UploadDetail, 'id' | 'rules' | 'sheets' | 'status'>;
  reportLoading: boolean;
  onDownloadReport: () => void;
}

/** Validation summary counters plus the checks grouped by sheet, with the issues report download. */
export function UploadValidationResults({ upload, reportLoading, onDownloadReport }: UploadValidationResultsProps) {
  const failedChecks = upload.rules.filter(rule => rule.status === 'Failed' || rule.status === 'Error').length;
  const warningChecks = upload.rules.filter(rule => rule.status === 'Warning').length;
  const passedChecks = upload.rules.filter(rule => rule.status === 'Passed').length;
  const affectedRows = new Set(upload.rules.flatMap(rule => rule.errors?.flatMap(issue => issue.rowNumber ?? []) ?? [])).size;

  return (
  <div className="space-y-6">
    <div className="flex justify-between items-center gap-4">
      <h2 className="text-xl font-bold text-[#1e293b]">Validation Results</h2>
      <a
        href={`${apiConfig.getBaseUrl()}/uploads/${encodeURIComponent(upload.id)}/report`}
        aria-disabled={reportLoading}
        onClick={event => {
          event.preventDefault();
          if (!reportLoading) onDownloadReport();
        }}
        className={`text-xs text-blue-600 hover:underline ${reportLoading ? 'opacity-50' : ''}`}
      >
        {reportLoading ? 'Downloading issues report...' : 'Download full issues report'}
      </a>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Validation summary">
      {[
        { label: 'Failed checks', value: failedChecks, style: 'text-red-700 bg-red-50 border-red-200' },
        { label: 'Warnings', value: warningChecks, style: 'text-amber-800 bg-amber-50 border-amber-200' },
        { label: 'Affected rows', value: affectedRows, style: 'text-slate-800 bg-slate-50 border-slate-200' },
        { label: 'Passed checks', value: passedChecks, style: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
      ].map(({ label, value, style }) => (
        <div key={label} className={`rounded-lg border p-3 ${style}`}>
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
      ))}
    </div>
    {groupRulesBySheet(upload.rules, upload.sheets, upload.status).map(group => (
      <section key={group.key} className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-700">
            {group.label} <span className="text-xs font-normal text-gray-400">{group.rules.length} check(s)</span>
          </h3>
          <span className={`text-[10px] ${statusTextClass(group.status)} font-bold uppercase`}>{group.status}</span>
        </div>
        {group.rules.map((rule, index) => <RuleResultSection key={index} rule={rule} />)}
      </section>
    ))}
  </div>
  );
}
