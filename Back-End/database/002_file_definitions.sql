IF OBJECT_ID(N'dbo.FileDefinitions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FileDefinitions (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_FileDefinitions PRIMARY KEY,
        Name NVARCHAR(255) NOT NULL,
        Description NVARCHAR(1000) NULL,
        Contract NVARCHAR(MAX) NOT NULL
            CONSTRAINT DF_FileDefinitions_Contract DEFAULT N'{"schemaVersion":1,"layout":"single","ignoredSheets":[],"encoding":"auto","tables":[{"sheet":null,"headerRow":null,"allowExtraColumns":true,"minRows":null,"maxRows":null,"columns":[]}],"rules":[],"lookups":{}}',
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_FileDefinitions_Status DEFAULT N'Active',
        TemplateFilename NVARCHAR(255) NULL,
        DeliveryFolder NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_FileDefinitions_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_FileDefinitions_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_FileDefinitions_ContractJson CHECK (ISJSON(Contract) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.FileDefinitions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.FileDefinitions', N'Contract') IS NULL
    THROW 51001, 'FileDefinitions uses an incompatible schema. Apply this schema to a clean database.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.FileDefinitions') AND name = N'IX_FileDefinitions_Status')
    CREATE INDEX IX_FileDefinitions_Status ON dbo.FileDefinitions(Status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.FileDefinitions') AND name = N'IX_FileDefinitions_CreatedAt')
    CREATE INDEX IX_FileDefinitions_CreatedAt ON dbo.FileDefinitions(CreatedAt DESC);
GO

IF OBJECT_ID(N'dbo.FileDefinitionUserAccess', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FileDefinitionUserAccess (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_FileDefinitionUserAccess PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        UserId NVARCHAR(36) NOT NULL,
        AssignedAt DATETIME2 NOT NULL CONSTRAINT DF_FileDefinitionUserAccess_AssignedAt DEFAULT SYSUTCDATETIME(),
        AssignedBy NVARCHAR(36) NULL,
        CONSTRAINT UQ_FileDefinitionUserAccess_User UNIQUE (FileDefinitionId, UserId),
        CONSTRAINT FK_FileDefinitionUserAccess_FileDefinition FOREIGN KEY (FileDefinitionId)
            REFERENCES dbo.FileDefinitions(Id) ON DELETE CASCADE,
        CONSTRAINT FK_FileDefinitionUserAccess_User FOREIGN KEY (UserId)
            REFERENCES dbo.Users(Id) ON DELETE CASCADE
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.FileDefinitionUserAccess') AND name = N'IX_FileDefinitionUserAccess_UserId')
    CREATE INDEX IX_FileDefinitionUserAccess_UserId ON dbo.FileDefinitionUserAccess(UserId);
GO
