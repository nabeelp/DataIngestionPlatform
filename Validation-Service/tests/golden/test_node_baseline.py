from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_file
from dq_engine.io.models import UnrecoverableFileError

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = ROOT / "samples"
BASELINE = Path(__file__).parent / "node-baseline"
MANIFEST = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))
DEFINITIONS = json.loads(
    (SAMPLES / "definitions" / "sample_definitions.json").read_text(encoding="utf-8")
)
ALLOWED_UPLOAD_EXTENSIONS = {".csv", ".tsv", ".txt", ".xlsx", ".xls"}
WORKBOOK_EXTENSIONS = {".xls", ".xlsx"}
VALIDATION_DATE = date(2026, 1, 1)
# These rule types no longer exist; column definitions (mustExist, nullable, type) perform the same checks.
# Names of the Node baseline checks produced by the removed rule types. The baseline JSON files are frozen
# and carry no rule type, so they are identified by name.
REMOVED_RULE_CHECK_NAMES = frozenset({
    "Key customer columns present",
    "Phone number provided",
    "Employee key columns present",
    "Alternate phone provided",
    "Order and customer identifiers present",
    "Reorder level is a whole number",
    "Invoice has a PO number",
    "Credit note reason provided",
})


def _column_definition(column: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": column["name"],
        "type": column["type"],
        "mustExist": column["required"],
        "nullable": not column["required"],
    }


def _expression_parts(expression: str) -> tuple[str, str]:
    column, separator, value = expression.partition(":")
    if not separator or not column.strip() or not value.strip():
        raise ValueError("Unsupported legacy sample rule expression.")
    return column.strip(), value.strip()


def _legacy_rule(rule: dict[str, Any], definition_id: str, index: int) -> dict[str, Any]:
    legacy_type = rule["ruleType"]
    expression = rule["expression"]
    params: dict[str, Any]

    if legacy_type == "Enum Check":
        column, value = _expression_parts(expression)
        rule_type = "enum"
        params = {
            "column": column,
            "values": [item.strip() for item in value.split(",") if item.strip()],
        }
    elif legacy_type == "Range Check":
        column, value = _expression_parts(expression)
        minimum, separator, maximum = value.partition("..")
        if not separator:
            raise ValueError("Unsupported legacy range expression.")
        rule_type = "range"
        params = {
            "column": column,
            "min": float(minimum) if minimum.strip() else None,
            "max": float(maximum) if maximum.strip() else None,
        }
    else:
        raise ValueError(f"Unsupported legacy sample rule type: {legacy_type}.")

    return {
        "id": f"{definition_id}-{index + 1}",
        "name": rule["name"],
        "description": rule.get("description", ""),
        "severity": rule["severity"],
        "executionOrder": index,
        "enabled": True,
        "table": rule.get("table"),
        "type": rule_type,
        "params": params,
    }


def _contract(definition_id: str) -> DefinitionContract:
    definition = DEFINITIONS[definition_id]
    legacy_tables = definition["tables"]
    tables = legacy_tables or [{"sheet": None, "columns": definition["columns"]}]
    payload = {
        "schemaVersion": 1,
        "layout": "sheets" if legacy_tables else "single",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [
            {
                "sheet": table["sheet"],
                "headerRow": None,
                "allowExtraColumns": True,
                "minRows": None,
                "maxRows": None,
                "columns": [_column_definition(column) for column in table["columns"]],
            }
            for table in tables
        ],
        "rules": [
            _legacy_rule(rule, definition_id, index)
            for index, rule in enumerate(definition["rules"])
        ],
        "lookups": {},
    }
    return DefinitionContract.model_validate(payload)


def _normalize_check_name(name: str, single_layout: bool) -> str:
    if single_layout and name.startswith('Sheet "'):
        return "File definition columns"
    return name


def _python_result(entry: dict[str, Any]) -> dict[str, Any]:
    sample_path = SAMPLES / entry["file"]
    definition_id = entry["definition"]
    contract = _contract(definition_id)
    extension = sample_path.suffix.lower()
    include_sheet = extension in {".xlsx", ".xlsm", ".xls", ".xlsb"}

    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        return {"outcome": "UPLOAD_REJECTED", "reason": "unsupported_extension", "checks": []}
    if sample_path.stat().st_size > MANIFEST["uploadLimitBytes"]:
        return {"outcome": "UPLOAD_REJECTED", "reason": "file_size_limit", "checks": []}
    if contract.layout == "sheets" and extension not in WORKBOOK_EXTENSIONS:
        return {"outcome": "UPLOAD_REJECTED", "reason": "sheet_tables_require_workbook", "checks": []}

    try:
        outcome = validate_file(sample_path, contract, VALIDATION_DATE)
    except UnrecoverableFileError:
        return {"outcome": "READ_ERROR", "checks": []}

    checks = [
        _normalize_check(check, contract.layout == "single", include_sheet)
        for check in outcome.checks
    ]
    if contract.layout == "single":
        checks = _combine_single_layout_checks(checks)
    return {
        "outcome": "VALIDATED",
        "uploadStatus": outcome.status,
        "rowCount": sum(outcome.row_counts.values()),
        "checks": checks,
    }


