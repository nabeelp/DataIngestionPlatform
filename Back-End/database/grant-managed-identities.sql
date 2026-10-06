IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'$(ApiIdentityName)'
)
BEGIN
    DECLARE @ApiIdentityClientId UNIQUEIDENTIFIER = '$(ApiIdentityClientId)';
    DECLARE @ApiIdentitySid VARCHAR(34) =
        CONVERT(VARCHAR(34), CONVERT(VARBINARY(16), @ApiIdentityClientId), 1);
    DECLARE @CreateApiIdentityUser NVARCHAR(MAX) =
        N'CREATE USER [$(ApiIdentityName)] WITH SID = ' + @ApiIdentitySid + N', TYPE = E;';
    EXEC (@CreateApiIdentityUser);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS role_members
    INNER JOIN sys.database_principals AS roles
        ON roles.principal_id = role_members.role_principal_id
    INNER JOIN sys.database_principals AS members
        ON members.principal_id = role_members.member_principal_id
    WHERE roles.name = N'db_datareader'
      AND members.name = N'$(ApiIdentityName)'
)
    ALTER ROLE db_datareader ADD MEMBER [$(ApiIdentityName)];

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS role_members
    INNER JOIN sys.database_principals AS roles
        ON roles.principal_id = role_members.role_principal_id
    INNER JOIN sys.database_principals AS members
        ON members.principal_id = role_members.member_principal_id
    WHERE roles.name = N'db_datawriter'
      AND members.name = N'$(ApiIdentityName)'
)
    ALTER ROLE db_datawriter ADD MEMBER [$(ApiIdentityName)];

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'$(WorkerIdentityName)'
)
BEGIN
    DECLARE @WorkerIdentityClientId UNIQUEIDENTIFIER = '$(WorkerIdentityClientId)';
    DECLARE @WorkerIdentitySid VARCHAR(34) =
        CONVERT(VARCHAR(34), CONVERT(VARBINARY(16), @WorkerIdentityClientId), 1);
    DECLARE @CreateWorkerIdentityUser NVARCHAR(MAX) =
        N'CREATE USER [$(WorkerIdentityName)] WITH SID = ' + @WorkerIdentitySid + N', TYPE = E;';
    EXEC (@CreateWorkerIdentityUser);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS role_members
    INNER JOIN sys.database_principals AS roles
        ON roles.principal_id = role_members.role_principal_id
    INNER JOIN sys.database_principals AS members
        ON members.principal_id = role_members.member_principal_id
    WHERE roles.name = N'db_datareader'
      AND members.name = N'$(WorkerIdentityName)'
)
    ALTER ROLE db_datareader ADD MEMBER [$(WorkerIdentityName)];

IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS role_members
    INNER JOIN sys.database_principals AS roles
        ON roles.principal_id = role_members.role_principal_id
    INNER JOIN sys.database_principals AS members
        ON members.principal_id = role_members.member_principal_id
    WHERE roles.name = N'db_datawriter'
      AND members.name = N'$(WorkerIdentityName)'
)
    ALTER ROLE db_datawriter ADD MEMBER [$(WorkerIdentityName)];
