"""Deterministic, realistic row builders. Values use native Python types (date, float, int, bool); CSV writers
convert them to text, Excel writers keep them as native cell types."""
import random
from datetime import date, datetime, timedelta

from .definitions import (CATEGORIES, COUNTRIES, CURRENCIES, CUSTOMER_STATUSES, DEPARTMENTS, INVOICE_STATUSES,
                          PAYMENT_METHODS, PAYMENT_STATUSES, PLANS, RELATIONSHIPS)

SEED = 20260927

FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth',
         'Thabo', 'Naledi', 'Sipho', 'Lerato', 'Priya', 'Arjun', 'Wei', 'Mei', 'Hans', 'Greta', 'Pierre', 'Claire',
         'Liam', 'Olivia', 'Noah', 'Emma', 'Aiden', 'Chloe', 'Ethan', 'Grace']
LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Nkosi', 'Dlamini',
        'Mokoena', 'Patel', 'Sharma', 'Chen', 'Wang', 'Schmidt', 'Muller', 'Dubois', 'Martin', 'Taylor',
        'Anderson', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Young']
UNICODE_FIRST = ['José', 'Zoë', 'Søren', 'Chloé', 'Björn', 'Ångström', 'Łukasz', 'Dvořák', 'Nguyễn', 'Мария',
                 'Αλέξανδρος', '李', '佐藤', 'محمد', 'שרה', 'Siyabonga', 'Renée', 'Ñandú', 'Øyvind', '🙂 Smiley']
UNICODE_LAST = ['García', 'Müller', 'Ødegaard', 'Kovačević', 'Straße', 'Łódź', 'Иванова', 'Παπαδόπουλος',
                '王', '山田', 'العلي', 'כהן', "O'Brien", 'Van der Merwe', 'D’Angelo', 'Nuñez', 'Çelik', 'Şahin']
PLACES = [('New York', 'NY', 'US'), ('Seattle', 'WA', 'US'), ('Austin', 'TX', 'US'), ('Toronto', 'ON', 'CA'),
          ('Vancouver', 'BC', 'CA'), ('London', 'ENG', 'GB'), ('Manchester', 'ENG', 'GB'), ('Johannesburg', 'GP', 'ZA'),
          ('Cape Town', 'WC', 'ZA'), ('Durban', 'KZN', 'ZA'), ('Sydney', 'NSW', 'AU'), ('Melbourne', 'VIC', 'AU'),
          ('Berlin', 'BE', 'DE'), ('Munich', 'BY', 'DE'), ('Paris', 'IDF', 'FR'), ('Lyon', 'ARA', 'FR'),
          ('Mumbai', 'MH', 'IN'), ('Bengaluru', 'KA', 'IN')]
STREETS = ['Main St', 'Oak Avenue', 'Church Street', 'Long Street', 'High Road', 'Park Lane', 'Station Road',
           'Victoria Street', 'Jan Smuts Avenue', 'Rue de Rivoli', 'Hauptstraße', 'MG Road']
ADJECTIVES = ['Compact', 'Premium', 'Eco', 'Smart', 'Classic', 'Ultra', 'Portable', 'Deluxe', 'Rugged', 'Wireless']
NOUNS = {'Apparel': ['Jacket', 'T-Shirt', 'Sneakers', 'Cap'], 'Electronics': ['Headphones', 'Charger', 'Speaker', 'Monitor'],
         'Garden': ['Hose', 'Planter', 'Shears', 'Sprinkler'], 'Home': ['Kettle', 'Lamp', 'Blender', 'Toaster'],
         'Sports': ['Yoga Mat', 'Dumbbell', 'Bicycle Helmet', 'Tennis Racket'], 'Toys': ['Puzzle', 'Robot Kit', 'Kite', 'Board Game']}
SUPPLIERS = ['Contoso Ltd', 'Fabrikam Inc', 'Northwind Traders', 'Tailspin Toys', 'Wide World Importers', 'Adventure Works']
POSITIONS = {'Engineering': ['Software Engineer', 'SRE', 'Engineering Manager'], 'Finance': ['Accountant', 'Controller'],
             'HR': ['HR Partner', 'Recruiter'], 'Operations': ['Ops Analyst', 'Logistics Lead'],
             'Sales': ['Account Executive', 'Sales Manager']}
