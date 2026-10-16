from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import polars as pl
import pytest

from dq_engine.benchmark import (
    benchmark_contract,
    generate_xlsx,
    natural_language_benchmark_contract,
)
from dq_engine.cli import main as cli_main
from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_file, validate_parsed, write_outputs
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable
from dq_engine.io.readers import read_file

ROOT = Path(__file__).resolve().parents[3]

def _contract(
    columns: list[dict[str, object]] | None = None,
    rules: list[dict[str, object]] | None = None,
    lookups: dict[str, dict[str, object]] | None = None,
    *,
    min_rows: int | None = None,
    max_rows: int | None = None,
    layout: str = "single",
    sheet: str | None = None,
) -> DefinitionContract:
    return DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": layout,
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [{
            "sheet": sheet,
            "headerRow": None,
            "allowExtraColumns": True,
            "minRows": min_rows,
            "maxRows": max_rows,
            "columns": columns or [],
        }],
        "rules": rules or [],
        "lookups": lookups or {},
    })


def _rule(rule_type: str, params: dict[str, object]) -> dict[str, object]:
    return {
        "id": f"rule-{rule_type}",
        "name": f"{rule_type} check",
        "description": "",
        "severity": "Error",
        "executionOrder": 1,
        "enabled": True,
        "table": None,
        "type": rule_type,
        "params": params,
    }


def _validate(path: Path, contract: DefinitionContract):
    return validate_file(path, contract, date(2025, 1, 15))


