import { useState, useEffect } from 'react';
import { getQueueStats, getProcessingFiles, ProcessingFile } from '../../services/adminApi';
import { Activity, AlertTriangle, Clock, CheckCircle, XCircle, PlayCircle, FileText } from 'lucide-react';

interface QueueStats {
  validation: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  delivery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  retry: { waiting: number; active: number; completed: number; failed: number; delayed: number };
}

export default function Monitoring() {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setError(null);
      const [statsData, filesData] = await Promise.all([
        getQueueStats(),
        getProcessingFiles()
      ]);
      setQueueStats(statsData);
      setProcessingFiles(filesData.files);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch monitoring data:', err);
      setError('Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'VALIDATING':
      case 'VALIDATION_IN_PROGRESS': return 'text-blue-600 bg-blue-50';
      case 'DELIVERING':
      case 'DELIVERY_IN_PROGRESS': return 'text-purple-600 bg-purple-50';
      case 'VALIDATION_QUEUED':
      case 'DELIVERY_QUEUED': return 'text-yellow-600 bg-yellow-50';
      case 'VALIDATION_COMPLETED': return 'text-green-600 bg-green-50';
      case 'QUEUED': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const formatTime = (dateString: string | null | undefined) => {
    if (!dateString) {
      return '-';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Monitoring</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Monitoring</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          {error}
        </div>
      )}

      {/* Queue Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Validation Queue */}
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity size={20} className="text-blue-600" />
            Validation Queue
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <QueueStatCard label="Waiting" value={queueStats?.validation.waiting || 0} icon={<Clock size={16} />} />
            <QueueStatCard label="Active" value={queueStats?.validation.active || 0} icon={<PlayCircle size={16} />} />
            <QueueStatCard label="Completed" value={queueStats?.validation.completed || 0} icon={<CheckCircle size={16} />} />
            <QueueStatCard label="Failed" value={queueStats?.validation.failed || 0} icon={<XCircle size={16} />} />
            <QueueStatCard label="Delayed" value={queueStats?.validation.delayed || 0} icon={<AlertTriangle size={16} />} />
          </div>
        </div>

        {/* Delivery Queue */}
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText size={20} className="text-purple-600" />
            Delivery Queue
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <QueueStatCard label="Waiting" value={queueStats?.delivery.waiting || 0} icon={<Clock size={16} />} />
            <QueueStatCard label="Active" value={queueStats?.delivery.active || 0} icon={<PlayCircle size={16} />} />
            <QueueStatCard label="Completed" value={queueStats?.delivery.completed || 0} icon={<CheckCircle size={16} />} />
            <QueueStatCard label="Failed" value={queueStats?.delivery.failed || 0} icon={<XCircle size={16} />} />
            <QueueStatCard label="Delayed" value={queueStats?.delivery.delayed || 0} icon={<AlertTriangle size={16} />} />
          </div>
        </div>
      </div>

      {/* Processing Files */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Files in Progress</h2>
        </div>
        
        {processingFiles.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No files currently being processed
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processing Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploaded</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {processingFiles.map((file) => (
                  <tr key={file.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 truncate max-w-xs">
                        {file.originalFilename}
                      </div>
                      <div className="text-xs text-gray-500">
                        {file.definitionName || 'Unknown Definition'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(file.status)}`}>
                        {file.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, file.progress || 0))}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{file.progress}%</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {file.stage.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {file.processingTimeFormatted || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatTime(file.uploadedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueStatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-gray-500">{icon}</span>
        <span className="text-xs text-gray-500 uppercase">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