REASONS = ['Damaged in transit', 'Pricing error', 'Returned goods', 'Duplicate invoice', 'Goodwill credit']
NOTES = ['', '', '', 'Leave at reception', 'Gift wrap', 'Call before delivery', 'Fragile, handle with care']


def rng(offset=0):
    return random.Random(SEED + offset)


def rand_date(r, start=date(2025, 1, 1), days=600):
    return start + timedelta(days=r.randrange(days))


def phone(r):
    return f'+1-555-{r.randint(100, 999)}-{r.randint(1000, 9999)}'


def customer(i, r, unicode=False):
    first = r.choice(UNICODE_FIRST if unicode else FIRST)
    last = r.choice(UNICODE_LAST if unicode else LAST)
    city, state, country = r.choice(PLACES)
    return {
        'CustomerId': f'CUST-{i:06d}', 'FirstName': first, 'LastName': last,
        'Email': f'customer{i}@example.com' if unicode else f'{first}.{last}{i}@example.com'.lower(),
        'Phone': phone(r), 'DateOfBirth': rand_date(r, date(1950, 1, 1), 365 * 55),
        'Address': f'{r.randint(1, 9999)} {r.choice(STREETS)}', 'City': city, 'State': state,
        'ZipCode': f'{r.randint(0, 99999):05d}', 'Country': country, 'CustomerStatus': r.choice(CUSTOMER_STATUSES),
    }


def customers(n, offset=0, start=1, unicode=False):
    r = rng(offset)
    return [customer(i, r, unicode) for i in range(start, start + n)]


def product(i, r):
    category = r.choice(CATEGORIES)
    cost = round(r.uniform(1, 800), 2)
    return {
        'SKU': f'SKU-{i:05d}', 'ProductName': f'{r.choice(ADJECTIVES)} {r.choice(NOUNS[category])}',
        'Category': category, 'Description': f'{category} item #{i} for everyday use',
        'UnitPrice': round(cost * r.uniform(1.1, 2.5), 2), 'CostPrice': cost,
        'StockQuantity': r.randint(0, 10000), 'ReorderLevel': r.randint(0, 500), 'Supplier': r.choice(SUPPLIERS),
        'WeightKg': round(r.uniform(0.05, 45), 3),
        'Dimensions': f'{r.randint(5, 120)}x{r.randint(5, 80)}x{r.randint(1, 60)} cm', 'Active': r.random() < 0.85,
    }


def products(n, offset=0):
    r = rng(100 + offset)
    return [product(i, r) for i in range(1, n + 1)]


def order(i, r):
    ordered = rand_date(r, date(2025, 1, 1), 600)
    total = round(r.uniform(5, 25000), 2)
    city, _, country = r.choice(PLACES)
    return {
        'OrderId': f'SO-{i:08d}', 'CustomerId': f'CUST-{r.randint(1, 50000):06d}', 'OrderDate': ordered,
        'ShipDate': ordered + timedelta(days=r.randint(0, 10)) if r.random() < 0.9 else None,
        'TotalAmount': total, 'Currency': r.choice(CURRENCIES), 'PaymentStatus': r.choice(PAYMENT_STATUSES),
        'ShippingAddress': f'{r.randint(1, 9999)} {r.choice(STREETS)}, {city}, {country}',
        'TaxAmount': round(total * 0.15, 2), 'DiscountAmount': round(r.choice([0, 0, 0, 5, 10, 25.5]), 2),
        'Notes': r.choice(NOTES),
    }


def orders(n, offset=0, start=1):
    r = rng(200 + offset)
    return [order(i, r) for i in range(start, start + n)]


