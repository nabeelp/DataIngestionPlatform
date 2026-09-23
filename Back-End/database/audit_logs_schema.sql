-- =============================================================================
-- AuditLogs Table Schema
-- =============================================================================

-- Create AuditLogs table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLogs')
BEGIN
    CREATE TABLE [dbo].[AuditLogs] (
        [Id] NVARCHAR(36) PRIMARY KEY,
        [UserId] NVARCHAR(36) NULL,
        [Action] NVARCHAR(100) NOT NULL,
        [EntityType] NVARCHAR(50) NULL,
        [EntityId] NVARCHAR(36) NULL,
        [Details] NVARCHAR(MAX) NULL,
        [IpAddress] NVARCHAR(45) NULL,
        [UserAgent] NVARCHAR(MAX) NULL,
        [Timestamp] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        
        CONSTRAINT [FK_AuditLogs_Users] FOREIGN KEY ([UserId]) 
            REFERENCES [Users]([Id]) ON DELETE SET NULL
    );

    -- Create indexes for common queries
    CREATE INDEX [IX_AuditLogs_UserId] ON [AuditLogs]([UserId]);
    CREATE INDEX [IX_AuditLogs_Action] ON [AuditLogs]([Action]);
    CREATE INDEX [IX_AuditLogs_EntityType] ON [AuditLogs]([EntityType]);
    CREATE INDEX [IX_AuditLogs_Timestamp] ON [AuditLogs]([Timestamp] DESC);
    CREATE INDEX [IX_AuditLogs_UserId_Timestamp] ON [AuditLogs]([UserId], [Timestamp] DESC);

    PRINT 'AuditLogs table created successfully';
END
ELSE
BEGIN
    PRINT 'AuditLogs table already exists';
END
GO
