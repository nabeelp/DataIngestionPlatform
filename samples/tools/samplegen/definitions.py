"""File definitions (and their rules) that the sample files are validated against.

The single-table definitions use exactly the same columns as the seeded definitions in
Back-End/database/sample_file_definitions.sql, so their sample files also work with those.
"""
import json


def col(name, type_='string', required=True):
    return {'name': name, 'type': type_, 'required': required}


def rule(name, rule_type, expression, severity='Error', table=None, description=''):
    return {'name': name, 'ruleType': rule_type, 'expression': expression, 'severity': severity,
            'table': table, 'description': description}


COLUMNS_CHECK = 'File definition columns'


def sheet_check(sheet):
    return f'Sheet "{sheet}" columns'


CUSTOMER_HEADERS = ['CustomerId', 'FirstName', 'LastName', 'Email', 'Phone', 'DateOfBirth', 'Address',
                    'City', 'State', 'ZipCode', 'Country', 'CustomerStatus']
PRODUCT_HEADERS = ['SKU', 'ProductName', 'Category', 'Description', 'UnitPrice', 'CostPrice', 'StockQuantity',
                   'ReorderLevel', 'Supplier', 'WeightKg', 'Dimensions', 'Active']
ORDER_HEADERS = ['OrderId', 'CustomerId', 'OrderDate', 'ShipDate', 'TotalAmount', 'Currency', 'PaymentStatus',
                 'ShippingAddress', 'TaxAmount', 'DiscountAmount', 'Notes']
INVOICE_HEADERS = ['InvoiceId', 'CustomerId', 'InvoiceDate', 'DueDate', 'Amount', 'Currency', 'Status', 'PONumber']
PAYMENT_HEADERS = ['PaymentId', 'InvoiceId', 'PaymentDate', 'Amount', 'Method', 'Reference']
CREDIT_HEADERS = ['CreditNoteId', 'InvoiceId', 'IssueDate', 'Amount', 'Reason']
EMPLOYEE_HEADERS = ['EmployeeId', 'FirstName', 'LastName', 'Email', 'Department', 'Position', 'HireDate', 'Salary',
                    'FullTime', 'ManagerId']
BENEFIT_HEADERS = ['EmployeeId', 'Plan', 'Dependents', 'MonthlyCost', 'EffectiveDate']
CONTACT_HEADERS = ['EmployeeId', 'ContactName', 'Relationship', 'Phone', 'AltPhone']

INVOICES, PAYMENTS, CREDIT_NOTES = 'Invoices', 'Payments', 'Credit Notes'
EMPLOYEES, BENEFITS = 'Employees', 'Benefits (2026)'
# Exactly 31 characters (Excel's sheet name limit), including an apostrophe.
CONTACTS = "Employee Emergency Contacts '26"
assert len(CONTACTS) == 31

CUSTOMER_STATUSES = ['Active', 'Inactive', 'Prospect']
COUNTRIES = ['US', 'CA', 'GB', 'ZA', 'AU', 'DE', 'FR', 'IN']
CATEGORIES = ['Apparel', 'Electronics', 'Garden', 'Home', 'Sports', 'Toys']
CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR']
PAYMENT_STATUSES = ['Failed', 'Paid', 'Pending', 'Refunded']
INVOICE_STATUSES = ['Cancelled', 'Draft', 'Issued', 'Overdue', 'Paid']
PAYMENT_METHODS = ['Card', 'Cash', 'Cheque', 'EFT']
DEPARTMENTS = ['Engineering', 'Finance', 'HR', 'Operations', 'Sales']
PLANS = ['Basic', 'Premium', 'Standard']
RELATIONSHIPS = ['Child', 'Friend', 'Other', 'Parent', 'Partner', 'Sibling', 'Spouse']

# Rule names, used by scenarios to state which checks are expected to fail or warn.
R_STATUS, R_COUNTRY, R_PHONE, R_KEY = ('Customer status allowed values', 'Country is a supported market',
                                        'Phone number provided', 'Key customer columns present')
