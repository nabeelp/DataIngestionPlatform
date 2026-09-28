"""One-table-per-sheet definitions: Sample - Finance Workbook and Sample - HR Onboarding Workbook."""
from .data import customers, finance, hr, rng, texts, with_changes
from .definitions import (BENEFIT_HEADERS, BENEFITS, B_COST, B_DEPENDENTS, B_PLAN, CN_AMOUNT, CN_REASON, CONTACT_HEADERS,
                          CONTACTS, CREDIT_HEADERS, CREDIT_NOTES, CURRENCIES, CUSTOMER_HEADERS, C_ALT_PHONE,
                          C_RELATIONSHIP, EMPLOYEE_HEADERS, EMPLOYEES, E_DEPT, E_SALARY, INVOICE_HEADERS, INVOICES,
                          I_AMOUNT, I_CURRENCY, I_PO, I_STATUS, PAYMENT_HEADERS, PAYMENTS, PAY_AMOUNT, PAY_METHOD,
                          sheet_check)
from .writers import F, sheet, upload_case, write_delimited, write_xls, write_xlsx

FIN = '02-sheet-tables/finance/'
HR = '02-sheet-tables/hr/'
FI, FP, FC = sheet_check(INVOICES), sheet_check(PAYMENTS), sheet_check(CREDIT_NOTES)
HE, HB, HC = sheet_check(EMPLOYEES), sheet_check(BENEFITS), sheet_check(CONTACTS)

INSTRUCTIONS = [['How to complete this workbook'], [],
                ['1. Fill in the Invoices, Payments and Credit Notes sheets.'],
                ['2. Do not rename the sheets or the header row.'],
                ['3. The Lookups and Summary sheets are for reference only and are not validated.']]


def fin_sheets(inv, pay, cn, **names):
    return [sheet(names.get('invoices', INVOICES), INVOICE_HEADERS, inv, freeze=True),
            sheet(names.get('payments', PAYMENTS), PAYMENT_HEADERS, pay, freeze=True),
            sheet(names.get('credits', CREDIT_NOTES), CREDIT_HEADERS, cn, freeze=True)]


def lookups():
    return sheet('Lookups', ['Currency', 'Method', 'Status'],
                 [[c, m, s] for c, m, s in zip(CURRENCIES + [''], ['Card', 'Cash', 'Cheque', 'EFT', ''],
                                               ['Cancelled', 'Draft', 'Issued', 'Overdue', 'Paid'])])


def summary(inv, pay, cn):
    return sheet('Summary', ['Metric', 'Value'], [
        ['Invoice count', F('=COUNTA(Invoices!A:A)-1', len(inv))],
        ['Invoiced total', F('=SUM(Invoices!E:E)', round(sum(r['Amount'] for r in inv), 2))],
        ['Payments total', F('=SUM(Payments!D:D)', round(sum(r['Amount'] for r in pay), 2))],
        ['Credit notes total', F("=SUM('Credit Notes'!D:D)", round(sum(r['Amount'] for r in cn), 2))],
        ['Outstanding', F("=B3-B4-B5", round(sum(r['Amount'] for r in inv) - sum(r['Amount'] for r in pay) - sum(r['Amount'] for r in cn), 2))],
    ])


def junk_sheet(name, offset):
    r = rng(900 + offset)
    return sheet(name, ['Col A', 'Col B', 'Amount', 'When'],
                 [[f'junk-{i}', r.choice(['x', '', 'n/a', '???']), r.choice(['abc', -5, 1e12, '']), r.choice(['never', 'soon', ''])]
                  for i in range(r.randint(5, 40))])


