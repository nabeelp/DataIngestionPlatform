-- Development only: these IDs match the optional mock accounts in AuthContext and authMiddleware.
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = '63BD96E4-1229-4399-8964-0795E50B3574')
BEGIN
    INSERT INTO dbo.Users (Id, Email, Username, FirstName, LastName, Role)
    VALUES ('63BD96E4-1229-4399-8964-0795E50B3574', 'admin@company.com', 'admin', 'System', 'Administrator', 'admin');
END;
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Id = '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA')
BEGIN
    INSERT INTO dbo.Users (Id, Email, Username, FirstName, LastName, Role)
    VALUES ('1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA', 'user@company.com', 'user', 'Test', 'User', 'user');
END;
GO