P_PRICE, P_STOCK, P_WEIGHT, P_REORDER, P_CATEGORY, P_REORDER_TYPE = (
    'Unit price range', 'Stock quantity range', 'Weight is not negative', 'Reorder level ceiling',
    'Category allowed values', 'Reorder level is a whole number')
O_CURRENCY, O_PAYMENT, O_TOTAL, O_DISCOUNT, O_IDS = (
    'Currency allowed values', 'Payment status allowed values', 'Order total range', 'Discount is not negative',
    'Order and customer identifiers present')
I_STATUS, I_CURRENCY, I_AMOUNT, I_PO = ('Invoice status allowed values', 'Invoice currency allowed values',
                                        'Invoice amount is positive', 'Invoice has a PO number')
PAY_METHOD, PAY_AMOUNT = 'Payment method allowed values', 'Payment amount range'
CN_AMOUNT, CN_REASON = 'Credit note amount range', 'Credit note reason provided'
E_DEPT, E_SALARY, E_KEY = 'Department allowed values', 'Salary range', 'Employee key columns present'
B_PLAN, B_DEPENDENTS, B_COST = 'Benefit plan allowed values', 'Dependents range', 'Monthly cost within budget'
C_RELATIONSHIP, C_ALT_PHONE = 'Relationship allowed values', 'Alternate phone provided'

