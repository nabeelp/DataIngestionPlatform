"""Score the data behavior of rules produced by Back-End/scripts/eval-nl-rules.ts.

Each generated rule is run through the real validation engine against the golden case's violating and clean sample
data. A rule scores when it flags exactly the expected rows on the violating data and nothing on the clean data.

Usage: python scripts/score_nl_eval.py <eval-report.json> [--corpus samples/nl-rules/golden.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from dq_engine.contracts.models import DefinitionContract
from dq_engine.engine import validate_parsed
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable

ROOT = Path(__file__).resolve().parents[2]
VALIDATION_DATE = date(2025, 1, 15)


def _contract(corpus: dict[str, Any], case: dict[str, Any], rule: dict[str, Any]) -> DefinitionContract:
    definition = corpus["definitions"][case["definition"]]
    return DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": definition["layout"],
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [
            {
                "sheet": table["sheet"], "headerRow": 1, "allowExtraColumns": True, "minRows": None, "maxRows": None,
                "columns": [
                    {"name": name, "type": column_type, "mustExist": True, "nullable": True}
                    for name, column_type in table["columns"]
                ],
            }
            for table in definition["tables"]
        ],
        "rules": [rule],
        "lookups": {},
    })


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


def _flagged(
    contract: DefinitionContract,
    data: dict[str, list[dict[str, Any]]],
    rule_id: str,
) -> tuple[str, set[tuple[str | None, int | None]]]:
    outcome = validate_parsed(_parsed(contract, data), contract, VALIDATION_DATE)
    check = next(item for item in outcome.checks if item.id == rule_id)
    return check.status, {
        (item.sheet or None, item.issue.row) for item in outcome.report_issues if item.check_id == rule_id
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--corpus", type=Path, default=ROOT / "samples" / "nl-rules" / "golden.json")
    arguments = parser.parse_args()
    corpus = json.loads(arguments.corpus.read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in corpus["cases"]}
    report = json.loads(arguments.report.read_text(encoding="utf-8"))

    totals: dict[str, dict[str, int]] = defaultdict(lambda: {"scored": 0, "behaviorMatch": 0, "unrunnable": 0})
    for result in report["results"]:
        case = cases[result["id"]]
        rule = result.get("config")
        if rule is None or "expectedFailures" not in case:
            continue
        category = totals[case["category"]]
        category["scored"] += 1
        try:
            contract = _contract(corpus, case, rule)
            expected = {(item["sheet"], item["row"]) for item in case["expectedFailures"]}
            _, violating = _flagged(contract, case["data"]["violating"], rule["id"])
            clean_status, clean = _flagged(contract, case["data"]["clean"], rule["id"])
            matched = violating == expected and clean_status == "PASSED" and not clean
        except Exception as error:  # noqa: BLE001 - a generated rule can fail in any way; report and continue
            category["unrunnable"] += 1
            print(f"ERROR {case['id']}: {type(error).__name__}: {error}")
            continue
        category["behaviorMatch"] += int(matched)
        print(f"{'ok  ' if matched else 'MISS'} {case['id']}")

    print("\nBehavior scoring by category (rows flagged on violating data, nothing on clean data):")
    for name, values in sorted(totals.items()):
        print(f"  {name:12} {values['behaviorMatch']}/{values['scored']} match, {values['unrunnable']} unrunnable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
