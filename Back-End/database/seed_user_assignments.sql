-- Development only: run after 001_users.sql, seed_local_users.sql, 002_file_definitions.sql,
-- 003_lookups.sql and the definition seed scripts.
DECLARE @testUserId NVARCHAR(36) = '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA';
DECLARE @adminUserId NVARCHAR(36) = '63BD96E4-1229-4399-8964-0795E50B3574';

INSERT INTO FileDefinitionUserAccess (Id, FileDefinitionId, UserId, AssignedBy)
SELECT NEWID(), fd.Id, @testUserId, @adminUserId
FROM FileDefinitions fd
WHERE fd.Name IN ('Customer Data', 'Product Catalog')
  AND NOT EXISTS (
      SELECT 1 FROM FileDefinitionUserAccess ua
      WHERE ua.FileDefinitionId = fd.Id AND ua.UserId = @testUserId
  );
GO
