// Audit logs
import { getBaseUrl, getFetchOptions } from './shared';

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

export const getAuditLogs = async (params?: {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.userId) queryParams.append('userId', params.userId);
  if (params?.action) queryParams.append('action', params.action);
  if (params?.entityType) queryParams.append('entityType', params.entityType);
  if (params?.startDate) queryParams.append('startDate', params.startDate);
  if (params?.endDate) queryParams.append('endDate', params.endDate);

  const response = await fetch(
    `${getBaseUrl()}/admin/audit-logs?${queryParams}`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch audit logs');
  }

  return {
    ...data,
    logs: data.logs.map((log: any) => ({
      id: log.id ?? log.Id,
      userId: log.userId ?? log.UserId,
      action: log.action ?? log.Action,
      entityType: log.entityType ?? log.EntityType,
      entityId: log.entityId ?? log.EntityId,
      details: log.details ?? log.Details,
      ipAddress: log.ipAddress ?? log.IpAddress,
      userAgent: log.userAgent ?? log.UserAgent,
      timestamp: log.timestamp ?? log.Timestamp,
    })),
  };
};
