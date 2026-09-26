-- =============================================================================
-- Upload System Database Schema
-- Production-ready SQL Script for Data Ingestion Platform
-- =============================================================================

-- ============================================================================
-- UPLOADS TABLE - Main upload records
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Uploads')
BEGIN
    CREATE TABLE Uploads (
        Id NVARCHAR(36) PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        UploadedBy NVARCHAR(36) NOT NULL,
        OriginalFilename NVARCHAR(255) NOT NULL,
        StoredFilename NVARCHAR(255) NOT NULL,
        TempLocalPath NVARCHAR(1000) NULL,
        AzureBlobUrl NVARCHAR(500) NULL,
        FileSize BIGINT NOT NULL DEFAULT 0,
        FileType NVARCHAR(50) NOT NULL,
        CompressedFileSize BIGINT NULL,
        CompressedBlobUrl NVARCHAR(500) NULL,
        RetryCount INT NOT NULL DEFAULT 0,
        RowCountNo INT NULL DEFAULT 0,
        SheetCount INT NULL DEFAULT 0,
        Status NVARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
        UploadedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        ValidationStartedAt DATETIME2 NULL,
        ValidationCompletedAt DATETIME2 NULL,
        DeliveryStartedAt DATETIME2 NULL,
        DeliveryCompletedAt DATETIME2 NULL,
        ValidationJobId NVARCHAR(36) NULL,
        DeliveryJobId NVARCHAR(36) NULL,
        ProcessingNode NVARCHAR(100) NULL,
        DeliveredTo NVARCHAR(500) NULL,
        DeliveredAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL
    );
    
    CREATE INDEX IX_Uploads_Status ON Uploads(Status);
    CREATE INDEX IX_Uploads_FileDefinitionId ON Uploads(FileDefinitionId);
    CREATE INDEX IX_Uploads_UploadedBy ON Uploads(UploadedBy);
    CREATE INDEX IX_Uploads_UploadedAt ON Uploads(UploadedAt DESC);
END;
GO

-- Add the validation source path to databases created before this column existed.
IF COL_LENGTH('Uploads', 'TempLocalPath') IS NULL
BEGIN
    ALTER TABLE Uploads ADD TempLocalPath NVARCHAR(1000) NULL;
END;
IF COL_LENGTH('Uploads', 'RetryCount') IS NULL
BEGIN
    ALTER TABLE Uploads ADD RetryCount INT NOT NULL DEFAULT 0;
END;
GO

-- ============================================================================
-- VALIDATION RESULTS TABLE - Overall validation results per upload
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ValidationResults')
BEGIN
    CREATE TABLE ValidationResults (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        TotalRules INT NOT NULL DEFAULT 0,
        PassedRules INT NOT NULL DEFAULT 0,
        FailedRules INT NOT NULL DEFAULT 0,
        WarningRules INT NOT NULL DEFAULT 0,
        ProgressPercent INT NOT NULL DEFAULT 0,
        CurrentRule NVARCHAR(255) NULL,
        Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        TotalErrors INT NOT NULL DEFAULT 0,
        TotalWarnings INT NOT NULL DEFAULT 0,
        ErrorSummary NVARCHAR(MAX) NULL
    );
    
    CREATE INDEX IX_ValidationResults_UploadId ON ValidationResults(UploadId);
    CREATE INDEX IX_ValidationResults_Status ON ValidationResults(Status);
END;
GO

