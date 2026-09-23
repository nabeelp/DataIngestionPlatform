-- Seed User Assignments for File Definitions
-- Run AFTER sample_file_definitions.sql to populate dropdown for test user

USE [YourDatabaseName];
GO

-- Test user IDs from frontend AuthContext.tsx (must match Users table)
DECLARE @testUserId NVARCHAR(36) = &#39;1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA&#39;;  -- user@company.com
DECLARE @adminUserId NVARCHAR(36) = &#39;63BD96E4-1229-4399-8964-0795E50B3574&#39;;   -- admin@company.com

PRINT &#39;Assigning test user to sample definitions...&#39;;

-- Assign to Customer Data
INSERT INTO FileDefinitionUserAccess (Id, FileDefinitionId, UserId, AssignedBy) 
SELECT NEWID(), fd.Id, @testUserId, @adminUserId 
FROM FileDefinitions fd 
WHERE fd.Name = &#39;Customer Data&#39;
  AND NOT EXISTS (SELECT 1 FROM FileDefinitionUserAccess ua WHERE ua.FileDefinitionId = fd.Id AND ua.UserId = @testUserId);

PRINT &#39;Customer Data assignment:&#39; + CASE WHEN @@ROWCOUNT > 0 THEN &#39;Success&#39; ELSE &#39;Skipped (exists)&#39; END;

-- Assign to Product Catalog
INSERT INTO FileDefinitionUserAccess (Id, FileDefinitionId, UserId, AssignedBy) 
SELECT NEWID(), fd.Id, @testUserId, @adminUserId 
FROM FileDefinitions fd 
WHERE fd.Name = &#39;Product Catalog&#39;
  AND NOT EXISTS (SELECT 1 FROM FileDefinitionUserAccess ua WHERE ua.FileDefinitionId = fd.Id AND ua.UserId = @testUserId);

PRINT &#39;Product Catalog assignment:&#39; + CASE WHEN @@ROWCOUNT > 0 THEN &#39;Success&#39; ELSE &#39;Skipped (exists)&#39; END;

-- List current assignments for test user
SELECT 
  fd.Name,
  fd.Description,
  fua.AssignedAt
FROM FileDefinitionUserAccess fua
INNER JOIN FileDefinitions fd ON fua.FileDefinitionId = fd.Id
WHERE fua.UserId = @testUserId
ORDER BY fua.AssignedAt DESC;

PRINT &#39;Test user assignments complete! Test dropdown in Upload page.&#39;;
GO

