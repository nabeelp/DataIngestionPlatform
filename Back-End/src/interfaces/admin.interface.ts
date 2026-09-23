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
  queueStats: {
    validation: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    delivery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    retry: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  };
}

export interface QueueStats {
  validation: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  delivery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  retry: { waiting: number; active: number; completed: number; failed: number; delayed: number };
}

export interface ProcessingFile {
  id: string;
  originalFilename: string;
  status: string;
  uploadedAt: string;
  definitionName?: string | null;
  uploadedBy: string;
  progress: number;
  stage: string;
  processingTimeMs: number;
  processingTimeFormatted: string;
  errorMessage?: string | null;
}

export interface StuckJob {
  jobId: string;
  uploadId: string;
  stuckDurationMs: number;
  startedAt: number;
}

export interface AdminHealthMetrics {
  cpuUsage: number;
  memoryUsage: number;
  dbConnections: number;
  redisConnections: number;
  responseTimeMs: number;
  errorRate: number;
  uptime: number;  // seconds
}

