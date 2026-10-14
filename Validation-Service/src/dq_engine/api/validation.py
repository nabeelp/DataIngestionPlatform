from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
from jsonschema import Draft7Validator, FormatChecker
from pydantic import TypeAdapter, ValidationError
from referencing import Registry, Resource

from dq_engine.contracts.models import (
    DefinitionContract,
    NaturalLanguageRule,
    RuleConfig,
)
from dq_engine.engine import validate_parsed
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable
from dq_engine.rules import sqlguard
from dq_engine.rules.base import RuleConfigurationError
from dq_engine.rules.examples import run_examples

_ROOT = Path(__file__).resolve().parents[4]
_CONTRACTS = _ROOT / "contracts"
_RULE_ADAPTER: TypeAdapter[RuleConfig] = TypeAdapter(RuleConfig)
_RULE_SCHEMA = json.loads((_CONTRACTS / "rule-config.schema.json").read_text(encoding="utf-8"))
_SCHEMA_REGISTRY = Registry().with_resource(
    _RULE_SCHEMA["$id"],
    Resource.from_contents(_RULE_SCHEMA),
)


def _schema_errors(schema_name: str, payload: object) -> list[dict[str, str]]:
    schema_path = _CONTRACTS / schema_name
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft7Validator(
        schema,
        registry=_SCHEMA_REGISTRY,
        format_checker=FormatChecker(),
    )
    errors = sorted(
        validator.iter_errors(payload),
        key=lambda error: tuple(
            (type(part).__name__, str(part))
            for part in error.absolute_path
        ),
    )
    return [
        {
            "path": "$" + "".join(
                f"[{part}]" if isinstance(part, int) else f".{part}"
                for part in error.absolute_path
            ),
            "message": error.message,
        }
        for error in errors[:50]
    ]


def _pydantic_errors(error: ValidationError) -> list[dict[str, str]]:
    return [
        {
            "path": "$" + "".join(
                f"[{part}]" if isinstance(part, int) else f".{part}"
                for part in item["loc"]
            ),
            "message": item["msg"],
        }
        for item in error.errors(include_input=False)[:50]
    ]


def _table_name(sheet: str | None) -> str:
    return sheet or ""


def _canonical_table(
    contract: DefinitionContract,
    requested: str,
    *,
    allow_single_alias: bool = False,
) -> str | None:
    if contract.layout == "single":
        if allow_single_alias or requested.strip().casefold() in {"", contract.tables[0].sheet or ""}:
            return ""
        return None
    match = next(
        (
            _table_name(table.sheet)
            for table in contract.tables
            if table.sheet and table.sheet.strip().casefold() == requested.strip().casefold()
        ),
        None,
    )
    return match


def _contract_structure_errors(contract: DefinitionContract) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if contract.layout == "sheets":
        normalized = [table.sheet.strip().casefold() for table in contract.tables if table.sheet]
        if len(normalized) != len(set(normalized)):
            errors.append({"path": "$.tables", "message": "Table sheet names must be unique."})
    for index, table in enumerate(contract.tables):
        names = [column.name.strip().casefold() for column in table.columns]
        if len(names) != len(set(names)):
            errors.append({
                "path": f"$.tables[{index}].columns",
                "message": "Column names must be unique, ignoring case and surrounding whitespace.",
            })
    return errors


