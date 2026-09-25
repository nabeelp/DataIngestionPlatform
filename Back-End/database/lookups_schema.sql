-- =============================================================================
-- Lookups - reusable reference value lists (for example currency or country codes)
-- =============================================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Lookups')
BEGIN
    CREATE TABLE Lookups (
        Id NVARCHAR(36) PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500) NULL,
        [Values] NVARCHAR(MAX) NOT NULL,  -- JSON array of strings
        CreatedBy NVARCHAR(36) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_Lookups_Name UNIQUE (Name)
    );

    PRINT 'Lookups table created successfully';
END
GO