DEFINITIONS = {
    'customers': {
        'name': 'Sample - Customers',
        'description': 'Sample single-table definition (same columns as "Customer Data") with enum, required-value and schema rules.',
        'columns': [col('CustomerId'), col('FirstName'), col('LastName'), col('Email'), col('Phone', required=False),
                    col('DateOfBirth', 'datetime', False), col('Address', required=False), col('City', required=False),
                    col('State', required=False), col('ZipCode', required=False), col('Country'), col('CustomerStatus')],
        'tables': [],
        'rules': [
            rule(R_STATUS, 'Enum Check', 'CustomerStatus: ' + ', '.join(CUSTOMER_STATUSES)),
            rule(R_COUNTRY, 'Enum Check', 'Country: ' + ', '.join(COUNTRIES), 'Warning'),
            rule(R_PHONE, 'Required Values', 'Phone', 'Warning'),
            rule(R_KEY, 'Schema Validation', 'CustomerId, Email'),
        ],
    },
    'products': {
        'name': 'Sample - Products',
        'description': 'Sample single-table definition (same columns as "Product Catalog") with range, enum and type rules.',
        'columns': [col('SKU'), col('ProductName'), col('Category'), col('Description', required=False),
                    col('UnitPrice', 'decimal'), col('CostPrice', 'decimal'), col('StockQuantity', 'integer'),
                    col('ReorderLevel', 'integer', False), col('Supplier', required=False),
                    col('WeightKg', 'decimal', False), col('Dimensions', required=False), col('Active', 'boolean')],
        'tables': [],
        'rules': [
            rule(P_PRICE, 'Range Check', 'UnitPrice: 0..100000'),
            rule(P_STOCK, 'Range Check', 'StockQuantity: 0..10000'),
            rule(P_WEIGHT, 'Range Check', 'WeightKg: 0..', 'Warning'),
            rule(P_REORDER, 'Range Check', 'ReorderLevel: ..500', 'Warning'),
            rule(P_CATEGORY, 'Enum Check', 'Category: ' + ', '.join(CATEGORIES)),
            rule(P_REORDER_TYPE, 'Type Check', 'ReorderLevel: integer', 'Warning'),
        ],
    },
    'orders': {
        'name': 'Sample - Sales Orders',
        'description': 'Sample single-table definition (same columns as "Sales Orders") used for format, date and large-file tests.',
        'columns': [col('OrderId'), col('CustomerId'), col('OrderDate', 'datetime'), col('ShipDate', 'datetime', False),
                    col('TotalAmount', 'decimal'), col('Currency'), col('PaymentStatus'), col('ShippingAddress'),
                    col('TaxAmount', 'decimal', False), col('DiscountAmount', 'decimal', False),
                    col('Notes', required=False)],
        'tables': [],
        'rules': [
            rule(O_CURRENCY, 'Enum Check', 'Currency: ' + ', '.join(CURRENCIES)),
            rule(O_PAYMENT, 'Enum Check', 'PaymentStatus: ' + ', '.join(PAYMENT_STATUSES)),
            rule(O_TOTAL, 'Range Check', 'TotalAmount: 0..1000000'),
            rule(O_DISCOUNT, 'Range Check', 'DiscountAmount: 0..', 'Warning'),
            rule(O_IDS, 'Required Values', 'OrderId, CustomerId'),
        ],
    },
    'finance': {
        'name': 'Sample - Finance Workbook',
        'description': 'Sample one-table-per-sheet definition: Invoices, Payments and Credit Notes; other sheets are ignored.',
        'columns': [],
        'tables': [
            {'sheet': INVOICES, 'columns': [col('InvoiceId'), col('CustomerId'), col('InvoiceDate', 'datetime'),
                                            col('DueDate', 'datetime', False), col('Amount', 'decimal'), col('Currency'),
                                            col('Status'), col('PONumber', required=False)]},
            {'sheet': PAYMENTS, 'columns': [col('PaymentId'), col('InvoiceId'), col('PaymentDate', 'datetime'),
                                            col('Amount', 'decimal'), col('Method'), col('Reference', required=False)]},
            {'sheet': CREDIT_NOTES, 'columns': [col('CreditNoteId'), col('InvoiceId'), col('IssueDate', 'datetime'),
                                                col('Amount', 'decimal'), col('Reason', required=False)]},
        ],
        'rules': [
            rule(I_STATUS, 'Enum Check', 'Status: ' + ', '.join(INVOICE_STATUSES), table=INVOICES),
            rule(I_CURRENCY, 'Enum Check', 'Currency: ' + ', '.join(CURRENCIES), table=INVOICES),
            rule(I_AMOUNT, 'Range Check', 'Amount: 0.01..', table=INVOICES),
            rule(I_PO, 'Required Values', 'PONumber', 'Warning', table=INVOICES),
            rule(PAY_METHOD, 'Enum Check', 'Method: ' + ', '.join(PAYMENT_METHODS), table=PAYMENTS),
            rule(PAY_AMOUNT, 'Range Check', 'Amount: 0.01..250000', table=PAYMENTS),
            rule(CN_AMOUNT, 'Range Check', 'Amount: 0.01..50000', table=CREDIT_NOTES),
            rule(CN_REASON, 'Required Values', 'Reason', 'Warning', table=CREDIT_NOTES),
        ],
    },
    'hr': {
        'name': 'Sample - HR Onboarding Workbook',
        'description': 'Sample one-table-per-sheet definition with special-character and 31-character sheet names.',
        'columns': [],
        'tables': [
            {'sheet': EMPLOYEES, 'columns': [col('EmployeeId'), col('FirstName'), col('LastName'), col('Email'),
                                             col('Department'), col('Position'), col('HireDate', 'datetime'),
                                             col('Salary', 'decimal'), col('FullTime', 'boolean'),
                                             col('ManagerId', required=False)]},
            {'sheet': BENEFITS, 'columns': [col('EmployeeId'), col('Plan'), col('Dependents', 'integer'),
                                            col('MonthlyCost', 'decimal'), col('EffectiveDate', 'datetime')]},
            {'sheet': CONTACTS, 'columns': [col('EmployeeId'), col('ContactName'), col('Relationship'), col('Phone'),
                                            col('AltPhone', required=False)]},
        ],
        'rules': [
            rule(E_DEPT, 'Enum Check', 'Department: ' + ', '.join(DEPARTMENTS), table=EMPLOYEES),
            rule(E_SALARY, 'Range Check', 'Salary: 10000..1000000', table=EMPLOYEES),
            rule(E_KEY, 'Schema Validation', 'EmployeeId, Email', table=EMPLOYEES),
            rule(B_PLAN, 'Enum Check', 'Plan: ' + ', '.join(PLANS), table=BENEFITS),
            rule(B_DEPENDENTS, 'Range Check', 'Dependents: 0..10', table=BENEFITS),
            rule(B_COST, 'Range Check', 'MonthlyCost: 0..5000', 'Warning', table=BENEFITS),
            rule(C_RELATIONSHIP, 'Enum Check', 'Relationship: ' + ', '.join(RELATIONSHIPS), 'Warning', table=CONTACTS),
            rule(C_ALT_PHONE, 'Required Values', 'AltPhone', 'Warning', table=CONTACTS),
        ],
    },
}


