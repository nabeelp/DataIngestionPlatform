SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
GO

IF OBJECT_ID(N'dbo.FileDefinitionVersions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FileDefinitionVersions (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_FileDefinitionVersions PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        VersionNumber INT NOT NULL,
        Status NVARCHAR(20) NOT NULL,
        Contract NVARCHAR(MAX) NOT NULL,
        DefinitionMetadata NVARCHAR(MAX) NULL,
        ChangeNote NVARCHAR(500) NULL,
        CreatedBy NVARCHAR(36) NULL,
        ActivatedAt DATETIME2 NOT NULL CONSTRAINT DF_FileDefinitionVersions_ActivatedAt DEFAULT SYSUTCDATETIME(),
        SupersededAt DATETIME2 NULL,
        CONSTRAINT CK_FileDefinitionVersions_Status CHECK (Status IN (N'Active', N'Superseded')),
        CONSTRAINT CK_FileDefinitionVersions_ContractJson CHECK (ISJSON(Contract) = 1),
        CONSTRAINT CK_FileDefinitionVersions_MetadataJson CHECK (DefinitionMetadata IS NULL OR ISJSON(DefinitionMetadata) = 1),
        CONSTRAINT UQ_FileDefinitionVersions_Number UNIQUE (FileDefinitionId, VersionNumber),
        CONSTRAINT FK_FileDefinitionVersions_Definition FOREIGN KEY (FileDefinitionId)
            REFERENCES dbo.FileDefinitions(Id) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID(N'dbo.FileDefinitionVersions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.FileDefinitionVersions', N'Contract') IS NULL
    THROW 51005, 'FileDefinitionVersions uses an incompatible schema. Apply this schema to a clean database.', 1;
GO

IF COL_LENGTH(N'dbo.FileDefinitionVersions', N'DefinitionMetadata') IS NULL
    ALTER TABLE dbo.FileDefinitionVersions ADD DefinitionMetadata NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_FileDefinitionVersions_MetadataJson')
    ALTER TABLE dbo.FileDefinitionVersions ADD CONSTRAINT CK_FileDefinitionVersions_MetadataJson
        CHECK (DefinitionMetadata IS NULL OR ISJSON(DefinitionMetadata) = 1);
GO

UPDATE versions
SET DefinitionMetadata = (
    SELECT definitions.Name AS name,
           definitions.Description AS description,
           definitions.Status AS status,
           definitions.DeliveryFolder AS deliveryFolder,
           definitions.TemplateFilename AS templateFilename
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
)
FROM dbo.FileDefinitionVersions versions
INNER JOIN dbo.FileDefinitions definitions ON definitions.Id = versions.FileDefinitionId
WHERE versions.Status = N'Active' AND versions.DefinitionMetadata IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.FileDefinitionVersions') AND name = N'UX_FileDefinitionVersions_Active')
    CREATE UNIQUE INDEX UX_FileDefinitionVersions_Active
        ON dbo.FileDefinitionVersions(FileDefinitionId)
        WHERE Status = N'Active';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Uploads_FileDefinitionVersion')
    ALTER TABLE dbo.Uploads ADD CONSTRAINT FK_Uploads_FileDefinitionVersion
        FOREIGN KEY (FileDefinitionVersionId) REFERENCES dbo.FileDefinitionVersions(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Uploads') AND name = N'IX_Uploads_FileDefinitionVersionId')
    CREATE INDEX IX_Uploads_FileDefinitionVersionId ON dbo.Uploads(FileDefinitionVersionId);
GO