def build_finance():
    inv, pay, cn = finance()
    valid = [sheet('Instructions', rows=INSTRUCTIONS), *fin_sheets(inv, pay, cn), lookups(), summary(inv, pay, cn),
             sheet('Scratch', ['temp'], [['working notes']], state='hidden'),
             sheet('Config', ['Key', 'Value'], [['version', '3.2'], ['owner', 'finance-ops']], state='veryhidden')]
    write_xlsx(FIN + 'finance_valid.xlsx', valid)
    upload_case(FIN + 'finance_valid.xlsx', 'finance', 'PASSED',
                'All three table sheets plus ignored Instructions/Lookups/Summary (formulas), a hidden and a very-hidden sheet.',
                rows=None)

    write_xls(FIN + 'finance_valid.xls', [*fin_sheets(inv, pay, cn), sheet('Notes', ['Note'], [['Legacy export']])])
    upload_case(FIN + 'finance_valid.xls', 'finance', 'PASSED', 'Legacy .xls workbook with the three table sheets.')

    shuffled = fin_sheets(inv, pay, cn, invoices='  INVOICES ', payments='payments', credits='credit NOTES')
    write_xlsx(FIN + 'finance_valid_sheet_names_case_and_spacing.xlsx', [shuffled[2], lookups(), shuffled[0], shuffled[1]])
    upload_case(FIN + 'finance_valid_sheet_names_case_and_spacing.xlsx', 'finance', 'PASSED',
                'Sheets matched ignoring case and surrounding spaces, in any order.')

    many = [*fin_sheets(inv, pay, cn)] + [junk_sheet(f'Extra {i:02d}', i) for i in range(1, 21)]
    write_xlsx(FIN + 'finance_valid_20_ignored_sheets.xlsx', many)
    upload_case(FIN + 'finance_valid_20_ignored_sheets.xlsx', 'finance', 'PASSED',
                '20 extra sheets full of invalid data are ignored (not validated).')

    old = with_changes(inv[:20], {0: {'Amount': 'abc', 'Status': 'Void'}, 1: {'Currency': 'JPY'}})
    write_xlsx(FIN + 'finance_valid_similar_named_ignored_sheets.xlsx', [
        *fin_sheets(inv, pay, cn), sheet('Invoices (old)', INVOICE_HEADERS, old), sheet('Invoices_backup', INVOICE_HEADERS, old),
        sheet('Payments 2025', PAYMENT_HEADERS, with_changes(pay[:5], {0: {'Method': 'Bitcoin'}}))])
    upload_case(FIN + 'finance_valid_similar_named_ignored_sheets.xlsx', 'finance', 'PASSED',
                'Look-alike sheets ("Invoices (old)", "Invoices_backup", "Payments 2025") contain bad data but are not table sheets.')

    hidden = fin_sheets(inv, pay, cn)
    hidden[1]['state'] = 'hidden'
    write_xlsx(FIN + 'finance_valid_hidden_table_sheet.xlsx', hidden)
    upload_case(FIN + 'finance_valid_hidden_table_sheet.xlsx', 'finance', 'PASSED', 'A hidden table sheet (Payments) is still found and validated.')

    write_xlsx(FIN + 'finance_valid_header_only_credit_notes.xlsx', fin_sheets(inv, pay, []))
    upload_case(FIN + 'finance_valid_header_only_credit_notes.xlsx', 'finance', 'PASSED',
                'Credit Notes has a header row and no data rows: the table is present, so it passes.')

    formatted = []
    for i, row in enumerate(inv):
        net = round(row['Amount'] / 1.15, 2)
        tax = round(row['Amount'] - net, 2)
        formatted.append({**row, 'Amount': F(f'=I{i + 2}+J{i + 2}', round(net + tax, 2)), 'Net': net, 'Tax': tax})
    write_xlsx(FIN + 'finance_valid_excel_tables_and_formulas.xlsx', [
        sheet(INVOICES, INVOICE_HEADERS + ['Net', 'Tax'], formatted, table=True, table_name='InvoiceTable'),
        sheet(PAYMENTS, PAYMENT_HEADERS, pay, table=True, table_name='PaymentTable'),
        sheet(CREDIT_NOTES, CREDIT_HEADERS, cn, table=True, table_name='CreditNoteTable'), summary(inv, pay, cn)])
    upload_case(FIN + 'finance_valid_excel_tables_and_formulas.xlsx', 'finance', 'PASSED',
                'Each table sheet is an Excel Table; Invoice Amount is a formula (=Net+Tax) with extra helper columns.')

    warn_inv = with_changes(inv, {3: {'PONumber': None}, 17: {'PONumber': ''}})
    warn_cn = with_changes(cn, {0: {'Reason': None}})
    write_xlsx(FIN + 'finance_warning_missing_po_and_reason.xlsx', fin_sheets(warn_inv, pay, warn_cn))
    upload_case(FIN + 'finance_warning_missing_po_and_reason.xlsx', 'finance', 'WARNING',
                'Optional PONumber/Reason missing: only the Warning rules for those sheets fail.',
                warnings=[I_PO, CN_REASON], error_counts={I_PO: 2, CN_REASON: 1})

    write_xlsx(FIN + 'finance_invalid_missing_credit_notes_sheet.xlsx', [sheet('Instructions', rows=INSTRUCTIONS), *fin_sheets(inv, pay, cn)[:2]])
    upload_case(FIN + 'finance_invalid_missing_credit_notes_sheet.xlsx', 'finance', 'FAILED',
                'A required table sheet is missing: its columns check fails; its rules have nothing to check.', failed=[FC])

    write_xlsx(FIN + 'finance_invalid_similar_sheet_names_only.xlsx', fin_sheets(inv, pay, cn, invoices='Invoice', payments='Payments 2026', credits='CreditNotes'))
    upload_case(FIN + 'finance_invalid_similar_sheet_names_only.xlsx', 'finance', 'FAILED',
                'Near-miss names ("Invoice", "Payments 2026", "CreditNotes") do not match, so all three sheets are missing.',
                failed=[FI, FP, FC])

    write_xlsx(FIN + 'finance_invalid_empty_payments_sheet.xlsx', [fin_sheets(inv, pay, cn)[0], sheet(PAYMENTS), fin_sheets(inv, pay, cn)[2]])
    upload_case(FIN + 'finance_invalid_empty_payments_sheet.xlsx', 'finance', 'FAILED',
                'A completely empty "Payments" sheet has no header row and is reported as not found.', failed=[FP])

    bad_inv = with_changes(inv, {0: {'Amount': 'abc'}, 1: {'Status': 'Void'}, 2: {'Currency': 'JPY'},
                                 3: {'InvoiceDate': '2026-13-01'}, 4: {'Amount': 0.0}})
    bad_pay = with_changes(pay, {0: {'Method': 'Bitcoin'}, 1: {'Amount': 300000.0}, 2: {'PaymentDate': 'yesterday'}})
    bad_cn = with_changes(cn, {0: {'Amount': 0.0}, 1: {'IssueDate': None}, 2: {'Amount': 75000.0}})
    write_xlsx(FIN + 'finance_invalid_errors_in_every_sheet.xlsx', [sheet('Instructions', rows=INSTRUCTIONS), *fin_sheets(bad_inv, bad_pay, bad_cn)])
    upload_case(FIN + 'finance_invalid_errors_in_every_sheet.xlsx', 'finance', 'FAILED',
                'Type, enum, range and required-value errors in each table; issues are reported with their sheet name.',
                failed=[FI, I_STATUS, I_CURRENCY, I_AMOUNT, FP, PAY_METHOD, PAY_AMOUNT, FC, CN_AMOUNT],
                error_counts={I_AMOUNT: 2, CN_AMOUNT: 2})

    no_method = [{k: v for k, v in row.items() if k != 'Method'} for row in pay]
    write_xlsx(FIN + 'finance_invalid_missing_required_column.xlsx', [
        fin_sheets(inv, pay, cn)[0], sheet(PAYMENTS, [h for h in PAYMENT_HEADERS if h != 'Method'], no_method), fin_sheets(inv, pay, cn)[2]])
    upload_case(FIN + 'finance_invalid_missing_required_column.xlsx', 'finance', 'FAILED',
                'Payments lacks its required Method column: the sheet check and the Method rule fail.', failed=[FP, PAY_METHOD])

    write_xlsx(FIN + 'finance_invalid_unrelated_workbook.xlsx', [sheet('Sheet1', CUSTOMER_HEADERS, customers(20))])
    upload_case(FIN + 'finance_invalid_unrelated_workbook.xlsx', 'finance', 'FAILED',
                'The wrong workbook (a customer list) for a sheet-table definition: every table sheet is missing.', failed=[FI, FP, FC])

    write_delimited(FIN + 'finance_rejected_csv_upload.csv', INVOICE_HEADERS, inv)
    upload_case(FIN + 'finance_rejected_csv_upload.csv', 'finance', 'UPLOAD_REJECTED',
                'CSV files have no sheets, so sheet-table definitions reject them at upload (HTTP 400).')

    write_xlsx(FIN + 'finance_valid_values_stored_as_text.xlsx', fin_sheets(texts(inv), texts(pay), texts(cn)))
    upload_case(FIN + 'finance_valid_values_stored_as_text.xlsx', 'finance', 'PASSED', 'All dates and amounts are text cells (e.g. pasted from a CSV).')


