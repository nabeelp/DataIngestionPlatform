from __future__ import annotations

from typing import Any

import polars as pl

from dq_engine.rules.base import RuleConfigurationError, RuleContext
from dq_engine.rules.sqlguard import substitute_validation_date, validate_row_expression


def row_failure_expr(ctx: RuleContext, params: dict[str, Any]) -> pl.Expr | None:
    if params["mode"] == "query":
        return None
    columns_by_table = params["columns"]
    if not isinstance(columns_by_table, dict):
        raise RuleConfigurationError("Natural-language rule columns must be mapped by table.")
    table_columns = next(
        (
            columns
            for table, columns in columns_by_table.items()
            if str(table).strip().casefold() == ctx.table.name.strip().casefold()
        ),
        None,
    )
    if table_columns is None and len(columns_by_table) == 1:
        table_columns = next(iter(columns_by_table.values()))
    if not isinstance(table_columns, list):
        raise RuleConfigurationError("Natural-language row rule has no declared columns for its table.")
    columns = [ctx.actual_column(str(column)) for column in table_columns]
    sql = substitute_validation_date(str(params.get("failWhen") or ""), ctx.validation_date)
    expression = validate_row_expression(sql, columns)
    failure = pl.sql_expr(expression)
    return (~pl.any_horizontal([ctx.empty(column) for column in columns])) & failure


def file_check(ctx: RuleContext, params: dict[str, Any]) -> None:
    raise RuleConfigurationError("Query-mode rules are evaluated by the validation runner.")


def describe(params: dict[str, Any]) -> str:
    return str(params["explanation"])
