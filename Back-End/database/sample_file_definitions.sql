-- Development only: run after the current schema and seed_local_users.sql.
CREATE TABLE #SampleDefinitions (
    Name NVARCHAR(255) NOT NULL,
    Description NVARCHAR(1000) NOT NULL,
    Status NVARCHAR(50) NOT NULL,
    LegacyColumns NVARCHAR(MAX) NOT NULL
);

INSERT INTO #SampleDefinitions (Name, Description, Status, LegacyColumns)
VALUES
(
    N'Customer Data',
    N'Standard customer information with validation rules for email format, phone number, and required fields',
    N'Active',
    N'[{"name":"CustomerId","type":"string","required":true},{"name":"FirstName","type":"string","required":true},{"name":"LastName","type":"string","required":true},{"name":"Email","type":"string","required":true},{"name":"Phone","type":"string","required":false},{"name":"DateOfBirth","type":"datetime","required":false},{"name":"Address","type":"string","required":false},{"name":"City","type":"string","required":false},{"name":"State","type":"string","required":false},{"name":"ZipCode","type":"string","required":false},{"name":"Country","type":"string","required":true},{"name":"CustomerStatus","type":"string","required":true}]'
),
(
    N'Product Catalog',
    N'Product master data with price validation and SKU uniqueness checks',
    N'Active',
    N'[{"name":"SKU","type":"string","required":true},{"name":"ProductName","type":"string","required":true},{"name":"Category","type":"string","required":true},{"name":"Description","type":"string","required":false},{"name":"UnitPrice","type":"decimal","required":true},{"name":"CostPrice","type":"decimal","required":true},{"name":"StockQuantity","type":"integer","required":true},{"name":"ReorderLevel","type":"integer","required":false},{"name":"Supplier","type":"string","required":false},{"name":"WeightKg","type":"decimal","required":false},{"name":"Dimensions","type":"string","required":false},{"name":"Active","type":"boolean","required":true}]'
),
(
    N'Sales Orders',
    N'Order data with date range validation and total amount calculations',
    N'Active',
    N'[{"name":"OrderId","type":"string","required":true},{"name":"CustomerId","type":"string","required":true},{"name":"OrderDate","type":"datetime","required":true},{"name":"ShipDate","type":"datetime","required":false},{"name":"TotalAmount","type":"decimal","required":true},{"name":"Currency","type":"string","required":true},{"name":"PaymentStatus","type":"string","required":true},{"name":"ShippingAddress","type":"string","required":true},{"name":"TaxAmount","type":"decimal","required":false},{"name":"DiscountAmount","type":"decimal","required":false},{"name":"Notes","type":"string","required":false}]'
),
(
    N'Employee HR Data',
    N'Employee onboarding data - currently under review',
    N'Inactive',
    N'[{"name":"EmployeeId","type":"string","required":true},{"name":"FirstName","type":"string","required":true},{"name":"LastName","type":"string","required":true},{"name":"Email","type":"string","required":true},{"name":"Department","type":"string","required":true},{"name":"Position","type":"string","required":true},{"name":"HireDate","type":"datetime","required":true},{"name":"Salary","type":"decimal","required":true},{"name":"ManagerId","type":"string","required":false}]'
);

INSERT INTO dbo.FileDefinitions (Id, Name, Description, Contract, Status)
SELECT
    CONVERT(NVARCHAR(36), NEWID()),
    sample.Name,
    sample.Description,
    (
        SELECT
            1 AS schemaVersion,
            N'single' AS layout,
            JSON_QUERY(N'[]') AS ignoredSheets,
            N'auto' AS encoding,
            JSON_QUERY((
                SELECT
                    CAST(NULL AS NVARCHAR(255)) AS sheet,
                    CAST(NULL AS INT) AS headerRow,
                    CAST(1 AS BIT) AS allowExtraColumns,
                    CAST(NULL AS INT) AS minRows,
                    CAST(NULL AS INT) AS maxRows,
                    JSON_QUERY((
                        SELECT
                            columns.[name],
                            columns.[type],
                            CAST(1 AS BIT) AS mustExist,
                            CAST(CASE WHEN columns.IsRequired = 1 THEN 0 ELSE 1 END AS BIT) AS nullable
                        FROM OPENJSON(sample.LegacyColumns)
                        WITH (
                            [name] NVARCHAR(255) '$.name',
                            [type] NVARCHAR(50) '$.type',
                            IsRequired BIT '$.required'
                        ) AS columns
                        FOR JSON PATH
                    )) AS columns
                FOR JSON PATH, INCLUDE_NULL_VALUES
            )) AS tables,
            JSON_QUERY(N'[]') AS rules,
            JSON_QUERY(N'{}') AS lookups
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ),
    sample.Status
FROM #SampleDefinitions AS sample
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.FileDefinitions AS existing
    WHERE existing.Name = sample.Name
);

DROP TABLE #SampleDefinitions;
GO
