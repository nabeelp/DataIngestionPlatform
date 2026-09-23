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
import { apiConfig } from '../config/api';
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

interface TaskItem {
  id: string;
  title: string;
  filename: string;
  type: 'Validation' | 'Upload';
  status: 'Completed' | 'Processing' | 'Failed' | 'Pending';
  started: string;
  duration: string;
}
//#endregion

//#region HARDCODED MOCK DATA (For layout preservation)
const uploadActivityData = [
  { date: 'May 23', uploads: 12 },
  { date: 'May 24', uploads: 19 },
  { date: 'May 25', uploads: 8 },
  { date: 'May 26', uploads: 22 },
  { date: 'May 27', uploads: 16 },
  { date: 'May 28', uploads: 25 },
  { date: 'May 29', uploads: 24 },
];

const topDefinitions = [
  { name: 'Customer Master', uploads: 8, rate: 100, color: 'bg-emerald-500' },
  { name: 'Daily Forex Rates', uploads: 6, rate: 83.3, color: 'bg-emerald-500' },
  { name: 'Product Master', uploads: 4, rate: 100, color: 'bg-emerald-500' },
  { name: 'Market Prices', uploads: 3, rate: 66.7, color: 'bg-amber-500' },
  { name: 'Sales Transactions', uploads: 3, rate: 100, color: 'bg-emerald-500' },
];

const pieData = [
  { name: 'Validation', value: 16, percentage: '66.7%', color: '#2563eb' },
  { name: 'Delivery', value: 5, percentage: '20.8%', color: '#22c55e' },
  { name: 'Upload', value: 3, percentage: '12.5%', color: '#eab308' },
];
//#endregion

