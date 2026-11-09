import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, Info, Download, Shield } from 'lucide-react';
import { saveBlob } from '../../services/download';
import { useLastData } from '../../services/hooks/useLastData';
import { apiRequest } from '../../services/http';
import { queryKeys } from '../../services/queryKeys';

//#region INTERFACES
type ControlStatus = 'Pass' | 'Review' | 'Info';

interface ComplianceControl {
  id: string;
  name: string;
  description: string;
  value: string;
  status: ControlStatus;
}

interface DefinitionRow {
  id: string;
  name: string;
  status: string;
  enabledRules: number;
  assignedUsers: number;
  uploads: number;
  passed: number;
  failed: number;
  passRate: number | null;
}

interface ComplianceReport {
  periodDays: number;
  from: string;
  generatedAt: string;
  controls: ComplianceControl[];
  definitions: DefinitionRow[];
}
//#endregion

const PERIOD_OPTIONS = [7, 30, 90, 365];

const useComplianceQuery = (days: number) =>
  useQuery({
    queryKey: queryKeys.compliance.report(days),
    queryFn: async () => (await apiRequest<{ report: ComplianceReport }>('/admin/compliance', { query: { days } })).report,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadReport = (report: ComplianceReport) => {
  const lines = [
    `Compliance report,generated ${report.generatedAt},period ${report.periodDays} days`,
    '',
    'Control,Status,Value,Description',
    ...report.controls.map(c => [c.name, c.status, c.value, c.description].map(csvCell).join(',')),
    '',
    'Definition,Status,Enabled rules,Assigned users,Uploads,Passed,Failed,Pass rate %',
    ...report.definitions.map(d => [d.name, d.status, d.enabledRules, d.assignedUsers, d.uploads, d.passed, d.failed, d.passRate ?? ''].map(csvCell).join(',')),
  ];
  saveBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `compliance-report-${report.generatedAt.slice(0, 10)}.csv`);
};

const STATUS_STYLES: Record<ControlStatus, { badge: string; icon: ReactNode }> = {
  Pass: { badge: 'bg-green-100 text-green-800', icon: <CheckCircle size={16} className="text-green-600" /> },
  Review: { badge: 'bg-yellow-100 text-yellow-800', icon: <AlertTriangle size={16} className="text-yellow-600" /> },
  Info: { badge: 'bg-blue-100 text-blue-800', icon: <Info size={16} className="text-blue-600" /> },
};

export default function Compliance() {
  const [periodDays, setPeriodDays] = useState(30);
  const reportQuery = useComplianceQuery(periodDays);
  // A failed refresh keeps showing the last loaded report (with an error banner).
  const report = useLastData(reportQuery.data) ?? null;
  const loading = reportQuery.isPending;
  const error = reportQuery.isError ? reportQuery.error.message || 'Failed to load compliance report' : null;
  const loadReport = () => { void reportQuery.refetch(); };
  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  if (loading && !report) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Compliance</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  const controls = report?.controls || [];
  const passCount = controls.filter(c => c.status === 'Pass').length;
  const reviewCount = controls.filter(c => c.status === 'Review').length;

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Compliance</h1>
          <p className="text-xs text-gray-500 mt-1">
            Operational control indicators from platform data. Use them as evidence for reviews, not as a regulatory certification.
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <select
            aria-label="Report period"
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            {PERIOD_OPTIONS.map(days => <option key={days} value={days}>Last {days} days</option>)}
          </select>
          <button
            onClick={() => report && downloadReport(report)}
            disabled={!report}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 justify-center disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex justify-between" role="alert">
          <span>{error}</span>
          <button onClick={loadReport} className="underline">Retry</button>
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
              <div className="p-2.5 rounded-md bg-green-50"><CheckCircle size={20} className="text-green-600" /></div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-gray-500">Controls passing</span>
                <span className="text-xl font-bold text-green-600">{passCount}</span>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
              <div className="p-2.5 rounded-md bg-yellow-50"><AlertTriangle size={20} className="text-yellow-600" /></div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-gray-500">Review required</span>
                <span className="text-xl font-bold text-yellow-600">{reviewCount}</span>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
              <div className="p-2.5 rounded-md bg-blue-50"><Shield size={20} className="text-blue-600" /></div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-gray-500">Generated</span>
                <span className="text-sm font-bold text-gray-900">{formatDateTime(report.generatedAt)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6">
            {controls.map(control => (
              <div key={control.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {STATUS_STYLES[control.status].icon}
                    <h3 className="font-semibold text-gray-900 text-sm">{control.name}</h3>
                  </div>
                  <span className={`px-2 text-xs leading-5 font-semibold rounded-full ${STATUS_STYLES[control.status].badge}`}>
                    {control.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">{control.description}</p>
                <p className="text-sm font-medium text-gray-900 mt-2">{control.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-4 sm:px-6 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Validation summary by definition</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Definition', 'Status', 'Enabled rules', 'Assigned users', 'Uploads', 'Passed', 'Failed', 'Pass rate'].map(header => (
                      <th key={header} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-sm">
                  {report.definitions.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No file definitions</td></tr>
                  ) : report.definitions.map(def => (
                    <tr key={def.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{def.name}</td>
                      <td className="px-4 py-3 text-gray-500">{def.status}</td>
                      <td className="px-4 py-3 text-gray-500">{def.enabledRules}</td>
                      <td className="px-4 py-3 text-gray-500">{def.assignedUsers}</td>
                      <td className="px-4 py-3 text-gray-500">{def.uploads}</td>
                      <td className="px-4 py-3 text-green-700">{def.passed}</td>
                      <td className="px-4 py-3 text-red-700">{def.failed}</td>
                      <td className="px-4 py-3 text-gray-900">{def.passRate === null ? '-' : `${def.passRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
