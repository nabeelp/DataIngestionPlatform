from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from dq_engine.api.validation import test_rule_examples as run_rule_examples
from dq_engine.api.validation import validate_rule_payload
from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_parsed
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable
from dq_engine.rules.base import RuleConfigurationError
from dq_engine.rules.examples import run_examples
from dq_engine.rules.sqlguard import validate_query

VALIDATION_DATE = date(2025, 1, 15)

SHEETS: dict[str, list[str]] = {
    "Customers": ["Id", "Name", "Country"],
    "Orders": ["OrderId", "CustomerId", "Amount"],
    "Payments": ["PaymentId", "OrderId", "Amount"],
}


def _column(name: str) -> dict[str, object]:
    return {"name": name, "type": "string", "mustExist": True, "nullable": True}


def _table(sheet: str) -> dict[str, object]:
    return {
        "sheet": sheet,
        "headerRow": 1,
        "allowExtraColumns": True,
        "minRows": None,
        "maxRows": None,
        "columns": [_column(name) for name in SHEETS[sheet]],
    }


def _rule(
    query: str,
    columns: dict[str, list[str]],
    examples: list[dict[str, Any]] | None = None,
    mode: str = "query",
    fail_when: str | None = None,
    table: str | None = None,
) -> dict[str, Any]:
    return {
        "id": "cross-sheet",
        "name": "Cross-sheet rule",
        "description": "",
        "severity": "Error",
        "executionOrder": 1,
        "enabled": True,
        "table": table,
        "type": "naturalLanguage",
        "params": {
            "request": "Cross-sheet check.",
            "explanation": "Checks data across sheets.",
            "mode": mode,
            "failWhen": fail_when,
            "query": None if mode == "row" else query,
            "message": "Cross-sheet check failed.",
            "columns": columns,
            "examples": examples or [],
            "provenance": {
                "model": "test",
                "responseId": "test",
                "promptSha256": "0" * 64,
                "createdAt": "2025-01-15T00:00:00Z",
            },
        },
    }


def _contract_data(rule: dict[str, Any], sheets: list[str] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "layout": "sheets",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [_table(sheet) for sheet in sheets or list(SHEETS)],
        "rules": [rule],
        "lookups": {},
    }


def _contract(rule: dict[str, Any], sheets: list[str] | None = None) -> DefinitionContract:
    return DefinitionContract.model_validate(_contract_data(rule, sheets))


def _parsed(contract: DefinitionContract, data: dict[str, list[dict[str, str]]]) -> ParsedFile:
    tables: dict[str, ParsedTable] = {}
    for definition in contract.tables:
        name = definition.sheet or ""
        columns = [column.name for column in definition.columns]
        rows = data.get(name, [])
        tables[name] = ParsedTable(
            name=name,
            definition=definition,
            frame=pl.DataFrame(
                {column: [row.get(column) for row in rows] for column in columns},
                schema={column: pl.String for column in columns},
            ),
            row_numbers=list(range(2, 2 + len(rows))),
            source_columns=columns,
        )
    return ParsedFile(FileMetadata(Path("book.xlsx"), "xlsx", "binary", None), tables)


FK_QUERY = (
    "SELECT o.__row AS __row, 'Orders' AS \"table\", 'CustomerId' AS \"column\", "
    "'Order references an unknown customer.' AS message "
    "FROM t_1 AS o LEFT JOIN t_0 AS c ON o.CustomerId = c.Id "
    "WHERE o.CustomerId IS NOT NULL AND c.Id IS NULL"
)
FK_COLUMNS = {"Customers": ["Id"], "Orders": ["CustomerId"]}


def _check(contract: DefinitionContract, data: dict[str, list[dict[str, str]]]) -> Any:
    outcome = validate_parsed(_parsed(contract, data), contract, VALIDATION_DATE)
    return outcome, next(check for check in outcome.checks if check.id == "cross-sheet")


def test_query_over_two_of_three_sheets_reports_offending_rows_with_their_sheet() -> None:
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS))

    outcome, check = _check(contract, {
        "Customers": [{"Id": "1"}, {"Id": "2"}],
        "Orders": [{"CustomerId": "1"}, {"CustomerId": "9"}, {"CustomerId": None}, {"CustomerId": "2"}],
    })

    assert check.status == "FAILED", [issue.message for issue in check.issues]
    assert [(issue.row, issue.column) for issue in check.issues] == [(3, "CustomerId")]
    reported = [item for item in outcome.report_issues if item.check_id == "cross-sheet"]
    assert [item.sheet for item in reported] == ["Orders"]


