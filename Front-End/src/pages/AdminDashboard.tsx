import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Activity, Upload, AlertTriangle, FileText, Clock, ShieldCheck, List } from 'lucide-react';
import { getAdminStats, AdminStats } from '../services/adminApi';

//#region ADMIN MODULE NAVIGATION
const ADMIN_MODULES = [
  { path: '/admin/users', label: 'User Management', description: 'Manage users and permissions', icon: <Users size={24} /> },
  { path: '/admin/file-definitions', label: 'File Definitions', description: 'Manage file definitions', icon: <FileText size={24} /> },
  { path: '/admin/audit-logs', label: 'Audit Logs', description: 'View immutable audit trail', icon: <Clock size={24} /> },
  { path: '/admin/monitoring', label: 'Monitoring', description: 'System health and performance', icon: <Activity size={24} /> },
  { path: '/admin/compliance', label: 'Compliance', description: 'Validation and audit reports', icon: <ShieldCheck size={24} /> },
  { path: '/admin/lookups', label: 'Lookups', description: 'Reference value lists', icon: <List size={24} /> },
];
//#endregion

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getAdminStats();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    
    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Admin Dashboard</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  // Use real stats if available, otherwise show empty state
  const displayStats = stats || {
    totalUsers: 0,
    activeSessions: 0,
    todayUploads: 0,
    systemHealth: '0%',
    totalDefinitions: 0,
    filesInQueue: 0,
    filesValidating: 0,
    filesDelivering: 0,
  };

  return (
    <div className="w-full">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Admin Dashboard</h1>
      
      {error && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 mb-6 sm:mb-8">
        <StatCard 
          label="Total Users" 
          value={displayStats.totalUsers.toString()} 
          icon={<Users size={20} className="text-blue-600" />} 
        />
        <StatCard 
          label="Logins (last hour)"
          value={displayStats.activeSessions.toString()} 
          icon={<Activity size={20} className="text-green-600" />} 
        />
        <StatCard 
          label="Today's Uploads" 
          value={displayStats.todayUploads.toString()} 
          icon={<Upload size={20} className="text-blue-600" />} 
        />
        <StatCard 
          label="System Health" 
          value={displayStats.systemHealth} 
          icon={<AlertTriangle size={20} className={parseFloat(displayStats.systemHealth) >= 90 ? 'text-green-600' : 'text-yellow-600'} />} 
          status={parseFloat(displayStats.systemHealth) >= 90 ? 'success' : 'warning'}
        />
      </div>

      {/* File Processing Status */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">File Processing Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
          <StatCard 
            label="Files in Queue" 
            value={displayStats.filesInQueue.toString()} 
            icon={<Clock size={20} className="text-gray-600" />} 
          />
          <StatCard 
            label="Files Validating" 
            value={displayStats.filesValidating.toString()} 
            icon={<Activity size={20} className="text-blue-600" />} 
          />
          <StatCard 
            label="Files Delivering" 
            value={displayStats.filesDelivering.toString()} 
            icon={<Upload size={20} className="text-purple-600" />} 
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Admin Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {ADMIN_MODULES.map((module) => (
            <Link
              key={module.path}
              to={module.path}
              className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="p-4 sm:p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0 bg-blue-50 rounded-md p-2 sm:p-3">
                    {module.icon}
                  </div>
                  <div className="ml-3 sm:ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm sm:text-base font-medium text-gray-900 truncate">{module.label}</dt>
                      <dd className="mt-1 text-xs sm:text-sm text-gray-500">{module.description}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, status }: { label: string; value: string; icon: React.ReactNode; status?: string }) {
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0 bg-blue-50 rounded-md p-3">
            {icon}
          </div>
          <div className="ml-5 w-0 flex-1">
            <dt className="text-sm font-medium text-gray-500 truncate">{label}</dt>
            <dd className="flex items-baseline">
              <div className="text-2xl font-semibold text-gray-900">{value}</div>
              {status === 'success' && (
                <span className="ml-2 text-sm text-green-600">✓</span>
              )}
              {status === 'warning' && (
                <span className="ml-2 text-sm text-yellow-600">⚠</span>
              )}
            </dd>
          </div>
        </div>
      </div>
    </div>
  );
}