def _normalize_check(check: Any, single_layout: bool, include_sheet: bool) -> dict[str, Any]:
    issues = []
    for issue in check.issues:
        normalized = {"value": issue.value, "error": issue.message}
        if issue.row is not None:
            normalized["row"] = issue.row
        if issue.column is not None:
            normalized["column"] = issue.column
        if check.sheet and include_sheet:
            normalized["sheet"] = check.sheet
        issues.append(normalized)
    return {
        "name": _normalize_check_name(check.name, single_layout),
        "severity": check.severity,
        "status": check.status,
        "errorCount": check.issue_count,
        "issues": issues,
    }


def _combine_single_layout_checks(checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    combined: dict[str, dict[str, Any]] = {}
    for check in checks:
        existing = combined.get(check["name"])
        if existing is None:
            combined[check["name"]] = {
                **check,
                "issues": list(check["issues"]),
            }
            continue
        existing["errorCount"] += check["errorCount"]
        existing["issues"].extend(check["issues"])
        if "ERROR" in (existing["status"], check["status"]):
            existing["status"] = "ERROR"
        elif "FAILED" in (existing["status"], check["status"]):
            existing["status"] = "FAILED"
        elif "WARNING" in (existing["status"], check["status"]):
            existing["status"] = "WARNING"
        existing["issues"] = existing["issues"][:100]
    return list(combined.values())


def _difference(expected: dict[str, Any], actual: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    for key in ("outcome", "reason", "uploadStatus", "rowCount"):
        if expected.get(key) != actual.get(key):
            differences.append(f"{key} differs (baseline={expected.get(key)}, python={actual.get(key)})")

    expected_checks = {check["name"]: check for check in expected.get("checks", [])}
    actual_checks = {check["name"]: check for check in actual.get("checks", [])}
    missing = sorted(expected_checks.keys() - actual_checks.keys())
    extra = sorted(actual_checks.keys() - expected_checks.keys())
    if missing:
        differences.append(f"missing checks: {', '.join(missing)}")
    if extra:
        differences.append(f"unexpected checks: {', '.join(extra)}")

    for name in sorted(expected_checks.keys() & actual_checks.keys()):
        expected_check = expected_checks[name]
        actual_check = actual_checks[name]
        for key in ("severity", "status", "errorCount"):
            if expected_check[key] != actual_check[key]:
                differences.append(
                    f"{name}: {key} differs "
                    f"(baseline={expected_check[key]}, python={actual_check[key]})"
                )
        if expected_check["issues"] != actual_check["issues"]:
            first_difference = next(
                (
                    f"issues[{index}].{field}"
                    for index, (old_issue, new_issue) in enumerate(
                        zip(expected_check["issues"], actual_check["issues"], strict=False)
                    )
                    for field in sorted(old_issue.keys() | new_issue.keys())
                    if old_issue.get(field) != new_issue.get(field)
                ),
                "issues length",
            )
            differences.append(f"{name}: {first_difference} differs")
    return differences


UPLOADS = [entry for entry in MANIFEST["files"] if entry["kind"] == "upload"]
INTENTIONAL_DIFFERENCES: dict[str, tuple[str, ...]] = {
    "01-single-table/customers/customers_valid_mixed_date_formats.csv": (
        "uploadStatus differs",
        "File definition columns:",
    ),
    "01-single-table/customers/customers_warning_optional_columns_missing.csv": (
        "uploadStatus differs",
    ),
    "01-single-table/customers/customers_invalid_header_case_mismatch.csv": (
        "Country is a supported market:",
        "Customer status allowed values:",
    ),
    "01-single-table/customers/customers_invalid_duplicate_headers.csv": (
        "unexpected checks: Structural validation",
        "File definition columns:",
    ),
    "01-single-table/customers/customers_invalid_ragged_rows.csv": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        "File definition columns:",
    ),
    "01-single-table/customers/customers_empty_file.csv": (
        "Country is a supported market:",
        "Customer status allowed values:",
    ),
    "01-single-table/customers/customers_xlsx_title_row_above_header.xlsx": (
        "unexpected checks: Structural validation",
        "Country is a supported market:",
        "Customer status allowed values:",
    ),
    "01-single-table/customers/customers_xlsx_extra_notes_sheet.xlsx": (
        "Country is a supported market:",
        "Customer status allowed values:",
    ),
    "01-single-table/sales-orders/orders_valid_date_format_variants.csv": (
        "uploadStatus differs",
        "File definition columns:",
    ),
    "01-single-table/sales-orders/orders_quirk_impossible_dates_accepted.csv": (
        "uploadStatus differs",
        "File definition columns:",
    ),
    "02-sheet-tables/finance/finance_valid.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_valid.xls": ("rowCount differs",),
    "02-sheet-tables/finance/finance_valid_sheet_names_case_and_spacing.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_valid_20_ignored_sheets.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_valid_similar_named_ignored_sheets.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_valid_excel_tables_and_formulas.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_invalid_missing_credit_notes_sheet.xlsx": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        'Sheet "Credit Notes" columns:',
    ),
    "02-sheet-tables/finance/finance_invalid_similar_sheet_names_only.xlsx": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        'Sheet "Credit Notes" columns:',
        'Sheet "Invoices" columns:',
        'Sheet "Payments" columns:',
    ),
    "02-sheet-tables/finance/finance_invalid_empty_payments_sheet.xlsx": (
        'Sheet "Payments" columns:',
        "Payment amount range:",
        "Payment method allowed values:",
    ),
    "02-sheet-tables/finance/finance_invalid_errors_in_every_sheet.xlsx": ("rowCount differs",),
    "02-sheet-tables/finance/finance_invalid_missing_required_column.xlsx": (
        "Payment method allowed values:",
    ),
    "02-sheet-tables/finance/finance_invalid_unrelated_workbook.xlsx": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        'Sheet "Credit Notes" columns:',
        'Sheet "Invoices" columns:',
        'Sheet "Payments" columns:',
    ),
    "02-sheet-tables/finance/finance_warning_missing_po_and_reason.xlsx": ("uploadStatus differs",),
    "02-sheet-tables/hr/hr_valid.xlsx": ("rowCount differs",),
    "02-sheet-tables/hr/hr_invalid_sheet_name_without_apostrophe.xlsx": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        """Sheet "Employee Emergency Contacts '26" columns:""",
    ),
    "02-sheet-tables/hr/hr_invalid_missing_employees_and_benefits.xlsx": (
        "rowCount differs",
        "unexpected checks: Structural validation",
        'Sheet "Benefits (2026)" columns:',
        'Sheet "Employees" columns:',
    ),
    "04-file-handling/customers_zero_bytes.xlsx": (
        "uploadStatus differs",
        "File definition columns:",
        "Customer status allowed values:",
        "Country is a supported market:",
    ),
    "04-file-handling/finance_zero_bytes.xlsx": (
        "unexpected checks: Structural validation",
        "Credit note amount range:",
        "Invoice amount is positive:",
        "Invoice currency allowed values:",
        "Invoice status allowed values:",
        "Payment amount range:",
        "Payment method allowed values:",
        'Sheet "Credit Notes" columns:',
        'Sheet "Invoices" columns:',
        'Sheet "Payments" columns:',
    ),
    "04-file-handling/customers_csv_renamed_to_xlsx.xlsx": (
        "outcome differs",
        "uploadStatus differs",
        "rowCount differs",
        "missing checks:",
    ),
    "04-file-handling/customers_random_binary.csv": (
        "outcome differs",
        "uploadStatus differs",
        "rowCount differs",
        "missing checks:",
    ),
    "04-file-handling/customers_utf16le_no_bom.csv": (
        "uploadStatus differs",
        "rowCount differs",
        "File definition columns:",
        "Customer status allowed values:",
        "Country is a supported market:",
    ),
    "04-file-handling/customers_single_column_no_delimiter.txt": (
        "Country is a supported market:",
        "Customer status allowed values:",
    ),
    "05-large/orders_xlsx_excel_max_rows.xlsx": (
        "outcome differs",
        "uploadStatus differs",
        "rowCount differs",
        "unexpected checks:",
    ),
    "05-large/finance_large_used_and_ignored_sheets.xlsx": ("rowCount differs",),
}


