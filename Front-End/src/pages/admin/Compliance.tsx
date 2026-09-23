import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, FileText, Shield } from 'lucide-react';

//#region INTERFACES
interface Report {
  id: string;
  type: string;
  period: string;
  status: string;
  generatedAt: string;
}
//#endregion

//#region MOCK DATA
const MOCK_REPORTS: Report[] = [
  { id: 'rpt_001', type: 'GDPR Data Processing', period: 'Q1 2024', status: 'Compliant', generatedAt: '2024-01-15T00:00:00Z' },
  { id: 'rpt_002', type: 'GDPR Data Processing', period: 'Q4 2023', status: 'Compliant', generatedAt: '2024-01-10T00:00:00Z' },
  { id: 'rpt_003', type: 'POPIA Assessment', period: 'January 2024', status: 'Compliant', generatedAt: '2024-01-12T00:00:00Z' },
  { id: 'rpt_004', type: 'SOX Financial Controls', period: '2023 Annual', status: 'Review Required', generatedAt: '2024-01-08T00:00:00Z' },
  { id: 'rpt_005', type: 'Access Control Audit', period: 'Q1 2024', status: 'Compliant', generatedAt: '2024-01-14T00:00:00Z' },
  { id: 'rpt_006', type: 'Data Retention Policy', period: 'January 2024', status: 'Review Required', generatedAt: '2024-01-11T00:00:00Z' },
];
//#endregion

export default function Compliance() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setReports(MOCK_REPORTS);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    if (status === 'Compliant') return 'bg-green-100 text-green-800';
    if (status === 'Review Required') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const compliantCount = reports.filter(r => r.status === 'Compliant').length;
  const reviewRequiredCount = reports.filter(r => r.status === 'Review Required').length;

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Compliance</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Compliance</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 w-full sm:w-auto justify-center">
          <Shield size={16} />
          Generate Report
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
          <div className="p-2.5 rounded-md bg-green-50 flex items-center justify-center">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-gray-500">Compliant</span>
            <span className="text-xl font-bold text-green-600">{compliantCount}</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
          <div className="p-2.5 rounded-md bg-yellow-50 flex items-center justify-center">
            <AlertTriangle size={20} className="text-yellow-600" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-gray-500">Review Required</span>
            <span className="text-xl font-bold text-yellow-600">{reviewRequiredCount}</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center gap-4">
          <div className="p-2.5 rounded-md bg-blue-50 flex items-center justify-center">
            <FileText size={20} className="text-blue-600" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-gray-500">Total Reports</span>
            <span className="text-xl font-bold text-gray-900">{reports.length}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-blue-600" />
            <h3 className="font-semibold text-gray-900">GDPR</h3>
          </div>
          <p className="text-sm text-gray-500">General Data Protection Regulation</p>
          <div className="mt-3 flex items-center gap-2">
            <CheckCircle size={14} className="text-green-600" />
            <span className="text-sm text-green-600">Fully Compliant</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-blue-600" />
            <h3 className="font-semibold text-gray-900">POPIA</h3>
          </div>
          <p className="text-sm text-gray-500">Protection of Personal Information Act</p>
          <div className="mt-3 flex items-center gap-2">
            <CheckCircle size={14} className="text-green-600" />
            <span className="text-sm text-green-600">Fully Compliant</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-blue-600" />
            <h3 className="font-semibold text-gray-900">SOX</h3>
          </div>
          <p className="text-sm text-gray-500">Sarbanes-Oxley Act</p>
          <div className="mt-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-yellow-600" />
            <span className="text-sm text-yellow-600">Review Required</span>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Report Type</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Generated</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reports.map((report) => (
                <tr key={report.id}>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">{report.type}</span>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">{report.period}</td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(report.status)}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(report.generatedAt)}</td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm">
                    <button className="text-blue-600 hover:text-blue-900 mr-2 sm:mr-3">View</button>
                    <button className="text-gray-600 hover:text-gray-900">Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

