-- Sample File Definitions for Admin Testing
-- Run after file_definitions_schema.sql and upload_system_tables.sql

USE [YourDatabaseName];
GO

-- Customer Upload Definition
DECLARE @customerId NVARCHAR(36) = NEWID();
INSERT INTO FileDefinitions (Id, Name, Description, Columns, Status)
VALUES (
  @customerId,
  'Customer Data',
  'Standard customer information with validation rules for email format, phone number, and required fields',
  N'[
    {"name": "CustomerId", "type": "string", "required": true},
    {"name": "FirstName", "type": "string", "required": true},
    {"name": "LastName", "type": "string", "required": true},
    {"name": "Email", "type": "string", "required": true},
    {"name": "Phone", "type": "string", "required": false},
    {"name": "DateOfBirth", "type": "datetime", "required": false},
    {"name": "Address", "type": "string", "required": false},
    {"name": "City", "type": "string", "required": false},
    {"name": "State", "type": "string", "required": false},
    {"name": "ZipCode", "type": "string", "required": false},
    {"name": "Country", "type": "string", "required": true},
    {"name": "CustomerStatus", "type": "string", "required": true}
  ]',
  'Active'
);

PRINT 'Customer Data definition created with ID: ' + @customerId;
GO

-- Product Upload Definition
DECLARE @productId NVARCHAR(36) = NEWID();
INSERT INTO FileDefinitions (Id, Name, Description, Columns, Status)
VALUES (
  @productId,
  'Product Catalog',
  'Product master data with price validation and SKU uniqueness checks',
  N'[
    {"name": "SKU", "type": "string", "required": true},
    {"name": "ProductName", "type": "string", "required": true},
    {"name": "Category", "type": "string", "required": true},
    {"name": "Description", "type": "string", "required": false},
    {"name": "UnitPrice", "type": "decimal", "required": true},
    {"name": "CostPrice", "type": "decimal", "required": true},
    {"name": "StockQuantity", "type": "integer", "required": true},
    {"name": "ReorderLevel", "type": "integer", "required": false},
    {"name": "Supplier", "type": "string", "required": false},
    {"name": "WeightKg", "type": "decimal", "required": false},
    {"name": "Dimensions", "type": "string", "required": false},
    {"name": "Active", "type": "boolean", "required": true}
  ]',
  'Active'
);

PRINT 'Product Catalog definition created with ID: ' + @productId;
GO

-- Order Upload Definition
DECLARE @orderId NVARCHAR(36) = NEWID();
INSERT INTO FileDefinitions (Id, Name, Description, Columns, Status)
VALUES (
  @orderId,
  'Sales Orders',
  'Order data with date range validation and total amount calculations',
  N'[
    {"name": "OrderId", "type": "string", "required": true},
    {"name": "CustomerId", "type": "string", "required": true},
    {"name": "OrderDate", "type": "datetime", "required": true},
    {"name": "ShipDate", "type": "datetime", "required": false},
    {"name": "TotalAmount", "type": "decimal", "required": true},
    {"name": "Currency", "type": "string", "required": true},
    {"name": "PaymentStatus", "type": "string", "required": true},
    {"name": "ShippingAddress", "type": "string", "required": true},
    {"name": "TaxAmount", "type": "decimal", "required": false},
    {"name": "DiscountAmount", "type": "decimal", "required": false},
    {"name": "Notes", "type": "string", "required": false}
  ]',
  'Active'
);

PRINT 'Sales Orders definition created with ID: ' + @orderId;
GO

-- HR Employee Upload Definition (Inactive for demo)
DECLARE @hrId NVARCHAR(36) = NEWID();
INSERT INTO FileDefinitions (Id, Name, Description, Columns, Status)
VALUES (
  @hrId,
  'Employee HR Data',
  'Employee onboarding data - currently under review',
  N'[
    {"name": "EmployeeId", "type": "string", "required": true},
    {"name": "FirstName", "type": "string", "required": true},
    {"name": "LastName", "type": "string", "required": true},
    {"name": "Email", "type": "string", "required": true},
    {"name": "Department", "type": "string", "required": true},
    {"name": "Position", "type": "string", "required": true},
    {"name": "HireDate", "type": "datetime", "required": true},
    {"name": "Salary", "type": "decimal", "required": true},
    {"name": "ManagerId", "type": "string", "required": false}
  ]',
  'Inactive'
);

PRINT 'Employee HR Data definition created with ID: ' + @hrId;
GO

PRINT 'All sample file definitions created successfully!';
GO
