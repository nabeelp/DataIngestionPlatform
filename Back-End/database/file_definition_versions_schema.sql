-- =============================================================================
-- File Definition Versions
-- A version is an immutable snapshot of a definition's columns and enabled rules.
-- Exactly one version per definition is Active; uploads are pinned to the version active when they arrive.
-- Run after upload_system_tables.sql (and after any sample/seed scripts). Idempotent: re-running it
-- only publishes an initial version for definitions that have none.
-- =============================================================================

-- Required for the filtered unique index (sqlcmd defaults it to OFF; use sqlcmd -I or keep this line).
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'FileDefinitionVersions')
BEGIN
    CREATE TABLE FileDefinitionVersions (
        Id NVARCHAR(36) PRIMARY KEY,
        FileDefinitionId NVARCHAR(36) NOT NULL,
        VersionNumber INT NOT NULL,
        Status NVARCHAR(20) NOT NULL,        -- Active | Superseded
        Columns NVARCHAR(MAX) NOT NULL,      -- JSON array of {name, type, required}
        Rules NVARCHAR(MAX) NOT NULL,        -- JSON array of enabled rule snapshots
        ChangeNote NVARCHAR(500) NULL,
        CreatedBy NVARCHAR(36) NULL,
        ActivatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        SupersededAt DATETIME2 NULL,
        CONSTRAINT CK_FileDefinitionVersions_Status CHECK (Status IN ('Active', 'Superseded'))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_FileDefinitionVersions_Number')
BEGIN
    CREATE UNIQUE INDEX UX_FileDefinitionVersions_Number ON FileDefinitionVersions(FileDefinitionId, VersionNumber);
END;
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_FileDefinitionVersions_Active')
BEGIN
    CREATE UNIQUE INDEX UX_FileDefinitionVersions_Active ON FileDefinitionVersions(FileDefinitionId) WHERE Status = 'Active';
END;
GO

IF COL_LENGTH('dbo.Uploads', 'FileDefinitionVersionId') IS NULL
BEGIN
    ALTER TABLE dbo.Uploads ADD FileDefinitionVersionId NVARCHAR(36) NULL;
END;
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Uploads_FileDefinitionVersionId')
BEGIN
    CREATE INDEX IX_Uploads_FileDefinitionVersionId ON dbo.Uploads(FileDefinitionVersionId);
END;
GO

-- Publish version 1 from the current configuration for definitions that have never been versioned.
INSERT INTO FileDefinitionVersions (Id, FileDefinitionId, VersionNumber, Status, Columns, Rules, ChangeNote, CreatedBy, ActivatedAt)
SELECT
    LOWER(CONVERT(NVARCHAR(36), NEWID())),
    fd.Id,
    1,
    'Active',
    fd.Columns,
    ISNULL((
        SELECT
            LOWER(CONVERT(NVARCHAR(36), r.Id)) AS Id,
            r.Name,
            ISNULL(r.Description, '') AS Description,
            r.RuleType,
            r.Severity,
            r.ExecutionOrder,
            r.SqlQuery
        FROM Rules r
        WHERE r.FileDefinitionId = fd.Id AND r.IsEnabled = 1
        ORDER BY r.ExecutionOrder, r.Id
        FOR JSON PATH
    ), '[]'),
    'Initial version',
    NULL,
    GETUTCDATE()
FROM FileDefinitions fd
WHERE NOT EXISTS (SELECT 1 FROM FileDefinitionVersions v WHERE v.FileDefinitionId = fd.Id);

PRINT CONCAT('Initial versions published: ', @@ROWCOUNT);
GO

-- Uploads from before versioning were validated against the configuration captured as version 1.
UPDATE u SET FileDefinitionVersionId = v.Id
FROM Uploads u
INNER JOIN FileDefinitionVersions v ON v.FileDefinitionId = u.FileDefinitionId AND v.VersionNumber = 1
WHERE u.FileDefinitionVersionId IS NULL;

PRINT CONCAT('Existing uploads pinned to version 1: ', @@ROWCOUNT);
GO
