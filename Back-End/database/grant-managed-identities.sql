IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'$(ApiIdentityName)'
)
BEGIN
    CREATE USER [$(ApiIdentityName)]
        FROM EXTERNAL PROVIDER
        WITH OBJECT_ID = '$(ApiIdentityPrincipalId)';
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
    CREATE USER [$(WorkerIdentityName)]
        FROM EXTERNAL PROVIDER
        WITH OBJECT_ID = '$(WorkerIdentityPrincipalId)';
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
