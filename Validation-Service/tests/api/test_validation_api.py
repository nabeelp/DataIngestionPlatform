from __future__ import annotations

import json
from pathlib import Path

from dq_engine.api.validation import validate_contract_payload, validate_rule_payload

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
    valid = _rule("required", {"columns": ["Amount"]})
    invalid = _rule("required", {"columns": ["Missing"]})

    accepted = validate_rule_payload(contract, valid)
    rejected = validate_rule_payload(contract, invalid)

    assert accepted["ok"] is True
    assert accepted["normalizedRule"]["id"] == "rule-required"
    assert rejected["ok"] is False
    assert any("undeclared column" in error["message"] for error in rejected["errors"])


def test_contract_publish_validation_checks_both_sheet_table_and_column_names() -> None:
    contract = _contract(
        [_table("Orders", "Amount"), _table("Payments", "Amount")],
        [_rule("required", {"columns": ["Amount"]}, table="Payments")],
        layout="sheets",
    )

    result = validate_contract_payload(contract)

    assert result == {"ok": True, "errors": []}


def test_contract_publish_validation_rejects_undeclared_sheet_target() -> None:
    contract = _contract(
        [_table("Orders", "Amount")],
        [_rule("required", {"columns": ["Amount"]}, table="Missing")],
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
