import { useState, useEffect, type ReactNode } from 'react';
import { Activity, AlertTriangle, Clock, PlayCircle, FileText } from 'lucide-react';
import { getQueueStats, type QueueStats, type RecentUploadThroughput } from '../../services/adminApi';

export default function Monitoring() {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [throughput, setThroughput] = useState<RecentUploadThroughput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setError(null);
      const data = await getQueueStats();
      setQueueStats(data.stats);
      setThroughput(data.recentUploadThroughput);
      setLastRefresh(new Date());
    } catch {
      setError('Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Monitoring</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Monitoring</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Last updated: {lastRefresh.toLocaleTimeString()}</span>
          <button
            onClick={() => void fetchData()}
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

      {queueStats && !queueStats.available && (
        <div role="status" className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
          <AlertTriangle size={16} className="inline mr-2" />
          Service Bus queue-depth metrics are unavailable from the local emulator.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity size={20} className="text-blue-600" />
            Validation Queue
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <QueueStatCard
              label="Active messages"
              value={queueStats?.available ? queueStats.validation?.activeMessageCount ?? 0 : '—'}
              icon={<PlayCircle size={16} />}
            />
            <QueueStatCard
              label="Dead-letter messages"
              value={queueStats?.available ? queueStats.validation?.deadLetterMessageCount ?? 0 : '—'}
              icon={<AlertTriangle size={16} />}
            />
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText size={20} className="text-purple-600" />
            Delivery Queue
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <QueueStatCard
              label="Active messages"
              value={queueStats?.available ? queueStats.delivery?.activeMessageCount ?? 0 : '—'}
              icon={<PlayCircle size={16} />}
            />
            <QueueStatCard
              label="Dead-letter messages"
              value={queueStats?.available ? queueStats.delivery?.deadLetterMessageCount ?? 0 : '—'}
              icon={<AlertTriangle size={16} />}
            />
          </div>
        </div>
      </div>

      <section className="bg-white shadow rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent upload throughput</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QueueStatCard
            label={`Uploads in the last ${throughput?.windowMinutes ?? 60} minutes`}
            value={throughput?.uploads ?? 0}
            icon={<FileText size={16} />}
          />
          <QueueStatCard
            label="Uploads per minute"
            value={throughput?.uploadsPerMinute ?? 0}
            icon={<Clock size={16} />}
          />
        </div>
      </section>
    </div>
  );
}

function QueueStatCard({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) {
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
