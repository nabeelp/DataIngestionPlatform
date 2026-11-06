// Dashboard stats and queue monitoring
import { getBaseUrl, getFetchOptions } from './shared';

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

export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await fetch(`${getBaseUrl()}/admin/stats`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch admin stats');
  }
  return data.stats;
};

export const getQueueStats = async (): Promise<{
  stats: QueueStats;
  recentUploadThroughput: RecentUploadThroughput;
}> => {
  const response = await fetch(`${getBaseUrl()}/admin/queue-stats`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch queue stats');
  }
  return {
    stats: data.stats,
    recentUploadThroughput: data.recentUploadThroughput,
  };
};
