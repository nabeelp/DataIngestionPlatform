//#region IMPORTS
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  UploadCloud, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  Download, 
  FileText,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { apiRequest } from '../services/http';
import { useAuth } from '../context/AuthContext';
import { roleBasePath } from '../config/routes';
//#endregion

//#region INTERFACES
interface FormattedUpload {
  id: string;
  filename: string;
  status: string;
  statusCode: string;
  info?: string;
  variant?: string;
  uploadedAt?: string;
}

interface PeriodMetric {
  current: number;
  previous: number;
}

interface DashboardData {
  periodDays: number;
  from: string;
  to: string;
  kpis: {
    totalDefinitions: number;
    activeDefinitions: number;
    uploads: PeriodMetric;
    failedUploads: PeriodMetric;
    pendingUploads: number;
    avgProcessingSeconds: PeriodMetric;
  };
  activity: { date: string; uploads: number; failed: number }[];
  topDefinitions: { id: string; name: string; uploads: number; successRate: number | null }[];
  outcomes: { successful: number; failed: number; inProgress: number };
  recentTasks: {
    id: string;
    uploadId: string;
    filename: string;
    type: 'Validation' | 'Delivery';
    status: 'Completed' | 'Processing' | 'Failed' | 'Pending';
    startedAt: string | null;
    durationSeconds: number | null;
  }[];
}
//#endregion

//#region API Functions
const fetchRecentUploads = async (limit: number = 5): Promise<FormattedUpload[]> => {
  const data = await apiRequest<{ uploads?: any[] }>(`/uploads/recent?limit=${limit}`);
  return (data.uploads || []).map((upload: any) => ({
    id: upload.Id || upload.id,
    filename: upload.OriginalFilename || upload.originalFilename,
    status: mapStatusToDisplay(upload.Status || upload.status),
    statusCode: upload.Status || upload.status,
    info: formatFileSize(upload.FileSize || upload.fileSize || 0) + ' • ' + formatDateTime(upload.UploadedAt || upload.uploadedAt),
    variant: getVariant(upload.Status || upload.status),
    uploadedAt: upload.UploadedAt || upload.uploadedAt,
  }));
};

const fetchDashboard = async (days: number): Promise<DashboardData> =>
  (await apiRequest<{ dashboard: DashboardData }>(`/uploads/dashboard?days=${days}`)).dashboard;
//#endregion

//#region Utility Functions
const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Processing',
    'VALIDATION_FAILED': 'Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'VALIDATED': 'Completed',
    'DELIVERY_QUEUED': 'Pending',
    'DELIVERY_IN_PROGRESS': 'Processing',
    'DELIVERED': 'Completed',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

