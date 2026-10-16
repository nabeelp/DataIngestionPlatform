"""Regression suite: validates every upload sample and compares the result with a reviewed snapshot.

`expected_outcomes.json` records the engine's behaviour (status, failing/warning checks, row count) for each
sample in samples/manifest.json. Behaviour changes must be reviewed: regenerate the snapshot with

    UPDATE_GOLDEN=1 uv run pytest tests/golden -q

and inspect the diff. Samples missing locally (git-ignored large files) are skipped and keep their snapshot.
`samples/manifest.json` records the product expectation per sample; where the engine intentionally differs
(for example mixed date formats are reported as FAILED), the snapshot is the engine truth.
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_file
from dq_engine.io.models import UnrecoverableFileError

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = ROOT / "samples"
SNAPSHOT_PATH = Path(__file__).parent / "expected_outcomes.json"
MANIFEST = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))
DEFINITIONS = json.loads(
    (SAMPLES / "definitions" / "sample_definitions.json").read_text(encoding="utf-8")
)
ALLOWED_UPLOAD_EXTENSIONS = {".csv", ".tsv", ".txt", ".xlsx", ".xls"}
WORKBOOK_EXTENSIONS = {".xls", ".xlsx"}
VALIDATION_DATE = date(2026, 1, 1)
UPLOADS = [entry for entry in MANIFEST["files"] if entry["kind"] == "upload"]
SNAPSHOT: dict[str, dict[str, Any]] = (
    json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8")) if SNAPSHOT_PATH.exists() else {}
)
UPDATE = os.getenv("UPDATE_GOLDEN") == "1"


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
        raise ValueError(f"Unsupported sample rule expression: {expression}")
    return column.strip(), value.strip()


def _rule(rule: dict[str, Any], definition_id: str, index: int) -> dict[str, Any]:
    rule_type = rule["ruleType"]
    column, value = _expression_parts(rule["expression"])
    params: dict[str, Any]
    if rule_type == "Enum Check":
        kind = "enum"
        params = {"column": column, "values": [item.strip() for item in value.split(",") if item.strip()]}
    elif rule_type == "Range Check":
        minimum, separator, maximum = value.partition("..")
        if not separator:
            raise ValueError(f"Unsupported range expression: {rule['expression']}")
        kind = "range"
        params = {
            "column": column,
            "min": float(minimum) if minimum.strip() else None,
            "max": float(maximum) if maximum.strip() else None,
        }
    else:
        raise ValueError(f"Unsupported sample rule type: {rule_type}")

    return {
        "id": f"{definition_id}-{index + 1}",
        "name": rule["name"],
        "description": rule.get("description", ""),
        "severity": rule["severity"],
        "executionOrder": index,
        "enabled": True,
        "table": rule.get("table"),
        "type": kind,
        "params": params,
    }


def _contract(definition_id: str) -> DefinitionContract:
    definition = DEFINITIONS[definition_id]
    sheet_tables = definition["tables"]
    tables = sheet_tables or [{"sheet": None, "columns": definition["columns"]}]
    return DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": "sheets" if sheet_tables else "single",
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
        "rules": [_rule(rule, definition_id, index) for index, rule in enumerate(definition["rules"])],
        "lookups": {},
    })


def _check_name(name: str, single_layout: bool) -> str:
    # Single-layout files report one structural check per column group; the manifest names it once.
    return "File definition columns" if single_layout and name.startswith('Sheet "') else name


def _actual(entry: dict[str, Any]) -> dict[str, Any]:
    sample_path = SAMPLES / entry["file"]
    contract = _contract(entry["definition"])
    extension = sample_path.suffix.lower()

    if extension not in ALLOWED_UPLOAD_EXTENSIONS or sample_path.stat().st_size > MANIFEST["uploadLimitBytes"]:
        return {"status": "UPLOAD_REJECTED"}
    if contract.layout == "sheets" and extension not in WORKBOOK_EXTENSIONS:
        return {"status": "UPLOAD_REJECTED"}

    try:
        outcome = validate_file(sample_path, contract, VALIDATION_DATE)
    except UnrecoverableFileError:
        return {"status": "READ_ERROR"}

    single = contract.layout == "single"
    failed = {_check_name(check.name, single) for check in outcome.checks if check.status in {"FAILED", "ERROR"}}
    warned = {_check_name(check.name, single) for check in outcome.checks if check.status == "WARNING"}
    return {
        "status": outcome.status,
        "failedChecks": sorted(failed),
        "warningChecks": sorted(warned - failed),
        "rows": sum(outcome.row_counts.values()),
    }


@pytest.mark.parametrize("entry", UPLOADS, ids=lambda entry: entry["file"])
def test_sample_matches_snapshot(entry: dict[str, Any]) -> None:
    if not (SAMPLES / entry["file"]).exists():
        pytest.skip("Sample not generated locally (large files are git-ignored).")

    actual = _actual(entry)
    if UPDATE:
        SNAPSHOT[entry["file"]] = actual
        SNAPSHOT_PATH.write_text(
            json.dumps(dict(sorted(SNAPSHOT.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return

    assert entry["file"] in SNAPSHOT, f"{entry['file']} has no snapshot; run with UPDATE_GOLDEN=1 and review."
    assert actual == SNAPSHOT[entry["file"]], entry["file"]


def test_snapshot_covers_only_manifest_samples() -> None:
    assert set(SNAPSHOT) <= {entry["file"] for entry in UPLOADS}


def test_sample_definitions_use_only_supported_rule_types() -> None:
    rule_types = {rule["ruleType"] for definition in DEFINITIONS.values() for rule in definition["rules"]}

    assert rule_types == {"Enum Check", "Range Check"}
    assert all(_contract(definition_id).rules for definition_id in DEFINITIONS)
