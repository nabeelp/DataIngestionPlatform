IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLogs (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
        UserId NVARCHAR(36) NULL,
        Action NVARCHAR(100) NOT NULL,
        EntityType NVARCHAR(50) NULL,
        EntityId NVARCHAR(36) NULL,
        Details NVARCHAR(MAX) NULL,
        IpAddress NVARCHAR(45) NULL,
        UserAgent NVARCHAR(MAX) NULL,
        [Timestamp] DATETIME2 NOT NULL CONSTRAINT DF_AuditLogs_Timestamp DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AuditLogs_Users FOREIGN KEY (UserId)
            REFERENCES dbo.Users(Id) ON DELETE SET NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_UserId')
    CREATE INDEX IX_AuditLogs_UserId ON dbo.AuditLogs(UserId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_Action')
    CREATE INDEX IX_AuditLogs_Action ON dbo.AuditLogs(Action);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_EntityType')
    CREATE INDEX IX_AuditLogs_EntityType ON dbo.AuditLogs(EntityType);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_Timestamp')
    CREATE INDEX IX_AuditLogs_Timestamp ON dbo.AuditLogs([Timestamp] DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_UserId_Timestamp')
    CREATE INDEX IX_AuditLogs_UserId_Timestamp ON dbo.AuditLogs(UserId, [Timestamp] DESC);
GO
