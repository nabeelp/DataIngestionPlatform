// =============================================================================
// Admin API Service - API calls for Admin Dashboard
// =============================================================================

import { apiConfig } from '../config/api';
import type { Column as ContractColumn, DefinitionContract, Table as ContractTable } from '../contracts/definition-contract';
import { apiRequest } from './http';

const getBaseUrl = () => apiConfig.getBaseUrl();

// ============================================================================
// Types
// ============================================================================

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

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

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

// ============================================================================
// API Methods
// ============================================================================

// Get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('token');
};

// Common fetch options
const getFetchOptions = (method: string, body?: any): RequestInit => {
  const token = getAuthToken();
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  return options;
};

// ============================================================================
// Dashboard Stats
// ============================================================================

export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await fetch(`${getBaseUrl()}/admin/stats`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch admin stats');
  }
  return data.stats;
};

// ============================================================================
// User Management
// ============================================================================

export const getUsers = async (params?: { page?: number; limit?: number; search?: string }): Promise<{
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.search) queryParams.append('search', params.search);

  const response = await fetch(
    `${getBaseUrl()}/admin/users?${queryParams}`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch users');
  }
  return data;
};

export const getUserById = async (id: string): Promise<AdminUser> => {
  const response = await fetch(`${getBaseUrl()}/admin/users/${id}`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch user');
  }
  return data.user;
};

export const createUser = async (userData: {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}): Promise<AdminUser> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users`,
    getFetchOptions('POST', userData)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to create user');
  }
  return data.user;
};

export const updateUser = async (id: string, updates: {
  firstName?: string;
  lastName?: string;
  role?: string;
  isActive?: boolean;
}): Promise<AdminUser> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}`,
    getFetchOptions('PUT', updates)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to update user');
  }
  return data.user;
};

export const unlockUser = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}/unlock`,
    getFetchOptions('POST')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to unlock user');
  }
};

export const deleteUser = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to delete user');
  }
};

// ============================================================================
// Audit Logs
// ============================================================================

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

export const getRecentAuditLogs = async (limit: number = 20): Promise<AuditLog[]> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/audit-logs/recent?limit=${limit}`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch recent audit logs');
  }
  return data.logs;
};

// ============================================================================
// Queue Monitoring
// ============================================================================

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

// ============================================================================
// File Definitions (Admin)
// ============================================================================

export type FileDefinitionColumn = Pick<ContractColumn, 'name'> & { type: string }
  & Partial<Omit<ContractColumn, 'name' | 'type'>>
  & { required: boolean };

/** A table for one workbook sheet (definitions with one table per sheet). */
export type FileDefinitionTable = Partial<Omit<ContractTable, 'sheet' | 'columns'>> & {
  sheet: string;
  columns: FileDefinitionColumn[];
};

export interface FileDefinitionAdmin {
  id: string;
  name: string;
  description: string;
  /** Single-table columns; empty when the definition has sheet tables. */
  columns: FileDefinitionColumn[];
  /** One table per workbook sheet; empty for single-table definitions. */
  tables?: FileDefinitionTable[];
  /** Full validation contract. Optional while older definitions are being migrated. */
  contract?: DefinitionContract | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  templateFilename?: string | null;
  deliveryFolder?: string | null;
  activeVersion?: { id: string; versionNumber: number; activatedAt: string } | null;
  hasUnpublishedChanges?: boolean;
}

export interface DefinitionVersionRule {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  severity: string;
  executionOrder: number;
  expression: string;
  /** Sheet table the rule applies to; null for single-table definitions. */
  table?: string | null;
  /** Natural Language rules only: the request the rule was created from. */
  naturalLanguageText?: string | null;
}

export interface DefinitionVersion {
  id: string;
  versionNumber: number;
  status: 'Active' | 'Superseded';
  columns: FileDefinitionColumn[];
  tables?: FileDefinitionTable[];
  contract?: DefinitionContract;
  rules: DefinitionVersionRule[];
  definitionMetadata: DefinitionMetadataSnapshot | null;
  changeNote: string | null;
  createdByName: string | null;
  activatedAt: string;
  supersededAt: string | null;
}

export interface DefinitionMetadataSnapshot {
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
  deliveryFolder: string | null;
  templateFilename: string | null;
}

export interface ContractChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface DefinitionVersionHistory {
  activeVersionNumber: number | null;
  hasUnpublishedChanges: boolean;
  changes: { metadata: ContractChanges; columns: ContractChanges; rules: ContractChanges };
  versions: DefinitionVersion[];
}

/** A rule created together with a new definition, so version 1 publishes it. */
export interface InitialRule {
  name: string;
  ruleType: string;
  expression: string;
  severity: 'Error' | 'Warning';
  /** Sheet table the rule applies to (sheet-table definitions only). */
  table?: string | null;
}

export interface ExampleColumn extends FileDefinitionColumn {
  filledRows: number;
  sampleValues: string[];
}

export interface ExampleRuleSuggestion extends InitialRule {
  reason: string;
}

export interface ExampleSheet {
  /** Worksheet name; null for CSV files, which have no sheets. */
  name: string | null;
  headerRow: number | null;
  rowsAnalyzed: number;
  truncated: boolean;
  columns: ExampleColumn[];
  suggestedRules: ExampleRuleSuggestion[];
  warnings: string[];
}

export interface ExampleAnalysis {
  fileName: string;
  fileType: 'csv' | 'xlsx';
  sheets: ExampleSheet[];
  warnings: string[];
}

