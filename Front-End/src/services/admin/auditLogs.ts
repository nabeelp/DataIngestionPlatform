// Audit logs
import { apiRequest } from '../http';

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

/** The audit log entity as the API returns it. */
interface AuditLogRow {
  Id: string;
  UserId: string | null;
  Action: string;
  EntityType: string | null;
  EntityId: string | null;
  Details: Record<string, unknown> | null;
  IpAddress: string | null;
  UserAgent: string | null;
  Timestamp: string;
}

export interface AuditLogParams {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditLogPage {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export const mapAuditLog = (row: AuditLogRow): AuditLog => ({
  id: row.Id,
  userId: row.UserId,
  action: row.Action,
  entityType: row.EntityType,
  entityId: row.EntityId,
  details: row.Details,
  ipAddress: row.IpAddress,
  userAgent: row.UserAgent,
  timestamp: row.Timestamp,
});

export const getAuditLogs = async (params?: AuditLogParams): Promise<AuditLogPage> => {
  const data = await apiRequest<Omit<AuditLogPage, 'logs'> & { logs: AuditLogRow[] }>('/admin/audit-logs', {
    query: { ...params },
    fallbackMessage: 'Failed to fetch audit logs',
  });
  return { ...data, logs: data.logs.map(mapAuditLog) };
};