//#region API Functions
const fetchRecentUploads = async (limit: number = 5): Promise<FormattedUpload[]> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  const response = await fetch(`${baseUrl}/uploads/recent?limit=${limit}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch recent uploads');
  }
  
  const data = await response.json();
  
  if (data.success && data.uploads) {
    return data.uploads.map((upload: any) => ({
      id: upload.Id || upload.id,
      filename: upload.OriginalFilename || upload.originalFilename,
      status: mapStatusToDisplay(upload.Status || upload.status),
      statusCode: upload.Status || upload.status,
      info: formatFileSize(upload.FileSize || upload.fileSize || 0) + ' • ' + formatDateTime(upload.UploadedAt || upload.uploadedAt),
      variant: getVariant(upload.Status || upload.status),
      uploadedAt: upload.UploadedAt || upload.uploadedAt,
    }));
  }
  
  return [];
};

const fetchDefinitionStats = async (): Promise<{ totalDefinitions: number; activeDefinitions: number }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  try {
    const response = await fetch(`${baseUrl}/definitions/stats`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch definition stats');
    }
    
    const data = await response.json();
    
    if (data.success) {
      return {
        totalDefinitions: data.totalDefinitions || 0,
        activeDefinitions: data.activeDefinitions || 0,
      };
    }
  } catch (error) {
    console.error('Error fetching definition stats:', error);
  }
  
  return { totalDefinitions: 0, activeDefinitions: 0 };
};

const fetchStats = async (): Promise<{ totalDefinitions: number; activeDefinitions: number; pendingUploads: number; failedUploads: number }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  try {
    const response = await fetch(`${baseUrl}/uploads?pageSize=100`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch uploads');
    }
    
    const data = await response.json();
    
    if (data.success && data.uploads) {
      const uploads = data.uploads;
      const pendingUploads = uploads.filter((u: any) => {
        const status = u.Status || u.status;
        return status === 'UPLOADED' || status === 'VALIDATION_QUEUED' || status === 'VALIDATION_IN_PROGRESS' || status === 'DELIVERY_QUEUED';
      }).length;
      
      const failedUploads = uploads.filter((u: any) => {
        const status = u.Status || u.status;
        return status === 'VALIDATION_FAILED' || status === 'DELIVERY_FAILED';
      }).length;
      
      const definitionStats = await fetchDefinitionStats();
      
      return {
        totalDefinitions: definitionStats.totalDefinitions,
        activeDefinitions: definitionStats.activeDefinitions,
        pendingUploads,
        failedUploads,
      };
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
  }
  
  return { totalDefinitions: 0, activeDefinitions: 0, pendingUploads: 0, failedUploads: 0 };
};
//#endregion

//#region Utility Functions
const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Processing',
    'VALIDATION_FAILED': 'Failed',
    'VALIDATION_PASSED': 'Validation Passed',
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
export default function Dashboard() {
  //#region STATE
  const [stats, setStats] = useState({ totalDefinitions: 0, activeDefinitions: 0, pendingUploads: 0, failedUploads: 0 });
  const [recentUploads, setRecentUploads] = useState<FormattedUpload[]>([]);
  const [recentTasks, setRecentTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  //#endregion

  //#region EFFECTS
  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [uploadsData, statsData] = await Promise.all([
        fetchRecentUploads(5),
        fetchStats(),
      ]);
      
      setRecentUploads(uploadsData);
      setStats(statsData);
      
      // Transform incoming uploads to populate structural tasks schema matching image_6b5bc7.png
      const tasks: TaskItem[] = uploadsData.flatMap((upload, idx) => {
        const sequentialId = uploadsData.length - idx + 120; // Example placeholder counter
        const timeFormatted = upload.uploadedAt ? formatDateTime(upload.uploadedAt) : 'May 29, 12:00 PM';
        
        const tasksArray: TaskItem[] = [];

        // Generate dynamic Upload Task
        if (upload.statusCode.includes('UPLOAD') || upload.statusCode.includes('DELIVERED') || upload.statusCode.includes('PASSED')) {
          tasksArray.push({
            id: `${upload.id}-upload`,
            title: `Upload #${sequentialId}`,
            filename: upload.filename,
            type: 'Upload',
            status: upload.statusCode === 'UPLOADED' ? 'Processing' : 'Completed',
            started: timeFormatted,
            duration: '32s' // Dynamic backend fallback placeholder
          });
        }

        // Generate dynamic Validation Task
        tasksArray.push({
          id: `${upload.id}-validation`,
          title: `Validation #${sequentialId + 1}`,
          filename: upload.filename,
          type: 'Validation',
          status: upload.statusCode === 'VALIDATION_FAILED' 
            ? 'Failed' 
            : upload.statusCode === 'VALIDATION_IN_PROGRESS' ? 'Processing' : 'Completed',
          started: timeFormatted,
          duration: upload.statusCode === 'VALIDATION_FAILED' ? '12s' : '27s' 
        });

        return tasksArray;
      });

      // Keep up to 5 items to match card visualization length precisely
      setRecentTasks(tasks.slice(0, 5));
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);
  //#endregion

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      
      {/* --- Top Header Section --- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Good morning, Chulumanco Poswa</h1>
          <p className="text-xs text-slate-500 mt-0.5">Here's what's happening with your File Uploads.</p>
        </div>
        
        <div className="flex items-center gap-3 self-end sm:self-auto">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs font-medium text-slate-700">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span>May 23 - May 29, 2026</span>
          </div>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white rounded-lg px-3 py-1.5 shadow-sm text-xs font-semibold">
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* --- KPI Cards Row --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Total File Definitions</span>
            <span className="text-2xl font-bold tracking-tight block">{stats.totalDefinitions}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <TrendingUp className="w-3 h-3" /> +26.3% <span className="text-slate-400 font-normal">vs last 7 days</span>
            </span>
          </div>
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Active File Definitions</span>
            <span className="text-2xl font-bold tracking-tight block">{stats.activeDefinitions}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <TrendingUp className="w-3 h-3" /> +20.0% <span className="text-slate-400 font-normal">vs last 7 days</span>
            </span>
          </div>
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Pending Uploads</span>
            <span className="text-2xl font-bold tracking-tight block">{stats.pendingUploads}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600">
              <TrendingDown className="w-3 h-3" /> -33.3% <span className="text-slate-400 font-normal">vs last 7 days</span>
            </span>
          </div>
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <UploadCloud className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Failed Uploads</span>
            <span className="text-2xl font-bold tracking-tight block">{stats.failedUploads}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600">
              <TrendingUp className="w-3 h-3" /> +100% <span className="text-slate-400 font-normal">vs last 7 days</span>
            </span>
          </div>
          <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-start justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 block">Avg. Processing Time</span>
            <span className="text-2xl font-bold tracking-tight block">23s</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <TrendingDown className="w-3 h-3" /> -8.0% <span className="text-slate-400 font-normal">vs last 7 days</span>
            </span>
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
            <select className="text-xs font-medium border border-slate-200 rounded px-2 py-1 bg-slate-50 text-slate-600 focus:outline-none">
              <option>Daily</option>
            </select>
          </div>
          <div className="h-48 w-full text-[11px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={uploadActivityData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} stroke="#94a3b8" />
                <YAxis tickLine={false} axisLine={false} stroke="#94a3b8" domain={[0, 40]} tickCount={5} />
                <Tooltip />
                <Area 
                  type="monotone" 
                  dataKey="uploads" 
                  stroke="#2563eb" 
                  strokeWidth={2} 
                  fillOpacity={1} 
                  fill="url(#uploadGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center items-center gap-1.5 text-xs font-medium text-slate-600 mt-2">
            <span className="w-3 h-0.5 bg-blue-600 inline-block rounded-full"></span>
            <span>Uploads</span>
          </div>
        </div>

        {/* --- REFACTORED RECENT TASKS PANEL (Matches image_6b5bc7.png) --- */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm lg:col-span-8 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900">Recent Tasks</h2>
            <button className="text-xs font-semibold text-blue-600 hover:underline">View all</button>
          </div>
          <div className="overflow-x-auto">
            {recentTasks.length === 0 ? (
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
                  {recentTasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50/40 transition-colors">
                      {/* Left Block Task Identification with Icon */}
                      <td className="py-3 pl-1 flex items-center gap-3 max-w-[260px]">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${
                          task.type === 'Upload' ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'
                        }`}>
                          {task.type === 'Upload' ? <UploadCloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        </div>
                        <div className="truncate">
                          <div className="text-slate-900 font-bold text-[13px] leading-tight">{task.title}</div>
                          <div className="text-xs text-slate-400 truncate font-normal mt-0.5">{task.filename}</div>
                        </div>
                      </td>
                      
                      {/* Task Segment Type */}
                      <td className="py-3 text-[13px] text-slate-900 font-semibold">{task.type}</td>
                      
                      {/* Strict Visual Status Badge Formatting */}
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                          {task.status === 'Completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500 fill-white" />}
                          {task.status === 'Failed' && <XCircle className="w-4 h-4 text-rose-500 fill-white" />}
                          {task.status === 'Processing' && <Clock className="w-4 h-4 text-blue-500" />}
                          {task.status}
                        </span>
                      </td>
                      
                      {/* Timestamps */}
                      <td className="py-3 text-[13px] text-slate-600 font-medium whitespace-nowrap">{task.started}</td>
                      
                      {/* Calculated Process Execution Duration */}
                      <td className="py-3 text-[13px] text-slate-900 font-semibold">{task.duration}</td>
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
            <Link to="/history" className="text-xs font-medium text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto h-full">
            {recentUploads.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-medium">No operational execution logs found.</div>
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
                        <Link to={`/history/${upload.id}`} className="hover:text-blue-600 block truncate text-slate-900 font-semibold">
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
            <button className="text-xs font-medium text-blue-600 hover:underline">View all</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Definition</th>
                  <th className="pb-2 font-medium">Uploads</th>
                  <th className="pb-2 font-medium text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 font-medium text-slate-700">
                {topDefinitions.map((def, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 text-slate-900 font-semibold">{def.name}</td>
                    <td className="py-3 text-slate-600">{def.uploads}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-slate-500 font-medium">{def.rate}%</span>
                        <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div className={`h-full ${def.color}`} style={{ width: `${def.rate}%` }}></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="mb-2">
            <h2 className="text-sm font-bold text-slate-900">Uploads by Type</h2>
          </div>
          <div className="flex items-center justify-between gap-4 h-full">
            <div className="w-1/2 h-36 relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={52}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold text-slate-900 leading-none">24</span>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">Total</span>
              </div>
            </div>

            <div className="w-1/2 space-y-2.5 text-xs font-semibold text-slate-700">
              {pieData.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: item.color }}></span>
                  <div>
                    <div className="text-slate-900 font-bold">{item.name}</div>
                    <div className="text-[11px] text-slate-400 font-medium">{item.value} ({item.percentage})</div>
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