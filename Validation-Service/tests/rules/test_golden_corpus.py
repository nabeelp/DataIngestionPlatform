from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from dq_engine.api.validation import test_rule_examples as run_rule_examples
from dq_engine.api.validation import validate_contract_payload
from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_parsed
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable

CORPUS_PATH = Path(__file__).resolve().parents[3] / "samples" / "nl-rules" / "golden.json"
CORPUS: dict[str, Any] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = [case for case in CORPUS["cases"] if case["expected"]["decision"] != "rejected"]
VALIDATION_DATE = date(2025, 1, 15)


def _table(table: dict[str, Any], layout: str) -> dict[str, Any]:
    return {
        "sheet": table["sheet"],
        "headerRow": 1,
        "allowExtraColumns": True,
        "minRows": None,
        "maxRows": None,
        "columns": [
            {"name": name, "type": column_type, "mustExist": True, "nullable": True}
            for name, column_type in table["columns"]
        ],
    }


def _values(items: list[dict[str, Any]]) -> dict[str, str]:
    return {item["column"]: item["value"] or "" for item in items}


def _example(example: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "table": example["table"],
        "values": _values(example["values"]),
        "expectedValid": example["expectedValid"],
        "source": "model",
    }
    if example["relatedRows"]:
        result["relatedRows"] = [
            {"table": row["table"], "values": _values(row["values"])} for row in example["relatedRows"]
        ]
    return result


def _rule(case: dict[str, Any]) -> dict[str, Any]:
    proposal = case["referenceProposal"]
    params = {key: value for key, value in proposal["params"].items() if value is not None}
    if proposal["type"] == "naturalLanguage":
        params = {
            "mode": proposal["params"]["mode"],
            "failWhen": proposal["params"]["failWhen"],
            "query": proposal["params"]["query"],
            "message": proposal["params"]["message"],
            "explanation": proposal["params"]["explanation"],
            "columns": {entry["table"]: entry["columns"] for entry in proposal["params"]["tableColumns"]},
            "request": case["request"],
            "examples": [_example(example) for example in proposal["examples"]],
            "provenance": {
                "model": "golden",
                "responseId": "golden",
                "promptSha256": "0" * 64,
                "createdAt": "2025-01-15T00:00:00Z",
            },
        }
    elif isinstance(params.get("when"), dict):
        params["when"] = {key: value for key, value in params["when"].items() if value is not None}
    return {
        "id": case["id"],
        "name": proposal["name"],
        "description": case["request"],
        "severity": proposal["severity"],
        "executionOrder": 1,
        "enabled": True,
        "table": proposal["table"],
        "type": proposal["type"],
        "params": params,
    }


def _contract_data(case: dict[str, Any]) -> dict[str, Any]:
    definition = CORPUS["definitions"][case["definition"]]
    return {
        "schemaVersion": 1,
        "layout": definition["layout"],
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [_table(table, definition["layout"]) for table in definition["tables"]],
        "rules": [_rule(case)],
        "lookups": {},
    }


def _parsed(contract: DefinitionContract, data: dict[str, list[dict[str, Any]]]) -> ParsedFile:
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
    return ParsedFile(FileMetadata(Path("golden.xlsx"), "xlsx", "binary", None), tables)


def _failures(case: dict[str, Any], dataset: str) -> tuple[str, set[tuple[str | None, int | None]]]:
    contract = DefinitionContract.model_validate(_contract_data(case))
    outcome = validate_parsed(_parsed(contract, case["data"][dataset]), contract, VALIDATION_DATE)
    check = next(item for item in outcome.checks if item.id == case["id"])
    failures = {
        (item.sheet or None, item.issue.row)
        for item in outcome.report_issues
        if item.check_id == case["id"]
    }
    return check.status, failures


def test_corpus_is_large_and_covers_every_category() -> None:
    categories = {case["category"] for case in CORPUS["cases"]}
    assert len(CORPUS["cases"]) >= 25
    assert {"builtin", "row-sql", "query-sql", "cross-sheet", "reject"} <= categories
    assert sum(case["category"] == "cross-sheet" for case in CORPUS["cases"]) >= 8
    assert len({case["id"] for case in CORPUS["cases"]}) == len(CORPUS["cases"])


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_reference_rule_is_accepted_by_the_contract_validator_and_examples(case: dict[str, Any]) -> None:
    data = _contract_data(case)

    result = validate_contract_payload(data)

    assert result["ok"], result["errors"]
    if case["referenceProposal"]["type"] == "naturalLanguage":
        rule = data["rules"][0]
        examples = run_rule_examples(data, rule, rule["params"]["examples"])
        assert examples["ok"], examples


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_reference_rule_flags_exactly_the_expected_rows(case: dict[str, Any]) -> None:
    expected = {(item["sheet"], item["row"]) for item in case["expectedFailures"]}

    status, failures = _failures(case, "violating")

    expected_status = "WARNING" if case.get("expectedSeverity") == "Warning" else "FAILED"
    assert status == expected_status
    assert failures == expected


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_reference_rule_passes_clean_data(case: dict[str, Any]) -> None:
    status, failures = _failures(case, "clean")

    assert (status, failures) == ("PASSED", set())