const getVariant = (status: string): string => {
  const failedStatuses = ['VALIDATION_FAILED', 'DELIVERY_FAILED', 'Failed'];
  return failedStatuses.includes(status) ? 'failed' : 'success';
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const percentChange = ({ current, previous }: PeriodMetric): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

const formatShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const getGreeting = (): string => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

const exportActivityCsv = (dashboard: DashboardData) => {
  const lines = ['date,uploads,failed', ...dashboard.activity.map(day => `${day.date},${day.uploads},${day.failed}`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `upload-activity-${dashboard.activity[0]?.date || 'period'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Trend badge. `higherIsBetter` controls colour; the arrow follows the direction of change.
 */
const Trend = ({ metric, higherIsBetter, days }: { metric: PeriodMetric; higherIsBetter: boolean; days: number }) => {
  const change = percentChange(metric);
  if (change === null) {
    return <span className="text-[11px] text-slate-400">No data for previous {days} days</span>;
  }
  const good = change === 0 || (change > 0) === higherIsBetter;
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon className="w-3 h-3" /> {change > 0 ? '+' : ''}{change}% <span className="text-slate-400 font-normal">vs previous {days} days</span>
    </span>
  );
};

const formatDateTime = (dateString: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};
//#endregion

//#region MAIN DASHBOARD COMPONENT
const PERIOD_OPTIONS = [7, 14, 30];
const OUTCOME_COLORS = { successful: '#22c55e', failed: '#ef4444', inProgress: '#2563eb' };

export default function Dashboard() {
  //#region STATE
  const { user } = useAuth();
  const basePath = roleBasePath(user?.Role);
  const [periodDays, setPeriodDays] = useState(7);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentUploads, setRecentUploads] = useState<FormattedUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  //#endregion

  //#region EFFECTS
  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [uploadsData, dashboardData] = await Promise.all([
        fetchRecentUploads(5),
        fetchDashboard(periodDays),
      ]);
      setRecentUploads(uploadsData);
      setDashboard(dashboardData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);
  //#endregion

  if (loading && !dashboard) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700" role="alert">
        <p className="font-medium">Could not load your dashboard</p>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={loadDashboardData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md text-sm">Retry</button>
      </div>
    );
  }

  const { kpis } = dashboard;
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.email || '';
  const outcomeData = [
    { name: 'Successful', value: dashboard.outcomes.successful, color: OUTCOME_COLORS.successful },
    { name: 'Failed', value: dashboard.outcomes.failed, color: OUTCOME_COLORS.failed },
    { name: 'In progress', value: dashboard.outcomes.inProgress, color: OUTCOME_COLORS.inProgress },
  ];
  const outcomeTotal = outcomeData.reduce((sum, item) => sum + item.value, 0);
  const activityData = dashboard.activity.map(day => ({ ...day, label: formatShortDate(day.date) }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      
      {/* --- Top Header Section --- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{getGreeting()}{displayName ? `, ${displayName}` : ''}</h1>
          <p className="text-xs text-slate-500 mt-0.5">Here's what's happening with your File Uploads.</p>
        </div>
        
        <div className="flex items-center gap-3 self-end sm:self-auto">
          <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs font-medium text-slate-700">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="sr-only">Period</span>
            <select
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
              className="bg-transparent focus:outline-none"
            >
              {PERIOD_OPTIONS.map(days => (
                <option key={days} value={days}>Last {days} days</option>
              ))}
            </select>
            <span className="text-slate-400 hidden md:inline">
              {formatShortDate(dashboard.from)} - {formatShortDate(dashboard.to)}
            </span>
          </label>
          <button
            onClick={() => exportActivityCsv(dashboard)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white rounded-lg px-3 py-1.5 shadow-sm text-xs font-semibold"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800" role="status">
          Showing the last loaded data: {error}
        </div>
      )}

      {/* --- KPI Cards Row --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">File Definitions</span>
            <span className="text-2xl font-bold tracking-tight block">{kpis.totalDefinitions}</span>
            <span className="text-[11px] text-slate-400">{kpis.activeDefinitions} active</span>
          </div>
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Uploads</span>
            <span className="text-2xl font-bold tracking-tight block">{kpis.uploads.current}</span>
            <Trend metric={kpis.uploads} higherIsBetter days={dashboard.periodDays} />
          </div>
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Pending Uploads</span>
            <span className="text-2xl font-bold tracking-tight block">{kpis.pendingUploads}</span>
            <span className="text-[11px] text-slate-400">Queued or processing now</span>
          </div>
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <UploadCloud className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Failed Uploads</span>
            <span className="text-2xl font-bold tracking-tight block">{kpis.failedUploads.current}</span>
            <Trend metric={kpis.failedUploads} higherIsBetter={false} days={dashboard.periodDays} />
          </div>
          <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Avg. Processing Time</span>
            <span className="text-2xl font-bold tracking-tight block">{kpis.avgProcessingSeconds.current ? formatDuration(kpis.avgProcessingSeconds.current) : '-'}</span>
            <Trend metric={kpis.avgProcessingSeconds} higherIsBetter={false} days={dashboard.periodDays} />
          </div>
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* --- Middle Charts & Tasks Grid --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Upload Activity Graph */}
        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm lg:col-span-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900">Upload Activity</h2>
            <span className="text-xs text-slate-400">Daily</span>
          </div>
          <div className="h-48 w-full text-[11px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="#94a3b8" />
                <YAxis tickLine={false} axisLine={false} stroke="#94a3b8" allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="uploads" name="Uploads" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#uploadGradient)" />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={1.5} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center items-center gap-4 text-xs font-medium text-slate-600 mt-2">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-600 inline-block rounded-full"></span>Uploads</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 inline-block rounded-full"></span>Failed</span>
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm lg:col-span-8 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900">Recent Tasks</h2>
            <Link to={`${basePath}/history`} className="text-xs font-semibold text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            {dashboard.recentTasks.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-medium">No recent tasks found.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-100 text-xs font-semibold">
                    <th className="pb-3 pl-1 font-medium">Task</th>
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Started</th>
                    <th className="pb-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-700">
                  {dashboard.recentTasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50/40 transition-colors">
                      <td className="py-3 pl-1 flex items-center gap-3 max-w-[260px]">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${
                          task.type === 'Delivery' ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'
                        }`}>
                          {task.type === 'Delivery' ? <UploadCloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        </div>
                        <div className="truncate">
                          <Link to={`${basePath}/history/${task.uploadId}`} className="text-slate-900 font-bold text-[13px] leading-tight hover:text-blue-600 truncate block">
                            {task.filename}
                          </Link>
                        </div>
                      </td>
                      <td className="py-3 text-[13px] text-slate-900 font-semibold">{task.type}</td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                          {task.status === 'Completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500 fill-white" />}
                          {task.status === 'Failed' && <XCircle className="w-4 h-4 text-rose-500 fill-white" />}
                          {(task.status === 'Processing' || task.status === 'Pending') && <Clock className="w-4 h-4 text-blue-500" />}
                          {task.status}
                        </span>
                      </td>
                      <td className="py-3 text-[13px] text-slate-600 font-medium whitespace-nowrap">{task.startedAt ? formatDateTime(task.startedAt) : '-'}</td>
                      <td className="py-3 text-[13px] text-slate-900 font-semibold">{formatDuration(task.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* --- Bottom Breakdown Grid --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">Recent Uploads</h2>
            <Link to={`${basePath}/history`} className="text-xs font-medium text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto h-full">
            {recentUploads.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-medium">No uploads yet.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="pb-2 font-medium">File Name</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-medium text-slate-700">
                  {recentUploads.map((upload) => (
                    <tr key={upload.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 max-w-[170px]">
                        <Link to={`${basePath}/history/${upload.id}`} className="hover:text-blue-600 block truncate text-slate-900 font-semibold">
                          {upload.filename}
                        </Link>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{upload.info}</div>
                      </td>
                      <td className="py-2.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${upload.variant === 'failed' ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {upload.variant === 'failed' ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                          {upload.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">Top Definitions</h2>
            <Link to={`${basePath}/definitions`} className="text-xs font-medium text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            {dashboard.topDefinitions.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-medium">No uploads in this period.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="pb-2 font-medium">Definition</th>
                    <th className="pb-2 font-medium">Uploads</th>
                    <th className="pb-2 font-medium text-right">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-medium text-slate-700">
                  {dashboard.topDefinitions.map((def) => (
                    <tr key={def.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 text-slate-900 font-semibold">{def.name}</td>
                      <td className="py-3 text-slate-600">{def.uploads}</td>
                      <td className="py-3 text-right">
                        {def.successRate === null ? (
                          <span className="text-slate-400">In progress</span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-slate-500 font-medium">{def.successRate}%</span>
                            <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className={`h-full ${def.successRate >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${def.successRate}%` }}></div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="mb-2">
            <h2 className="text-sm font-bold text-slate-900">Uploads by Outcome</h2>
          </div>
          <div className="flex items-center justify-between gap-4 h-full">
            <div className="w-1/2 h-36 relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={outcomeTotal > 0 ? outcomeData : [{ name: 'None', value: 1, color: '#e2e8f0' }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={52}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {(outcomeTotal > 0 ? outcomeData : [{ name: 'None', value: 1, color: '#e2e8f0' }]).map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold text-slate-900 leading-none">{outcomeTotal}</span>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">Total</span>
              </div>
            </div>

            <div className="w-1/2 space-y-2.5 text-xs font-semibold text-slate-700">
              {outcomeData.map((item) => (
                <div key={item.name} className="flex items-start gap-2">
                  <span className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: item.color }}></span>
                  <div>
                    <div className="text-slate-900 font-bold">{item.name}</div>
                    <div className="text-[11px] text-slate-400 font-medium">
                      {item.value} ({outcomeTotal > 0 ? `${Math.round((item.value / outcomeTotal) * 1000) / 10}%` : '0%'})
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- Footer Status Line --- */}
      <div className="text-center text-[11px] text-slate-400 mt-8 font-medium">
        All times displayed in your local timezone
      </div>
    </div>
  );
}
//#endregion
