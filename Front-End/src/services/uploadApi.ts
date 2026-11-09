/**
 * Upload API Service
 * Handles all upload-related API calls to the backend
 */

import { downloadApiFile } from './download';
import { apiRequest } from './http';

// ============================================================================
// Types (the JSON the backend returns: entity fields are PascalCase, dates are ISO strings)
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

export type ValidationStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'WARNING' | 'ERROR' | 'SKIPPED';

export interface IUpload {
  Id: string;
  FileDefinitionId: string;
  /** Definition version the upload is validated against; null for uploads created before versioning. */
  FileDefinitionVersionId?: string | null;
  UploadedBy: string;
  OriginalFilename: string;
  StoredFilename: string;
  FileSize: number;
  FileType: string;
  RowCountNo: number | null;
  SheetCount: number | null;
  Status: UploadStatus;
  UploadedAt: string;
  ValidationStartedAt: string | null;
  ValidationCompletedAt: string | null;
  DeliveryStartedAt: string | null;
  DeliveryCompletedAt: string | null;
  DeliveredTo: string | null;
  DeliveredAt: string | null;
  ErrorMessage: string | null;
  /** Added by the list and detail endpoints (not by /uploads/recent). */
  DefinitionName?: string;
  DefinitionVersionNumber?: number | null;
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
  Status: Exclude<ValidationStatus, 'ERROR' | 'SKIPPED'>;
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
  /** Null for built-in checks such as the definition's column schema. */
  RuleId: string | null;
  RuleName: string;
  RuleType: string;
  RuleSeverity: string;
  ExecutionOrder: number;
  Status: ValidationStatus;
  IssueCount: number;
  /** JSON-encoded list of validation issues. */
  Issues: string;
  ElapsedMs: number;
  /** Sheet the check applies to; null when it covers every sheet (or the CSV). */
  Sheet?: string | null;
  StartedAt: string | null;
  CompletedAt: string | null;
}

export interface IDeliveryRecord {
  Id: string;
  UploadId: string;
  UploadSheetId: string | null;
  DeliveryType: 'FileCopy' | 'AzureBlob' | 'FabricLakehouse' | 'SharePoint';
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

export interface IRecentUploadsResponse {
  success: boolean;
  uploads: IUpload[];
}

export interface IUploadResponse {
  success: boolean;
  upload: IUpload;
  message: string;
}

/** `GET /uploads/:id`. */
export interface IUploadDetailResponse {
  success: boolean;
  upload: IUpload;
  /** The definition version the upload was validated against; null for uploads created before versioning. */
  definitionVersion: { id: string; versionNumber: number; activatedAt: string } | null;
  sheets: IUploadSheet[];
  validationResult: IValidationResult | null;
  ruleDetails: IValidationRuleDetail[];
  deliveryRecords: IDeliveryRecord[];
}

export interface IUploadActionResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// Upload API Methods
// ============================================================================

export const UPLOADS_PAGE_SIZE = 20;

/** One page of the user's uploads, newest first. */
export const getUploads = (page: number, pageSize: number = UPLOADS_PAGE_SIZE): Promise<IUploadsResponse> =>
  apiRequest<IUploadsResponse>('/uploads', { query: { page, pageSize } });

/**
 * Get recent uploads for dashboard
 */
export const getRecentUploads = (limit: number = 10): Promise<IRecentUploadsResponse> =>
  apiRequest<IRecentUploadsResponse>('/uploads/recent', { query: { limit } });

export const getUploadDetails = (id: string, signal?: AbortSignal): Promise<IUploadDetailResponse> =>
  apiRequest<IUploadDetailResponse>(`/uploads/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: 'Failed to fetch upload details',
  });

/** Download via the API so upload access checks and bearer authentication are preserved. */
export const downloadUploadReport = (id: string): Promise<void> =>
  downloadApiFile(`/uploads/${encodeURIComponent(id)}/report`, {
    fallbackFilename: `${id}-issues.csv`,
    failureMessage: status => `Failed to download issues report (HTTP ${status})`,
  });

/** Download a delivered file through the authenticated API, not a public Blob URL. */
export const downloadUploadDelivery = (uploadId: string, deliveryId: string): Promise<void> =>
  downloadApiFile(
    `/uploads/${encodeURIComponent(uploadId)}/deliveries/${encodeURIComponent(deliveryId)}`,
    {
      fallbackFilename: `${deliveryId}-delivery`,
      failureMessage: status => `Failed to download delivery output (HTTP ${status})`,
    },
  );

/**
 * Upload a file
 */
export const uploadFile = (file: File, definitionId: string): Promise<IUploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('definitionId', definitionId);
  return apiRequest<IUploadResponse>('/uploads', {
    method: 'POST',
    body: formData,
    fallbackMessage: 'Failed to upload file',
  });
};

/**
 * Start validation for an uploaded file
 */
export const startVerification = (id: string): Promise<IUploadActionResponse> =>
  apiRequest<IUploadActionResponse>(`/uploads/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    fallbackMessage: 'Failed to start verification',
  });

/**
 * Retry validation for a failed upload
 */
export const retryValidation = (id: string): Promise<IUploadActionResponse> =>
  apiRequest<IUploadActionResponse>(`/uploads/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    fallbackMessage: 'Failed to retry',
  });

/**
 * Delete an upload
 */
export const deleteUpload = (id: string): Promise<IUploadActionResponse> =>
  apiRequest<IUploadActionResponse>(`/uploads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    fallbackMessage: 'Failed to delete upload',
  });

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
  getRecentUploads,
  uploadFile,
  startVerification,
  retryValidation,
  deleteUpload,
  mapStatusToDisplay,
  canVerify,
  canRetry,
  canDelete,
};