def hr_sheets(e, b, c, contacts=CONTACTS):
    return [sheet(EMPLOYEES, EMPLOYEE_HEADERS, e, freeze=True), sheet(BENEFITS, BENEFIT_HEADERS, b),
            sheet(contacts, CONTACT_HEADERS, c)]


def build_hr():
    emp, ben, con = hr()
    base = hr_sheets
    org = sheet('Org Chart', ['EmployeeId', 'ReportsTo'], [[r['EmployeeId'], r['ManagerId']] for r in emp])
    write_xlsx(HR + 'hr_valid.xlsx', [sheet('Instructions', rows=[['New starter pack'], [], ['Complete all three data sheets.']]), *base(emp, ben, con), org])
    upload_case(HR + 'hr_valid.xlsx', 'hr', 'PASSED',
                "Sheet names with parentheses and a 31-character name with an apostrophe; Instructions and Org Chart are ignored.")

    ue, ub, uc = hr(30, offset=1, unicode=True)
    write_xlsx(HR + 'hr_valid_unicode_and_emoji.xlsx', base(ue, ub, uc))
    upload_case(HR + 'hr_valid_unicode_and_emoji.xlsx', 'hr', 'PASSED', 'Non-Latin scripts, accents and emoji in names.')

    bad_emp = with_changes(emp, {0: {'Department': 'Legal'}, 1: {'Salary': 5000.0}, 2: {'Department': 'engineering'}})
    bad_ben = with_changes(ben, {0: {'Plan': 'Gold'}, 1: {'Dependents': 11}, 2: {'Dependents': -1}})
    write_xlsx(HR + 'hr_invalid_values.xlsx', base(bad_emp, bad_ben, con))
    upload_case(HR + 'hr_invalid_values.xlsx', 'hr', 'FAILED', 'Enum and range errors in the Employees and Benefits sheets.',
                failed=[E_DEPT, E_SALARY, B_PLAN, B_DEPENDENTS], error_counts={E_DEPT: 2, B_DEPENDENTS: 2})

    write_xlsx(HR + 'hr_invalid_sheet_name_without_apostrophe.xlsx', base(emp, ben, con, contacts='Employee Emergency Contacts 26'))
    upload_case(HR + 'hr_invalid_sheet_name_without_apostrophe.xlsx', 'hr', 'FAILED',
                'The contacts sheet is named without the apostrophe, so it is not matched.', failed=[HC])

    warn_ben = with_changes(ben, {4: {'MonthlyCost': 6200.0}})
    warn_con = with_changes(con, {0: {'Relationship': 'Cousin'}, 1: {'AltPhone': None}, 2: {'AltPhone': None}})
    write_xlsx(HR + 'hr_warning_cost_relationship_alt_phone.xlsx', base(emp, warn_ben, warn_con))
    upload_case(HR + 'hr_warning_cost_relationship_alt_phone.xlsx', 'hr', 'WARNING', 'Only Warning rules in two sheets fail.',
                warnings=[B_COST, C_RELATIONSHIP, C_ALT_PHONE], error_counts={C_ALT_PHONE: 2})

    type_emp = with_changes(emp, {0: {'FullTime': 'Part-time'}, 1: {'HireDate': 'N/A'}, 2: {'FullTime': 2}})
    type_ben = with_changes(ben, {0: {'Dependents': 2.5}, 1: {'Dependents': 'two'}, 2: {'EffectiveDate': None}})
    write_xlsx(HR + 'hr_invalid_boolean_integer_and_date_types.xlsx', base(type_emp, type_ben, con))
    upload_case(HR + 'hr_invalid_boolean_integer_and_date_types.xlsx', 'hr', 'FAILED',
                'Non-boolean FullTime (text and the number 2), non-integer Dependents, bad and missing dates.',
                failed=[HE, HB, B_DEPENDENTS], error_counts={HE: 3, HB: 3, B_DEPENDENTS: 1})

    write_xlsx(HR + 'hr_invalid_missing_employees_and_benefits.xlsx', [base(emp, ben, con)[2], org])
    upload_case(HR + 'hr_invalid_missing_employees_and_benefits.xlsx', 'hr', 'FAILED', 'Only one of the three table sheets is present.', failed=[HE, HB])


def build():
    build_finance()
    build_hr()
