from __future__ import annotations

from datetime import date
from typing import Any

from dq_engine.contracts.models import (
    DefinitionContract,
    NaturalLanguageRule,
    RuleConfig,
)
from dq_engine.rules import sqlguard
from dq_engine.rules.base import RuleConfigurationError


def table_name(sheet: str | None) -> str:
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
            table_name(table.sheet)
            for table in contract.tables
            if table.sheet and table.sheet.strip().casefold() == requested.strip().casefold()
        ),
        None,
    )
    return match


def contract_structure_errors(contract: DefinitionContract) -> list[dict[str, str]]:
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


def contract_rule_errors(
    contract: DefinitionContract,
    rule: RuleConfig,
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    tables = {table_name(table.sheet).strip().casefold(): table for table in contract.tables}

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
            for name, columns in columns_by_table.items():
                references.extend((name, column) for column in columns)
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

    for referenced_table, column_name in references:
        canonical_name = _canonical_table(
            contract,
            referenced_table,
            allow_single_alias=rule_type == "naturalLanguage",
        )
        if canonical_name is None:
            errors.append({
                "path": "$.params",
                "message": f'Rule references undeclared table "{referenced_table}".',
            })
            continue
        definition = tables.get(canonical_name.strip().casefold())
        if definition is None:
            errors.append({
                "path": "$.params",
                "message": f'Rule references undeclared table "{referenced_table}".',
            })
            continue
        declared = {column.name.strip().casefold() for column in definition.columns}
        rule_columns: set[str] = set()
        if rule_type == "naturalLanguage":
            rule_columns = {
                column.strip().casefold()
                for name, columns in params["columns"].items()
                if name.strip().casefold() == referenced_table.strip().casefold()
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
                "message": f'Rule references undeclared column "{column_name}" in table "{referenced_table}".',
            })

    if isinstance(rule, NaturalLanguageRule) and rule.params.mode == "query":
        table_mapping: dict[str, list[str]] = {}
        for index, table in enumerate(contract.tables):
            name = table_name(table.sheet)
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
                # A cross-sheet query reads only the sheets it declares.
                continue
            table_mapping[f"t_{index}"] = [*mapping, "__row"]
        if not table_mapping:
            errors.append({
                "path": "$.params.columns",
                "message": "Query-mode rules must declare columns for at least one table.",
            })
            return errors
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
