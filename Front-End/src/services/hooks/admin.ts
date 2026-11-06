import { useQuery } from '@tanstack/react-query';
import { getAdminStats, getQueueStats } from '../admin/dashboard';
import { getAuditLogs, type AuditLogParams } from '../admin/auditLogs';
import { queryKeys } from '../queryKeys';

export const useAuditLogsQuery = (params: AuditLogParams) =>
  useQuery({ queryKey: queryKeys.auditLogs.list(params), queryFn: () => getAuditLogs(params), staleTime: 0 });

export const ADMIN_STATS_REFRESH_MS = 30_000;
export const QUEUE_STATS_REFRESH_MS = 10_000;

export const useAdminStatsQuery = () =>
  useQuery({
    queryKey: queryKeys.dashboard.adminStats(),
    queryFn: getAdminStats,
    staleTime: 0,
    refetchInterval: ADMIN_STATS_REFRESH_MS,
  });

export const useQueueStatsQuery = () =>
  useQuery({
    queryKey: queryKeys.dashboard.adminQueue(),
    queryFn: getQueueStats,
    staleTime: 0,
    refetchInterval: QUEUE_STATS_REFRESH_MS,
  });