def test_query_passes_when_every_reference_exists() -> None:
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS))

    _, check = _check(contract, {
        "Customers": [{"Id": "1"}],
        "Orders": [{"CustomerId": "1"}],
    })

    assert check.status == "PASSED"


def test_query_does_not_need_sheets_it_does_not_declare() -> None:
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS))
    parsed = _parsed(contract, {"Customers": [{"Id": "1"}], "Orders": [{"CustomerId": "1"}]})
    del parsed.tables["Payments"]

    outcome = validate_parsed(parsed, contract, VALIDATION_DATE)

    assert next(check for check in outcome.checks if check.id == "cross-sheet").status == "PASSED"


def test_query_with_a_declared_sheet_that_is_missing_is_an_error() -> None:
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS))
    parsed = _parsed(contract, {"Customers": [{"Id": "1"}], "Orders": [{"CustomerId": "1"}]})
    del parsed.tables["Customers"]

    outcome = validate_parsed(parsed, contract, VALIDATION_DATE)

    check = next(check for check in outcome.checks if check.id == "cross-sheet")
    assert check.status == "ERROR"
    assert 'table "Customers" is missing' in check.issues[0].message


def test_not_exists_subquery_is_supported_across_sheets() -> None:
    query = (
        "SELECT p.__row AS __row, 'Payments' AS \"table\", 'OrderId' AS \"column\" "
        "FROM t_2 AS p WHERE NOT EXISTS (SELECT 1 FROM t_1 AS o WHERE o.OrderId = p.OrderId)"
    )
    contract = _contract(_rule(query, {"Orders": ["OrderId"], "Payments": ["OrderId"]}))

    _, check = _check(contract, {
        "Orders": [{"OrderId": "A"}],
        "Payments": [{"OrderId": "A"}, {"OrderId": "Z"}],
    })

    assert [issue.row for issue in check.issues] == [3]
    assert check.issues[0].message == "Cross-sheet check failed."


def test_cross_sheet_row_comparison_through_a_join() -> None:
    query = (
        "SELECT p.__row AS __row, 'Payments' AS \"table\", 'Amount' AS \"column\", "
        "'Payment amount differs from the order amount.' AS message "
        "FROM t_2 AS p JOIN t_1 AS o ON p.OrderId = o.OrderId "
        "WHERE TRY_CAST(p.Amount AS DOUBLE) <> TRY_CAST(o.Amount AS DOUBLE)"
    )
    contract = _contract(_rule(
        query,
        {"Orders": ["OrderId", "Amount"], "Payments": ["OrderId", "Amount"]},
    ))

    _, check = _check(contract, {
        "Orders": [{"OrderId": "A", "Amount": "10"}, {"OrderId": "B", "Amount": "5"}],
        "Payments": [{"OrderId": "A", "Amount": "10"}, {"OrderId": "B", "Amount": "4"}],
    })

    assert [issue.row for issue in check.issues] == [3]
    assert "differs" in check.issues[0].message


def test_file_level_cross_sheet_query_returns_one_message() -> None:
    query = (
        "SELECT 'Orders without payments exist.' AS message WHERE "
        "(SELECT COUNT(*) FROM t_1) > (SELECT COUNT(*) FROM t_2)"
    )
    contract = _contract(_rule(query, {"Orders": ["OrderId"], "Payments": ["PaymentId"]}))

    _, check = _check(contract, {"Orders": [{"OrderId": "A"}, {"OrderId": "B"}], "Payments": [{"PaymentId": "1"}]})

    assert check.status == "FAILED"
    assert check.issues[0].row is None


def test_examples_seed_related_rows_in_other_sheets() -> None:
    examples = [
        {
            "table": "Orders", "values": {"CustomerId": "1"}, "expectedValid": True, "source": "model",
            "relatedRows": [{"table": "Customers", "values": {"Id": "1"}}],
        },
        {
            "table": "Orders", "values": {"CustomerId": "9"}, "expectedValid": False, "source": "model",
            "relatedRows": [{"table": "Customers", "values": {"Id": "1"}}],
        },
        {"table": "Orders", "values": {"CustomerId": "9"}, "expectedValid": False, "source": "model"},
    ]
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS, examples))

    results = run_examples(contract, contract.rules[0], validation_date=VALIDATION_DATE)

    assert [(item.actual_valid, item.passed, item.error) for item in results] == [
        (True, True, None), (False, True, None), (False, True, None),
    ]


