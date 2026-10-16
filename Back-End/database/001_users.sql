IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id NVARCHAR(36) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Email NVARCHAR(255) NOT NULL CONSTRAINT UQ_Users_Email UNIQUE,
        Username NVARCHAR(255) NOT NULL,
        PasswordHash NVARCHAR(255) NULL,
        FirstName NVARCHAR(255) NULL,
        LastName NVARCHAR(255) NULL,
        Role NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_Role DEFAULT N'user',
        IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
        SsoProvider NVARCHAR(50) NULL,
        SsoSubjectId NVARCHAR(255) NULL,
        IsPasswordAuthEnabled BIT NOT NULL CONSTRAINT DF_Users_PasswordAuth DEFAULT 0,
        IsSsoAuthEnabled BIT NOT NULL CONSTRAINT DF_Users_SsoAuth DEFAULT 0,
        LastLoginAt DATETIME2 NULL,
        FailedLoginAttempts INT NOT NULL CONSTRAINT DF_Users_FailedLoginAttempts DEFAULT 0,
        LockedUntil DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'IX_Users_IsActive_LastLogin')
    CREATE INDEX IX_Users_IsActive_LastLogin ON dbo.Users(IsActive, LastLoginAt DESC);
GO
