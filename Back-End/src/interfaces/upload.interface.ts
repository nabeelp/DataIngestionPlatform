// =============================================================================
// Upload Interface - Complete Upload System Types
// =============================================================================

/**
 * Upload status lifecycle
 */
export type UploadStatus = 
    | 'UPLOADED'
    | 'VALIDATION_QUEUED'
    | 'VALIDATION_IN_PROGRESS'
    | 'VALIDATION_FAILED'
    | 'VALIDATION_PASSED'
    /** Terminal: validation passed and the definition has no delivery target */
    | 'VALIDATED'
    | 'DELIVERY_QUEUED'
    | 'DELIVERY_IN_PROGRESS'
    | 'DELIVERED'
    | 'DELIVERY_FAILED';

/**
 * Validation status
 */
export type ValidationStatus = 
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'PASSED'
    | 'FAILED'
    | 'WARNING'
    | 'ERROR'
    | 'SKIPPED';

export interface IValidationIssue {
    sheet: string | null;
    row: number | null;
    column: string | null;
    value: string | number | boolean | null;
    message: string;
}

/**
 * Delivery type
 */
export type DeliveryType = 
    | 'FileCopy'
    // Legacy values that may exist on historical delivery records
    | 'FabricLakehouse'
    | 'SharePoint';

/**
 * Delivery status
 */
export type DeliveryStatus = 
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'DELIVERED'
    | 'FAILED';

/**
 * Job status
 */
export type JobStatus = 
    | 'WAITING'
    | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED';

/**
 * Sheet status
 */
export type SheetStatus = 
    | 'PENDING'
    | 'VALIDATING'
    | 'VALIDATED'
    | 'DELIVERING'
    | 'DELIVERED'
    | 'FAILED';

/**
 * Upload entity interface
 */
export interface IUpload {
    Id: string;
    FileDefinitionId: string;
    /** Definition version the upload is validated against; null for uploads created before versioning */
    FileDefinitionVersionId?: string | null;
    UploadedBy: string;
    OriginalFilename: string;
    StoredFilename: string;
    BlobContainer: string;
    BlobName: string;
    FileSha256: string | null;
    DetectedEncoding: string | null;
    ValidationDate: Date | null;
    EngineVersion: string | null;
    ReportBlobName: string | null;
    ParquetPrefix: string | null;
    AzureBlobUrl: string | null;
    FileSize: number;
    FileType: string;
    CompressedFileSize: number | null;
    CompressedBlobUrl: string | null;
    TempLocalPath: string | null | undefined;
    RetryCount: number;
    RowCountNo: number | null;
    SheetCount: number | null;
    Status: UploadStatus;
    UploadedAt: Date;
    ValidationStartedAt: Date | null;
    ValidationCompletedAt: Date | null;
    DeliveryStartedAt: Date | null;
    DeliveryCompletedAt: Date | null;
    ValidationJobId: string | null;
    DeliveryJobId: string | null;
    ProcessingNode: string | null;
    DeliveredTo: string | null;
    DeliveredAt: Date | null;
    ErrorMessage: string | null;
}

/**
 * Upload sheet interface
 */
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
    DeliveredAt: Date | null;
    ErrorMessage: string | null;
    CreatedAt: Date;
    UpdatedAt: Date;
}

/**
 * Validation result interface
 */
export interface IValidationResult {
    Id: string;
    UploadId: string;
    TotalRules: number;
    PassedRules: number;
    FailedRules: number;
    WarningRules: number;
    ProgressPercent: number;
    CurrentRule: string | null;
    Status: ValidationStatus;
    StartedAt: Date | null;
    CompletedAt: Date | null;
    TotalErrors: number;
    TotalWarnings: number;
    ErrorSummary: string | null;
}

/**
 * Validation rule detail interface
 */