@pytest.mark.parametrize("entry", UPLOADS, ids=lambda entry: entry["file"])
def test_node_baseline_equivalence(entry: dict[str, Any]) -> None:
    baseline_path = BASELINE / f"{entry['file']}.json"
    expected = json.loads(baseline_path.read_text(encoding="utf-8"))
    expected["checks"] = [
        check for check in expected.get("checks", []) if check["name"] not in REMOVED_RULE_CHECK_NAMES
    ]
    actual = _python_result(entry)

    differences = _difference(expected, actual)
    allowances = INTENTIONAL_DIFFERENCES.get(entry["file"], ())
    unexplained = [
        difference
        for difference in differences
        if not any(difference.startswith(allowance) for allowance in allowances)
    ]
    missing_allowances = [
        allowance
        for allowance in allowances
        if not any(difference.startswith(allowance) for difference in differences)
    ]
    assert not unexplained and not missing_allowances, (
        f"{entry['file']}: unexplained={unexplained}; "
        f"expected differences not observed={missing_allowances}"
    )


def test_sample_definition_translation_covers_all_legacy_rule_types() -> None:
    legacy_types = {
        rule["ruleType"]
        for definition in DEFINITIONS.values()
        for rule in definition["rules"]
    }

    assert legacy_types == {"Enum Check", "Range Check"}
    assert all(_contract(definition_id).rules for definition_id in DEFINITIONS)
