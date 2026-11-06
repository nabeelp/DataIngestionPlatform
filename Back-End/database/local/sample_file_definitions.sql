-- Development only: run after the current schema and local/seed_local_users.sql.
-- Idempotent: definitions that already exist (by name) are left unchanged. Each definition is a full versioned contract;
-- publish it in the application before uploading files.
CREATE TABLE #SampleDefinitions (
    Name NVARCHAR(255) NOT NULL,
    Description NVARCHAR(1000) NOT NULL,
    Status NVARCHAR(50) NOT NULL,
    Contract NVARCHAR(MAX) NOT NULL
);

INSERT INTO #SampleDefinitions (Name, Description, Status, Contract)
VALUES
(
    N'Customer Data',
    N'Standard customer information with validation rules for email format, phone number, and required fields',
    N'Active',
    N'{"schemaVersion":1,"layout":"single","ignoredSheets":[],"encoding":"auto","tables":[{"sheet":null,"headerRow":null,"allowExtraColumns":true,"minRows":null,"maxRows":null,"columns":[{"name":"CustomerId","type":"string","mustExist":true,"nullable":false},{"name":"FirstName","type":"string","mustExist":true,"nullable":false},{"name":"LastName","type":"string","mustExist":true,"nullable":false},{"name":"Email","type":"string","mustExist":true,"nullable":false},{"name":"Phone","type":"string","mustExist":true,"nullable":true},{"name":"DateOfBirth","type":"datetime","mustExist":true,"nullable":true},{"name":"Address","type":"string","mustExist":true,"nullable":true},{"name":"City","type":"string","mustExist":true,"nullable":true},{"name":"State","type":"string","mustExist":true,"nullable":true},{"name":"ZipCode","type":"string","mustExist":true,"nullable":true},{"name":"Country","type":"string","mustExist":true,"nullable":false},{"name":"CustomerStatus","type":"string","mustExist":true,"nullable":false}]}],"rules":[],"lookups":{}}'
),
(
    N'Product Catalog',
    N'Product master data with price validation and SKU uniqueness checks',
    N'Active',
    N'{"schemaVersion":1,"layout":"single","ignoredSheets":[],"encoding":"auto","tables":[{"sheet":null,"headerRow":null,"allowExtraColumns":true,"minRows":null,"maxRows":null,"columns":[{"name":"SKU","type":"string","mustExist":true,"nullable":false},{"name":"ProductName","type":"string","mustExist":true,"nullable":false},{"name":"Category","type":"string","mustExist":true,"nullable":false},{"name":"Description","type":"string","mustExist":true,"nullable":true},{"name":"UnitPrice","type":"decimal","mustExist":true,"nullable":false},{"name":"CostPrice","type":"decimal","mustExist":true,"nullable":false},{"name":"StockQuantity","type":"integer","mustExist":true,"nullable":false},{"name":"ReorderLevel","type":"integer","mustExist":true,"nullable":true},{"name":"Supplier","type":"string","mustExist":true,"nullable":true},{"name":"WeightKg","type":"decimal","mustExist":true,"nullable":true},{"name":"Dimensions","type":"string","mustExist":true,"nullable":true},{"name":"Active","type":"boolean","mustExist":true,"nullable":false}]}],"rules":[],"lookups":{}}'
),
(
    N'Sales Orders',
    N'Order data with date range validation and total amount calculations',
    N'Active',
    N'{"schemaVersion":1,"layout":"single","ignoredSheets":[],"encoding":"auto","tables":[{"sheet":null,"headerRow":null,"allowExtraColumns":true,"minRows":null,"maxRows":null,"columns":[{"name":"OrderId","type":"string","mustExist":true,"nullable":false},{"name":"CustomerId","type":"string","mustExist":true,"nullable":false},{"name":"OrderDate","type":"datetime","mustExist":true,"nullable":false},{"name":"ShipDate","type":"datetime","mustExist":true,"nullable":true},{"name":"TotalAmount","type":"decimal","mustExist":true,"nullable":false},{"name":"Currency","type":"string","mustExist":true,"nullable":false},{"name":"PaymentStatus","type":"string","mustExist":true,"nullable":false},{"name":"ShippingAddress","type":"string","mustExist":true,"nullable":false},{"name":"TaxAmount","type":"decimal","mustExist":true,"nullable":true},{"name":"DiscountAmount","type":"decimal","mustExist":true,"nullable":true},{"name":"Notes","type":"string","mustExist":true,"nullable":true}]}],"rules":[],"lookups":{}}'
),
(
    N'Employee HR Data',
    N'Employee onboarding data - currently under review',
    N'Inactive',
    N'{"schemaVersion":1,"layout":"single","ignoredSheets":[],"encoding":"auto","tables":[{"sheet":null,"headerRow":null,"allowExtraColumns":true,"minRows":null,"maxRows":null,"columns":[{"name":"EmployeeId","type":"string","mustExist":true,"nullable":false},{"name":"FirstName","type":"string","mustExist":true,"nullable":false},{"name":"LastName","type":"string","mustExist":true,"nullable":false},{"name":"Email","type":"string","mustExist":true,"nullable":false},{"name":"Department","type":"string","mustExist":true,"nullable":false},{"name":"Position","type":"string","mustExist":true,"nullable":false},{"name":"HireDate","type":"datetime","mustExist":true,"nullable":false},{"name":"Salary","type":"decimal","mustExist":true,"nullable":false},{"name":"ManagerId","type":"string","mustExist":true,"nullable":true}]}],"rules":[],"lookups":{}}'
);

INSERT INTO dbo.FileDefinitions (Id, Name, Description, Contract, Status)
SELECT CONVERT(NVARCHAR(36), NEWID()), sample.Name, sample.Description, sample.Contract, sample.Status
FROM #SampleDefinitions AS sample
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.FileDefinitions AS existing
    WHERE existing.Name = sample.Name
);

DROP TABLE #SampleDefinitions;
GO
