-- FileDefinitions Table Schema
-- Required for File Definitions page

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FileDefinitions')
BEGIN
    CREATE TABLE FileDefinitions (
        Id NVARCHAR(36) PRIMARY KEY,
        Name NVARCHAR(255) NOT NULL,
        Description NVARCHAR(1000) NULL,
        Columns NVARCHAR(MAX) NOT NULL,  -- JSON array of {name, type, required}
        Status NVARCHAR(50) NOT NULL DEFAULT 'Active',
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_FileDefinitions_Status ON FileDefinitions(Status);
    CREATE INDEX IX_FileDefinitions_CreatedAt ON FileDefinitions(CreatedAt DESC);
    
    PRINT 'FileDefinitions table created successfully';
END
ELSE
BEGIN
    PRINT 'FileDefinitions table already exists';
END
GO