export interface IValidationRuleDetail {
    Id: string;
    ValidationResultId: string;
    UploadId: string;
    RuleId: string | null;
    RuleName: string;
    RuleType: string;
    RuleSeverity: string;
    ExecutionOrder: number;
    Status: ValidationStatus;
    IssueCount: number;
    Issues: string;
    ElapsedMs: number;
    ExecutionTimeMs: number | null;
    ErrorCount: number;
    WarningCount: number;
    FailedRows: string | null;
    FailedRowsCount: number;
    SampleErrorValue: string | null;
    StartedAt: Date | null;
    CompletedAt: Date | null;
    /** Sheet the check applies to (null: every sheet or the CSV). Only set on upload details responses. */
    Sheet?: string | null;
}

/**
 * Delivery record interface
 */
export interface IDeliveryRecord {
    Id: string;
    UploadId: string;
    UploadSheetId: string | null;
    DeliveryType: DeliveryType;
    DestinationPath: string;
    DestinationName: string | null;
    Status: DeliveryStatus;
    ProgressPercent: number | null;
    StartedAt: Date | null;
    CompletedAt: Date | null;
    ErrorMessage: string | null;
    RecordsDelivered: number | null;
}

/**
 * Upload task interface
 */
export interface IUploadTask {
    Id: string;
    UploadId: string;
    TaskType: 'VALIDATION' | 'DELIVERY';
    CurrentStage: string | null;
    TotalStages: number | null;
    ProgressPercent: number;
    CompletedStages: number;
    Status: JobStatus;
    QueueName: string | null;
    JobId: string | null;
    StartedAt: Date | null;
    CompletedAt: Date | null;
    LastUpdatedAt: Date;
}

/**
 * Upload access interface
 */
export interface IUploadAccess {
    Id: string;
    UploadId: string;
    UserId: string;
    AccessLevel: 'READ' | 'WRITE' | 'ADMIN';
    GrantedAt: Date;
    GrantedBy: string;
}

/**
 * Error row interface for validation failures
 */
export interface IErrorRow {
    row_num: number;
    column: string;
    value: string;
    error: string;
}

// ============================================================================
// DTOs (Data Transfer Objects)
// ============================================================================

/**
 * Create upload DTO
 */
export interface ICreateUploadDto {
    FileDefinitionId: string;
    FileDefinitionVersionId?: string | null;
    OriginalFilename: string;
    StoredFilename: string;
    BlobContainer?: string;
    BlobName?: string;
    FileSha256?: string | null;
    DetectedEncoding?: string | null;
    ValidationDate?: Date | null;
    EngineVersion?: string | null;
    ReportBlobName?: string | null;
    ParquetPrefix?: string | null;
    TempLocalPath?: string;
    AzureBlobUrl?: string;
    FileSize: number;
    FileType: string;
    CompressedFileSize?: number;
    CompressedBlobUrl?: string;
    RetryCount?: number;
    RowCountNo?: number;
    SheetCount?: number;
}


/**
 * Update upload DTO
 */
export interface IUpdateUploadDto {
    Status?: UploadStatus;
    FileDefinitionVersionId?: string;
    BlobContainer?: string;
    BlobName?: string;
    FileSha256?: string | null;
    DetectedEncoding?: string | null;
    ValidationDate?: Date | null;
    EngineVersion?: string | null;
    ReportBlobName?: string | null;
    ParquetPrefix?: string | null;
    TempLocalPath?: string | null;
    RetryCount?: number;
    RowCountNo?: number;
    SheetCount?: number;
    AzureBlobUrl?: string;
    CompressedBlobUrl?: string;
    ValidationJobId?: string;
    DeliveryJobId?: string;
    DeliveredTo?: string;
    DeliveredAt?: Date | null;
    ErrorMessage?: string | null;
    ValidationStartedAt?: Date | null;
    ValidationCompletedAt?: Date | null;
    DeliveryStartedAt?: Date | null;
    DeliveryCompletedAt?: Date | null;
}


/**
 * Create upload sheet DTO
 */
