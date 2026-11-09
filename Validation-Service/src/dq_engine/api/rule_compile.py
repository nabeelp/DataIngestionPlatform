from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from dq_engine.api.contract_checks import table_name
from dq_engine.contracts.models import DefinitionContract, RuleConfig
from dq_engine.engine import validate_parsed
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable


def _sample_value(column_type: str) -> str:
    return {
        "integer": "1",
        "decimal": "1.0",
        "date": "2025-01-15",
        "datetime": "2025-01-15 00:00:00",
        "boolean": "true",
    }.get(column_type, "sample")


def compile_rule(contract: DefinitionContract, rule: RuleConfig) -> list[dict[str, str]]:
    rule_data = rule.model_dump(by_alias=True, exclude_none=True)
    params: dict[str, Any] = rule_data["params"]
    rule_type = str(rule_data["type"])
    columns_by_table: dict[str, list[str]] = {}
    for definition in contract.tables:
        name = table_name(definition.sheet)
        columns = [column.name for column in definition.columns]
        rule_column_map: dict[str, list[str]] = (
            params.get("columns", {}) if rule_type == "naturalLanguage" else {}
        )
        for mapped_name, declared in rule_column_map.items():
            if mapped_name.strip().casefold() in {name.strip().casefold(), ""}:
                columns.extend(declared)
        if contract.layout == "single" and len(rule_column_map) == 1:
            columns.extend(next(iter(rule_column_map.values())))
        if rule_type == "reconcile":
            for reference in (params["left"], params["right"]):
                if reference["table"].strip().casefold() == name.strip().casefold():
                    columns.append(reference["column"])
        columns = list(dict.fromkeys(columns))
        columns_by_table[name] = columns

    parsed_tables: dict[str, ParsedTable] = {}
    for definition in contract.tables:
        name = table_name(definition.sheet)
        columns = columns_by_table[name]
        values = {
            column: [
                _sample_value(next(
                    (
                        item.type
                        for item in definition.columns
                        if item.name.strip().casefold() == column.strip().casefold()
                    ),
                    "string",
                ))
            ]
            for column in columns
        }
        frame = pl.DataFrame(values, schema={column: pl.String for column in columns})
        parsed_tables[name] = ParsedTable(
            name=name,
            definition=definition,
            frame=frame,
            row_numbers=[(definition.headerRow or 1) + 1],
            source_columns=columns,
        )

    parsed = ParsedFile(
        metadata=FileMetadata(Path("<rule-validation>"), "csv", "utf-8", ","),
        tables=parsed_tables,
    )
    result = validate_parsed(
        parsed,
        contract.model_copy(update={"rules": [rule]}),
        date(2025, 1, 15),
    )
    check = next((item for item in result.checks if item.id == rule.id), None)
    if check is None:
        return [{"path": "$.rule", "message": "Rule did not produce an execution result."}]
    if check.status == "ERROR":
        return [{"path": "$.rule", "message": check.issues[0].message}]
    return []