/**
 * Analyze an example CSV/XLSX file and get proposed columns and rules. The server does not keep the file.
 */
export const analyzeExampleFile = async (file: File): Promise<ExampleAnalysis> => {
  const formData = new FormData();
  formData.append('file', file);
  const token = getAuthToken();

  const response = await fetch(`${getBaseUrl()}/admin/file-definitions/analyze-example`, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : undefined,
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to analyze the example file');
  }
  return { fileName: data.fileName, fileType: data.fileType, sheets: data.sheets, warnings: data.warnings || [] };
};

export const getFileDefinitionVersions = (definitionId: string): Promise<DefinitionVersionHistory> =>
  apiRequest<DefinitionVersionHistory>(`/admin/file-definitions/${encodeURIComponent(definitionId)}/versions`);

export const publishFileDefinitionVersion = async (definitionId: string, changeNote?: string): Promise<DefinitionVersion> => {
  const data = await apiRequest<{ version: DefinitionVersion }>(
    `/admin/file-definitions/${encodeURIComponent(definitionId)}/versions`,
    { method: 'POST', body: { changeNote: changeNote?.trim() || null } }
  );
  return data.version;
};

export const removeTemplate = async (definitionId: string): Promise<void> => {
  await apiRequest<{ success: true }>(
    `/admin/file-definitions/${encodeURIComponent(definitionId)}/template`,
    { method: 'DELETE' }
  );
};

export const getFileDefinitionsAdmin = async (): Promise<{
  definitions: FileDefinitionAdmin[];
  total: number;
}> => {
  const response = await fetch(`${getBaseUrl()}/admin/file-definitions`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch file definitions');
  }
  return data;
};

export const createFileDefinitionAdmin = async (defData: {
  name: string;
  description?: string;
  columns: FileDefinitionColumn[];
  tables?: FileDefinitionTable[];
  contract?: DefinitionContract;
  status?: string;
  deliveryFolder?: string | null;
  rules?: InitialRule[];
}): Promise<FileDefinitionAdmin> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions`,
    getFetchOptions('POST', defData)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to create file definition');
  }
  return data.definition;
};

export const updateFileDefinitionAdmin = async (
  id: string,
  updates: {
    name?: string;
    description?: string;
    columns?: FileDefinitionColumn[];
    tables?: FileDefinitionTable[];
    contract?: DefinitionContract;
    status?: string;
    deliveryFolder?: string | null;
  }
): Promise<FileDefinitionAdmin> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${id}`,
    getFetchOptions('PUT', updates)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to update file definition');
  }
  return data.definition;
};

export const deleteFileDefinitionAdmin = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${id}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to delete file definition');
  }
};

// ============================================================================
// File Definition User Access Management (Admin)
// ============================================================================

/**
 * Get users assigned to a file definition
 */
export const getFileDefinitionUsers = async (definitionId: string): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch users for file definition');
  }
  return data;
};

/**
 * Add users to file definition
 */
export const addUsersToFileDefinition = async (
  definitionId: string,
  userIds: string[]
): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users`,
    getFetchOptions('POST', { userIds })
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to add users to file definition');
  }
  return data;
};

/**
 * Remove user from file definition
 */
export const removeUserFromFileDefinition = async (
  definitionId: string,
  userId: string
): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users/${userId}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to remove user from file definition');
  }
  return data;
};

/**
 * Get all available users for assignment dropdown
 */
export const getAvailableUsers = async (): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/users/all`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch available users');
  }
  return data;
};

/**
 * Get user counts for all file definitions
 */
export const getFileDefinitionUserCounts = async (): Promise<Record<string, number>> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/users/counts`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch user counts');
  }
  return data.counts;
};

// ============================================================================
// User File Definitions Management (Admin)
// ============================================================================

/**
 * Get file definitions for specific user
 */
export const getUserFileDefinitions = async (userId: string): Promise<{ definitions: FileDefinitionAdmin[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${userId}/file-definitions`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch user file definitions');
  }
  return data;
};

/**
 * Assign file definitions to user
 */
export const assignFileDefinitionsToUser = async (
  userId: string,
  definitionIds: string[]
): Promise<{ definitions: FileDefinitionAdmin[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${userId}/file-definitions`,
    getFetchOptions('POST', { fileDefinitionIds: definitionIds })
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to assign file definitions to user');
  }
  return data;
};

/**
 * Remove file definition from user
 */
export const removeFileDefinitionFromUser = async (
  userId: string,
  definitionId: string
): Promise<{ definitions: FileDefinitionAdmin[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${userId}/file-definitions/${definitionId}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to remove file definition from user');
  }
  return data;
};

// ============================================================================
// Type extensions for access management
// ============================================================================

export interface IFileDefinitionUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Export file definition as JSON download
 */
export const exportFileDefinition = async (definitionId: string): Promise<void> => {
  try {
    const response = await fetch(
      `${getBaseUrl()}/admin/file-definitions/${definitionId}/export`,
      getFetchOptions('GET')
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to export file definition');
    }

    const content = await response.json();
    const filename = `${content.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-definition.json`;
    
    // Create blob and trigger download
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed:', error);
    throw new Error(error instanceof Error ? error.message : 'Export failed');
  }
};

/**
 * Upload template file (admin)
 */
export const uploadTemplate = async (definitionId: string, file: File): Promise<{ templateFilename: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  const token = getAuthToken();

  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${encodeURIComponent(definitionId)}/template-upload`,
    {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : undefined,
      body: formData,
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to upload template');
  }
  return { templateFilename: data.templateFilename };
};
