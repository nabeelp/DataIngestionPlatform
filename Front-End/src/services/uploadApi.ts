/**
 * Upload API Service
 * Handles all upload-related API calls to the backend
 */

import { apiConfig } from '../config/api';

// ============================================================================
// Types
// ============================================================================

export type UploadStatus = 
  | 'UPLOADED'
  | 'VALIDATION_QUEUED'
  | 'VALIDATION_IN_PROGRESS'
  | 'VALIDATION_FAILED'
  | 'VALIDATION_PASSED'
  | 'VALIDATED'
  | 'DELIVERY_QUEUED'
  | 'DELIVERY_IN_PROGRESS'
  | 'DELIVERED'
  | 'DELIVERY_FAILED';

export type SheetStatus = 
  | 'PENDING'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'FAILED';

export interface IUpload {
  Id: string;
  FileDefinitionId: string;
  UploadedBy: string;
  OriginalFilename: string;
  StoredFilename: string;
  AzureBlobUrl: string | null;
  FileSize: number;
  FileType: string;
  CompressedFileSize: number | null;
  CompressedBlobUrl: string | null;
  RowCountNo: number | null;
  SheetCount: number | null;
  Status: UploadStatus;
  UploadedAt: string;
  ValidationStartedAt: string | null;
  ValidationCompletedAt: string | null;
  DeliveryStartedAt: string | null;
  DeliveryCompletedAt: string | null;
  ValidationJobId: string | null;
  DeliveryJobId: string | null;
  ProcessingNode: string | null;
  DeliveredTo: string | null;
  DeliveredAt: string | null;
  ErrorMessage: string | null;
}

export interface IUploadSheet {
  Id: string;
  UploadId: string;
  SheetIndex: number;
  SheetName: string;
  RowCountNo: number | null;
  Status: SheetStatus;
  ValidationProgress: number | null;
  ValidatedRules: number | null;
  TotalRules: number | null;
  DeliveryPath: string | null;
  DeliveredAt: string | null;
  ErrorMessage: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface IValidationResult {
  Id: string;
  UploadId: string;
  TotalRules: number;
  PassedRules: number;
  FailedRules: number;
  WarningRules: number;
  ProgressPercent: number;
  CurrentRule: string | null;
  Status: 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'WARNING';
  StartedAt: string | null;
  CompletedAt: string | null;
  TotalErrors: number;
  TotalWarnings: number;
  ErrorSummary: string | null;
}

export interface IValidationRuleDetail {
  Id: string;
  ValidationResultId: string;
  UploadId: string;
  RuleId: string;
  RuleName: string;
  RuleType: string;
  RuleSeverity: string;
  ExecutionOrder: number;
  Status: 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'WARNING';
  ExecutionTimeMs: number | null;
  ErrorCount: number;
  WarningCount: number;
  FailedRows: string | null;
  FailedRowsCount: number;
  SampleErrorValue: string | null;
  StartedAt: string | null;
  CompletedAt: string | null;
}

export interface IDeliveryRecord {
  Id: string;
  UploadId: string;
  UploadSheetId: string | null;
  DeliveryType: 'FabricLakehouse' | 'SQLTable' | 'SharePoint';
  DestinationPath: string;
  DestinationName: string | null;
  Status: 'PENDING' | 'IN_PROGRESS' | 'DELIVERED' | 'FAILED';
  ProgressPercent: number | null;
  StartedAt: string | null;
  CompletedAt: string | null;
  ErrorMessage: string | null;
  RecordsDelivered: number | null;
}

export interface IUploadsResponse {
  success: boolean;
  uploads: IUpload[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IUploadResponse {
  success: boolean;
  upload: IUpload;
}

export interface IUploadDetailResponse {
  success: boolean;
  upload: IUpload;
  sheets: IUploadSheet[];
  validationResult: IValidationResult | null;
  ruleDetails: IValidationRuleDetail[];
  deliveryRecords: IDeliveryRecord[];
}

export interface IUploadProgressResponse {
  success: boolean;
  uploadId: string;
  status: UploadStatus;
  progress: {
    validation: {
      percent: number;
      currentRule: string | null;
      passedRules: number;
      totalRules: number;
    } | null;
    delivery: {
      percent: number;
      recordsDelivered: number;
    } | null;
  };
}

export interface IApiError {
  success: false;
  message: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const error: IApiError = await response.json();
    throw new Error(error.message || `HTTP error ${response.status}`);
  }
  return response.json();
};

// ============================================================================
// Upload API Methods
// ============================================================================

/**
 * Get all uploads accessible to the user
 */
export const getUploads = async (params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<IUploadsResponse> => {
  const baseUrl = apiConfig.getBaseUrl();
  const queryParams = new URLSearchParams();
  
  if (params?.page) queryParams.set('page', params.page.toString());
  if (params?.pageSize) queryParams.set('pageSize', params.pageSize.toString());
  if (params?.status) queryParams.set('status', params.status);

  const url = `${baseUrl}/uploads${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<IUploadsResponse>(response);
};

/**
 * Get recent uploads for dashboard
 */
export const getRecentUploads = async (limit: number = 10): Promise<IUploadsResponse> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/recent?limit=${limit}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<IUploadsResponse>(response);
};

/**
 * Get single upload details
 */
export const getUploadById = async (id: string): Promise<IUploadDetailResponse> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<IUploadDetailResponse>(response);
};

/**
 * Get upload progress
 */
export const getUploadProgress = async (id: string): Promise<IUploadProgressResponse> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/${id}/progress`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<IUploadProgressResponse>(response);
};

/**
 * Upload a file
 */
export const uploadFile = async (file: File, definitionId: string): Promise<IUploadResponse> => {
  const baseUrl = apiConfig.getBaseUrl();
  const formData = new FormData();
  
  formData.append('file', file);
  formData.append('definitionId', definitionId);

  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
    },
    body: formData,
  });

  return handleResponse<IUploadResponse>(response);
};

/**
 * Start validation for an uploaded file
 */
export const startVerification = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/${id}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<{ success: boolean; message: string }>(response);
};

/**
 * Retry validation for a failed upload
 */
export const retryValidation = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/${id}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<{ success: boolean; message: string }>(response);
};

/**
 * Delete an upload
 */
export const deleteUpload = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return handleResponse<{ success: boolean; message: string }>(response);
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Map backend status to frontend display status
 */
export const mapStatusToDisplay = (status: UploadStatus): string => {
  const statusMap: Record<UploadStatus, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Validation In Progress',
    'VALIDATION_FAILED': 'Validation Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'VALIDATED': 'Validation Passed',
    'DELIVERY_QUEUED': 'Pending',
    'DELIVERY_IN_PROGRESS': 'Delivery In Progress',
    'DELIVERED': 'Delivered',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

/**
 * Check if upload can be verified
 */
export const canVerify = (status: UploadStatus): boolean => {
  return status === 'UPLOADED' || status === 'VALIDATION_FAILED';
};

/**
 * Check if upload can be retried
 */
export const canRetry = (status: UploadStatus): boolean => {
  return status === 'VALIDATION_FAILED' || status === 'DELIVERY_FAILED';
};

/**
 * Check if upload can be deleted
 */
export const canDelete = (status: UploadStatus): boolean => {
  return status !== 'VALIDATION_IN_PROGRESS' && status !== 'DELIVERY_IN_PROGRESS';
};

export default {
  getUploads,
  getRecentUploads,
  getUploadById,
  getUploadProgress,
  uploadFile,
  startVerification,
  retryValidation,
  deleteUpload,
  mapStatusToDisplay,
  canVerify,
  canRetry,
  canDelete,
};