export interface ICreateUploadSheetDto {
    UploadId: string;
    SheetIndex: number;
    SheetName: string;
    RowCountNo?: number;
}

/**
 * Update upload sheet DTO
 */
export interface IUpdateUploadSheetDto {
    RowCountNo?: number;
    Status?: SheetStatus;
    ValidationProgress?: number;
    ValidatedRules?: number;
    TotalRules?: number;
    DeliveryPath?: string;
    DeliveredAt?: Date | null;
    ErrorMessage?: string;
}

/**
 * Create validation result DTO
 */
export interface ICreateValidationResultDto {
    UploadId: string;
    TotalRules: number;
}

/**
 * Update validation result DTO
 */
export interface IUpdateValidationResultDto {
    PassedRules?: number;
    FailedRules?: number;
    WarningRules?: number;
    ProgressPercent?: number;
    CurrentRule?: string;
    Status?: ValidationStatus;
    StartedAt?: Date;
    CompletedAt?: Date;
    TotalErrors?: number;
    TotalWarnings?: number;
    ErrorSummary?: string;
}

/**
 * Create validation rule detail DTO
 */
export interface ICreateValidationRuleDetailDto {
    ValidationResultId: string;
    UploadId: string;
    /** Null for built-in checks such as the file definition column schema */
    RuleId: string | null;
    RuleName: string;
    RuleType: string;
    RuleSeverity: string;
    ExecutionOrder: number;
}

/**
 * Update validation rule detail DTO
 */
export interface IUpdateValidationRuleDetailDto {
    Status?: ValidationStatus;
    IssueCount?: number;
    Issues?: string;
    ElapsedMs?: number;
    Sheet?: string | null;
    ExecutionTimeMs?: number;
    ErrorCount?: number;
    WarningCount?: number;
    FailedRows?: string;
    FailedRowsCount?: number;
    SampleErrorValue?: string;
    StartedAt?: Date;
    CompletedAt?: Date;
}

/**
 * Create delivery record DTO
 */
export interface ICreateDeliveryRecordDto {
    UploadId: string;
    UploadSheetId?: string;
    DeliveryType: DeliveryType;
    DestinationPath: string;
    DestinationName?: string;
}

/**
 * Update delivery record DTO
 */
export interface IUpdateDeliveryRecordDto {
    Status?: DeliveryStatus;
    ProgressPercent?: number;
    StartedAt?: Date;
    CompletedAt?: Date;
    ErrorMessage?: string;
    RecordsDelivered?: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Upload list response
 */
export interface IUploadsResponse {
    success: boolean;
    uploads: IUpload[];
    total: number;
    page: number;
    pageSize: number;
}

/**
 * Single upload response
 */
export interface IUploadResponse {
    success: boolean;
    upload: IUpload;
}

/**
 * Upload detail with related data (for details page)
 */
export interface IUploadDetailResponse {
    success: boolean;
    upload: IUpload;
    /** Definition version the upload was validated against; null for uploads created before versioning */
    definitionVersion: { id: string; versionNumber: number; activatedAt: Date } | null;
    sheets: IUploadSheet[];
    validationResult: IValidationResult | null;
    ruleDetails: IValidationRuleDetail[];
    deliveryRecords: IDeliveryRecord[];
}

/**
 * Upload progress response
 */
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

// ============================================================================
// Queue Job Types
// ============================================================================

/**
 * Validation job data
 */
export interface IValidationJobData {
    uploadId: string;
    fileDefinitionId: string;
    fileUrl: string;
    userId: string;
}


/**
 * Delivery job data
 */
export interface IDeliveryJobData {
    uploadId: string;
    uploadSheetId?: string;
    deliveryType: DeliveryType;
    destinationPath: string;
    azureBlobUrl: string;
    userId: string;
}

/**
 * Retry job data
 */
export interface IRetryJobData {
    originalJobId: string;
    uploadId: string;
    jobType: string;
    retryCount: number;
}
