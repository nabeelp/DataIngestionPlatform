// =============================================================================
// Admin API Service - API calls for Admin Dashboard
// =============================================================================

import { apiConfig } from '../config/api';

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
  queueStats: {
    validation: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    delivery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    retry: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  };
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

export interface ProcessingFile {
  id: string;
  originalFilename: string;
  status: string;
  uploadedAt: string;
  definitionName: string | null;
  uploadedBy: string;
  progress: number;
  stage: string;
  processingTimeMs: number;
  processingTimeFormatted: string;
  errorMessage: string | null;
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
  validation: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  delivery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  retry: { waiting: number; active: number; completed: number; failed: number; delayed: number };
}> => {
  const response = await fetch(`${getBaseUrl()}/admin/queue-stats`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch queue stats');
  }
  return data.stats;
};

export const getProcessingFiles = async (): Promise<{
  files: ProcessingFile[];
  stuckJobs: {
    validationJobs: Array<{ jobId: string; uploadId: string; stuckDurationMs: number }>;
    deliveryJobs: Array<{ jobId: string; uploadId: string; stuckDurationMs: number }>;
  };
}> => {
  const response = await fetch(`${getBaseUrl()}/admin/processing-files`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch processing files');
  }
  return {
    ...data,
    files: data.files.map((file: any) => ({
      id: file.id ?? file.Id,
      originalFilename: file.originalFilename ?? file.OriginalFilename,
      status: file.status ?? file.Status,
      uploadedAt: file.uploadedAt ?? file.UploadedAt,
      definitionName: file.definitionName ?? file.DefinitionName,
      uploadedBy: file.uploadedBy ?? file.UploadedBy,
      progress: file.progress,
      stage: file.stage,
      processingTimeMs: file.processingTimeMs,
      processingTimeFormatted: file.processingTimeFormatted,
    })),
  };
};

// ============================================================================
// File Definitions (Admin)
// ============================================================================

export interface FileDefinitionColumn {
  name: string;
  type: string;
  required: boolean;
}

export interface FileDefinitionAdmin {
  id: string;
  name: string;
  description: string;
  columns: FileDefinitionColumn[];
  status: string;
  createdAt: string;
  updatedAt: string;
  templateFilename?: string;
}

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
  status?: string;
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
    status?: string;
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
export const uploadTemplate = async (definitionId: string, file: File): Promise<void> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/template-upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to upload template');
  }
};





