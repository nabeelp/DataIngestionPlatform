IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id NVARCHAR(36) NOT NULL PRIMARY KEY,
        Email NVARCHAR(255) NOT NULL UNIQUE,
        Username NVARCHAR(255) NOT NULL,
        PasswordHash NVARCHAR(255) NULL,
        FirstName NVARCHAR(255) NULL,
        LastName NVARCHAR(255) NULL,
        Role NVARCHAR(20) NOT NULL DEFAULT 'user',
        IsActive BIT NOT NULL DEFAULT 1,
        SsoProvider NVARCHAR(50) NULL,
        SsoSubjectId NVARCHAR(255) NULL,
        IsPasswordAuthEnabled BIT NOT NULL DEFAULT 0,
        IsSsoAuthEnabled BIT NOT NULL DEFAULT 0,
        LastLoginAt DATETIME2 NULL,
        FailedLoginAttempts INT NOT NULL DEFAULT 0,
        LockedUntil DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_Users_IsActive_LastLogin ON dbo.Users(IsActive, LastLoginAt DESC);
END;
GO