def _sql_text(value):
    return 'NULL' if value is None else "N'" + str(value).replace("'", "''") + "'"


def definitions_sql():
    """Idempotent T-SQL that creates the sample definitions, their rules and demo user access."""
    lines = [
        '-- Sample definitions used by the files in samples/. GENERATED by samples/tools/generate_samples.py; do not edit.',
        '-- Run against the application database after the scripts in Back-End/database (and seed_local_users.sql),',
        '-- then re-run Back-End/database/file_definition_versions_schema.sql to publish version 1 of each new definition.',
        '-- Idempotent: a definition that already exists (by name) is left unchanged.',
        'SET QUOTED_IDENTIFIER ON;', 'GO', '',
    ]
    for d in DEFINITIONS.values():
        tables = json.dumps(d['tables']) if d['tables'] else None
        lines += [
            f'-- {d["name"]} ({"one table per sheet" if d["tables"] else "one table"})',
            f'IF NOT EXISTS (SELECT 1 FROM FileDefinitions WHERE Name = {_sql_text(d["name"])})',
            'BEGIN',
            '    DECLARE @id NVARCHAR(36) = LOWER(CONVERT(NVARCHAR(36), NEWID()));',
            '    INSERT INTO FileDefinitions (Id, Name, Description, Columns, Tables, Status)',
            f'    VALUES (@id, {_sql_text(d["name"])}, {_sql_text(d["description"])}, {_sql_text(json.dumps(d["columns"]))}, {_sql_text(tables)}, \'Active\');',
        ]
        for order, r in enumerate(d['rules'], start=1):
            lines.append(
                '    INSERT INTO Rules (Id, FileDefinitionId, Name, Description, RuleType, Severity, ExecutionOrder, SqlQuery, IsEnabled, TableName)'
                f' VALUES (NEWID(), @id, {_sql_text(r["name"])}, {_sql_text(r["description"] or None)}, {_sql_text(r["ruleType"])},'
                f' {_sql_text(r["severity"])}, {order}, {_sql_text(r["expression"])}, 1, {_sql_text(r["table"])});')
        lines += [f"    PRINT 'Created {d['name']}';", 'END', 'GO', '']
    names = ', '.join(_sql_text(d['name']) for d in DEFINITIONS.values())
    lines += [
        '-- Give the seeded local test user access to the sample definitions (skipped when the user does not exist).',
        "DECLARE @testUserId NVARCHAR(36) = '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA';",
        "DECLARE @adminUserId NVARCHAR(36) = '63BD96E4-1229-4399-8964-0795E50B3574';",
        'IF EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @testUserId)',
        '    INSERT INTO FileDefinitionUserAccess (Id, FileDefinitionId, UserId, AssignedBy)',
        '    SELECT NEWID(), fd.Id, @testUserId, @adminUserId FROM FileDefinitions fd',
        f'    WHERE fd.Name IN ({names})',
        '      AND NOT EXISTS (SELECT 1 FROM FileDefinitionUserAccess ua WHERE ua.FileDefinitionId = fd.Id AND ua.UserId = @testUserId);',
        'GO', '',
    ]
    return '\n'.join(lines)