def order_text_rows(n, offset=0):
    """Fast generator of CSV-ready order rows (used for the very large files)."""
    r = rng(300 + offset)
    base = date(2025, 1, 1).toordinal()
    places = [f'{c}, {k}' for c, _, k in PLACES]
    for i in range(1, n + 1):
        ordered = date.fromordinal(base + r.randrange(600))
        total = round(r.uniform(5, 25000), 2)
        yield [f'SO-{i:08d}', f'CUST-{r.randint(1, 50000):06d}', ordered.isoformat(),
               (ordered + timedelta(days=r.randint(0, 10))).isoformat(), f'{total:.2f}', r.choice(CURRENCIES),
               r.choice(PAYMENT_STATUSES), f'{r.randint(1, 9999)} {r.choice(STREETS)}, {r.choice(places)}',
               f'{total * 0.15:.2f}', r.choice(['0', '0', '5', '10']), r.choice(NOTES)]


def invoice(i, r):
    issued = rand_date(r, date(2026, 1, 1), 240)
    return {
        'InvoiceId': f'INV-{i:07d}', 'CustomerId': f'CUST-{r.randint(1, 5000):06d}', 'InvoiceDate': issued,
        'DueDate': issued + timedelta(days=30), 'Amount': round(r.uniform(50, 90000), 2),
        'Currency': r.choice(CURRENCIES), 'Status': r.choice(INVOICE_STATUSES), 'PONumber': f'PO-{r.randint(10000, 99999)}',
    }


def payment(i, r, invoice_count):
    return {
        'PaymentId': f'PAY-{i:07d}', 'InvoiceId': f'INV-{r.randint(1, max(invoice_count, 1)):07d}',
        'PaymentDate': rand_date(r, date(2026, 1, 15), 240), 'Amount': round(r.uniform(10, 90000), 2),
        'Method': r.choice(PAYMENT_METHODS), 'Reference': f'REF{r.randint(100000, 999999)}',
    }


def credit_note(i, r, invoice_count):
    return {
        'CreditNoteId': f'CN-{i:06d}', 'InvoiceId': f'INV-{r.randint(1, max(invoice_count, 1)):07d}',
        'IssueDate': rand_date(r, date(2026, 2, 1), 200), 'Amount': round(r.uniform(5, 20000), 2),
        'Reason': r.choice(REASONS),
    }


def finance(invoices_n=120, payments_n=90, credits_n=15, offset=0):
    r = rng(400 + offset)
    return ([invoice(i, r) for i in range(1, invoices_n + 1)],
            [payment(i, r, invoices_n) for i in range(1, payments_n + 1)],
            [credit_note(i, r, invoices_n) for i in range(1, credits_n + 1)])


def hr(n=40, offset=0, unicode=False):
    r = rng(500 + offset)
    employees, benefits, contacts = [], [], []
    for i in range(1, n + 1):
        dept = r.choice(DEPARTMENTS)
        first = r.choice(UNICODE_FIRST if unicode else FIRST)
        last = r.choice(UNICODE_LAST if unicode else LAST)
        eid = f'EMP-{i:05d}'
        employees.append({
            'EmployeeId': eid, 'FirstName': first, 'LastName': last, 'Email': f'employee{i}@contoso.example',
            'Department': dept, 'Position': r.choice(POSITIONS[dept]), 'HireDate': rand_date(r, date(2015, 1, 1), 4000),
            'Salary': float(r.randrange(25000, 250000, 500)), 'FullTime': r.random() < 0.8,
            'ManagerId': f'EMP-{r.randint(1, max(i - 1, 1)):05d}' if i > 1 else None,
        })
        benefits.append({'EmployeeId': eid, 'Plan': r.choice(PLANS), 'Dependents': r.randint(0, 5),
                         'MonthlyCost': round(r.uniform(80, 4500), 2), 'EffectiveDate': date(2026, 1, 1)})
        contacts.append({'EmployeeId': eid, 'ContactName': f'{r.choice(FIRST)} {last}',
                         'Relationship': r.choice(RELATIONSHIPS), 'Phone': phone(r), 'AltPhone': phone(r)})
    return employees, benefits, contacts


def with_changes(rows, changes):
    """Copy rows, applying {row_index: {column: value}} overrides (value None blanks the cell)."""
    result = [dict(row) for row in rows]
    for index, update in changes.items():
        result[index].update(update)
    return result


def texts(rows):
    """Render every value as text (as a CSV export would)."""
    from .writers import to_text
    return [{k: to_text(v) for k, v in row.items()} for row in rows]


def now_stamp():
    return datetime(2026, 9, 27, 9, 0)
