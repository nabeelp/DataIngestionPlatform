SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
GO

IF OBJECT_ID(N'dbo.ValidationErrorBatches', N'U') IS NOT NULL DROP TABLE dbo.ValidationErrorBatches;
IF OBJECT_ID(N'dbo.DeadLetterJobs', N'U') IS NOT NULL DROP TABLE dbo.DeadLetterJobs;
IF OBJECT_ID(N'dbo.WorkerInstances', N'U') IS NOT NULL DROP TABLE dbo.WorkerInstances;
IF OBJECT_ID(N'dbo.ProcessingJobs', N'U') IS NOT NULL DROP TABLE dbo.ProcessingJobs;
GO

IF OBJECT_ID(N'dbo.Uploads', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Uploads (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_Uploads PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        FileDefinitionVersionId NVARCHAR(36) NULL,
        UploadedBy NVARCHAR(36) NOT NULL,
        OriginalFilename NVARCHAR(255) NOT NULL,
        StoredFilename NVARCHAR(255) NOT NULL,
        BlobContainer NVARCHAR(63) NOT NULL,
        BlobName NVARCHAR(1024) NOT NULL,
        FileSha256 CHAR(64) NULL,
        DetectedEncoding NVARCHAR(40) NULL,
        ValidationDate DATETIME2 NULL,
        EngineVersion NVARCHAR(100) NULL,
        ReportBlobName NVARCHAR(1024) NULL,
        ParquetPrefix NVARCHAR(1024) NULL,
        AzureBlobUrl NVARCHAR(1000) NULL,
        FileSize BIGINT NOT NULL CONSTRAINT DF_Uploads_FileSize DEFAULT 0,
        FileType NVARCHAR(50) NOT NULL,
        RetryCount INT NOT NULL CONSTRAINT DF_Uploads_RetryCount DEFAULT 0,
        RowCountNo BIGINT NULL,
        SheetCount INT NULL,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_Uploads_Status DEFAULT N'UPLOADED',
        UploadedAt DATETIME2 NOT NULL CONSTRAINT DF_Uploads_UploadedAt DEFAULT SYSUTCDATETIME(),
        ValidationStartedAt DATETIME2 NULL,
        ValidationCompletedAt DATETIME2 NULL,
        DeliveryStartedAt DATETIME2 NULL,
        DeliveryCompletedAt DATETIME2 NULL,
        DeliveredTo NVARCHAR(500) NULL,
        DeliveredAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL
    );
END;
GO

IF COL_LENGTH(N'dbo.Uploads', N'TempLocalPath') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN TempLocalPath;
IF COL_LENGTH(N'dbo.Uploads', N'ValidationJobId') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN ValidationJobId;
IF COL_LENGTH(N'dbo.Uploads', N'CompressedFileSize') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN CompressedFileSize;
IF COL_LENGTH(N'dbo.Uploads', N'CompressedBlobUrl') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN CompressedBlobUrl;
IF COL_LENGTH(N'dbo.Uploads', N'DeliveryJobId') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN DeliveryJobId;
IF COL_LENGTH(N'dbo.Uploads', N'ProcessingNode') IS NOT NULL
    ALTER TABLE dbo.Uploads DROP COLUMN ProcessingNode;
GO

IF OBJECT_ID(N'dbo.Uploads', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.Uploads', N'BlobContainer') IS NULL
    THROW 51002, 'Uploads uses an incompatible schema. Apply this schema to a clean database.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Uploads') AND name = N'IX_Uploads_Status')
    CREATE INDEX IX_Uploads_Status ON dbo.Uploads(Status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Uploads') AND name = N'IX_Uploads_FileDefinitionId')
    CREATE INDEX IX_Uploads_FileDefinitionId ON dbo.Uploads(FileDefinitionId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Uploads') AND name = N'IX_Uploads_UploadedBy')
    CREATE INDEX IX_Uploads_UploadedBy ON dbo.Uploads(UploadedBy);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Uploads') AND name = N'IX_Uploads_UploadedAt')
    CREATE INDEX IX_Uploads_UploadedAt ON dbo.Uploads(UploadedAt DESC);
GO

IF OBJECT_ID(N'dbo.ValidationResults', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ValidationResults (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_ValidationResults PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        TotalRules INT NOT NULL CONSTRAINT DF_ValidationResults_TotalRules DEFAULT 0,
        PassedRules INT NOT NULL CONSTRAINT DF_ValidationResults_PassedRules DEFAULT 0,
        FailedRules INT NOT NULL CONSTRAINT DF_ValidationResults_FailedRules DEFAULT 0,
        WarningRules INT NOT NULL CONSTRAINT DF_ValidationResults_WarningRules DEFAULT 0,
        ProgressPercent INT NOT NULL CONSTRAINT DF_ValidationResults_ProgressPercent DEFAULT 0,
        CurrentRule NVARCHAR(255) NULL,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_ValidationResults_Status DEFAULT N'PENDING',
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        TotalErrors INT NOT NULL CONSTRAINT DF_ValidationResults_TotalErrors DEFAULT 0,
        TotalWarnings INT NOT NULL CONSTRAINT DF_ValidationResults_TotalWarnings DEFAULT 0,
        ErrorSummary NVARCHAR(MAX) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ValidationResults') AND name = N'IX_ValidationResults_UploadId')
    CREATE INDEX IX_ValidationResults_UploadId ON dbo.ValidationResults(UploadId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ValidationResults') AND name = N'IX_ValidationResults_Status')
    CREATE INDEX IX_ValidationResults_Status ON dbo.ValidationResults(Status);
GO

IF OBJECT_ID(N'dbo.Rules', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.Rules', N'Config') IS NULL
    THROW 51003, 'Rules uses an incompatible schema. Apply this schema to a clean database.', 1;
GO

IF OBJECT_ID(N'dbo.Rules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Rules (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_Rules PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        Config NVARCHAR(MAX) NOT NULL,
        ConfigSchemaVersion INT NOT NULL CONSTRAINT DF_Rules_ConfigSchemaVersion DEFAULT 1,
        IsEnabled BIT NOT NULL CONSTRAINT DF_Rules_IsEnabled DEFAULT 1,
        CreatedBy NVARCHAR(36) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Rules_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Rules_UpdatedAt DEFAULT SYSUTCDATETIME(),
        Name AS CONVERT(NVARCHAR(255), JSON_VALUE(Config, N'$.name')) PERSISTED,
        RuleType AS CONVERT(NVARCHAR(50), JSON_VALUE(Config, N'$.type')) PERSISTED,
        Severity AS CONVERT(NVARCHAR(20), JSON_VALUE(Config, N'$.severity')) PERSISTED,
        ExecutionOrder AS TRY_CONVERT(INT, JSON_VALUE(Config, N'$.executionOrder')) PERSISTED,
        TableName AS CONVERT(NVARCHAR(255), JSON_VALUE(Config, N'$.table')) PERSISTED,
        CONSTRAINT CK_Rules_ConfigJson CHECK (ISJSON(Config) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Rules') AND name = N'IX_Rules_FileDefinitionId_Order')
    CREATE INDEX IX_Rules_FileDefinitionId_Order ON dbo.Rules(FileDefinitionId, ExecutionOrder);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Rules') AND name = N'IX_Rules_IsEnabled')
    CREATE INDEX IX_Rules_IsEnabled ON dbo.Rules(IsEnabled);
GO

IF OBJECT_ID(N'dbo.Rules', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.Rules', N'Name') IS NULL
    THROW 51004, 'Rules computed columns are missing. Recreate the database using the current schema.', 1;
GO

IF OBJECT_ID(N'dbo.ValidationRuleDetails', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ValidationRuleDetails (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_ValidationRuleDetails PRIMARY KEY,
        ValidationResultId NVARCHAR(36) NOT NULL,
        UploadId NVARCHAR(36) NOT NULL,
        RuleId NVARCHAR(36) NULL,
        RuleName NVARCHAR(255) NOT NULL,
        RuleType NVARCHAR(50) NOT NULL,
        RuleSeverity NVARCHAR(20) NOT NULL,
        ExecutionOrder INT NOT NULL,
        Status NVARCHAR(20) NULL,
        IssueCount BIGINT NOT NULL CONSTRAINT DF_ValidationRuleDetails_IssueCount DEFAULT 0,
        Issues NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ValidationRuleDetails_Issues DEFAULT N'[]',
        ElapsedMs BIGINT NOT NULL CONSTRAINT DF_ValidationRuleDetails_ElapsedMs DEFAULT 0,
        Sheet NVARCHAR(255) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ValidationRuleDetails_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_ValidationRuleDetails_Status CHECK (Status IS NULL OR Status IN (N'PASSED', N'WARNING', N'FAILED', N'ERROR')),
        CONSTRAINT CK_ValidationRuleDetails_IssuesJson CHECK (ISJSON(Issues) = 1),
        CONSTRAINT CK_ValidationRuleDetails_Counts CHECK (IssueCount >= 0 AND ElapsedMs >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.ValidationRuleDetails') AND name = N'IX_ValidationRuleDetails_Upload_Order')
    CREATE INDEX IX_ValidationRuleDetails_Upload_Order ON dbo.ValidationRuleDetails(UploadId, ExecutionOrder);
GO

IF OBJECT_ID(N'dbo.UploadSheets', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UploadSheets (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_UploadSheets PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        SheetIndex INT NOT NULL,
        SheetName NVARCHAR(255) NOT NULL,
        RowCountNo BIGINT NULL,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_UploadSheets_Status DEFAULT N'PENDING',
        ValidationProgress INT NULL CONSTRAINT DF_UploadSheets_Progress DEFAULT 0,
        ValidatedRules INT NULL CONSTRAINT DF_UploadSheets_ValidatedRules DEFAULT 0,
        TotalRules INT NULL CONSTRAINT DF_UploadSheets_TotalRules DEFAULT 0,
        DeliveryPath NVARCHAR(500) NULL,
        DeliveredAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_UploadSheets_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_UploadSheets_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.UploadSheets') AND name = N'IX_UploadSheets_UploadId')
    CREATE INDEX IX_UploadSheets_UploadId ON dbo.UploadSheets(UploadId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.UploadSheets') AND name = N'IX_UploadSheets_Status')
    CREATE INDEX IX_UploadSheets_Status ON dbo.UploadSheets(Status);
GO

IF OBJECT_ID(N'dbo.DeliveryRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DeliveryRecords (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_DeliveryRecords PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        UploadSheetId NVARCHAR(36) NULL,
        DeliveryType NVARCHAR(50) NOT NULL,
        DestinationPath NVARCHAR(500) NOT NULL,
        DestinationName NVARCHAR(255) NULL,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_DeliveryRecords_Status DEFAULT N'PENDING',
        ProgressPercent INT NULL CONSTRAINT DF_DeliveryRecords_Progress DEFAULT 0,
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        ErrorMessage NVARCHAR(MAX) NULL,
        RecordsDelivered BIGINT NULL CONSTRAINT DF_DeliveryRecords_RecordsDelivered DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_DeliveryRecords_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.DeliveryRecords') AND name = N'IX_DeliveryRecords_UploadId')
    CREATE INDEX IX_DeliveryRecords_UploadId ON dbo.DeliveryRecords(UploadId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.DeliveryRecords') AND name = N'IX_DeliveryRecords_Status')
    CREATE INDEX IX_DeliveryRecords_Status ON dbo.DeliveryRecords(Status);
GO

IF OBJECT_ID(N'dbo.UploadTasks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UploadTasks (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_UploadTasks PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        TaskType NVARCHAR(50) NOT NULL,
        CurrentStage NVARCHAR(100) NULL,
        TotalStages INT NULL CONSTRAINT DF_UploadTasks_TotalStages DEFAULT 0,
        ProgressPercent INT NOT NULL CONSTRAINT DF_UploadTasks_Progress DEFAULT 0,
        CompletedStages INT NOT NULL CONSTRAINT DF_UploadTasks_CompletedStages DEFAULT 0,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_UploadTasks_Status DEFAULT N'PENDING',
        QueueName NVARCHAR(100) NULL,
        JobId NVARCHAR(36) NULL,
        StartedAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        LastUpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_UploadTasks_LastUpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.UploadAccess', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UploadAccess (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_UploadAccess PRIMARY KEY,
        UploadId NVARCHAR(36) NOT NULL,
        UserId NVARCHAR(36) NOT NULL,
        AccessLevel NVARCHAR(20) NOT NULL CONSTRAINT DF_UploadAccess_Level DEFAULT N'READ',
        GrantedAt DATETIME2 NOT NULL CONSTRAINT DF_UploadAccess_GrantedAt DEFAULT SYSUTCDATETIME(),
        GrantedBy NVARCHAR(36) NOT NULL,
        CONSTRAINT UQ_UploadAccess_Upload_User UNIQUE (UploadId, UserId)
    );
END;
GO