def test_related_row_for_unknown_sheet_or_column_is_reported_per_example() -> None:
    examples = [
        {
            "table": "Orders", "values": {"CustomerId": "1"}, "expectedValid": True, "source": "model",
            "relatedRows": [{"table": "Missing", "values": {"Id": "1"}}],
        },
        {
            "table": "Orders", "values": {"CustomerId": "1"}, "expectedValid": True, "source": "model",
            "relatedRows": [{"table": "Customers", "values": {"Nope": "1"}}],
        },
    ]
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS, examples))

    results = run_examples(contract, contract.rules[0], validation_date=VALIDATION_DATE)

    assert [item.passed for item in results] == [False, False]
    assert 'unknown table "Missing"' in (results[0].error or "")
    assert "undeclared columns" in (results[1].error or "")


def test_row_mode_examples_cannot_seed_related_rows() -> None:
    example = {
        "table": "Orders", "values": {"Amount": "1"}, "expectedValid": True, "source": "model",
        "relatedRows": [{"table": "Customers", "values": {"Id": "1"}}],
    }
    rule = _rule("", {"Orders": ["Amount"]}, [example], mode="row", fail_when="Amount = ''", table="Orders")
    contract = _contract(rule)

    results = run_examples(contract, contract.rules[0], validation_date=VALIDATION_DATE)

    assert "related rows" in (results[0].error or "")


def test_legacy_example_without_related_rows_still_validates() -> None:
    contract = _contract(_rule(FK_QUERY, FK_COLUMNS, [
        {"table": "Orders", "values": {"CustomerId": "9"}, "expectedValid": False, "source": "model"},
    ]))

    assert contract.rules[0].params.examples[0].relatedRows == []  # type: ignore[union-attr]


def test_rule_validation_accepts_a_query_that_declares_only_the_sheets_it_reads() -> None:
    result = validate_rule_payload(_contract_data(_rule(FK_QUERY, FK_COLUMNS)), _rule(FK_QUERY, FK_COLUMNS))

    assert result["ok"], result["errors"]


def test_rule_validation_rejects_a_query_that_reads_a_sheet_it_did_not_declare() -> None:
    rule = _rule(FK_QUERY, {"Orders": ["CustomerId"]})

    result = validate_rule_payload(_contract_data(rule), rule)

    assert not result["ok"]
    assert any(error["path"] == "$.params.query" for error in result["errors"])


def test_rule_validation_rejects_a_query_with_no_declared_sheet() -> None:
    rule = _rule("SELECT 'x' AS message", {})

    result = validate_rule_payload(_contract_data(rule), rule)

    assert not result["ok"]
    assert any("at least one table" in error["message"] for error in result["errors"])


def test_rule_examples_endpoint_passes_multi_sheet_examples() -> None:
    examples = [
        {
            "table": "Orders", "values": {"CustomerId": "1"}, "expectedValid": True, "source": "model",
            "relatedRows": [{"table": "Customers", "values": {"Id": "1"}}],
        },
        {"table": "Orders", "values": {"CustomerId": "9"}, "expectedValid": False, "source": "model"},
    ]
    rule = _rule(FK_QUERY, FK_COLUMNS, examples)

    result = run_rule_examples(_contract_data(rule), rule, examples)

    assert result["ok"], result
    assert all(item["passed"] for item in result["results"])


def test_cte_output_columns_are_valid_but_undeclared_source_columns_still_are_not() -> None:
    registered = {"t_1": ["OrderId", "Amount", "__row"]}
    grouped = (
        "WITH s AS (SELECT OrderId AS Key, SUM(TRY_CAST(Amount AS DOUBLE)) AS total FROM t_1 GROUP BY OrderId) "
        "SELECT 'x' AS message FROM s WHERE s.total > 1 AND total > 0 AND s.Key IS NOT NULL"
    )
    assert validate_query(grouped, registered) == grouped
    with pytest.raises(RuleConfigurationError, match="undeclared"):
        validate_query("WITH s AS (SELECT OrderId FROM t_1) SELECT s.Secret AS message FROM s", registered)
    with pytest.raises(RuleConfigurationError, match="undeclared"):
        validate_query("WITH s AS (SELECT Secret FROM t_1) SELECT 'x' AS message FROM s", registered)


def test_cte_referenced_under_another_alias_exposes_only_its_own_output_columns() -> None:
    registered = {"t_1": ["OrderId", "Amount", "__row"], "t_2": ["OrderId", "Amount", "__row"]}
    aliased = (
        "WITH paid AS (SELECT p.OrderId AS OrderId, SUM(TRY_CAST(p.Amount AS DOUBLE)) AS total "
        "FROM t_2 AS p GROUP BY p.OrderId) "
        "SELECT o.__row AS __row FROM t_1 AS o JOIN paid AS p2 ON p2.OrderId = o.OrderId "
        "WHERE p2.total > TRY_CAST(o.Amount AS DOUBLE)"
    )
    assert validate_query(aliased, registered) == aliased
    with pytest.raises(RuleConfigurationError, match="undeclared"):
        validate_query(aliased.replace("p2.total >", "p2.Secret >"), registered)
    with pytest.raises(RuleConfigurationError, match="undeclared"):
        validate_query(aliased.replace("p2.total >", "p3.total >"), registered)


