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
        TemplateFilename NVARCHAR(255) NULL,
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

IF COL_LENGTH('dbo.FileDefinitions', 'TemplateFilename') IS NULL
BEGIN
    ALTER TABLE dbo.FileDefinitions ADD TemplateFilename NVARCHAR(255) NULL;
END;
GO

-- Optional delivery folder (relative to DELIVERY_ROOT_PATH). NULL means uploads finish as VALIDATED.
IF COL_LENGTH('dbo.FileDefinitions', 'DeliveryFolder') IS NULL
BEGIN
    ALTER TABLE dbo.FileDefinitions ADD DeliveryFolder NVARCHAR(500) NULL;
END;
GO

-- One table per workbook sheet: JSON array of {sheet, columns: [{name, type, required}]}.
-- NULL (or empty) means a single table: Columns apply to CSV files and to every sheet of a workbook.
IF COL_LENGTH('dbo.FileDefinitions', 'Tables') IS NULL
BEGIN
    ALTER TABLE dbo.FileDefinitions ADD Tables NVARCHAR(MAX) NULL;
END;
GO
