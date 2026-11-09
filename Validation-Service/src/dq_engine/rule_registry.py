from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from dq_engine.contracts.models import DefinitionContract, RuleConfig
from dq_engine.io.models import ParsedTable
from dq_engine.rules import (
    aggregate,
    compare,
    conditional_required,
    date_range,
    enum,
    length,
    lookup,
    natural_language,
    pattern,
    reconcile,
    row_count,
    unique,
)
from dq_engine.rules import (
    range as range_rule,
)
from dq_engine.rules.base import RuleContext

RULE_MODULES: dict[str, Any] = {
    "enum": enum,
    "range": range_rule,
    "pattern": pattern,
    "length": length,
    "unique": unique,
    "lookup": lookup,
    "dateRange": date_range,
    "conditionalRequired": conditional_required,
    "compare": compare,
    "rowCount": row_count,
    "aggregate": aggregate,
    "reconcile": reconcile,
    "naturalLanguage": natural_language,
}


@dataclass(slots=True)
class CompiledRule:
    config: dict[str, Any]
    module: Any
    context: RuleContext
    failure_column: str
    compile_elapsed_ms: int


def rule_data_for(rule: RuleConfig) -> dict[str, Any]:
    data = rule.model_dump(by_alias=True, exclude_none=True)
    data.setdefault("table", None)
    return data


def rule_table(rule_data: dict[str, Any], contract: DefinitionContract) -> str | None:
    target = rule_data["table"]
    if target is None and contract.layout == "single":
        return contract.tables[0].sheet or ""
    return target if isinstance(target, str) else None


def matches_table(rule: RuleConfig, contract: DefinitionContract, table: ParsedTable) -> bool:
    target = rule_table(rule_data_for(rule), contract)
    if contract.layout == "single":
        return rule.table is None or (
            isinstance(target, str) and table.name.strip().casefold() == target.strip().casefold()
        )
    return isinstance(target, str) and table.name.strip().casefold() == target.strip().casefold()


def columns_for(rule_data: dict[str, Any]) -> set[str]:
    params = rule_data["params"]
    rule_type = rule_data["type"]
    if rule_type == "unique":
        return {str(item) for item in params["columns"]}
    if rule_type in {"enum", "range", "pattern", "length", "lookup", "dateRange"}:
        return {str(params["column"])}
    if rule_type == "conditionalRequired":
        return {str(params["when"]["column"]), *map(str, params["columns"])}
    if rule_type == "compare":
        return {str(params["left"]), str(params["right"])}
    if rule_type == "aggregate":
        return {str(params["column"])}
    if rule_type == "naturalLanguage":
        columns_by_table = params["columns"]
        return {
            str(column)
            for columns in columns_by_table.values()
            for column in columns
        } if isinstance(columns_by_table, dict) else set()
    return set()


def make_context(parsed: ParsedTable, contract: DefinitionContract, validation_date: date) -> RuleContext:
    lookups = {key: lookup_definition.values for key, lookup_definition in contract.lookups.items()}
    return RuleContext(parsed, validation_date, lookups)