def _contract_rule_errors(
    contract: DefinitionContract,
    rule: RuleConfig,
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    tables = {_table_name(table.sheet).strip().casefold(): table for table in contract.tables}

    rule_data = rule.model_dump(by_alias=True, exclude_none=True)
    params: dict[str, Any] = rule_data["params"]
    references: list[tuple[str, str]] = []
    rule_type = str(rule_data["type"])
    target = rule.table
    if rule_type == "reconcile":
        references.extend(
            (str(reference["table"]), str(reference["column"]))
            for reference in (params["left"], params["right"])
        )
    elif rule_type == "naturalLanguage":
        columns_by_table: dict[str, list[str]] = params["columns"]
        if params["mode"] == "query":
            for table_name, columns in columns_by_table.items():
                references.extend((table_name, column) for column in columns)
        else:
            if contract.layout == "single":
                configured_items = list(columns_by_table.items())
                if len(configured_items) != 1:
                    errors.append({
                        "path": "$.params.columns",
                        "message": "A single-layout row rule must declare one table's columns.",
                    })
                references.extend(("", column) for column in (
                    configured_items[0][1] if configured_items else []
                ))
            elif target is not None:
                target_name = _canonical_table(contract, target)
                configured_columns = next(
                    (
                        columns
                        for name, columns in columns_by_table.items()
                        if name.strip().casefold() == target.strip().casefold()
                    ),
                    [],
                )
                references.extend((target_name or target, column) for column in configured_columns)
                if not configured_columns:
                    errors.append({
                        "path": "$.params.columns",
                        "message": "A row rule must declare columns for its target table.",
                    })
    elif rule_type == "unique":
        references.extend((target or "", str(column)) for column in params["columns"])
    elif rule_type in {"enum", "range", "pattern", "length", "lookup", "dateRange", "aggregate"}:
        references.append((target or "", str(params["column"])))
    elif rule_type == "conditionalRequired":
        references.extend((target or "", str(column)) for column in params["columns"])
        references.append((target or "", str(params["when"]["column"])))
    elif rule_type == "compare":
        references.extend(
            (target or "", str(params[key]))
            for key in ("left", "right")
        )

    global_rule = rule_type == "reconcile" or (
        rule_type == "naturalLanguage" and params["mode"] == "query"
    )
    if contract.layout == "sheets" and not global_rule:
        if target is None or _canonical_table(contract, target) is None:
            errors.append({
                "path": "$.table",
                "message": "A sheet-layout rule must target a declared table.",
            })
    elif target is not None and contract.layout == "single":
        if _canonical_table(contract, target) is None:
            errors.append({
                "path": "$.table",
                "message": "A single-layout rule cannot target an undeclared table.",
            })

    for table_name, column_name in references:
        canonical_name = _canonical_table(
            contract,
            table_name,
            allow_single_alias=rule_type == "naturalLanguage",
        )
        if canonical_name is None:
            errors.append({
                "path": "$.params",
                "message": f'Rule references undeclared table "{table_name}".',
            })
            continue
        definition = tables.get(canonical_name.strip().casefold())
        if definition is None:
            errors.append({
                "path": "$.params",
                "message": f'Rule references undeclared table "{table_name}".',
            })
            continue
        declared = {column.name.strip().casefold() for column in definition.columns}
        rule_columns: set[str] = set()
        if rule_type == "naturalLanguage":
            rule_columns = {
                column.strip().casefold()
                for name, columns in params["columns"].items()
                if name.strip().casefold() == table_name.strip().casefold()
                for column in columns
            }
            if contract.layout == "single" and len(params["columns"]) == 1:
                rule_columns.update(
                    column.strip().casefold()
                    for columns in params["columns"].values()
                    for column in columns
                )
        if column_name.strip().casefold() not in declared | rule_columns:
            errors.append({
                "path": "$.params",
                "message": f'Rule references undeclared column "{column_name}" in table "{table_name}".',
            })

    if isinstance(rule, NaturalLanguageRule) and rule.params.mode == "query":
        table_mapping: dict[str, list[str]] = {}
        for index, table in enumerate(contract.tables):
            name = _table_name(table.sheet)
            mapping = next(
                (
                    columns
                    for key, columns in rule.params.columns.items()
                    if key.strip().casefold() == name.strip().casefold()
                ),
                None,
            )
            if mapping is None and contract.layout == "single" and len(rule.params.columns) == 1:
                mapping = next(iter(rule.params.columns.values()))
            if mapping is None:
                errors.append({
                    "path": "$.params.columns",
                    "message": f'Query-mode columns for table "{name}" are missing.',
                })
                continue
            table_mapping[f"t_{index}"] = [*mapping, "__row"]
        try:
            sqlguard.validate_query(
                sqlguard.substitute_validation_date(
                    rule.params.query or "",
                    date(2025, 1, 15),
                ),
                table_mapping,
            )
        except RuleConfigurationError as error:
            errors.append({"path": "$.params.query", "message": str(error)})
    elif isinstance(rule, NaturalLanguageRule):
        try:
            sqlguard.validate_row_expression(
                sqlguard.substitute_validation_date(
                    rule.params.failWhen or "",
                    date(2025, 1, 15),
                ),
                [column for _, column in references],
            )
        except RuleConfigurationError as error:
            errors.append({"path": "$.params.failWhen", "message": str(error)})
    return errors


def _sample_value(column_type: str) -> str:
    return {
        "integer": "1",
        "decimal": "1.0",
        "date": "2025-01-15",
        "datetime": "2025-01-15 00:00:00",
        "boolean": "true",
    }.get(column_type, "sample")


def _compile_rule(contract: DefinitionContract, rule: RuleConfig) -> list[dict[str, str]]:
    rule_data = rule.model_dump(by_alias=True, exclude_none=True)
    params: dict[str, Any] = rule_data["params"]
    rule_type = str(rule_data["type"])
    columns_by_table: dict[str, list[str]] = {}
    for definition in contract.tables:
        name = _table_name(definition.sheet)
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
        name = _table_name(definition.sheet)
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


def _single_rule_context(contract_data: object) -> object:
    # Other draft rules are validated at publication, not while authoring this candidate.
    if isinstance(contract_data, dict) and isinstance(contract_data.get("rules"), list):
        return {**contract_data, "rules": []}
    return contract_data


def validate_rule_payload(contract_data: object, rule_data: object) -> dict[str, Any]:
    contract_data = _single_rule_context(contract_data)
    errors = _schema_errors("definition-contract.schema.json", contract_data)
    if errors:
        return {"ok": False, "errors": errors, "normalizedRule": None, "explanation": None}
    try:
        contract = DefinitionContract.model_validate(contract_data)
        rule = _RULE_ADAPTER.validate_python(rule_data)
    except ValidationError as error:
        return {"ok": False, "errors": _pydantic_errors(error), "normalizedRule": None, "explanation": None}
    errors = _contract_structure_errors(contract)
    errors.extend(_contract_rule_errors(contract, rule))
    if not errors:
        errors.extend(_compile_rule(contract, rule))
    explanation = rule.params.explanation if isinstance(rule, NaturalLanguageRule) else rule.description
    return {
        "ok": not errors,
        "errors": errors,
        "normalizedRule": rule.model_dump(by_alias=True),
        "explanation": explanation,
    }


def validate_contract_payload(contract_data: object) -> dict[str, Any]:
    errors = _schema_errors("definition-contract.schema.json", contract_data)
    if errors:
        return {"ok": False, "errors": errors}
    try:
        contract = DefinitionContract.model_validate(contract_data)
    except ValidationError as error:
        return {"ok": False, "errors": _pydantic_errors(error)}

    errors = _contract_structure_errors(contract)
    for rule_index, rule in enumerate(contract.rules):
        rule_errors = _contract_rule_errors(contract, rule)
        if not rule_errors:
            rule_errors.extend(_compile_rule(contract, rule))
        errors.extend(
            {
                "path": f"$.rules[{rule_index}]{item['path'][1:]}",
                "message": item["message"],
            }
            for item in rule_errors
        )
        if isinstance(rule, NaturalLanguageRule):
            examples = run_examples(contract, rule, validation_date=date(2025, 1, 15))
            errors.extend(
                {
                    "path": f"$.rules[{rule_index}].params.examples[{example.index - 1}]",
                    "message": example.error or (
                        "Example result does not match expectedValid."
                    ),
                }
                for example in examples
                if not example.passed
            )
    return {"ok": not errors, "errors": errors}


def test_rule_examples(
    contract_data: object,
    rule_data: object,
    examples_data: object | None,
) -> dict[str, Any]:
    contract_data = _single_rule_context(contract_data)
    validation = validate_rule_payload(contract_data, rule_data)
    if not validation["ok"]:
        return {"ok": False, "errors": validation["errors"], "results": []}
    try:
        contract = DefinitionContract.model_validate(contract_data)
        rule = _RULE_ADAPTER.validate_python(rule_data)
    except ValidationError as error:
        return {"ok": False, "errors": _pydantic_errors(error), "results": []}
    if not isinstance(rule, NaturalLanguageRule):
        return {
            "ok": False,
            "errors": [{"path": "$.rule.type", "message": "Example tests require a Natural Language rule."}],
            "results": [],
        }
    try:
        from dq_engine.contracts.models import NaturalLanguageExample

        if examples_data is not None and not isinstance(examples_data, list):
            return {
                "ok": False,
                "errors": [{"path": "$.examples", "message": "Examples must be an array."}],
                "results": [],
            }
        examples = (
            [NaturalLanguageExample.model_validate(item) for item in examples_data]
            if examples_data is not None
            else None
        )
    except (TypeError, ValidationError) as error:
        details = _pydantic_errors(error) if isinstance(error, ValidationError) else [
            {"path": "$.examples", "message": "Examples must be an array."}
        ]
        return {"ok": False, "errors": details, "results": []}
    results = run_examples(contract, rule, examples, date(2025, 1, 15))
    return {
        "ok": all(result.passed for result in results),
        "errors": [],
        "results": [
            {
                "index": result.index,
                "table": result.table,
                "expectedValid": result.expected_valid,
                "actualValid": result.actual_valid,
                "passed": result.passed,
                "error": result.error,
            }
            for result in results
        ],
    }
