// Dashboard stats and queue monitoring
import { apiRequest } from '../http';

// AdminStats type (matches BE interfaces/admin.interface.ts exactly)
export interface AdminStats {
  totalUsers: number;
  activeSessions: number;
  todayUploads: number;
  systemHealth: string;
  totalDefinitions: number;
  filesInQueue: number;
  filesValidating: number;
  filesDelivering: number;
  queueStats: QueueStats;
  recentUploadThroughput: RecentUploadThroughput;
}

export interface QueueStats {
  available: boolean;
  validation: { activeMessageCount: number; deadLetterMessageCount: number } | null;
  delivery: { activeMessageCount: number; deadLetterMessageCount: number } | null;
}

export interface RecentUploadThroughput {
  windowMinutes: number;
  uploads: number;
  uploadsPerMinute: number;
}

export const getAdminStats = async (): Promise<AdminStats> =>
  (await apiRequest<{ stats: AdminStats }>('/admin/stats', { fallbackMessage: 'Failed to fetch admin stats' })).stats;

export const getQueueStats = async (): Promise<{
  stats: QueueStats;
  recentUploadThroughput: RecentUploadThroughput;
}> => {
  const data = await apiRequest<{ stats: QueueStats; recentUploadThroughput: RecentUploadThroughput }>(
    '/admin/queue-stats',
    { fallbackMessage: 'Failed to fetch queue stats' },
  );
  return { stats: data.stats, recentUploadThroughput: data.recentUploadThroughput };
};