def test_aliased_cte_query_runs_end_to_end_and_flags_the_overpaid_order() -> None:
    query = (
        "WITH paid AS (SELECT p.OrderId AS OrderId, SUM(TRY_CAST(p.Amount AS DOUBLE)) AS total "
        "FROM t_2 AS p GROUP BY p.OrderId) "
        "SELECT o.__row AS __row, 'Orders' AS \"table\", 'Amount' AS \"column\", "
        "'Payments exceed order amount' AS message "
        "FROM t_1 AS o JOIN paid AS p2 ON p2.OrderId = o.OrderId WHERE p2.total > TRY_CAST(o.Amount AS DOUBLE)"
    )
    contract = _contract(_rule(query, {"Orders": ["OrderId", "Amount"], "Payments": ["OrderId", "Amount"]}))

    _, check = _check(contract, {
        "Orders": [{"OrderId": "O1", "Amount": "100"}, {"OrderId": "O2", "Amount": "50"}],
        "Payments": [
            {"OrderId": "O1", "Amount": "60"}, {"OrderId": "O1", "Amount": "50"}, {"OrderId": "O2", "Amount": "50"},
        ],
    })

    assert [issue.row for issue in check.issues] == [2]


def test_blank_cells_are_null_in_queries_for_csv_and_excel_alike() -> None:
    query = (
        "SELECT o.__row AS __row, 'Orders' AS \"table\" FROM t_1 AS o "
        "WHERE o.CustomerId IS NULL"
    )
    contract = _contract(_rule(query, {"Orders": ["CustomerId"]}))

    _, csv_style = _check(contract, {"Orders": [{"CustomerId": ""}, {"CustomerId": "  "}, {"CustomerId": "C1"}]})
    _, excel_style = _check(contract, {"Orders": [{"CustomerId": None}, {"CustomerId": "  "}, {"CustomerId": "C1"}]})

    assert [issue.row for issue in csv_style.issues] == [2, 3]
    assert [issue.row for issue in excel_style.issues] == [2, 3]


def test_query_can_count_rows_of_tables_that_declare_no_columns() -> None:
    query = (
        "SELECT 'Payments are missing' AS message "
        "WHERE (SELECT COUNT(*) FROM t_1 AS o) > 0 AND (SELECT COUNT(*) FROM t_2 AS p) = 0"
    )
    rule = _rule(query, {"Orders": [], "Payments": []})
    contract = _contract(rule)

    validated = validate_rule_payload(_contract_data(rule), rule)
    _, failing = _check(contract, {"Orders": [{"OrderId": "A"}, {"OrderId": "B"}], "Payments": []})
    _, passing = _check(contract, {"Orders": [{"OrderId": "A"}], "Payments": [{"PaymentId": "1"}]})
    _, no_orders = _check(contract, {"Orders": [], "Payments": []})

    assert validated["ok"], validated["errors"]
    assert (failing.status, passing.status, no_orders.status) == ("FAILED", "PASSED", "PASSED")


def test_service_reports_the_capability_the_live_evaluation_requires() -> None:
    from dq_engine.api.app import healthz

    assert healthz() == {"status": "ok", "features": ["nl-cross-sheet-v1"]}


def test_ambiguous_unqualified_column_across_sheets_is_rejected() -> None:
    registered = {"t_1": ["Amount", "__row"], "t_2": ["Amount", "__row"]}

    with pytest.raises(RuleConfigurationError, match="ambiguous"):
        validate_query("SELECT __row FROM t_1 AS o JOIN t_2 AS p ON o.Amount = p.Amount WHERE Amount = '1'", registered)


@pytest.mark.parametrize("sql", [
    "SELECT 1 AS message WHERE EXISTS (SELECT 1 FROM other_table)",
    "SELECT 1 AS message WHERE EXISTS (SELECT 1 FROM main.t_1)",
    "SELECT 1 AS message WHERE EXISTS (SELECT SLEEP(1) FROM t_1)",
    "SELECT 1 AS message WHERE EXISTS (SELECT Secret FROM t_1)",
])
def test_exists_subqueries_are_still_constrained_to_registered_tables_and_columns(sql: str) -> None:
    with pytest.raises(RuleConfigurationError):
        validate_query(sql, {"t_1": ["Amount", "__row"]})
