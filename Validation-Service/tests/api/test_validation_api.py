from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from dq_engine.api.validation import (
    test_rule_examples as execute_rule_examples,
)
from dq_engine.api.validation import (
    validate_contract_payload,
    validate_rule_payload,
)
from dq_engine.contracts.models import DefinitionContract

ROOT = Path(__file__).resolve().parents[3]


def _column(name: str) -> dict[str, object]:
    return {
        "name": name,
        "type": "string",
        "mustExist": True,
        "nullable": True,
    }


def _rule(rule_type: str, params: dict[str, object], table: str | None = None) -> dict[str, object]:
    return {
        "id": f"rule-{rule_type}",
        "name": f"{rule_type} rule",
        "description": "Test rule",
        "severity": "Error",
        "executionOrder": 1,
        "enabled": True,
        "table": table,
        "type": rule_type,
        "params": params,
    }


def _contract(
    tables: list[dict[str, object]],
    rules: list[dict[str, object]],
    *,
    layout: str = "single",
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "layout": layout,
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": tables,
        "rules": rules,
        "lookups": {},
    }


def _table(sheet: str | None, *columns: str) -> dict[str, object]:
    return {
        "sheet": sheet,
        "headerRow": None,
        "allowExtraColumns": True,
        "minRows": None,
        "maxRows": None,
        "columns": [_column(name) for name in columns],
    }


def test_rule_validation_checks_declared_columns_and_compiles_builtin_rules() -> None:
    contract = _contract([_table(None, "Amount")], [])
    valid = _rule("unique", {"columns": ["Amount"]})
    invalid = _rule("unique", {"columns": ["Missing"]})

    accepted = validate_rule_payload(contract, valid)
    rejected = validate_rule_payload(contract, invalid)

    assert accepted["ok"] is True
    assert accepted["normalizedRule"]["id"] == "rule-unique"
    assert rejected["ok"] is False
    assert any("undeclared column" in error["message"] for error in rejected["errors"])


def test_contract_publish_validation_checks_both_sheet_table_and_column_names() -> None:
    contract = _contract(
        [_table("Orders", "Amount"), _table("Payments", "Amount")],
        [_rule("unique", {"columns": ["Amount"]}, table="Payments")],
        layout="sheets",
    )

    result = validate_contract_payload(contract)

    assert result == {"ok": True, "errors": []}


def test_contract_publish_validation_rejects_undeclared_sheet_target() -> None:
    contract = _contract(
        [_table("Orders", "Amount")],
        [_rule("unique", {"columns": ["Amount"]}, table="Missing")],
        layout="sheets",
    )

    result = validate_contract_payload(contract)

    assert result["ok"] is False
    assert any("undeclared table" in error["message"] for error in result["errors"])


def test_contract_publish_validation_runs_natural_language_examples() -> None:
    contract = json.loads(
        (ROOT / "contracts" / "examples" / "definition-contract.json").read_text(encoding="utf-8")
    )

    result = validate_contract_payload(contract)

    assert result == {"ok": True, "errors": []}


def test_contract_publish_validation_checks_contract_structure_without_rules() -> None:
    contract = _contract(
        [_table("Orders", "Amount", " amount ")],
        [],
        layout="sheets",
    )

    result = validate_contract_payload(contract)

    assert result["ok"] is False
    assert any("Column names must be unique" in error["message"] for error in result["errors"])


def _employee_candidate() -> dict[str, object]:
    return _rule("naturalLanguage", {
        "request": "Employee email address must not contain employee surname",
        "explanation": "Email must not contain the surname, ignoring case and surrounding whitespace.",
        "mode": "row",
        "failWhen": (
            '"Email" IS NOT NULL AND "LastName" IS NOT NULL AND TRIM("LastName") != \'\' '
            'AND REGEXP_LIKE(LOWER(TRIM("Email")), LOWER(TRIM("LastName")))'
        ),
        "query": None,
        "message": "Email address must not contain the employee surname.",
        "columns": {"Employees": ["Email", "LastName"]},
        "examples": [
            {
                "table": "Employees",
                "values": {"Email": "jane.smith@example.com", "LastName": "Smith"},
                "expectedValid": False,
                "source": "model",
            },
            {
                "table": "Employees",
                "values": {"Email": "jane.jones@example.com", "LastName": "Smith"},
                "expectedValid": True,
                "source": "model",
            },
        ],
        "provenance": {
            "model": "test",
            "responseId": "test",
            "promptSha256": "0" * 64,
            "createdAt": "2026-10-07T00:00:00Z",
        },
    }, table="Employees")


def _invalid_employee_draft() -> dict[str, object]:
    tables = [
        _table("Employees", "Email", "LastName"),
        _table("Orders", "Amount"),
        _table("Payments", "Amount"),
        _table("Departments", "Name"),
    ]
    rules = [_rule("unique", {"columns": ["Email"]}, table="Employees") for _ in range(3)]
    rules.append(_rule("unique", {"columns": []}, table="Employees"))
    return _contract(tables, rules, layout="sheets")


