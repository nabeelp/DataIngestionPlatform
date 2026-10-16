IF OBJECT_ID(N'dbo.Lookups', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Lookups (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_Lookups PRIMARY KEY,
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500) NULL,
        [Values] NVARCHAR(MAX) NOT NULL,
        CreatedBy NVARCHAR(36) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Lookups_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Lookups_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Lookups_Name UNIQUE (Name),
        CONSTRAINT CK_Lookups_ValuesJson CHECK (ISJSON([Values]) = 1)
    );
END;
GO
