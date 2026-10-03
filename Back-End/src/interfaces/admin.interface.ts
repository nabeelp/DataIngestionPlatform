/**
 * Admin Dashboard Interfaces
 * Centralized types for BE/FE consistency
 */

export interface AdminStats {
  totalUsers: number;
  activeSessions: number;
  todayUploads: number;
  systemHealth: string;  // e.g., "95%"
  totalDefinitions: number;
  filesInQueue: number;
  filesValidating: number;
  filesDelivering: number;
  queueStats: QueueStats;
  recentUploadThroughput: { windowMinutes: number; uploads: number; uploadsPerMinute: number };
}

export interface QueueStats {
  available: boolean;
  validation: { activeMessageCount: number; deadLetterMessageCount: number } | null;
  delivery: { activeMessageCount: number; deadLetterMessageCount: number } | null;
}