def test_candidate_validation_and_examples_ignore_invalid_existing_rules_without_mutating_draft() -> None:
    contract = _invalid_employee_draft()
    original = deepcopy(contract)
    candidate = _employee_candidate()

    validation = validate_rule_payload(contract, candidate)
    examples = execute_rule_examples(contract, candidate, None)
    explicit_examples = execute_rule_examples(contract, candidate, candidate["params"]["examples"])

    assert validation["ok"] is True, validation["errors"]
    assert validation["normalizedRule"]["params"]["failWhen"] == candidate["params"]["failWhen"]
    assert examples["ok"] is True, examples
    assert [(item["actualValid"], item["passed"]) for item in examples["results"]] == [
        (False, True), (True, True),
    ]
    assert explicit_examples == examples
    assert contract == original
    publish = validate_contract_payload(contract)
    assert publish["ok"] is False
    assert publish["errors"][0]["path"] == "$.rules[3]"


@pytest.mark.parametrize("candidate", [
    _rule("unique", {"columns": ["Missing"]}, table="Employees"),
    _rule("unique", {"columns": []}, table="Employees"),
])
def test_candidate_isolation_still_rejects_invalid_candidate(candidate: dict[str, object]) -> None:
    result = validate_rule_payload(_invalid_employee_draft(), candidate)

    assert result["ok"] is False
    assert result["errors"]
    assert all(not error["path"].startswith("$.rules[") for error in result["errors"])


def test_candidate_isolation_still_rejects_invalid_sql_and_failing_examples() -> None:
    contract = _invalid_employee_draft()
    candidate = _employee_candidate()
    candidate["params"]["failWhen"] = 'READ_CSV("Email")'

    invalid_sql = validate_rule_payload(contract, candidate)
    assert invalid_sql["ok"] is False
    assert invalid_sql["errors"][0]["path"] == "$.params.failWhen"

    candidate = _employee_candidate()
    candidate["params"]["examples"][0]["expectedValid"] = True
    examples = execute_rule_examples(contract, candidate, None)
    assert examples["ok"] is False
    assert examples["results"][0]["passed"] is False


@pytest.mark.parametrize("rules", [None, {}, "invalid"])
def test_candidate_isolation_preserves_rules_array_requirement(rules: object) -> None:
    contract = _invalid_employee_draft()
    contract["rules"] = rules

    result = validate_rule_payload(contract, _employee_candidate())

    assert result["ok"] is False
    assert result["errors"][0]["path"] == "$.rules"


def test_candidate_isolation_preserves_definition_structure_validation() -> None:
    contract = _invalid_employee_draft()
    contract["tables"][0]["columns"].append(_column(" email "))

    result = validate_rule_payload(contract, _employee_candidate())

    assert result["ok"] is False
    assert any("Column names must be unique" in error["message"] for error in result["errors"])

    del contract["rules"]
    result = validate_rule_payload(contract, _employee_candidate())
    assert result["ok"] is False
    assert any("required property" in error["message"] for error in result["errors"])


def test_candidate_isolation_preserves_lookup_context() -> None:
    contract = _invalid_employee_draft()
    contract["lookups"] = {"allowed": {"name": "Allowed email", "values": ["jane@example.com"]}}
    candidate = _rule("lookup", {"column": "Email", "lookupId": "allowed"}, table="Employees")

    result = validate_rule_payload(contract, candidate)

    assert result["ok"] is True, result["errors"]


def test_query_candidate_isolation_preserves_table_alias_order() -> None:
    contract = _invalid_employee_draft()
    candidate = _employee_candidate()
    candidate["table"] = None
    candidate["params"]["mode"] = "query"
    candidate["params"]["failWhen"] = None
    candidate["params"]["query"] = (
        "SELECT 'Email contains surname' AS message FROM t_0 "
        'WHERE REGEXP_LIKE(LOWER(TRIM("Email")), LOWER(TRIM("LastName"))) LIMIT 1'
    )
    candidate["params"]["columns"] = {
        "Employees": ["Email", "LastName"],
        "Orders": ["Amount"],
        "Payments": ["Amount"],
        "Departments": ["Name"],
    }

    result = execute_rule_examples(contract, candidate, None)

    assert result["ok"] is True, result
    assert all(example["passed"] for example in result["results"])


def test_single_layout_candidate_ignores_unparseable_existing_rule() -> None:
    contract = _contract([_table(None, "Email")], [{"type": "unknown"}])

    result = validate_rule_payload(contract, _rule("unique", {"columns": ["Email"]}))

    assert result["ok"] is True, result["errors"]
    assert validate_contract_payload(contract)["ok"] is False


REMOVED_RULES = [
    _rule("columnsPresent", {"columns": ["Amount"]}),
    _rule("required", {"columns": ["Amount"]}),
    _rule("type", {"column": "Amount", "dataType": "integer"}),
]


@pytest.mark.parametrize("rule", REMOVED_RULES, ids=lambda rule: str(rule["type"]))
def test_removed_rule_types_are_rejected_by_rule_validation(rule: dict[str, object]) -> None:
    contract = _contract([_table(None, "Amount")], [])

    validation = validate_rule_payload(contract, rule)
    examples = execute_rule_examples(contract, rule, None)

    assert validation["ok"] is False
    assert validation["normalizedRule"] is None
    assert validation["errors"]
    assert examples["ok"] is False
    assert examples["results"] == []


def test_contract_publish_validation_rejects_removed_rule_types_but_runtime_loading_drops_them() -> None:
    contract = _contract([_table(None, "Amount")], deepcopy(REMOVED_RULES))

    # Publishing is held to the current rule schema; contracts published earlier still load and run.
    assert validate_contract_payload(contract)["ok"] is False
    assert DefinitionContract.model_validate(contract).rules == []