-- ============================================================================
-- RULES TABLE - Validation rules reference
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Rules')
BEGIN
    CREATE TABLE Rules (
        Id UNIQUEIDENTIFIER PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        Name NVARCHAR(255) NOT NULL,
        Description NVARCHAR(1000) NULL,
        RuleType NVARCHAR(50) NOT NULL,
        Severity NVARCHAR(20) NOT NULL,
        ExecutionOrder INT NOT NULL DEFAULT 0,
        SqlQuery NVARCHAR(MAX) NOT NULL,
        IsEnabled BIT NOT NULL DEFAULT 1,
        CreatedBy NVARCHAR(36) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_Rules_FileDefinitionId ON Rules(FileDefinitionId);
    CREATE INDEX IX_Rules_IsEnabled ON Rules(IsEnabled);
END;
GO

-- Align databases created with the older Rules schema with the model.
IF COL_LENGTH('dbo.Rules', 'Description') IS NULL
    ALTER TABLE dbo.Rules ADD Description NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.Rules', 'Severity') IS NULL
BEGIN
    ALTER TABLE dbo.Rules ADD Severity NVARCHAR(20) NOT NULL CONSTRAINT DF_Rules_Severity DEFAULT 'Error';
    IF COL_LENGTH('dbo.Rules', 'RuleSeverity') IS NOT NULL
        EXEC('UPDATE dbo.Rules SET Severity = RuleSeverity');
END;
IF COL_LENGTH('dbo.Rules', 'RuleSeverity') IS NOT NULL
    ALTER TABLE dbo.Rules DROP COLUMN RuleSeverity;
IF COL_LENGTH('dbo.Rules', 'SqlQuery') IS NULL
BEGIN
    ALTER TABLE dbo.Rules ADD SqlQuery NVARCHAR(MAX) NULL;
    UPDATE dbo.Rules SET IsEnabled = 0;
END;
IF COL_LENGTH('dbo.Rules', 'CreatedBy') IS NULL
    ALTER TABLE dbo.Rules ADD CreatedBy NVARCHAR(36) NULL;
-- Sheet table a rule applies to, for definitions with one table per workbook sheet. NULL for single-table definitions.
IF COL_LENGTH('dbo.Rules', 'TableName') IS NULL
    ALTER TABLE dbo.Rules ADD TableName NVARCHAR(255) NULL;
GO

-- Custom SQL and Regex Pattern rules are no longer supported. Disable any existing ones so they
-- can be reviewed and recreated with a supported declarative type.
UPDATE dbo.Rules
SET IsEnabled = 0, UpdatedAt = GETUTCDATE()
WHERE RuleType IN ('Custom SQL', 'Regex Pattern') AND IsEnabled = 1;
GO

-- ============================================================================
-- VALIDATION RULE DETAILS TABLE - Individual rule execution results
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ValidationRuleDetails')
BEGIN
    CREATE TABLE ValidationRuleDetails (
        Id NVARCHAR(36) PRIMARY KEY,
        ValidationResultId NVARCHAR(36) NOT NULL,
        UploadId NVARCHAR(36) NOT NULL,
        RuleId UNIQUEIDENTIFIER NULL,
        RuleName NVARCHAR(255) NOT NULL,
        RuleType NVARCHAR(50) NOT NULL,
        RuleSeverity NVARCHAR(20) NOT NULL,
        ExecutionOrder INT NOT NULL,
        Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        ExecutionTimeMs INT NULL,
        ErrorCount INT NOT NULL DEFAULT 0,
        WarningCount INT NOT NULL DEFAULT 0,
        FailedRows NVARCHAR(MAX) NULL,
        FailedRowsCount INT NOT NULL DEFAULT 0,
        SampleErrorValue NVARCHAR(500) NULL,
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL
    );
    
    CREATE INDEX IX_ValidationRuleDetails_ValidationResultId ON ValidationRuleDetails(ValidationResultId);
    CREATE INDEX IX_ValidationRuleDetails_UploadId ON ValidationRuleDetails(UploadId);
    CREATE INDEX IX_ValidationRuleDetails_Status ON ValidationRuleDetails(Status);
END;
GO

-- ============================================================================
-- UPLOAD SHEETS TABLE - Multi-sheet Excel file tracking
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UploadSheets')
BEGIN
    CREATE TABLE UploadSheets (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        SheetIndex INT NOT NULL,
        SheetName NVARCHAR(255) NOT NULL,
        RowCountNo INT NULL DEFAULT 0,
        Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        ValidationProgress INT NULL DEFAULT 0,
        ValidatedRules INT NULL DEFAULT 0,
        TotalRules INT NULL DEFAULT 0,
        DeliveryPath NVARCHAR(500) NULL,
        DeliveredAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_UploadSheets_UploadId ON UploadSheets(UploadId);
    CREATE INDEX IX_UploadSheets_Status ON UploadSheets(Status);
END;
GO

-- ============================================================================
-- DELIVERY RECORDS TABLE - Delivery destination tracking
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DeliveryRecords')
BEGIN
    CREATE TABLE DeliveryRecords (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        UploadSheetId NVARCHAR(36) NULL,
        DeliveryType NVARCHAR(50) NOT NULL,
        DestinationPath NVARCHAR(500) NOT NULL,
        DestinationName NVARCHAR(255) NULL,
        Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        ProgressPercent INT NULL DEFAULT 0,
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        RecordsDelivered INT NULL DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_DeliveryRecords_UploadId ON DeliveryRecords(UploadId);
    CREATE INDEX IX_DeliveryRecords_Status ON DeliveryRecords(Status);
    CREATE INDEX IX_DeliveryRecords_DeliveryType ON DeliveryRecords(DeliveryType);
END;
GO

-- ============================================================================
-- UPLOAD TASKS TABLE - Task orchestration tracking
-- ============================================================================
IF COL_LENGTH('DeliveryRecords', 'CreatedAt') IS NULL
BEGIN
    ALTER TABLE DeliveryRecords ADD CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE();
END;
GO
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UploadTasks')
BEGIN
    CREATE TABLE UploadTasks (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        TaskType NVARCHAR(50) NOT NULL,
        CurrentStage NVARCHAR(100) NULL,
        TotalStages INT NULL DEFAULT 0,
        ProgressPercent INT NOT NULL DEFAULT 0,
        CompletedStages INT NOT NULL DEFAULT 0,
        Status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        QueueName NVARCHAR(100) NULL,
        JobId NVARCHAR(36) NULL,
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        LastUpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_UploadTasks_UploadId ON UploadTasks(UploadId);
    CREATE INDEX IX_UploadTasks_Status ON UploadTasks(Status);
    CREATE INDEX IX_UploadTasks_TaskType ON UploadTasks(TaskType);
END;
GO

-- ============================================================================
-- PROCESSING JOBS TABLE - Background job tracking
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProcessingJobs')
BEGIN
    CREATE TABLE ProcessingJobs (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NULL,
        JobType NVARCHAR(50) NOT NULL,
        QueueName NVARCHAR(100) NOT NULL,
        Status NVARCHAR(50) NOT NULL DEFAULT 'WAITING',
        RetryCount INT NOT NULL DEFAULT 0,
        MaxRetries INT NOT NULL DEFAULT 3,
        WorkerId NVARCHAR(36) NULL,
        QueuedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        StackTrace NVARCHAR(MAX) NULL,
        JobData NVARCHAR(MAX) NULL,
        ResultData NVARCHAR(MAX) NULL
    );
    
    CREATE INDEX IX_ProcessingJobs_UploadId ON ProcessingJobs(UploadId);
    CREATE INDEX IX_ProcessingJobs_Status ON ProcessingJobs(Status);
    CREATE INDEX IX_ProcessingJobs_JobType ON ProcessingJobs(JobType);
    CREATE INDEX IX_ProcessingJobs_QueuedAt ON ProcessingJobs(QueuedAt DESC);
END;
GO

-- ============================================================================
-- WORKER INSTANCES TABLE - Worker node tracking
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WorkerInstances')
BEGIN
    CREATE TABLE WorkerInstances (
        Id NVARCHAR(36) PRIMARY KEY,
        HostName NVARCHAR(100) NOT NULL,
        WorkerType NVARCHAR(50) NOT NULL,
        Status NVARCHAR(50) NOT NULL DEFAULT 'RUNNING',
        IpAddress NVARCHAR(50) NULL,
        ProcessId INT NULL,
        Version NVARCHAR(20) NULL,
        StartedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        LastHeartbeat DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        JobsProcessed INT NOT NULL DEFAULT 0,
        JobsFailed INT NOT NULL DEFAULT 0
    );
    
    CREATE INDEX IX_WorkerInstances_Status ON WorkerInstances(Status);
    CREATE INDEX IX_WorkerInstances_WorkerType ON WorkerInstances(WorkerType);
    CREATE INDEX IX_WorkerInstances_LastHeartbeat ON WorkerInstances(LastHeartbeat);
END;
GO

-- ============================================================================
-- DEAD LETTER JOBS TABLE - Failed jobs that need manual intervention
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DeadLetterJobs')
BEGIN
    CREATE TABLE DeadLetterJobs (
        Id NVARCHAR(36) PRIMARY KEY,
        JobId NVARCHAR(36) NOT NULL,
        UploadId NVARCHAR(36) NULL,
        JobType NVARCHAR(50) NOT NULL,
        FailureReason NVARCHAR(MAX) NOT NULL,
        StackTrace NVARCHAR(MAX) NULL,
        RetryCount INT NOT NULL DEFAULT 0,
        LastAttemptAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        ResolvedBy NVARCHAR(36) NULL,
        ResolvedAt DATETIME2 NULL,
        ResolutionNotes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_DeadLetterJobs_Status ON DeadLetterJobs(ResolvedAt);
    CREATE INDEX IX_DeadLetterJobs_UploadId ON DeadLetterJobs(UploadId);
    CREATE INDEX IX_DeadLetterJobs_CreatedAt ON DeadLetterJobs(CreatedAt DESC);
END;
GO

-- ============================================================================
-- FILE DEFINITION USER ACCESS TABLE - Users assigned to specific file definitions
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FileDefinitionUserAccess')
BEGIN
    CREATE TABLE FileDefinitionUserAccess (
        Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        FileDefinitionId NVARCHAR(36) NOT NULL,
        UserId NVARCHAR(36) NOT NULL,
        AssignedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        AssignedBy NVARCHAR(36) NULL,
        
        -- Constraints
        CONSTRAINT FK_FileDefinitionUserAccess_FileDefinition FOREIGN KEY (FileDefinitionId) 
            REFERENCES FileDefinitions(Id) ON DELETE CASCADE,
        CONSTRAINT FK_FileDefinitionUserAccess_User FOREIGN KEY (UserId) 
            REFERENCES Users(Id) ON DELETE CASCADE,
        
        -- Unique constraint - one assignment per user per definition
        UNIQUE (FileDefinitionId, UserId)
    );
    
    CREATE INDEX IX_FileDefinitionUserAccess_FileDefinitionId ON FileDefinitionUserAccess(FileDefinitionId);
    CREATE INDEX IX_FileDefinitionUserAccess_UserId ON FileDefinitionUserAccess(UserId);
END;
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.FileDefinitionUserAccess')
      AND name = 'AssignedBy'
      AND is_nullable = 0
)
BEGIN
    ALTER TABLE dbo.FileDefinitionUserAccess ALTER COLUMN AssignedBy NVARCHAR(36) NULL;
END;
GO

-- ============================================================================
-- UPLOAD ACCESS TABLE - User access to uploads (for shared files)
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UploadAccess')
BEGIN
    CREATE TABLE UploadAccess (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        UserId NVARCHAR(36) NOT NULL,
        AccessLevel NVARCHAR(20) NOT NULL DEFAULT 'READ',
        GrantedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        GrantedBy NVARCHAR(36) NOT NULL
    );
    
    CREATE UNIQUE INDEX IX_UploadAccess_UploadId_UserId ON UploadAccess(UploadId, UserId);
    CREATE INDEX IX_UploadAccess_UserId ON UploadAccess(UserId);
END;
GO

-- ============================================================================
-- VALIDATION ERRORS BATCH TABLE - For large file error grouping
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ValidationErrorBatches')
BEGIN
    CREATE TABLE ValidationErrorBatches (
        Id NVARCHAR(36) PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        ValidationRuleDetailId NVARCHAR(36) NOT NULL,
        BatchNumber INT NOT NULL,
        ErrorCount INT NOT NULL DEFAULT 0,
        ErrorsJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_ValidationErrorBatches_UploadId ON ValidationErrorBatches(UploadId);
    CREATE INDEX IX_ValidationErrorBatches_ValidationRuleDetailId ON ValidationErrorBatches(ValidationRuleDetailId);
END;
GO

PRINT 'Upload System tables created successfully!';
GO