def test_A1_empty_file_reports_required_column(tmp_path: Path) -> None:
    path = tmp_path / "empty.csv"
    path.write_bytes(b"")
    contract = _contract(columns=[{
        "name": "RequiredId",
        "type": "string",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)

    assert result.status == "FAILED"
    assert any('Required column "RequiredId" not found' in issue.message
               for check in result.checks for issue in check.issues)


def test_A1_zero_byte_workbook_reports_required_column(tmp_path: Path) -> None:
    path = tmp_path / "empty.xlsx"
    path.write_bytes(b"")
    contract = _contract(columns=[{
        "name": "RequiredId",
        "type": "string",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)

    assert result.status == "FAILED"
    assert any('Required column "RequiredId" not found' in issue.message
               for check in result.checks for issue in check.issues)


def test_A1_missing_required_sheet_is_reported() -> None:
    path = ROOT / "samples" / "02-sheet-tables" / "finance" / "finance_valid_hidden_table_sheet.xlsx"
    contract = _contract(layout="sheets", sheet="Missing")

    result = _validate(path, contract)

    assert result.status == "FAILED"
    assert any(
        issue.code == "missing_sheet" and issue.message == 'Required sheet "Missing" not found.'
        for issue in result.structural_issues
    )


def test_A4_ragged_row_does_not_prevent_valid_rows_from_being_checked(tmp_path: Path) -> None:
    path = tmp_path / "mixed.csv"
    path.write_text("A,B\n1,2\n3\n,4\n", encoding="utf-8")
    contract = _contract(columns=[{
        "name": "A",
        "type": "string",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)

    assert result.status == "FAILED"
    assert result.row_counts[""] == 2
    assert result.structural_issues[0].code == "ragged_row"
    check = next(check for check in result.checks if check.id == "columns:")
    assert check.issue_count == 1
    assert check.issues[0].row == 4


def test_A2_header_only_table_obeys_minimum_rows(tmp_path: Path) -> None:
    path = tmp_path / "header-only.csv"
    path.write_text("Id\n", encoding="utf-8")

    passes = _validate(path, _contract(min_rows=0))
    fails = _validate(path, _contract(min_rows=1))
    path.write_text("Id\n1\n", encoding="utf-8")
    max_fails = _validate(path, _contract(max_rows=0))

    assert passes.status == "PASSED"
    row_check = next(check for check in fails.checks if check.id == "tableRows:")
    assert row_check.status == "FAILED"
    assert row_check.issues[0].row is None
    max_check = next(check for check in max_fails.checks if check.id == "tableRows:")
    assert max_check.status == "FAILED"


def test_A5_invalid_calendar_date_fails_strict_date_column(tmp_path: Path) -> None:
    path = tmp_path / "dates.csv"
    path.write_text("Date\n2024-02-30\n2024-02-29\n", encoding="utf-8")
    contract = _contract(columns=[{
        "name": "Date",
        "type": "date",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "columns:")
    assert check.issue_count == 1
    assert check.issues[0].row == 2


def test_A5_datetime_formats_with_and_without_timezone_are_combined(tmp_path: Path) -> None:
    path = tmp_path / "timestamps.csv"
    path.write_text(
        "CreatedAt\n2026-04-01T12:30:00.000Z\n2026-04-02 14:30:00\n2026-04-03\n",
        encoding="utf-8",
    )
    contract = _contract(columns=[{
        "name": "CreatedAt",
        "type": "datetime",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)

    assert result.status == "PASSED"


def test_A6_decimal_rejects_nonfinite_and_precision_overflow(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text('Amount\nInfinity\nNaN\n999999.00\n"1,234.50"\n', encoding="utf-8")
    contract = _contract(columns=[{
        "name": "Amount",
        "type": "decimal",
        "mustExist": True,
        "nullable": False,
        "thousandsSeparator": ",",
        "precision": 6,
        "scale": 2,
    }])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "columns:")
    assert check.issue_count == 4
    assert any(
        issue.value == "999999.00" and issue.message == "Value exceeds decimal precision 6"
        for issue in check.issues
    )


def test_A7_missing_declared_column_is_failure_not_skipped(tmp_path: Path) -> None:
    path = tmp_path / "records.csv"
    path.write_text("Id\n1\n", encoding="utf-8")
    contract = _contract(columns=[{
        "name": "Missing",
        "type": "string",
        "mustExist": True,
        "nullable": True,
    }])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "columns:")
    assert check.status == "FAILED"
    assert check.issues[0].message == 'Required column "Missing" not found'
    assert result.status == "FAILED"


def test_column_type_mismatch_is_reported_for_the_offending_row(tmp_path: Path) -> None:
    path = tmp_path / "types.csv"
    path.write_text("A\n1\nnot-a-number\n", encoding="utf-8")
    contract = _contract(columns=[{
        "name": "A",
        "type": "integer",
        "mustExist": True,
        "nullable": True,
    }])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "columns:")
    assert check.status == "FAILED"
    assert check.issue_count == 1
    assert check.issues[0].row == 3
    assert check.issues[0].value == "not-a-number"
    assert check.issues[0].message == "Value is not a valid integer"


def test_removed_rule_types_are_rejected_and_covered_by_column_definitions(tmp_path: Path) -> None:
    path = tmp_path / "legacy.csv"
    path.write_text("Id,Amount\n1,10\n,abc\n", encoding="utf-8")
    columns: list[dict[str, object]] = [
        {"name": "Id", "type": "integer", "mustExist": True, "nullable": False},
        {"name": "Amount", "type": "integer", "mustExist": True, "nullable": True},
    ]

    for removed in (
        _rule("columnsPresent", {"columns": ["Id", "Missing"]}),
        _rule("required", {"columns": ["Missing"]}),
        _rule("type", {"column": "Id", "dataType": "date"}),
    ):
        with pytest.raises(ValueError, match="rules"):
            _contract(columns=columns, rules=[removed])

    outcome = _validate(path, _contract(columns=columns))

    assert [check.id for check in outcome.checks] == ["columns:"]
    assert outcome.status == "FAILED"
    assert outcome.checks[0].issue_count == 2


@pytest.mark.parametrize(
    ("rule_type", "headers", "row", "params", "lookups"),
    [
        ("enum", "A", "outside", {"column": "A", "values": ["inside"]}, {}),
        ("range", "A", "-1", {"column": "A", "min": 0}, {}),
        ("pattern", "A", "lowercase", {"column": "A", "pattern": "[A-Z]+"}, {}),
        ("length", "A", "x", {"column": "A", "min": 3}, {}),
        ("unique", "A", "duplicate\nduplicate", {"columns": ["A"]}, {}),
        ("lookup", "A", "outside", {"column": "A", "lookupId": "allowed"}, {
            "allowed": {"name": "allowed", "values": ["inside"]},
        }),
        ("dateRange", "A", "2024-01-01", {"column": "A", "min": "2025-01-01"}, {}),
        ("conditionalRequired", "A,B", "yes,", {
            "columns": ["B"],
            "when": {"column": "A", "op": "eq", "value": "yes"},
        }, {}),
        ("compare", "A,B", "1,2", {
            "left": "A", "op": "gt", "right": "B", "as": "number",
        }, {}),
    ],
)
def test_builtin_row_rule_types_evaluate_failure_expressions(
    tmp_path: Path,
    rule_type: str,
    headers: str,
    row: str,
    params: dict[str, object],
    lookups: dict[str, dict[str, object]],
) -> None:
    path = tmp_path / f"{rule_type}.csv"
    path.write_text(f"{headers}\n{row}\n", encoding="utf-8")
    contract = _contract(
        rules=[_rule(rule_type, params)],
        lookups=lookups,
    )

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == f"rule-{rule_type}")
    assert check.status == "FAILED", check.issues[0].message
    assert check.issue_count >= 1


def test_A9_file_level_aggregate_failure_has_no_row_number(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text("Amount\n1\n2\n", encoding="utf-8")
    contract = _contract(rules=[_rule("aggregate", {
        "column": "Amount",
        "fn": "sum",
        "min": 10,
    })])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "rule-aggregate")
    assert check.status == "FAILED"
    assert check.issues[0].row is None


def test_A7_aggregate_with_missing_column_returns_error(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text("Amount\n1\n", encoding="utf-8")
    contract = _contract(rules=[_rule("aggregate", {
        "column": "Missing",
        "fn": "sum",
    })])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "rule-aggregate")
    assert check.status == "ERROR"


def test_A9_cross_table_reconciliation_has_no_row_number(tmp_path: Path) -> None:
    contract = DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": "sheets",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [
            {
                "sheet": "Orders",
                "headerRow": 1,
                "allowExtraColumns": True,
                "minRows": None,
                "maxRows": None,
                "columns": [],
            },
            {
                "sheet": "Payments",
                "headerRow": 1,
                "allowExtraColumns": True,
                "minRows": None,
                "maxRows": None,
                "columns": [],
            },
        ],
        "rules": [_rule("reconcile", {
            "left": {"table": "Orders", "column": "Amount", "fn": "sum"},
            "right": {"table": "Payments", "column": "Amount", "fn": "sum"},
            "tolerance": 0,
        })],
        "lookups": {},
    })
    metadata = FileMetadata(Path("reconcile.xlsx"), "xlsx", "binary", None)
    tables = {
        name: ParsedTable(
            name=name,
            definition=contract.tables[index],
            frame=pl.DataFrame({"Amount": values}),
            row_numbers=[2],
            source_columns=["Amount"],
        )
        for index, (name, values) in enumerate((("Orders", ["10"]), ("Payments", ["9"])))
    }
    parsed = ParsedFile(metadata, tables)

    result = validate_parsed(parsed, contract, date(2025, 1, 15))

    check = next(check for check in result.checks if check.id == "rule-reconcile")
    assert check.status == "FAILED"
    assert check.issues[0].row is None


def test_A10_stores_first_100_issues_and_exports_all(tmp_path: Path) -> None:
    path = tmp_path / "missing.csv"
    path.write_text(
        "Id,Description\n" + "\n".join(",present" for _ in range(120)) + "\n",
        encoding="utf-8",
    )
    contract = _contract(columns=[{
        "name": "Id",
        "type": "string",
        "mustExist": True,
        "nullable": False,
    }])

    result = _validate(path, contract)
    check = next(check for check in result.checks if check.id == "columns:")

    assert check.issue_count == 120
    assert len(check.issues) == 100
    assert len(result.report_issues) == 120
    output = tmp_path / "out"
    parsed = read_file(path, contract)
    write_outputs(parsed, result, output)
    assert len((output / "issues.csv").read_text(encoding="utf-8-sig").splitlines()) == 121


def test_benchmark_contract_contains_the_required_13_rules() -> None:
    contract = benchmark_contract()

    assert len(contract.rules) == 13
    assert {rule.type for rule in contract.rules}.isdisjoint({"columnsPresent", "required", "type"})
    assert [column.name for column in contract.tables[0].columns] == [
        "Id", "CustomerId", "OrderDate", "Amount", "Email",
    ]


def test_natural_language_benchmark_contract_adds_one_guarded_row_rule() -> None:
    contract = natural_language_benchmark_contract(benchmark_contract())

    assert len(contract.rules) == 14
    rule = contract.rules[-1]
    assert rule.type == "naturalLanguage"
    assert rule.params.mode == "row"


def test_xlsx_benchmark_generator_writes_the_requested_rows(tmp_path: Path) -> None:
    path = tmp_path / "benchmark.xlsx"
    generate_xlsx(path, 5)

    parsed = read_file(path, benchmark_contract())

    assert list(parsed.tables) == ["Orders"]
    assert parsed.tables["Orders"].frame.height == 5


def test_cli_validate_emits_json_for_a_valid_file(tmp_path: Path, monkeypatch, capsys) -> None:
    path = tmp_path / "valid.csv"
    path.write_text("Id\n1\n", encoding="utf-8")
    contract_path = tmp_path / "contract.json"
    contract_path.write_text(_contract().model_dump_json(by_alias=True), encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "dq-engine",
            "validate",
            str(path),
            "--contract",
            str(contract_path),
            "--validation-date",
            "2025-01-15",
            "--json",
        ],
    )

    with pytest.raises(SystemExit) as result:
        cli_main()

    payload = json.loads(capsys.readouterr().out)
    assert result.value.code == 0
    assert payload["status"] == "PASSED"
    assert payload["rowCounts"] == {"": 1}


def test_natural_language_row_rule_compiles_guarded_expression(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text("Amount,Discount\n100,60\n100,40\n", encoding="utf-8")
    contract = _contract(rules=[_rule("naturalLanguage", {
        "request": "Discount does not exceed half of Amount.",
        "explanation": "Discount must be at most half of the amount.",
        "mode": "row",
        "failWhen": "TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5",
        "message": "Discount exceeds half of the amount.",
        "columns": {"": ["Amount", "Discount"]},
        "examples": [],
        "provenance": {
            "model": "test",
            "responseId": "test",
            "promptSha256": "0" * 64,
            "createdAt": "2025-01-15T00:00:00Z",
        },
    })])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "rule-naturalLanguage")
    assert check.issue_count == 1
    assert check.issues[0].message == "Discount exceeds half of the amount."
    assert check.issues[0].row == 2


def test_natural_language_query_rule_returns_physical_row_failures(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text("Amount\n-1\n2\n", encoding="utf-8")
    contract = _contract(rules=[_rule("naturalLanguage", {
        "request": "Amounts must be nonnegative.",
        "explanation": "Fails negative amounts.",
        "mode": "query",
        "failWhen": None,
        "query": "SELECT __row FROM t_0 WHERE TRY_CAST(Amount AS DOUBLE) < 0",
        "message": "Amount must be nonnegative.",
        "columns": {"": ["Amount"]},
        "examples": [],
        "provenance": {
            "model": "test",
            "responseId": "test",
            "promptSha256": "0" * 64,
            "createdAt": "2025-01-15T00:00:00Z",
        },
    })])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "rule-naturalLanguage")
    assert check.status == "FAILED"
    assert check.issue_count == 1
    assert check.issues[0].row == 2


def test_natural_language_query_file_message_has_no_row(tmp_path: Path) -> None:
    path = tmp_path / "amounts.csv"
    path.write_text("Amount\n-1\n-2\n", encoding="utf-8")
    contract = _contract(rules=[_rule("naturalLanguage", {
        "request": "The total must be nonnegative.",
        "explanation": "Fails a negative total.",
        "mode": "query",
        "failWhen": None,
        "query": (
            "SELECT 'Total must be nonnegative.' AS message "
            "WHERE (SELECT SUM(TRY_CAST(Amount AS DOUBLE)) FROM t_0) < 0"
        ),
        "message": "The aggregate query failed.",
        "columns": {"": ["Amount"]},
        "examples": [],
        "provenance": {
            "model": "test",
            "responseId": "test",
            "promptSha256": "0" * 64,
            "createdAt": "2025-01-15T00:00:00Z",
        },
    })])

    result = _validate(path, contract)

    check = next(check for check in result.checks if check.id == "rule-naturalLanguage")
    assert check.status == "FAILED"
    assert check.issues[0].row is None
    assert check.issues[0].message == "Total must be nonnegative."
