from __future__ import annotations

from datetime import date

from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_file
from dq_engine.rules.examples import run_examples


def _natural_language_rule(
    *,
    mode: str,
    columns: dict[str, list[str]],
    examples: list[dict[str, object]],
    fail_when: str | None = None,
    query: str | None = None,
) -> dict[str, object]:
    return {
        "id": "nl-rule",
        "name": "Natural language test",
        "description": "",
        "severity": "Error",
        "executionOrder": 1,
        "enabled": True,
        "table": None,
        "type": "naturalLanguage",
        "params": {
            "request": "Validate amounts.",
            "explanation": "Test natural-language execution.",
            "mode": mode,
            "failWhen": fail_when,
            "query": query,
            "message": "Natural-language check failed.",
            "columns": columns,
            "examples": examples,
            "provenance": {
                "model": "test",
                "responseId": "test",
                "promptSha256": "0" * 64,
                "createdAt": "2025-01-15T00:00:00Z",
            },
        },
    }


def _table(sheet: str | None) -> dict[str, object]:
    return {
        "sheet": sheet,
        "headerRow": 1 if sheet else None,
        "allowExtraColumns": True,
        "minRows": None,
        "maxRows": None,
        "columns": [{
            "name": "Amount",
            "type": "string",
            "mustExist": True,
            "nullable": True,
        }],
    }


def _contract(
    tables: list[dict[str, object]],
    rule: dict[str, object],
    layout: str = "single",
) -> DefinitionContract:
    return DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": layout,
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": tables,
        "rules": [rule],
        "lookups": {},
    })


def test_row_examples_report_expected_passes_and_failures() -> None:
    examples = [
        {
            "table": "Orders",
            "values": {"Amount": "10", "Discount": "6"},
            "expectedValid": False,
            "source": "model",
        },
        {
            "table": "Orders",
            "values": {"Amount": "10", "Discount": "4"},
            "expectedValid": True,
            "source": "admin",
        },
    ]
    rule = _natural_language_rule(
        mode="row",
        columns={"Orders": ["Amount", "Discount"]},
        examples=examples,
        fail_when="TRY_CAST(Discount AS DOUBLE) > TRY_CAST(Amount AS DOUBLE) * 0.5",
    )
    contract = _contract([_table(None)], rule)

    results = run_examples(contract, contract.rules[0], validation_date=date(2025, 1, 15))

    assert [(result.expected_valid, result.actual_valid, result.passed) for result in results] == [
        (False, False, True),
        (True, True, True),
    ]


def test_query_examples_seed_each_named_table_independently_for_cross_sheet_totals() -> None:
    examples = [
        {
            "table": "Orders",
            "values": {"Amount": "10"},
            "expectedValid": False,
            "source": "model",
        },
        {
            "table": "Payments",
            "values": {"Amount": "0"},
            "expectedValid": True,
            "source": "admin",
        },
    ]
    rule = _natural_language_rule(
        mode="query",
        columns={"Orders": ["Amount"], "Payments": ["Amount"]},
        examples=examples,
        query=(
            "SELECT 'Totals differ' AS message "
            "WHERE COALESCE((SELECT SUM(TRY_CAST(o.Amount AS DOUBLE)) "
            "FROM t_0 AS o), 0) <> "
            "COALESCE((SELECT SUM(TRY_CAST(p.Amount AS DOUBLE)) "
            "FROM t_1 AS p), 0)"
        ),
    )
    contract = _contract([_table("Orders"), _table("Payments")], rule, layout="sheets")

    results = run_examples(contract, contract.rules[0], validation_date=date(2025, 1, 15))

    assert [(result.table, result.actual_valid, result.passed) for result in results] == [
        ("Orders", False, True),
        ("Payments", True, True),
    ]


def test_query_mode_detects_duplicates_in_real_table_rows(tmp_path) -> None:
    rule = _natural_language_rule(
        mode="query",
        columns={"": ["Amount"]},
        examples=[],
        query=(
            "SELECT __row FROM t_0 WHERE Amount IN ("
            "SELECT Amount FROM t_0 GROUP BY Amount HAVING COUNT(*) > 1"
            ")"
        ),
    )
    contract = _contract([_table(None)], rule)
    path = tmp_path / "duplicate-amounts.csv"
    path.write_text("Amount\n5\n5\n9\n", encoding="utf-8")

    outcome = validate_file(path, contract, date(2025, 1, 15))

    check = next(check for check in outcome.checks if check.id == "nl-rule")
    assert check.status == "FAILED", [issue.message for issue in check.issues]
    assert [issue.row for issue in check.issues] == [2, 3]
